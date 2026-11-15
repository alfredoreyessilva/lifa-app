// Pruebas de las compras en la vitrina (README, "Compras en la vitrina"): lo que
// se calcula sin la base —qué se puede comprar, tallas y existencias, el carrito,
// los totales, qué le falta a una tienda, el estado de un pedido— y lo de Mercado
// Pago que no toca la red —las llaves cifradas, el enlace para conectar, la firma
// de un aviso y el cobro—. Al final, que las listas viajen igual en el esquema, el
// backend y el frontend (regla 6).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as compras from '../../src/utils/compras.js';
import {
  ACCIONES_DE_LA_TIENDA, FORMAS_DE_ENTREGA, ESTADOS_DEL_PEDIDO, TIPOS_DE_RENGLON,
  accionPermitida, costoDeEnvio, entregasDeLaTienda, esComprable, estadoDelPedido,
  existenciasDe, existenciasSiguenValiendo, faltaParaVender, historiaDe, leerExistenciasPorTalla,
  pedidoDeLaReferencia, puedeVender, referenciaDe, revisarCarrito, tallasDe, tallasParaElegir,
  totalesDe, validarAjustes, validarComprador, validarDireccion,
} from '../../src/utils/compras.js';
import {
  cifrar, cobroDe, conexionDe, descifrar, enlaceParaConectar, estadoParaConectar, faltanVariables,
  firmaDelAvisoValida, firmarAviso, leerEstadoParaConectar, manifiestoDelAviso, pagoCuadra, renglonDePago,
} from '../../src/utils/mercadoPago.js';
import * as frontend from '../../../frontend/src/utils/compras.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const leer = (relativo) => fs.readFileSync(path.join(RAIZ, relativo), 'utf8');

const producto = (id, extra = {}) => ({
  id, name: `Producto ${id}`, price: '850', currency: 'MXN', stock: 10, size_stock: null,
  size_variant: null, image_url: null, is_active: true, show_on_platform: true, ...extra,
});

// ── Qué se puede comprar ─────────────────────────────────────────────────

test('se compra lo activo, en la vitrina, en pesos y con precio', () => {
  assert.ok(esComprable(producto(1)));
  assert.ok(!esComprable(producto(1, { price: null })), 'precio a consultar');
  assert.ok(!esComprable(producto(1, { price: '0' })));
  assert.ok(!esComprable(producto(1, { currency: 'USD' })));
  assert.ok(!esComprable(producto(1, { is_active: false })));
  assert.ok(!esComprable(producto(1, { show_on_platform: false })));
  // La lista pública no trae esas dos columnas: ya viene filtrada.
  assert.ok(esComprable({ id: 1, price: '850.50', currency: 'MXN' }));
});

test('las tallas salen del texto que la tienda ya tenía, sin repetidas ni vacías', () => {
  assert.deepEqual(tallasDe('S, M, L, XL'), ['S', 'M', 'L', 'XL']);
  assert.deepEqual(tallasDe(' S ,, m , M ,L'), ['S', 'm', 'L']);
  assert.deepEqual(tallasDe(null), []);
  assert.deepEqual(tallasParaElegir('Unitalla'), [], 'con una sola no hay nada que elegir');
  assert.deepEqual(tallasParaElegir('Chica, Grande'), ['Chica', 'Grande']);
});

test('las existencias por talla son de todas las tallas o de ninguna, y el número es su suma', () => {
  assert.deepEqual(leerExistenciasPorTalla({ S: 2, M: '0', L: 3 }, 'S, M, L'), { sizeStock: { S: 2, M: 0, L: 3 }, stock: 5 });
  assert.deepEqual(leerExistenciasPorTalla(null, 'S, M'), { sizeStock: null });
  assert.deepEqual(leerExistenciasPorTalla({ S: '', M: null }, 'S, M'), { sizeStock: null }, 'vacías es un solo número');
  assert.match(leerExistenciasPorTalla({ S: 2 }, 'S, M').error, /todas las tallas/);
  assert.match(leerExistenciasPorTalla({ XL: 1, S: 1 }, 'S, M').error, /XL/);
  assert.match(leerExistenciasPorTalla({ S: -1, M: 1 }, 'S, M').error, /entero/);
  assert.match(leerExistenciasPorTalla({ S: 1.5, M: 1 }, 'S, M').error, /entero/);
  assert.match(leerExistenciasPorTalla({ U: 1 }, 'Unitalla').error, /dos o más/);
  assert.match(leerExistenciasPorTalla([1, 2], 'S, M').error, /formato/);
});

test('cambiar las tallas deja sin valor las existencias por talla viejas', () => {
  assert.ok(existenciasSiguenValiendo({ S: 1, M: 2 }, 'M, S'));
  assert.ok(!existenciasSiguenValiendo({ S: 1, M: 2 }, 'S, M, L'));
  assert.ok(!existenciasSiguenValiendo({ S: 1, M: 2 }, 'Unitalla'));
  assert.ok(existenciasSiguenValiendo(null, 'cualquier cosa'));
});

test('las existencias de una talla salen de la talla, o del producto; sin cuenta es null', () => {
  const jersey = producto(1, { size_variant: 'S, M', size_stock: { S: 0, M: 4 }, stock: 4 });
  assert.equal(existenciasDe(jersey, 'S'), 0);
  assert.equal(existenciasDe(jersey, 'M'), 4);
  assert.equal(existenciasDe(producto(2, { stock: 7 }), null), 7);
  assert.equal(existenciasDe(producto(3, { stock: null }), 'M'), null, 'sin registrar no es cero');
});

// ── El carrito ───────────────────────────────────────────────────────────

test('el carrito se cobra al precio de hoy, no al que mande el navegador, y junta lo repetido', () => {
  const productos = [producto(1, { price: '850.50' }), producto(2, { price: '100' })];
  const { renglones, problemas } = revisarCarrito([
    { product_id: 1, quantity: 1, price: '1' },
    { product_id: 1, quantity: 2 },
    { product_id: 2, quantity: 3 },
  ], productos);
  assert.deepEqual(problemas, []);
  assert.equal(renglones.length, 2);
  assert.equal(renglones[0].quantity, 3);
  assert.equal(renglones[0].unit_price, 850.5);
  assert.equal(renglones[0].line_cents, 255150);
  assert.equal(renglones[1].line_total, 300);
});

test('el carrito dice qué no se puede cobrar, renglón por renglón', () => {
  const productos = [
    producto(1, { size_variant: 'S, M', size_stock: { S: 1, M: 0 }, stock: 1 }),
    producto(2, { price: null }),
    producto(3, { stock: 2 }),
  ];
  const { problemas } = revisarCarrito([
    { product_id: 1, size: 'M', quantity: 1 },
    { product_id: 1, quantity: 1 },
    { product_id: 2, quantity: 1 },
    { product_id: 3, quantity: 11 },
    { product_id: 99, quantity: 1 },
  ], productos);
  const por = Object.fromEntries(problemas.map((p) => [`${p.product_id}|${p.size ?? ''}`, p]));
  assert.equal(por['1|M'].problema, 'sin_existencias');
  assert.equal(por['1|M'].disponibles, 0);
  assert.equal(por['1|'].problema, 'talla');
  assert.equal(por['2|'].problema, 'no_disponible');
  assert.equal(por['3|'].problema, 'cantidad');
  assert.equal(por['99|'].problema, 'no_disponible');
  assert.deepEqual(revisarCarrito([], productos).problemas, [{ problema: 'vacio' }]);
});

test('dos tallas de un producto sin cuenta por talla salen del mismo número', () => {
  const productos = [producto(1, { size_variant: 'M, L', stock: 3 })];
  const { problemas } = revisarCarrito([
    { product_id: 1, size: 'M', quantity: 2 },
    { product_id: 1, size: 'L', quantity: 2 },
  ], productos);
  assert.equal(problemas.length, 2, 'cuatro piezas de tres: los dos renglones lo dicen');
  assert.ok(problemas.every((p) => p.problema === 'sin_existencias' && p.disponibles === 3));
});

test('el envío es el costo fijo de la tienda, o nada desde su "gratis desde"', () => {
  const ajustes = { shipping_fee: 150, free_shipping_from: 1500 };
  assert.equal(costoDeEnvio(ajustes, 149_999), 15_000);
  assert.equal(costoDeEnvio(ajustes, 150_000), 0);
  assert.equal(costoDeEnvio({ shipping_fee: 0 }, 1), 0);
  const { renglones } = revisarCarrito([{ product_id: 1, quantity: 1 }], [producto(1, { price: '0.10' })]);
  const t = totalesDe({ renglones, formaDeEntrega: 'shipping', ajustes: { shipping_fee: '0.20' }, porcentajeDeComision: 0 });
  assert.equal(t.total, 0.3, 'en centavos: 0.1 + 0.2 es 0.3');
  assert.equal(totalesDe({ renglones, formaDeEntrega: 'pickup', ajustes: { shipping_fee: 99 } }).shipping_fee, 0);
});

test('la comisión es 0 hoy, y sobre el total cuando no lo sea', () => {
  const { renglones } = revisarCarrito([{ product_id: 1, quantity: 2 }], [producto(1, { price: '850' })]);
  assert.equal(totalesDe({ renglones, porcentajeDeComision: 0 }).fee_amount, 0);
  assert.equal(totalesDe({ renglones, porcentajeDeComision: 5 }).fee_amount, 85);
  assert.equal(totalesDe({ renglones, porcentajeDeComision: 2.5 }).fee_cents, 4250);
});

// ── La tienda ────────────────────────────────────────────────────────────

const tienda = { type: 'store', is_public: true, is_verified: true, contact_phone: '9981234567' };
const ajustesListos = {
  address: 'Av. Tulum 10, Cancún', pickup_enabled: true, pickup_hours: 'L–S 10 a 19',
  shipping_enabled: true, shipping_fee: 150, match_enabled: true, return_policy: 'Cambios en 15 días',
};

test('una entrega cuenta solo prendida y completa', () => {
  assert.deepEqual(entregasDeLaTienda(ajustesListos, [{ stand_id: 1 }]), ['pickup', 'shipping', 'match']);
  assert.deepEqual(entregasDeLaTienda({ ...ajustesListos, pickup_hours: '' }, []), ['shipping'], 'sin horario no se recoge, y sin partido no hay entrega en un partido');
  assert.deepEqual(entregasDeLaTienda({ ...ajustesListos, shipping_fee: null }, []), ['pickup']);
  assert.deepEqual(entregasDeLaTienda({ ...ajustesListos, shipping_fee: 0 }, []), ['pickup', 'shipping'], 'envío gratis sí es un costo');
});

test('lo que le falta a una tienda para vender, en orden', () => {
  const todo = { org: tienda, ajustes: ajustesListos, cuenta: { id: 1 }, productos: [producto(1)], puestosAbiertos: [] };
  assert.deepEqual(faltaParaVender(todo), []);
  assert.ok(puedeVender(todo));
  assert.deepEqual(faltaParaVender({ ...todo, org: { ...tienda, is_verified: false } }), ['verificada']);
  assert.deepEqual(faltaParaVender({
    org: { type: 'store', is_public: false, is_verified: false, contact_phone: '' },
    ajustes: {}, cuenta: null, productos: [producto(1, { price: null })],
  }), ['publicada', 'verificada', 'mercado_pago', 'domicilio', 'telefono', 'politica', 'entrega', 'producto']);
  assert.deepEqual(faltaParaVender({ ...todo, org: { ...tienda, type: 'media' } }), ['tienda']);
});

test('los ajustes de venta piden lo que hace funcionar cada entrega', () => {
  const { ajustes } = validarAjustes({ ...ajustesListos, shipping_fee: '150.555', free_shipping_from: '' });
  assert.equal(ajustes.shipping_fee, 150.56);
  assert.equal(ajustes.free_shipping_from, null);
  assert.match(validarAjustes({ pickup_enabled: true, address: 'x' }).error, /horario/);
  assert.match(validarAjustes({ shipping_enabled: true }).error, /costo del envío/);
  assert.match(validarAjustes({ shipping_fee: -1 }).error, /0 o más/);
  assert.match(validarAjustes({ free_shipping_from: 0 }).error, /mayor que 0/);
  assert.equal(validarAjustes({ pickup_enabled: 'true' }).ajustes.pickup_enabled, false, 'solo true es prender');
});

// ── Quien compra ─────────────────────────────────────────────────────────

test('nombre y WhatsApp a diez dígitos; el correo es opcional', () => {
  assert.deepEqual(validarComprador({ name: '  Ana   Pérez ', phone: '+52 1 998 123 4567', email: ' ANA@Correo.mx ' }).comprador,
    { name: 'Ana Pérez', phone: '9981234567', email: 'ana@correo.mx' });
  assert.equal(validarComprador({ name: 'Ana', phone: '998 123 4567' }).comprador.email, null);
  assert.match(validarComprador({ name: 'A', phone: '9981234567' }).error, /nombre/);
  assert.match(validarComprador({ name: 'Ana', phone: '12345' }).error, /WhatsApp/);
  assert.match(validarComprador({ name: 'Ana', phone: '9981234567', email: 'no-es-correo' }).error, /correo/);
});

test('la dirección del envío es de México', () => {
  const { direccion } = validarDireccion({
    street: 'Av. Tulum 10', neighborhood: 'Centro', postal_code: '77 500', city: 'Cancún', state: 'quintana roo',
  });
  assert.equal(direccion.postal_code, '77500');
  assert.equal(direccion.state, 'QUINTANA ROO');
  assert.equal(direccion.references, null);
  assert.match(validarDireccion({ street: 'x', neighborhood: 'y', postal_code: '7750', city: 'z', state: 'QUINTANA ROO' }).error, /5 dígitos/);
  assert.match(validarDireccion({ street: 'x', neighborhood: 'y', postal_code: '77500', city: 'z', state: 'TEXAS' }).error, /estado/);
});

// ── El pedido ────────────────────────────────────────────────────────────

const AHORA = new Date('2026-11-20T18:00:00Z');
const pedido = { id: 7, created_at: '2026-11-20T12:00:00Z', delivery_method: 'pickup' };
const r = (kind, extra = {}) => ({ kind, by_side: 'mercadopago', created_at: '2026-11-20T12:00:00Z', ...extra });

test('el estado de un pedido es la cuenta de sus renglones', () => {
  const clave = (renglones, cuando = AHORA) => estadoDelPedido(pedido, renglones, cuando).clave;
  assert.equal(clave([r('created')]), 'unpaid');
  assert.equal(clave([r('created'), r('payment_pending', { mp_payment_id: '1' })]), 'awaiting');
  assert.equal(clave([r('created'), r('payment_pending', { mp_payment_id: '1' }), r('payment_rejected', { mp_payment_id: '2' })]), 'rejected');
  assert.equal(clave([r('created')], new Date('2026-11-23T13:00:00Z')), 'expired', 'sin pagar a las 72 horas');
  assert.equal(clave([r('payment_approved', { mp_payment_id: '3' })], new Date('2026-12-30T00:00:00Z')), 'paid', 'un pago aprobado manda sobre el vencimiento');
  assert.equal(clave([r('payment_approved', { mp_payment_id: '3' }), r('ready')]), 'ready');
  assert.equal(clave([r('payment_approved', { mp_payment_id: '3' }), r('ready'), r('delivered')]), 'delivered');
  assert.equal(clave([r('payment_approved', { mp_payment_id: '3' }), r('cancelled')]), 'cancelled');
  assert.equal(clave([r('payment_approved', { mp_payment_id: '3' }), r('cancelled'), r('refunded', { mp_payment_id: '3' })]), 'refunded');
  assert.equal(clave([r('payment_approved', { mp_payment_id: '3' }), r('refunded', { mp_payment_id: '9' })]), 'paid', 'el reembolso de un pago repetido no reembolsa el pedido');
  assert.equal(clave([r('payment_approved', { mp_payment_id: '3' }), r('charged_back', { mp_payment_id: '3' })]), 'charged_back');
  const conRepetido = estadoDelPedido(pedido, [r('payment_approved', { mp_payment_id: '3' }), r('payment_extra', { mp_payment_id: '4' })], AHORA);
  assert.equal(conRepetido.pagos_repetidos, 1);
  assert.equal(conRepetido.pago, '3');
});

test('lo que la tienda puede hacer con un pedido en cada estado', () => {
  assert.equal(accionPermitida('paid', 'ready', 'pickup'), null);
  assert.equal(accionPermitida('paid', 'ready', 'match'), null);
  assert.match(accionPermitida('paid', 'ready', 'shipping'), /enviado/);
  assert.equal(accionPermitida('paid', 'shipped', 'shipping'), null);
  assert.match(accionPermitida('paid', 'shipped', 'pickup'), /envío/);
  assert.equal(accionPermitida('ready', 'delivered', 'pickup'), null);
  assert.equal(accionPermitida('shipped', 'delivered', 'shipping'), null);
  assert.equal(accionPermitida('paid', 'cancel', 'pickup'), null);
  assert.equal(accionPermitida('ready', 'cancel', 'match'), null);
  assert.ok(accionPermitida('shipped', 'cancel', 'shipping'), 'lo que ya salió no se cancela desde aquí');
  assert.ok(accionPermitida('unpaid', 'cancel', 'pickup'), 'lo que no se pagó vence solo');
  assert.ok(accionPermitida('delivered', 'delivered', 'pickup'));
  assert.ok(accionPermitida('paid', 'borrar', 'pickup'));
  assert.deepEqual(Object.keys(ACCIONES_DE_LA_TIENDA).sort(), ['cancel', 'delivered', 'ready', 'shipped']);
});

test('la historia no lleva los datos crudos de Mercado Pago ni quién apretó', () => {
  const historia = historiaDe([
    r('created', { by_side: 'buyer', by_user_id: 5 }),
    r('checkout_opened', { data: { preference_id: 'x' } }),
    r('payment_approved', { mp_payment_id: '3', data: { payment_type: 'credit_card', status_detail: 'accredited' } }),
    r('shipped', { by_side: 'store', by_user_id: 9, data: { carrier: 'Estafeta', tracking: '123' } }),
  ]);
  assert.deepEqual(historia.map((h) => h.kind), ['created', 'payment_approved', 'shipped']);
  assert.equal(historia[1].method, 'credit_card');
  assert.equal(historia[2].carrier, 'Estafeta');
  assert.ok(historia.every((h) => !('by_user_id' in h) && !('mp_payment_id' in h)));
});

test('la referencia del cobro dice qué pedido es', () => {
  assert.equal(referenciaDe(42), 'cfbamx-42');
  assert.equal(pedidoDeLaReferencia('cfbamx-42'), 42);
  assert.equal(pedidoDeLaReferencia('otra-42'), null);
});

// ── Mercado Pago, sin la red ─────────────────────────────────────────────

test('las llaves de la tienda se cifran, y alteradas o con otra llave no se abren', () => {
  const guardada = cifrar('APP_USR-123', 'secreto');
  assert.notEqual(guardada, cifrar('APP_USR-123', 'secreto'), 'cada vez con su propio vector');
  assert.ok(!guardada.includes('APP_USR'));
  assert.equal(descifrar(guardada, 'secreto'), 'APP_USR-123');
  assert.throws(() => descifrar(guardada, 'otro'));
  const [v, iv, etiqueta, datos] = guardada.split('.');
  const alterada = [v, iv, etiqueta, `${datos.slice(0, -2)}AA`].join('.');
  assert.throws(() => descifrar(alterada, 'secreto'));
});

test('el enlace para conectar lleva un state firmado que vence a los 10 minutos', () => {
  const ahora = 1_800_000_000_000;
  const estado = estadoParaConectar({ organizationId: 12, userId: 34, ahora, secreto: 's' });
  assert.deepEqual(leerEstadoParaConectar(estado, { ahora: ahora + 60_000, secreto: 's' }), { organizationId: 12, userId: 34 });
  assert.equal(leerEstadoParaConectar(estado, { ahora: ahora + 11 * 60_000, secreto: 's' }), null, 'vencido');
  assert.equal(leerEstadoParaConectar(estado, { ahora, secreto: 'otro' }), null);
  assert.equal(leerEstadoParaConectar(estado.replace(/^12\./, '13.'), { ahora, secreto: 's' }), null, 'otra tienda');
  assert.equal(leerEstadoParaConectar('basura', { ahora, secreto: 's' }), null);

  const url = new URL(enlaceParaConectar({
    estado,
    entorno: { MP_CLIENT_ID: '999', SITE_URL: 'https://cfbamx.mx/' },
  }));
  assert.equal(url.origin + url.pathname, 'https://auth.mercadopago.com/authorization');
  assert.equal(url.searchParams.get('client_id'), '999');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('platform_id'), 'mp');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://cfbamx.mx/mercadopago/conectar');
  assert.equal(url.searchParams.get('state'), estado);
});

test('la firma del aviso de Mercado Pago se revisa como la documenta', () => {
  assert.equal(manifiestoDelAviso({ dataId: '123', xRequestId: 'abc', ts: '1700' }), 'id:123;request-id:abc;ts:1700;');
  assert.equal(manifiestoDelAviso({ dataId: 'ABC', ts: '1' }), 'id:abc;ts:1;', 'sin request-id no va su pedazo');
  const firma = firmarAviso({ dataId: '123', xRequestId: 'abc', ts: '1700', secreto: 'clave' });
  assert.ok(firmaDelAvisoValida({ xSignature: firma, xRequestId: 'abc', dataId: '123', secreto: 'clave' }));
  assert.ok(!firmaDelAvisoValida({ xSignature: firma, xRequestId: 'abc', dataId: '124', secreto: 'clave' }), 'otro pago');
  assert.ok(!firmaDelAvisoValida({ xSignature: firma, xRequestId: 'abc', dataId: '123', secreto: 'otra' }));
  assert.ok(!firmaDelAvisoValida({ xSignature: 'ts=1', xRequestId: 'abc', dataId: '123', secreto: 'clave' }));
  assert.ok(!firmaDelAvisoValida({ xSignature: firma, xRequestId: 'abc', dataId: '123', secreto: '' }), 'sin clave, nada vale');
});

test('cada estado de un pago deja su renglón, y uno desconocido no deja nada', () => {
  assert.equal(renglonDePago('approved'), 'payment_approved');
  for (const s of ['pending', 'in_process', 'authorized']) assert.equal(renglonDePago(s), 'payment_pending');
  for (const s of ['rejected', 'cancelled']) assert.equal(renglonDePago(s), 'payment_rejected');
  assert.equal(renglonDePago('refunded'), 'refunded');
  assert.equal(renglonDePago('charged_back'), 'charged_back');
  assert.equal(renglonDePago('in_mediation'), null);
  for (const tipo of ['payment_approved', 'payment_pending', 'payment_rejected', 'refunded', 'charged_back']) {
    assert.ok(TIPOS_DE_RENGLON.includes(tipo));
  }
});

test('un pago se registra solo si su referencia, su moneda y su monto son los del pedido', () => {
  const p = { id: 42, total: '1000.50', currency: 'MXN' };
  const pago = { external_reference: 'cfbamx-42', currency_id: 'MXN', transaction_amount: 1000.5 };
  assert.ok(pagoCuadra(pago, p));
  assert.ok(!pagoCuadra({ ...pago, external_reference: 'cfbamx-43' }, p));
  assert.ok(!pagoCuadra({ ...pago, transaction_amount: 1000.49 }, p));
  assert.ok(!pagoCuadra({ ...pago, currency_id: 'USD' }, p));
});

test('el cobro lleva los productos, el envío, la referencia, a dónde regresa y cuándo vence', () => {
  const entorno = { SITE_URL: 'https://cfbamx.mx', API_PUBLIC_URL: 'https://api.cfbamx.mx/' };
  const p = {
    id: 42, token: 'tok', created_at: '2026-11-20T12:00:00Z', buyer_name: 'Ana', buyer_email: null,
    shipping_fee: '150', fee_amount: '0',
  };
  const cobro = cobroDe({
    pedido: p,
    renglones: [{ id: 1, product_id: 9, product_name: 'Jersey', size_label: 'M', unit_price: '850', quantity: 2, product_image_url: 'https://x/y.png' }],
    entorno,
  });
  assert.deepEqual(cobro.items.map((i) => [i.title, i.quantity, i.unit_price]), [['Jersey · M', 2, 850], ['Envío a domicilio', 1, 150]]);
  assert.equal(cobro.external_reference, 'cfbamx-42');
  assert.equal(cobro.notification_url, 'https://api.cfbamx.mx/api/shop/mercadopago/webhook?pedido=42');
  assert.equal(cobro.back_urls.success, 'https://cfbamx.mx/pedido/tok');
  assert.equal(cobro.date_of_expiration, '2026-11-23T12:00:00.000+00:00', '72 horas, con su zona');
  assert.ok(!('marketplace_fee' in cobro), 'la comisión 0 no viaja');
  assert.ok(!('email' in cobro.payer));
  assert.equal(cobroDe({ pedido: { ...p, fee_amount: '25.5' }, renglones: [], entorno }).marketplace_fee, 25.5);
});

test('una conexión guarda las llaves cifradas y cuándo vence', () => {
  process.env.MP_TOKEN_KEY = 'llave-de-prueba';
  const c = conexionDe({ access_token: 'APP_USR-1', refresh_token: 'TG-1', user_id: 77, public_key: 'pk', expires_in: 15_552_000, live_mode: false }, 0);
  assert.equal(c.provider_user_id, '77');
  assert.equal(descifrar(c.access_token_enc), 'APP_USR-1');
  assert.equal(descifrar(c.refresh_token_enc), 'TG-1');
  assert.equal(c.expires_at, new Date(15_552_000_000).toISOString());
  assert.equal(c.live_mode, false);
});

test('sin alguna variable de Mercado Pago, las compras no existen', () => {
  const todas = { MP_CLIENT_ID: 'a', MP_CLIENT_SECRET: 'b', MP_WEBHOOK_SECRET: 'c', MP_TOKEN_KEY: 'd', SITE_URL: 'e', API_PUBLIC_URL: 'f' };
  assert.deepEqual(faltanVariables(todas), []);
  assert.deepEqual(faltanVariables({ ...todas, MP_WEBHOOK_SECRET: ' ' }), ['MP_WEBHOOK_SECRET']);
});

// ── Las listas, en los tres lados (regla 6) ──────────────────────────────

test('las listas del frontend son las del backend', () => {
  assert.deepEqual(frontend.FORMAS_DE_ENTREGA, FORMAS_DE_ENTREGA);
  assert.deepEqual(frontend.ESTADOS_DEL_PEDIDO, ESTADOS_DEL_PEDIDO);
  assert.deepEqual(Object.keys(frontend.ESTADOS).sort(), [...ESTADOS_DEL_PEDIDO].sort(), 'cada estado tiene su texto');
  assert.deepEqual(Object.keys(frontend.ENTREGAS).sort(), [...FORMAS_DE_ENTREGA].sort());
  // Lo que la historia enseña: todo menos abrir Mercado Pago, que no es un hecho del pedido.
  assert.deepEqual(Object.keys(frontend.RENGLONES).sort(), TIPOS_DE_RENGLON.filter((t) => t !== 'checkout_opened').sort());
  assert.equal(frontend.PIEZAS_POR_RENGLON, compras.PIEZAS_POR_RENGLON);
  assert.equal(frontend.RENGLONES_POR_PEDIDO, compras.RENGLONES_POR_PEDIDO);
  // Lo que le falta a una tienda: todo lo que el backend puede decir tiene su texto.
  const claves = faltaParaVender({ org: { type: 'store' }, ajustes: {}, cuenta: null, productos: [] });
  for (const clave of [...claves, 'tienda']) assert.ok(frontend.LO_QUE_FALTA[clave], `"${clave}" no tiene texto en el panel`);
});

test('el frontend lee las tallas, las existencias y lo comprable igual que el backend', () => {
  for (const t of ['S, M, L, XL', ' S ,, m , M ,L', 'Unitalla', '', null]) {
    assert.deepEqual(frontend.tallasDe(t), tallasDe(t));
    assert.deepEqual(frontend.tallasParaElegir(t), tallasParaElegir(t));
  }
  for (const p of [producto(1), producto(2, { price: null }), producto(3, { currency: 'USD' }), { id: 4, price: '1', currency: 'MXN' }]) {
    assert.equal(frontend.esComprable(p), esComprable(p));
  }
  const jersey = producto(1, { size_variant: 'S, M', size_stock: { S: 0, M: 4 }, stock: 4 });
  for (const talla of ['S', 'M', null]) assert.equal(frontend.existenciasDe(jersey, talla), existenciasDe(jersey, talla));
});

test('los CHECK del esquema se arman con las listas de utils/compras.js', () => {
  const esquema = leer('backend/src/config/db.js');
  assert.match(esquema, /delivery_method IN \(\$\{lista\(FORMAS_DE_ENTREGA\)\}\)/);
  assert.match(esquema, /kind IN \(\$\{lista\(TIPOS_DE_RENGLON\)\}\)/);
  assert.match(esquema, /by_side IN \(\$\{lista\(LADOS\)\}\)/);
  assert.match(esquema, /kind IN \(\$\{lista\(MOVIMIENTOS\)\}\)/);
  assert.match(esquema, /WHERE kind IN \(\$\{lista\(RENGLONES_UNICOS\)\}\)/);
  assert.match(esquema, /kind IN \(\$\{lista\(RENGLONES_DE_PAGO\)\}\)/);
});

test('la comisión se llama igual en el esquema y en utils/ajustesDePlataforma.js', () => {
  const check = leer('backend/src/config/db.js').match(/setting_key\s+TEXT NOT NULL CHECK \(setting_key IN \(([^)]*)\)\)/);
  assert.ok(check, 'no se encontró el CHECK de platform_settings');
  const delEsquema = [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  const lista = leer('backend/src/utils/ajustesDePlataforma.js').match(/export const AJUSTES = \{([\s\S]*?)\n\};/);
  const delBackend = [...lista[1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(delBackend, delEsquema);
});

test('el interruptor de las compras se llama igual en el esquema, en el backend y en el Panel Admin', () => {
  const checks = [...leer('backend/src/config/db.js').matchAll(/CHECK \(switch_key IN \(([^)]*)\)\)/g)];
  assert.ok(checks.at(-1)[1].includes("'store_purchases'"));
  assert.match(leer('backend/src/utils/interruptores.js'), /store_purchases: 'Compras en la vitrina'/);
  assert.match(leer('frontend/src/components/admin/AdminShopSection.jsx'), /SWITCH_KEY = 'store_purchases'/);
});
