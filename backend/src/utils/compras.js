// Las compras en la vitrina de una tienda (README, "Compras en la vitrina",
// 2026-11-14, lo pidió Alfredo): botón Comprar, carrito y Mercado Pago de cada
// tienda. Aquí vive lo que se puede contestar sin la base —qué se puede comprar,
// las tallas y sus existencias, los totales, qué le falta a una tienda para
// vender y en qué estado va un pedido— para que el CI lo pruebe.
//
// Las listas de abajo viajan en tres lados (regla 6): config/db.js arma con ellas
// los CHECK del esquema, las rutas las usan, y frontend/src/utils/compras.js
// tiene su copia. tests/unit/compras.test.mjs falla si una cambia sola.

import { MEXICO_STATES } from './mexicoStates.js';
import { puedePremiar } from './orgVisibility.js';

// ── Las listas ────────────────────────────────────────────────────────────

export const FORMAS_DE_ENTREGA = ['pickup', 'shipping', 'match'];

// Cada cambio de un pedido es un renglón que no se edita (`store_order_events`),
// y el estado es la cuenta de esos renglones. Los de RENGLONES_UNICOS salen una
// vez por pedido (un índice único parcial lo cuida); los de RENGLONES_DE_PAGO,
// una vez por pago de Mercado Pago, para que un aviso repetido no deje dos.
export const TIPOS_DE_RENGLON = [
  'created', 'checkout_opened',
  'payment_pending', 'payment_rejected', 'payment_approved', 'payment_extra',
  'ready', 'shipped', 'delivered',
  'cancelled', 'refunded', 'charged_back',
  'claimed',
];
export const RENGLONES_UNICOS = ['created', 'payment_approved', 'ready', 'shipped', 'delivered', 'cancelled', 'claimed'];
export const RENGLONES_DE_PAGO = ['payment_pending', 'payment_rejected', 'payment_extra', 'refunded', 'charged_back'];

// Quién dejó el renglón.
export const LADOS = ['buyer', 'store', 'mercadopago'];

// Lo que pasó con las existencias de cada producto de un pedido pagado:
// salieron, no alcanzaron, la tienda no lleva la cuenta, o regresaron al
// cancelarse. Las tres primeras son una sola por producto del pedido.
export const MOVIMIENTOS = ['out', 'short', 'untracked', 'back'];

// Lo que la tienda hace con un pedido desde su panel, y el renglón que deja.
export const ACCIONES_DE_LA_TIENDA = {
  ready: 'ready',
  shipped: 'shipped',
  delivered: 'delivered',
  cancel: 'cancelled',
};

export const MONEDA = 'MXN';
export const HORAS_PARA_PAGAR = 72;
export const HORAS_DE_CIERRE_EN_PARTIDO = 3;
export const DIAS_DE_PUESTOS = 30;
export const PIEZAS_POR_RENGLON = 10;
export const RENGLONES_POR_PEDIDO = 20;

const texto = (v) => String(v ?? '').trim();

// ── Dinero, en centavos ──────────────────────────────────────────────────
//
// Las cuentas se hacen en centavos enteros: 0.1 + 0.2 no es 0.3 en JavaScript,
// y un total que no cuadra por un centavo contra el monto que reporta Mercado
// Pago dejaría un pago sin registrar.

export function aCentavos(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export const aPesos = (centavos) => Math.round(Number(centavos) || 0) / 100;

// ── Qué se puede comprar ─────────────────────────────────────────────────

// Activo, en la vitrina, en pesos y con precio. "Precio a consultar" no se
// cobra: no hay precio que cobrar. La lista pública ya trae solo lo activo y
// en la vitrina, sin esas dos columnas; por eso se pregunta `!== false`.
export function esComprable(producto) {
  if (!producto) return false;
  if (producto.is_active === false || producto.show_on_platform === false) return false;
  if ((producto.currency || MONEDA) !== MONEDA) return false;
  return (aCentavos(producto.price) ?? 0) > 0;
}

// "S, M, L, XL" → ['S', 'M', 'L', 'XL']. Sin repetidas y sin vacías. El texto
// que las tiendas ya tenían en "Tallas o variantes" se lee así, sin migrar.
export function tallasDe(sizeVariant) {
  const vistas = new Set();
  const tallas = [];
  for (const parte of String(sizeVariant ?? '').split(',')) {
    const talla = parte.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!talla || vistas.has(talla.toLowerCase())) continue;
    vistas.add(talla.toLowerCase());
    tallas.push(talla);
  }
  return tallas;
}

// Con una sola opción no hay nada que elegir.
export function tallasParaElegir(sizeVariant) {
  const tallas = tallasDe(sizeVariant);
  return tallas.length > 1 ? tallas : [];
}

// Las existencias por talla que manda la ventana del producto. Son de todas
// las tallas o de ninguna: con unas sí y otras no, la talla sin número no
// tendría de dónde contar. Devuelve `{ sizeStock, stock }` —el número del
// producto pasa a ser la suma— o `{ sizeStock: null }`, o `{ error }`.
export function leerExistenciasPorTalla(valor, sizeVariant) {
  if (valor === null || valor === undefined || valor === '') return { sizeStock: null };
  if (typeof valor !== 'object' || Array.isArray(valor)) {
    return { error: 'Las existencias por talla no tienen el formato correcto' };
  }
  const tallas = tallasParaElegir(sizeVariant);
  const llenas = Object.entries(valor).filter(([, n]) => n !== null && n !== undefined && n !== '');
  if (llenas.length === 0) return { sizeStock: null };
  if (tallas.length === 0) return { error: 'Para llevar existencias por talla, escribe dos o más tallas separadas por coma' };

  const porTalla = {};
  for (const [talla, cantidad] of llenas) {
    if (!tallas.includes(talla)) return { error: `La talla ${talla} no está en «Tallas o variantes»` };
    const n = Number(cantidad);
    if (!Number.isInteger(n) || n < 0) return { error: `Las existencias de la talla ${talla} deben ser un número entero, cero o más` };
    porTalla[talla] = n;
  }
  const faltan = tallas.filter((t) => !(t in porTalla));
  if (faltan.length) return { error: `Pon las existencias de todas las tallas, o de ninguna (falta ${faltan.join(', ')})` };
  return { sizeStock: porTalla, stock: Object.values(porTalla).reduce((a, b) => a + b, 0) };
}

// ¿Siguen valiendo unas existencias por talla con estas tallas? Si la tienda
// cambia "Tallas o variantes" sin tocar las casillas, las viejas ya no dicen
// nada y el producto vuelve a un solo número.
export function existenciasSiguenValiendo(sizeStock, sizeVariant) {
  if (!sizeStock) return true;
  const tallas = tallasParaElegir(sizeVariant);
  const claves = Object.keys(sizeStock);
  return tallas.length > 0 && claves.length === tallas.length && claves.every((c) => tallas.includes(c));
}

// Cuántas piezas hay: las de esa talla si el producto las lleva por talla, si
// no las del producto. null es "la tienda no lleva la cuenta", que no es cero.
export function existenciasDe(producto, talla) {
  const porTalla = producto?.size_stock;
  if (porTalla && typeof porTalla === 'object' && talla && Object.prototype.hasOwnProperty.call(porTalla, talla)) {
    return Number(porTalla[talla]);
  }
  if (producto?.stock === null || producto?.stock === undefined) return null;
  return Number(producto.stock);
}

// ── El carrito ───────────────────────────────────────────────────────────

// Revisa un carrito contra lo que la tienda vende hoy. `productos` son filas de
// la base, de esa tienda. Junta lo repetido (mismo producto y talla) y devuelve
// los renglones al precio de hoy, y un problema por renglón que no se puede
// cobrar, para que la pantalla lo diga antes de pagar. Lo que mande el navegador
// —el precio que vio, por ejemplo— no se lee.
export function revisarCarrito(lineas, productos = []) {
  if (!Array.isArray(lineas) || lineas.length === 0) {
    return { renglones: [], problemas: [{ problema: 'vacio' }] };
  }
  if (lineas.length > RENGLONES_POR_PEDIDO) {
    return { renglones: [], problemas: [{ problema: 'demasiados' }] };
  }
  const porId = new Map(productos.map((p) => [Number(p.id), p]));
  const juntas = new Map();
  for (const linea of lineas) {
    const id = Number(linea?.product_id);
    const talla = texto(linea?.size) || null;
    const clave = `${id}|${talla ?? ''}`;
    const cantidad = Number(linea?.quantity);
    const previa = juntas.get(clave);
    juntas.set(clave, { product_id: id, size: talla, quantity: previa ? previa.quantity + cantidad : cantidad });
  }

  const renglones = [];
  const problemas = [];
  for (const { product_id, size, quantity } of juntas.values()) {
    const producto = porId.get(product_id);
    if (!producto || !esComprable(producto)) {
      problemas.push({ product_id, size, problema: 'no_disponible' });
      continue;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > PIEZAS_POR_RENGLON) {
      problemas.push({ product_id, size, problema: 'cantidad' });
      continue;
    }
    const opciones = tallasParaElegir(producto.size_variant);
    if (opciones.length && !opciones.includes(size)) {
      problemas.push({ product_id, size, problema: 'talla' });
      continue;
    }
    const talla = opciones.length ? size : null;
    const unidad = aCentavos(producto.price);
    renglones.push({
      product_id,
      product_name: producto.name,
      product_image_url: producto.image_url || null,
      size: talla,
      quantity,
      unit_cents: unidad,
      line_cents: unidad * quantity,
      unit_price: aPesos(unidad),
      line_total: aPesos(unidad * quantity),
    });
  }

  // Las existencias se cuentan por producto y por talla juntando renglones: una
  // M y una L del mismo jersey salen del mismo número si no lleva tallas.
  const pedidas = new Map();
  for (const r of renglones) {
    const p = porId.get(r.product_id);
    const porTalla = r.size && p.size_stock && Object.prototype.hasOwnProperty.call(p.size_stock, r.size);
    const clave = porTalla ? `${r.product_id}|${r.size}` : `${r.product_id}|`;
    pedidas.set(clave, (pedidas.get(clave) || 0) + r.quantity);
  }
  for (const r of renglones) {
    const p = porId.get(r.product_id);
    const porTalla = r.size && p.size_stock && Object.prototype.hasOwnProperty.call(p.size_stock, r.size);
    const hay = existenciasDe(p, porTalla ? r.size : null);
    const piden = pedidas.get(porTalla ? `${r.product_id}|${r.size}` : `${r.product_id}|`);
    if (hay !== null && hay < piden) {
      problemas.push({ product_id: r.product_id, size: r.size, problema: 'sin_existencias', disponibles: Math.max(0, hay) });
    }
  }
  return { renglones, problemas };
}

// El envío: el costo fijo de la tienda, o nada desde su "gratis desde".
export function costoDeEnvio(ajustes, subtotalCentavos) {
  const fijo = aCentavos(ajustes?.shipping_fee) ?? 0;
  const gratisDesde = aCentavos(ajustes?.free_shipping_from);
  if (gratisDesde !== null && subtotalCentavos >= gratisDesde) return 0;
  return fijo;
}

// La comisión de CFBAMX sobre el total, en centavos. Hoy es 0 (README, "Panel
// Admin → Compras").
export function comisionDe(totalCentavos, porcentaje) {
  const p = Number(porcentaje) || 0;
  if (p <= 0) return 0;
  return Math.round((totalCentavos * p) / 100);
}

export function totalesDe({ renglones = [], formaDeEntrega, ajustes, porcentajeDeComision = 0 }) {
  const subtotal = renglones.reduce((suma, r) => suma + r.line_cents, 0);
  const envio = formaDeEntrega === 'shipping' ? costoDeEnvio(ajustes, subtotal) : 0;
  const total = subtotal + envio;
  const comision = comisionDe(total, porcentajeDeComision);
  return {
    subtotal_cents: subtotal,
    shipping_cents: envio,
    total_cents: total,
    fee_cents: comision,
    subtotal: aPesos(subtotal),
    shipping_fee: aPesos(envio),
    total: aPesos(total),
    fee_amount: aPesos(comision),
  };
}

// ── La tienda ────────────────────────────────────────────────────────────

// Las formas de entrega que una tienda ofrece de verdad: prendidas y completas.
// Prendida pero sin domicilio, sin costo de envío o sin un partido abierto no
// se le ofrece a nadie.
export function entregasDeLaTienda(ajustes, puestosAbiertos = []) {
  const entregas = [];
  if (ajustes?.pickup_enabled && texto(ajustes.address) && texto(ajustes.pickup_hours)) entregas.push('pickup');
  if (ajustes?.shipping_enabled && aCentavos(ajustes.shipping_fee) !== null) entregas.push('shipping');
  if (ajustes?.match_enabled && puestosAbiertos.length > 0) entregas.push('match');
  return entregas;
}

// Lo que le falta a una tienda para vender, en el orden en que se lo dice su
// panel. Vacío es que vende (`puedeVender`). `cuenta` es su conexión con Mercado
// Pago vigente, o null.
export function faltaParaVender({ org, ajustes, cuenta, productos = [], puestosAbiertos = [] }) {
  const falta = [];
  if (org?.type !== 'store') return ['tienda'];
  if (!org.is_public) falta.push('publicada');
  if (!org.is_verified) falta.push('verificada');
  if (!cuenta) falta.push('mercado_pago');
  if (!texto(ajustes?.address)) falta.push('domicilio');
  if (!texto(org.contact_phone)) falta.push('telefono');
  if (!texto(ajustes?.return_policy)) falta.push('politica');
  if (entregasDeLaTienda(ajustes, puestosAbiertos).length === 0) falta.push('entrega');
  if (!productos.some(esComprable)) falta.push('producto');
  return falta;
}

// Publicada y verificada es la regla de los premios: se reusa para no tener dos.
export const tiendaConfiable = (org) => puedePremiar(org);

export function puedeVender(datos) {
  return faltaParaVender(datos).length === 0;
}

// ¿Está vigente una conexión con Mercado Pago? Conectada, con su llave, y sin
// vencer. La que vence se renueva antes de usarse (routes/shop.js).
export function cuentaVigente(cuenta, ahora = new Date()) {
  if (!cuenta || cuenta.disconnected_at || !cuenta.access_token_enc) return false;
  if (!cuenta.expires_at) return true;
  return new Date(cuenta.expires_at).getTime() > ahora.getTime();
}

// Un puesto en un partido recibe pedidos mientras el partido esté en el
// calendario público, con fecha, sin empezar, y falten más de 3 horas. Va en
// SQL porque `match_date` es texto y la base es la que lo convierte, igual que
// el candado del voto (utils/scoring.js). Pide los alias `m` (matches) y `l`
// (leagues).
export const PUESTO_ABIERTO_SQL = `(
  l.is_public = TRUE
  AND m.is_draft = FALSE
  AND m.match_date IS NOT NULL
  AND m.status NOT IN ('live', 'finished')
  AND m.match_date::timestamptz > NOW() + INTERVAL '${HORAS_DE_CIERRE_EN_PARTIDO} hours'
)`;

// Los partidos donde una tienda puede poner un puesto: los mismos, en los
// próximos 30 días.
export const PARTIDO_PARA_PUESTO_SQL = `(
  ${PUESTO_ABIERTO_SQL}
  AND m.match_date::timestamptz <= NOW() + INTERVAL '${DIAS_DE_PUESTOS} days'
)`;

// ── Lo que escribe quien compra ──────────────────────────────────────────

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const limpio = (v, max) => texto(v).replace(/\s+/g, ' ').slice(0, max);

// Nombre y WhatsApp, obligatorios; correo, opcional. El WhatsApp se guarda a
// diez dígitos: con el 52 de enfrente o sin él es el mismo número.
export function validarComprador(c = {}) {
  const name = limpio(c.name, 80);
  if (name.length < 2) return { error: 'Escribe tu nombre' };
  const digitos = String(c.phone ?? '').replace(/\D/g, '');
  const valido = digitos.length === 10
    || (digitos.length === 12 && digitos.startsWith('52'))
    || (digitos.length === 13 && digitos.startsWith('521'));
  if (!valido) return { error: 'Escribe tu WhatsApp a 10 dígitos' };
  const email = texto(c.email).toLowerCase();
  if (email && (!CORREO.test(email) || email.length > 120)) return { error: 'El correo no es válido' };
  return { comprador: { name, phone: digitos.slice(-10), email: email || null } };
}

// Una dirección de México para el envío.
export function validarDireccion(d = {}) {
  const street = limpio(d.street, 120);
  const neighborhood = limpio(d.neighborhood, 80);
  const postal_code = String(d.postal_code ?? '').replace(/\D/g, '');
  const city = limpio(d.city, 80);
  const state = texto(d.state).toUpperCase();
  const references = limpio(d.references, 200);
  if (!street) return { error: 'Escribe la calle y el número' };
  if (!neighborhood) return { error: 'Escribe la colonia' };
  if (postal_code.length !== 5) return { error: 'El código postal lleva 5 dígitos' };
  if (!city) return { error: 'Escribe la ciudad o el municipio' };
  if (!MEXICO_STATES.includes(state)) return { error: 'Elige el estado' };
  return { direccion: { street, neighborhood, postal_code, city, state, references: references || null } };
}

// Los ajustes de venta que guarda la tienda desde "Cobro y entrega". Prender una
// entrega pide lo que la hace funcionar; apagada, lo escrito se guarda igual.
export function validarAjustes(b = {}) {
  const montoOpcional = (v, { mayorQueCero = false } = {}) => {
    if (v === null || v === undefined || v === '') return { valor: null };
    const c = aCentavos(v);
    if (c === null || c < 0 || (mayorQueCero && c === 0) || c > 10_000_000) return { error: true };
    return { valor: aPesos(c) };
  };
  const envio = montoOpcional(b.shipping_fee);
  if (envio.error) return { error: 'El costo del envío debe ser una cantidad en pesos, 0 o más' };
  const gratis = montoOpcional(b.free_shipping_from, { mayorQueCero: true });
  if (gratis.error) return { error: '«Envío gratis desde» debe ser una cantidad en pesos mayor que 0' };

  const ajustes = {
    address: limpio(b.address, 200) || null,
    pickup_enabled: b.pickup_enabled === true,
    pickup_hours: limpio(b.pickup_hours, 120) || null,
    shipping_enabled: b.shipping_enabled === true,
    shipping_fee: envio.valor,
    free_shipping_from: gratis.valor,
    match_enabled: b.match_enabled === true,
    return_policy: texto(b.return_policy).slice(0, 2000) || null,
  };
  if (ajustes.pickup_enabled && (!ajustes.address || !ajustes.pickup_hours)) {
    return { error: 'Para que recojan en tu tienda, pon tu domicilio y tu horario' };
  }
  if (ajustes.shipping_enabled && ajustes.shipping_fee === null) {
    return { error: 'Pon el costo del envío (0 si es gratis)' };
  }
  return { ajustes };
}

// ── El pedido ────────────────────────────────────────────────────────────

export const referenciaDe = (orderId) => `cfbamx-${orderId}`;

export function pedidoDeLaReferencia(referencia) {
  const m = /^cfbamx-(\d+)$/.exec(texto(referencia));
  return m ? Number(m[1]) : null;
}

// El estado de un pedido es la cuenta de sus renglones (`renglones` en el orden
// en que se escribieron). "Vencido" no se escribe: sin pagar a las 72 horas, lo
// es. Un pago aprobado manda sobre el vencimiento: si alguien paga su ficha de
// OXXO a tiempo y Mercado Pago lo aprueba después, está pagado.
//
// Las claves viajan al frontend, que les pone su texto (regla 6).
export const ESTADOS_DEL_PEDIDO = [
  'unpaid', 'awaiting', 'rejected', 'expired',
  'paid', 'ready', 'shipped', 'delivered',
  'cancelled', 'refunded', 'charged_back',
];

export function estadoDelPedido(pedido, renglones = [], ahora = new Date()) {
  const hay = (tipo) => renglones.some((r) => r.kind === tipo);
  const aprobado = renglones.find((r) => r.kind === 'payment_approved') || null;
  const delAprobado = (tipo) => renglones.some((r) => r.kind === tipo
    && (aprobado ? r.mp_payment_id === aprobado.mp_payment_id : true));

  const base = {
    pagado: Boolean(aprobado),
    pago: aprobado ? aprobado.mp_payment_id : null,
    pagos_repetidos: renglones.filter((r) => r.kind === 'payment_extra').length,
  };

  if (delAprobado('charged_back')) return { ...base, clave: 'charged_back' };
  if (delAprobado('refunded')) return { ...base, clave: 'refunded' };
  if (hay('cancelled')) return { ...base, clave: 'cancelled' };
  if (aprobado) {
    if (hay('delivered')) return { ...base, clave: 'delivered' };
    if (hay('shipped')) return { ...base, clave: 'shipped' };
    if (hay('ready')) return { ...base, clave: 'ready' };
    return { ...base, clave: 'paid' };
  }

  const creado = new Date(pedido?.created_at).getTime();
  if (Number.isFinite(creado) && ahora.getTime() - creado > HORAS_PARA_PAGAR * 3_600_000) {
    return { ...base, clave: 'expired' };
  }
  const ultimo = [...renglones].reverse().find((r) => r.kind === 'payment_pending' || r.kind === 'payment_rejected');
  if (ultimo?.kind === 'payment_pending') return { ...base, clave: 'awaiting' };
  if (ultimo?.kind === 'payment_rejected') return { ...base, clave: 'rejected' };
  return { ...base, clave: 'unpaid' };
}

// ¿Se puede abrir Mercado Pago otra vez? Sin pagar, sin cancelar y sin vencer.
// "Pago pendiente" también: la ficha de OXXO se pudo perder, y si alguien paga
// dos veces queda como pago repetido para que la tienda reembolse uno.
export const SE_PUEDE_PAGAR = ['unpaid', 'awaiting', 'rejected'];

// Lo que la tienda puede hacer con un pedido en cada estado. Cancelar se puede
// mientras no haya salido: enviado o entregado, la pieza ya no está en la tienda.
export function accionPermitida(estado, accion, formaDeEntrega) {
  switch (accion) {
    case 'ready':
      if (formaDeEntrega === 'shipping') return 'Un envío se marca como enviado, no como listo';
      return estado === 'paid' ? null : 'Solo un pedido pagado se marca como listo';
    case 'shipped':
      if (formaDeEntrega !== 'shipping') return 'Solo un envío se marca como enviado';
      return estado === 'paid' ? null : 'Solo un pedido pagado se marca como enviado';
    case 'delivered':
      return ['paid', 'ready', 'shipped'].includes(estado) ? null : 'Este pedido no está pendiente de entregar';
    case 'cancel':
      return ['paid', 'ready'].includes(estado) ? null : 'Solo se cancela un pedido pagado que no ha salido';
    default:
      return 'Esa acción no existe';
  }
}

// Lo que viaja de un renglón al comprador y a la tienda: qué pasó y cuándo, sin
// los datos crudos de Mercado Pago.
export function historiaDe(renglones = []) {
  return renglones
    .filter((r) => r.kind !== 'checkout_opened')
    .map((r) => ({
      kind: r.kind,
      at: r.created_at,
      by_side: r.by_side,
      ...(r.kind === 'shipped' ? { carrier: r.data?.carrier ?? null, tracking: r.data?.tracking ?? null } : {}),
      ...(r.kind === 'cancelled' ? { reason: r.data?.reason ?? null } : {}),
      ...(['payment_approved', 'payment_pending', 'payment_rejected'].includes(r.kind)
        ? { method: r.data?.payment_type ?? null }
        : {}),
    }));
}
