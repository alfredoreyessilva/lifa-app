// Pruebas de las compras en la vitrina del lado de la pantalla (utils/compras.js):
// el carrito guardado en el navegador, qué se puede comprar y cuántas, cómo se
// dice cada estado de un pedido, los mensajes de WhatsApp y Panel Admin →
// Compras. Las listas que viajan se comparan contra el backend en
// backend/tests/unit/compras.test.mjs (regla 6).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ESTADOS, ESTADOS_DEL_PEDIDO, ORDER_FILTERS, agotado, agregarAlCarrito, cambiarCantidad, carritoAlDia,
  carritoParaElServidor, claveDelCarrito, cuandoEsElPartido, direccionEnTexto, enlaceDeWhatsApp, etiquetaDelEstado,
  figuraDePedidos, guardarCarrito, leerCarrito, maximoDePiezas, mensajeParaElComprador, mensajeParaLaTienda,
  panelDeCompras, piezasDelCarrito, porQueNoSePuedePagar, porcentaje, problemaDelCarrito, quitarDelCarrito, revisarComprador,
  revisarDireccion, textoDelEnvio, tramosDeMisPedidos,
} from '../../src/utils/compras.js';
import {
  EMPTY_PRODUCT, productPayload, productToForm, salesAttention, sumaDeTallas, validateProductForm,
} from '../../src/utils/storePanel.js';

// Un localStorage de mentira, con la opción de fallar como en modo privado.
function almacen({ falla = false } = {}) {
  const datos = new Map();
  return {
    getItem: (k) => { if (falla) throw new Error('privado'); return datos.has(k) ? datos.get(k) : null; },
    setItem: (k, v) => { if (falla) throw new Error('privado'); datos.set(k, String(v)); },
    removeItem: (k) => { datos.delete(k); },
    datos,
  };
}

const jersey = { id: 1, name: 'Jersey', price: '850', image_url: 'https://img/j.png', size_variant: 'S, M, L', size_stock: { S: 0, M: 2, L: 5 }, stock: 7 };
const gorra = { id: 2, name: 'Gorra', price: '300.50', image_url: null, size_variant: null, stock: null };

// ── El carrito ───────────────────────────────────────────────────────────

test('el carrito suma la misma pieza, separa las tallas y no pasa de 10', () => {
  let c = agregarAlCarrito([], jersey, 'M', 2);
  c = agregarAlCarrito(c, jersey, 'M', 3);
  c = agregarAlCarrito(c, jersey, 'L', 1);
  c = agregarAlCarrito(c, gorra, null, 9);
  c = agregarAlCarrito(c, gorra, null, 9);
  assert.deepEqual(c.map((r) => [r.product_id, r.size, r.quantity]), [[1, 'M', 5], [1, 'L', 1], [2, null, 10]]);
  assert.equal(piezasDelCarrito(c), 16);
  assert.deepEqual(carritoParaElServidor(c)[0], { product_id: 1, size: 'M', quantity: 5 }, 'al servidor solo viaja qué y cuántas');
});

test('cambiar a 0 o quitar saca la pieza; las demás tallas se quedan', () => {
  let c = agregarAlCarrito(agregarAlCarrito([], jersey, 'M', 1), jersey, 'L', 1);
  c = cambiarCantidad(c, { product_id: 1, size: 'M' }, 4);
  assert.equal(c.find((r) => r.size === 'M').quantity, 4);
  c = cambiarCantidad(c, { product_id: 1, size: 'M' }, 0);
  assert.deepEqual(c.map((r) => r.size), ['L']);
  assert.deepEqual(quitarDelCarrito(c, { product_id: 1, size: 'L' }), []);
});

test('el carrito se guarda por tienda, se lee limpio y sin almacenamiento no truena', () => {
  const a = almacen();
  guardarCarrito(99, agregarAlCarrito([], gorra, null, 2), a);
  assert.ok(a.datos.has(claveDelCarrito(99)));
  assert.equal(leerCarrito(99, a)[0].quantity, 2);
  assert.deepEqual(leerCarrito(98, a), [], 'otra tienda tiene su propio carrito');
  a.setItem(claveDelCarrito(97), '{"no":"es arreglo"}');
  assert.deepEqual(leerCarrito(97, a), []);
  a.setItem(claveDelCarrito(96), JSON.stringify([{ product_id: 'x', quantity: 1 }, { product_id: 3, quantity: 40 }]));
  assert.deepEqual(leerCarrito(96, a).map((r) => [r.product_id, r.quantity]), [[3, 10]]);
  guardarCarrito(99, [], a);
  assert.ok(!a.datos.has(claveDelCarrito(99)), 'vacío se borra');
  const privado = almacen({ falla: true });
  assert.deepEqual(leerCarrito(1, privado), []);
  assert.doesNotThrow(() => guardarCarrito(1, [{ product_id: 1, quantity: 1 }], privado));
});

test('lo que contesta el servidor pone al día el nombre, la foto y el precio', () => {
  const c = agregarAlCarrito([], { ...gorra, name: 'Gorra vieja', price: '200' }, null, 1);
  const alDia = carritoAlDia(c, [{ product_id: 2, size: null, product_name: 'Gorra', product_image_url: 'x.png', unit_price: 300.5 }]);
  assert.deepEqual([alDia[0].name, alDia[0].image_url, alDia[0].price], ['Gorra', 'x.png', 300.5]);
});

test('agotado y cuántas se pueden pedir, por talla o por producto', () => {
  assert.equal(agotado(jersey), false);
  assert.equal(agotado({ ...jersey, size_stock: { S: 0, M: 0, L: 0 } }), true);
  assert.equal(agotado({ id: 3, stock: 0 }), true);
  assert.equal(agotado(gorra), false, 'sin cuenta no es agotado');
  assert.equal(maximoDePiezas(jersey, 'M'), 2);
  assert.equal(maximoDePiezas(jersey, 'S'), 0);
  assert.equal(maximoDePiezas(gorra, null), 10);
});

test('cada problema del carrito se dice como lo lee quien compra', () => {
  assert.equal(problemaDelCarrito({ problema: 'sin_existencias', disponibles: 2 }), 'Solo quedan 2');
  assert.equal(problemaDelCarrito({ problema: 'sin_existencias', disponibles: 0 }), 'Se agotó');
  assert.equal(problemaDelCarrito({ problema: 'talla' }), 'Elige una talla');
  assert.equal(problemaDelCarrito({ problema: 'otro' }), 'Revisa este producto');
});

// ── La compra ────────────────────────────────────────────────────────────

test('el formulario revisa lo mismo que el backend antes de mandar', () => {
  assert.deepEqual(revisarComprador({ name: 'Ana', phone: '998 123 4567', email: '' }), {});
  assert.deepEqual(Object.keys(revisarComprador({ name: 'A', phone: '123', email: 'x' })).sort(), ['email', 'name', 'phone']);
  assert.deepEqual(revisarComprador({ name: 'Ana', phone: '+52 1 998 123 4567' }), {});
  assert.deepEqual(revisarDireccion({ street: 'Calle 5', neighborhood: 'Centro', postal_code: '77 500', city: 'Cancún', state: 'QUINTANA ROO' }), {});
  assert.ok(revisarDireccion({ street: 'x', neighborhood: 'y', postal_code: '775', city: 'z', state: 'QUINTANA ROO' }).postal_code);
});

test('el envío y la dirección se dicen en un renglón', () => {
  assert.equal(textoDelEnvio({ fee: 150, free_from: 2000 }), '$150 · gratis desde $2,000');
  assert.equal(textoDelEnvio({ fee: 0 }), 'Envío gratis');
  assert.equal(direccionEnTexto({ street: 'Calle 5', neighborhood: 'SM 23', postal_code: '77500', city: 'Cancún', state: 'QUINTANA ROO' }),
    'Calle 5, SM 23, C.P. 77500, Cancún, QUINTANA ROO');
});

test('el partido de una entrega dice cuándo en su zona', () => {
  const texto = cuandoEsElPartido({ match_date: '2026-11-21T18:00:00Z', timezone: 'America/Mexico_City' }, new Date('2026-11-14T12:00:00Z'));
  assert.match(texto, /Sábado 21 de noviembre · 12:00/);
  assert.equal(cuandoEsElPartido({ match_date: null }), 'Fecha por definir');
});

// ── El pedido ────────────────────────────────────────────────────────────

test('cada estado tiene su texto y su tono, y "Listo" dice dónde', () => {
  for (const clave of ESTADOS_DEL_PEDIDO) assert.ok(ESTADOS[clave]?.label && ESTADOS[clave]?.tone, clave);
  assert.equal(etiquetaDelEstado('ready', 'pickup'), 'Listo para recoger');
  assert.equal(etiquetaDelEstado('ready', 'match'), 'Listo para entregar en el partido');
  assert.equal(etiquetaDelEstado('paid', 'shipping'), 'Pagado, por preparar');
  assert.equal(etiquetaDelEstado('raro'), 'Sin estado');
});

test('WhatsApp: un número de 10 dígitos lleva el 52, y el mensaje va escrito', () => {
  assert.equal(enlaceDeWhatsApp('998 123 4567', 'Hola'), 'https://wa.me/529981234567?text=Hola');
  assert.equal(enlaceDeWhatsApp('5219981234567'), 'https://wa.me/5219981234567');
  assert.equal(enlaceDeWhatsApp('123'), null);
  const pedido = {
    id: 42, token: 't', status: 'shipped', total: 1150,
    buyer: { name: 'Ana Prueba', phone: '9987654321' },
    store: { name: 'Deportes' },
    items: [{ name: 'Jersey', size: 'M', quantity: 1 }, { name: 'Gorra', size: null, quantity: 2 }],
    delivery: { method: 'shipping', promised: {} },
    history: [{ kind: 'shipped', carrier: 'Estafeta', tracking: '123' }],
  };
  const aLaTienda = mensajeParaLaTienda(pedido, 'https://x/pedido/t');
  assert.match(aLaTienda, /pedido 42 en Deportes/);
  assert.match(aLaTienda, /1 × Jersey · M, 2 × Gorra/);
  assert.match(aLaTienda, /https:\/\/x\/pedido\/t/);
  const alComprador = mensajeParaElComprador(pedido, 'Deportes', 'https://x/pedido/t');
  assert.match(alComprador, /^Hola Ana, tu pedido 42 de Deportes ya va en camino por Estafeta, guía 123\./);
  assert.match(mensajeParaElComprador({ ...pedido, status: 'ready', delivery: { method: 'match' } }, 'Deportes', 'u'), /en el partido/);
});

test('Mis pedidos separa lo que sigue en curso de lo terminado, y Mi panel lo cuenta', () => {
  const pedidos = [
    { id: 1, status: 'paid' }, { id: 2, status: 'delivered' }, { id: 3, status: 'unpaid' }, { id: 4, status: 'expired' },
  ];
  assert.deepEqual(tramosDeMisPedidos(pedidos).map((t) => [t.key, t.rows.map((r) => r.id)]), [['curso', [1, 3]], ['cerrados', [2, 4]]]);
  assert.deepEqual(tramosDeMisPedidos([]), []);
  assert.deepEqual(figuraDePedidos(pedidos), { value: '2', sub: 'En curso · ver todos' });
  assert.deepEqual(figuraDePedidos([{ id: 2, status: 'delivered' }]), { value: '1', sub: 'Ver mis pedidos' });
  assert.equal(figuraDePedidos([]), null, 'sin pedidos no sale la celda');
});

test('las celdas de Pedidos filtran por estado, y "Por preparar" es lo que le toca a la tienda', () => {
  const filas = ESTADOS_DEL_PEDIDO.map((status, id) => ({ id, status }));
  const de = (key) => filas.filter(ORDER_FILTERS.find((f) => f.key === key).test).map((o) => o.status);
  assert.deepEqual(de('preparar'), ['paid']);
  assert.deepEqual(de('listos'), ['ready', 'shipped']);
  assert.deepEqual(de('esperando'), ['unpaid', 'awaiting', 'rejected']);
  assert.deepEqual(de('cerrados'), ['expired', 'cancelled', 'refunded', 'charged_back']);
  assert.ok(ORDER_FILTERS.find((f) => f.key === 'preparar').attention);
  // Cada estado cae en algún filtro además de "todos".
  for (const f of filas) assert.ok(ORDER_FILTERS.filter((x) => x.key !== 'todos').some((x) => x.test(f)), f.status);
});

// ── El panel de la tienda ────────────────────────────────────────────────

test('las existencias por talla de la ventana del producto: de todas o de ninguna, y el número es su suma', () => {
  const form = { ...EMPTY_PRODUCT, name: 'Jersey', price: '850', size_variant: 'S, M', size_stock: { S: '1', M: '2' }, stock: '99' };
  assert.equal(validateProductForm(form), null);
  assert.equal(sumaDeTallas(form), 3);
  assert.deepEqual(productPayload(form).size_stock, { S: 1, M: 2 });
  assert.equal(productPayload(form).stock, 3);
  assert.match(validateProductForm({ ...form, size_stock: { S: '1' } }), /todas las tallas/);
  assert.match(validateProductForm({ ...form, size_stock: { S: '1', M: '-2' } }), /número entero/);
  assert.equal(productPayload({ ...form, size_stock: {} }).size_stock, null, 'vacías es un solo número');
  assert.equal(productPayload({ ...form, size_stock: {} }).stock, 99);
  assert.deepEqual(productToForm({ name: 'x', size_variant: 'S, M', size_stock: { S: 0, M: 3 } }).size_stock, { S: '0', M: '3' });
  assert.equal(productPayload({ ...form, size_variant: 'Unitalla' }).size_stock, null, 'con una sola talla no hay por talla');
});

test('el Resumen de la tienda le pone primero lo de sus ventas', () => {
  assert.deepEqual(salesAttention(7, null, 0), []);
  const [pedidos] = salesAttention(7, null, 2);
  assert.equal(pedidos.text, '2 pedidos por preparar');
  assert.equal(pedidos.to, '/panel/tienda/7?seccion=pedidos&filtro=preparar');
  const [vender] = salesAttention(7, { enabled: true, missing: ['verificada', 'mercado_pago', 'domicilio'] }, 0);
  assert.equal(vender.to, '/panel/tienda/7?seccion=cobro');
  assert.match(vender.where, /conectar tu cuenta de mercado pago y tu domicilio/);
  assert.match(salesAttention(7, { enabled: true, missing: ['publicada'] }, 0)[0].where, /CFBAMX/);
  assert.deepEqual(salesAttention(7, { enabled: false, missing: ['mercado_pago'] }, 0), [], 'apagadas no se le pide nada');
});

// ── Panel Admin → Compras ────────────────────────────────────────────────

test('Panel Admin → Compras lee cada número como número', () => {
  const p = panelDeCompras({
    switch: { enabled: true, history: [{ enabled: true, changed_at: '2026-11-14T10:00:00Z' }] },
    configured: true,
    missing_variables: [],
    fee: { percent: '2.5', limits: { minimo: 0, maximo: 30 }, history: [] },
    counts: { trusted_stores: 3, connected_stores: '1', orders: 9, paid_30d: 7, paid_amount_30d: '6550.5', fees_30d: null },
  });
  assert.equal(p.enabled, true);
  assert.equal(p.since, '2026-11-14T10:00:00Z');
  assert.equal(p.fee, 2.5);
  assert.equal(p.connected, 1);
  assert.equal(p.paidAmount, 6550.5);
  assert.equal(p.fees, 0);
  assert.deepEqual(panelDeCompras(null).history, []);
  assert.equal(panelDeCompras(null).enabled, false);
  assert.equal(porcentaje(2.5), '2.5%');
  assert.equal(porcentaje(0), '0%');
});

test('un pedido que espera su pago y no trae «Pagar» dice por qué', () => {
  // Se puede pagar, o ya no espera pago: nada que explicar.
  assert.equal(porQueNoSePuedePagar({ status: 'unpaid', can_pay: true, pay_blocked: null }), null);
  assert.equal(porQueNoSePuedePagar({ status: 'paid', can_pay: false, pay_blocked: null }), null);
  assert.equal(porQueNoSePuedePagar({ status: 'expired', can_pay: false, pay_blocked: null }), null);
  assert.equal(porQueNoSePuedePagar(null), null);
  // La tienda no vende, o las compras están apagadas.
  assert.equal(porQueNoSePuedePagar({ status: 'rejected', can_pay: false, pay_blocked: null }), 'Por ahora esta tienda no está recibiendo pagos.');
  // La tienda conectó otra cuenta: hacerlo de nuevo; con OXXO, avisar si ya pagó la ficha.
  assert.match(porQueNoSePuedePagar({ status: 'unpaid', can_pay: false, pay_blocked: 'account_changed' }), /ya no se puede pagar\. Haz tu pedido de nuevo/);
  assert.match(porQueNoSePuedePagar({ status: 'rejected', can_pay: false, pay_blocked: 'account_changed' }), /ya no se puede pagar/);
  const oxxo = porQueNoSePuedePagar({ status: 'awaiting', can_pay: false, pay_blocked: 'account_changed' });
  assert.match(oxxo, /Si ya pagaste tu ficha, avísale a la tienda por WhatsApp/);
  assert.doesNotMatch(oxxo, /ya no se puede pagar/);
});
