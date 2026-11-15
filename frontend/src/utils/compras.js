// Las compras en la vitrina, del lado de la pantalla (README, "Compras en la
// vitrina"): qué se puede comprar, las tallas, el carrito guardado en el
// navegador, cómo se dice cada estado de un pedido y los mensajes de WhatsApp.
// Funciones puras: lo prueba tests/unit/compras.test.mjs.
//
// Las listas viajan en tres lados (regla 6): el CHECK del esquema, el backend
// (backend/src/utils/compras.js) y aquí. La prueba del backend compara las dos
// copias, y falla si una cambia sola.
//
// `price` es NUMERIC y llega como texto ("850.00"); todo se lee con Number().

import { catalogPrice } from './money.js';
import { fechaLarga, getMatchParts } from './matchDisplay.js';

// ── Las listas ────────────────────────────────────────────────────────────

export const FORMAS_DE_ENTREGA = ['pickup', 'shipping', 'match'];

export const ESTADOS_DEL_PEDIDO = [
  'unpaid', 'awaiting', 'rejected', 'expired',
  'paid', 'ready', 'shipped', 'delivered',
  'cancelled', 'refunded', 'charged_back',
];

export const MONEDA = 'MXN';
export const PIEZAS_POR_RENGLON = 10;
export const RENGLONES_POR_PEDIDO = 20;

const texto = (v) => String(v ?? '').trim();

// ── Qué se puede comprar ─────────────────────────────────────────────────

export function aCentavos(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export const aPesos = (centavos) => Math.round(Number(centavos) || 0) / 100;

// Activo, en la vitrina, en pesos y con precio. La lista pública ya trae solo lo
// activo y en la vitrina, sin esas columnas.
export function esComprable(producto) {
  if (!producto) return false;
  if (producto.is_active === false || producto.show_on_platform === false) return false;
  if ((producto.currency || MONEDA) !== MONEDA) return false;
  return (aCentavos(producto.price) ?? 0) > 0;
}

// "S, M, L, XL" → ['S', 'M', 'L', 'XL'], igual que el backend.
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

export function tallasParaElegir(sizeVariant) {
  const tallas = tallasDe(sizeVariant);
  return tallas.length > 1 ? tallas : [];
}

// null es "la tienda no lleva la cuenta", que no es cero.
export function existenciasDe(producto, talla) {
  const porTalla = producto?.size_stock;
  if (porTalla && typeof porTalla === 'object' && talla && Object.prototype.hasOwnProperty.call(porTalla, talla)) {
    return Number(porTalla[talla]);
  }
  if (producto?.stock === null || producto?.stock === undefined || producto?.stock === '') return null;
  return Number(producto.stock);
}

// Agotado del todo: lleva la cuenta y no queda nada, en ninguna talla.
export function agotado(producto) {
  const tallas = tallasParaElegir(producto?.size_variant);
  if (tallas.length && producto?.size_stock) {
    return tallas.every((t) => (existenciasDe(producto, t) ?? 1) <= 0);
  }
  const hay = existenciasDe(producto, null);
  return hay !== null && hay <= 0;
}

// Cuántas piezas se pueden pedir de esa talla: hasta 10, y hasta las que haya.
export function maximoDePiezas(producto, talla) {
  const hay = existenciasDe(producto, talla);
  return hay === null ? PIEZAS_POR_RENGLON : Math.max(0, Math.min(PIEZAS_POR_RENGLON, hay));
}

// ── El carrito, en el navegador ──────────────────────────────────────────
//
// Uno por tienda (README, "El carrito"). Guarda qué quieres y cuántas, y una copia
// de cómo lo viste —nombre, foto, precio— para pintarlo sin esperar al servidor.
// Esa copia no se le cree a nadie: el servidor vuelve a leer todo antes de pagar.
// El almacenamiento puede fallar (modo privado): sin él, el carrito vive mientras
// la página esté abierta.

export const claveDelCarrito = (organizationId) => `cfbamx_carrito_${organizationId}`;

export function leerCarrito(organizationId, almacen) {
  try {
    const crudo = almacen?.getItem(claveDelCarrito(organizationId));
    const datos = crudo ? JSON.parse(crudo) : [];
    if (!Array.isArray(datos)) return [];
    return datos
      .filter((r) => Number.isInteger(Number(r?.product_id)) && Number(r?.quantity) > 0)
      .slice(0, RENGLONES_POR_PEDIDO)
      .map((r) => ({
        product_id: Number(r.product_id),
        size: r.size ? String(r.size) : null,
        quantity: Math.min(PIEZAS_POR_RENGLON, Math.max(1, Math.round(Number(r.quantity)))),
        name: texto(r.name),
        image_url: r.image_url || null,
        price: r.price ?? null,
      }));
  } catch {
    return [];
  }
}

export function guardarCarrito(organizationId, carrito, almacen) {
  try {
    if (!carrito.length) almacen?.removeItem(claveDelCarrito(organizationId));
    else almacen?.setItem(claveDelCarrito(organizationId), JSON.stringify(carrito));
  } catch {
    // modo privado: el carrito vive mientras la página esté abierta
  }
}

const mismaPieza = (a, b) => a.product_id === b.product_id && (a.size || null) === (b.size || null);

// Agregar suma a la misma pieza (producto y talla), hasta 10.
export function agregarAlCarrito(carrito, producto, talla, cantidad) {
  const nueva = {
    product_id: Number(producto.id),
    size: talla || null,
    quantity: Math.max(1, Math.round(Number(cantidad) || 1)),
    name: producto.name,
    image_url: producto.image_url || null,
    price: producto.price ?? null,
  };
  const previa = carrito.find((r) => mismaPieza(r, nueva));
  if (previa) {
    return carrito.map((r) => (mismaPieza(r, nueva)
      ? { ...r, ...nueva, quantity: Math.min(PIEZAS_POR_RENGLON, r.quantity + nueva.quantity) }
      : r));
  }
  if (carrito.length >= RENGLONES_POR_PEDIDO) return carrito;
  return [...carrito, { ...nueva, quantity: Math.min(PIEZAS_POR_RENGLON, nueva.quantity) }];
}

export function cambiarCantidad(carrito, pieza, cantidad) {
  const n = Math.round(Number(cantidad));
  if (!Number.isFinite(n) || n <= 0) return quitarDelCarrito(carrito, pieza);
  return carrito.map((r) => (mismaPieza(r, pieza) ? { ...r, quantity: Math.min(PIEZAS_POR_RENGLON, n) } : r));
}

export const quitarDelCarrito = (carrito, pieza) => carrito.filter((r) => !mismaPieza(r, pieza));

export const piezasDelCarrito = (carrito) => carrito.reduce((suma, r) => suma + r.quantity, 0);

// Lo que viaja al servidor: qué y cuántas. Nada más.
export const carritoParaElServidor = (carrito) =>
  carrito.map(({ product_id, size, quantity }) => ({ product_id, size, quantity }));

// Con lo que contestó el servidor, el carrito se pone al día: el nombre, la
// foto y el precio de hoy.
export function carritoAlDia(carrito, renglones = []) {
  return carrito.map((r) => {
    const deHoy = renglones.find((l) => l.product_id === r.product_id && (l.size || null) === (r.size || null));
    return deHoy ? { ...r, name: deHoy.product_name, image_url: deHoy.product_image_url, price: deHoy.unit_price } : r;
  });
}

// ── Cómo se dicen las cosas ──────────────────────────────────────────────

export const ENTREGAS = {
  pickup: { label: 'Recoger en la tienda', short: 'Recoger' },
  shipping: { label: 'Envío a domicilio', short: 'Envío' },
  match: { label: 'Entrega en un partido', short: 'En un partido' },
};

// El tono es el color de su etiqueta: `wait` amarillo (algo pendiente), `ok`
// verde, `off` gris, `bad` rojo.
export const ESTADOS = {
  unpaid:       { label: 'Esperando pago', tone: 'wait' },
  awaiting:     { label: 'Pago pendiente', tone: 'wait' },
  rejected:     { label: 'Pago rechazado', tone: 'bad' },
  expired:      { label: 'Vencido', tone: 'off' },
  paid:         { label: 'Pagado, por preparar', tone: 'wait' },
  ready:        { label: 'Listo', tone: 'ok' },
  shipped:      { label: 'Enviado', tone: 'ok' },
  delivered:    { label: 'Entregado', tone: 'ok' },
  cancelled:    { label: 'Cancelado', tone: 'off' },
  refunded:     { label: 'Reembolsado', tone: 'off' },
  charged_back: { label: 'Contracargo', tone: 'bad' },
};

// "Listo" dice dónde: en la tienda o en el partido.
export function etiquetaDelEstado(clave, formaDeEntrega) {
  if (clave === 'ready') {
    return formaDeEntrega === 'match' ? 'Listo para entregar en el partido' : 'Listo para recoger';
  }
  return ESTADOS[clave]?.label ?? 'Sin estado';
}

// Lo que se le explica a quien compró, debajo del estado.
export function explicacionDelEstado(clave, formaDeEntrega) {
  switch (clave) {
    case 'unpaid': return 'Tu pedido está guardado. Págalo con Mercado Pago para que la tienda lo prepare.';
    case 'awaiting': return 'Mercado Pago espera tu pago: si elegiste OXXO, paga tu ficha antes de que venza.';
    case 'rejected': return 'Mercado Pago rechazó el pago. Puedes intentarlo otra vez, con otra tarjeta o en OXXO.';
    case 'expired': return 'Pasaron 72 horas sin pago y el pedido venció. Si todavía lo quieres, hazlo de nuevo desde la vitrina.';
    case 'paid': return 'Tu pago está aprobado. La tienda está preparando tu pedido.';
    case 'ready': return formaDeEntrega === 'match'
      ? 'Tu pedido está listo: recógelo en el puesto de la tienda el día del partido.'
      : 'Tu pedido está listo: recógelo en la tienda, en su horario.';
    case 'shipped': return 'Tu pedido va en camino.';
    case 'delivered': return 'La tienda entregó tu pedido.';
    case 'cancelled': return 'La tienda canceló tu pedido. El reembolso lo hace Mercado Pago, en sus plazos.';
    case 'refunded': return 'Tu pago se reembolsó por Mercado Pago.';
    case 'charged_back': return 'El cargo se desconoció ante el banco.';
    default: return '';
  }
}

// Por qué un pedido que espera su pago no trae «Pagar». Un pedido se cobra con la
// cuenta de Mercado Pago con la que se hizo (`pay_blocked: 'account_changed'`
// cuando la tienda ya conectó otra): con OXXO, la ficha que ya tiene quien compró
// paga a la cuenta de antes, y aquí ya no se puede confirmar.
export function porQueNoSePuedePagar(pedido) {
  if (!pedido || pedido.can_pay || !['unpaid', 'awaiting', 'rejected'].includes(pedido.status)) return null;
  if (pedido.pay_blocked === 'account_changed') {
    return pedido.status === 'awaiting'
      ? 'La tienda cambió su cuenta de Mercado Pago después de tu pedido, y aquí ya no podemos confirmar tu pago. Si ya pagaste tu ficha, avísale a la tienda por WhatsApp; si no, haz tu pedido de nuevo desde su vitrina.'
      : 'La tienda cambió su cuenta de Mercado Pago después de tu pedido, y este ya no se puede pagar. Haz tu pedido de nuevo desde su vitrina.';
  }
  return 'Por ahora esta tienda no está recibiendo pagos.';
}

// Los estados en que un pedido todavía espera algo —un pago o una entrega— y los
// que ya se cerraron. "Mis pedidos" los separa así, y "Mi panel" cuenta los
// primeros.
export const PEDIDO_EN_CURSO = ['unpaid', 'awaiting', 'rejected', 'paid', 'ready', 'shipped'];

export function tramosDeMisPedidos(pedidos) {
  if (!Array.isArray(pedidos) || pedidos.length === 0) return [];
  const curso = pedidos.filter((p) => PEDIDO_EN_CURSO.includes(p.status));
  const cerrados = pedidos.filter((p) => !PEDIDO_EN_CURSO.includes(p.status));
  return [
    curso.length && { key: 'curso', label: 'En curso', rows: curso },
    cerrados.length && { key: 'cerrados', label: 'Terminados', rows: cerrados },
  ].filter(Boolean);
}

// Las celdas del marcador de Pedidos, en el panel de la tienda: filtran la tabla.
// "Por preparar" va en amarillo: es lo que le toca a la tienda.
export const ORDER_FILTERS = [
  { key: 'todos', label: 'Pedidos', test: () => true },
  { key: 'preparar', label: 'Por preparar', test: (o) => o.status === 'paid', attention: true },
  { key: 'listos', label: 'Listos o enviados', test: (o) => ['ready', 'shipped'].includes(o.status) },
  { key: 'entregados', label: 'Entregados', test: (o) => o.status === 'delivered' },
  { key: 'esperando', label: 'Esperando pago', test: (o) => ['unpaid', 'awaiting', 'rejected'].includes(o.status) },
  {
    key: 'cerrados', label: 'Cancelados o vencidos', optional: true,
    test: (o) => ['cancelled', 'refunded', 'expired', 'charged_back'].includes(o.status),
  },
];

// Lo que la tienda puede hacer con un pedido, como botón: la acción principal a la
// vista, y cancelar en "⋯". Las claves son las del backend (`actions`).
export const ACCIONES = {
  ready: { label: 'Marcar listo', hecho: 'Marcado como listo' },
  shipped: { label: 'Marcar enviado', hecho: 'Marcado como enviado' },
  delivered: { label: 'Marcar entregado', hecho: 'Marcado como entregado' },
  cancel: { label: 'Cancelar y reembolsar', hecho: 'Cancelado y reembolsado' },
};

// La celda de "Mi panel": solo si tienes pedidos.
export function figuraDePedidos(pedidos) {
  if (!Array.isArray(pedidos) || pedidos.length === 0) return null;
  const curso = pedidos.filter((p) => PEDIDO_EN_CURSO.includes(p.status)).length;
  return {
    value: String(curso || pedidos.length),
    sub: curso ? (curso === 1 ? 'En curso · ver' : 'En curso · ver todos') : 'Ver mis pedidos',
  };
}

// Cada renglón de la historia de un pedido, como lo lee una persona.
export const RENGLONES = {
  created: 'Pedido hecho',
  payment_pending: 'Pago pendiente',
  payment_rejected: 'Pago rechazado',
  payment_approved: 'Pago aprobado',
  payment_extra: 'Pago repetido',
  ready: 'Listo',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancelled: 'Cancelado por la tienda',
  refunded: 'Reembolsado',
  charged_back: 'Contracargo',
  claimed: 'Guardado en una cuenta',
};

// Por qué no se puede cobrar un renglón del carrito (POST /shop/.../quote).
export function problemaDelCarrito(problema) {
  switch (problema?.problema) {
    case 'no_disponible': return 'Ya no está a la venta';
    case 'cantidad': return 'Elige de 1 a 10 piezas';
    case 'talla': return 'Elige una talla';
    case 'sin_existencias': return problema.disponibles > 0
      ? `Solo quedan ${problema.disponibles}`
      : 'Se agotó';
    case 'vacio': return 'Tu carrito está vacío';
    case 'demasiados': return 'Son demasiados productos para un pedido';
    default: return 'Revisa este producto';
  }
}

// Lo que le falta a una tienda para vender, como lo dice su panel. `quien` es a
// quién le toca: a CFBAMX o a la tienda.
export const LO_QUE_FALTA = {
  tienda: { label: 'Solo una tienda vende en su vitrina', quien: 'cfbamx' },
  publicada: { label: 'Que CFBAMX publique tu tienda', quien: 'cfbamx' },
  verificada: { label: 'Que CFBAMX verifique tu tienda', quien: 'cfbamx' },
  mercado_pago: { label: 'Conectar tu cuenta de Mercado Pago', quien: 'tienda' },
  domicilio: { label: 'Tu domicilio', quien: 'tienda' },
  telefono: { label: 'Un teléfono de contacto en tu perfil', quien: 'tienda' },
  politica: { label: 'Tu política de cambios y devoluciones', quien: 'tienda' },
  entrega: { label: 'Al menos una forma de entrega lista', quien: 'tienda' },
  producto: { label: 'Un producto con precio en tu vitrina', quien: 'tienda' },
};

export const precioDe = (valor) => catalogPrice(valor) ?? '—';

// Lo que Panel Admin → Compras lee de GET /admin/shop, con cada número como
// número aunque la API mande texto o nada.
export function panelDeCompras(payload) {
  const numero = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const historial = Array.isArray(payload?.switch?.history) ? payload.switch.history : [];
  const comision = payload?.fee ?? {};
  const conteos = payload?.counts ?? {};
  return {
    enabled: payload?.switch?.enabled === true,
    since: historial[0]?.changed_at ?? null,
    history: historial,
    configured: payload?.configured === true,
    missing: Array.isArray(payload?.missing_variables) ? payload.missing_variables : [],
    fee: numero(comision.percent),
    feeLimits: { min: numero(comision.limits?.minimo), max: numero(comision.limits?.maximo ?? 30) },
    feeHistory: Array.isArray(comision.history) ? comision.history : [],
    stores: numero(conteos.trusted_stores),
    connected: numero(conteos.connected_stores),
    orders: numero(conteos.orders),
    paid: numero(conteos.paid_30d),
    paidAmount: numero(conteos.paid_amount_30d),
    fees: numero(conteos.fees_30d),
  };
}

// "5%", "2.5%": el porcentaje como se lee.
export const porcentaje = (n) => `${Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 })}%`;

// "Talla M" solo si el producto pide elegir.
export const conTalla = (nombre, talla) => (talla ? `${nombre} · ${talla}` : nombre);

// Un partido donde la tienda entrega: quién juega, cuándo —en la zona del
// partido, como en su página— y dónde.
export const partidoEnTexto = (m) => (m ? `${m.home_team} vs ${m.away_team}` : '');

export function cuandoEsElPartido(m, ahora = Date.now()) {
  if (!m?.match_date) return 'Fecha por definir';
  const zona = m.timezone || m.league_timezone;
  const { time } = getMatchParts(m.match_date, zona);
  return `${fechaLarga(m.match_date, zona, ahora)} · ${time}`;
}

export function dondeEsElPartido(m) {
  return [m?.venue_name, m?.venue_address, m?.venue_city].filter((v) => texto(v)).join(', ');
}

// La dirección de un envío, en un renglón.
export function direccionEnTexto(d) {
  if (!d) return '';
  return [d.street, d.neighborhood, d.postal_code && `C.P. ${d.postal_code}`, d.city, d.state]
    .filter((v) => texto(v))
    .join(', ');
}

// Lo que el formulario revisa antes de mandar, con los mismos límites que el
// backend (utils/compras.js de allá): el servidor decide, esto evita el viaje.
export function revisarComprador(c = {}) {
  const errores = {};
  if (texto(c.name).length < 2) errores.name = 'Escribe tu nombre';
  const digitos = String(c.phone ?? '').replace(/\D/g, '');
  const valido = digitos.length === 10
    || (digitos.length === 12 && digitos.startsWith('52'))
    || (digitos.length === 13 && digitos.startsWith('521'));
  if (!valido) errores.phone = 'Escribe tu WhatsApp a 10 dígitos';
  const correo = texto(c.email);
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) errores.email = 'El correo no es válido';
  return errores;
}

export function revisarDireccion(d = {}) {
  const errores = {};
  if (!texto(d.street)) errores.street = 'Escribe la calle y el número';
  if (!texto(d.neighborhood)) errores.neighborhood = 'Escribe la colonia';
  if (String(d.postal_code ?? '').replace(/\D/g, '').length !== 5) errores.postal_code = 'El código postal lleva 5 dígitos';
  if (!texto(d.city)) errores.city = 'Escribe la ciudad o el municipio';
  if (!texto(d.state)) errores.state = 'Elige el estado';
  return errores;
}

// El envío que se va a cobrar, para enseñarlo antes de que el servidor lo diga.
export function textoDelEnvio(envio) {
  if (!envio) return '';
  const fijo = Number(envio.fee) || 0;
  if (fijo === 0) return 'Envío gratis';
  const gratis = envio.free_from ? ` · gratis desde ${precioDe(envio.free_from)}` : '';
  return `${precioDe(fijo)}${gratis}`;
}

// ── WhatsApp ─────────────────────────────────────────────────────────────

// Un número de México a 10 dígitos lleva el 52 de enfrente.
export function enlaceDeWhatsApp(numero, mensaje) {
  const digitos = String(numero ?? '').replace(/\D/g, '');
  if (digitos.length < 10) return null;
  const completo = digitos.length === 10 ? `52${digitos}` : digitos;
  return `https://wa.me/${completo}${mensaje ? `?text=${encodeURIComponent(mensaje)}` : ''}`;
}

export const urlDelPedido = (token, origen) => `${String(origen ?? '').replace(/\/+$/, '')}/pedido/${token}`;

// "998 765 4321": un número de diez dígitos como se dicta. Cualquier otro, tal cual.
export function telefonoEnTexto(numero) {
  const digitos = String(numero ?? '').replace(/\D/g, '');
  if (digitos.length !== 10) return String(numero ?? '');
  return `${digitos.slice(0, 3)} ${digitos.slice(3, 6)} ${digitos.slice(6)}`;
}

const listaDeProductos = (items = []) => items
  .map((i) => `${i.quantity} × ${conTalla(i.name, i.size)}`)
  .join(', ');

// Del comprador a la tienda, con el pedido escrito.
export function mensajeParaLaTienda(pedido, url) {
  return [
    `Hola, soy ${pedido.buyer.name}. Hice el pedido ${pedido.id} en ${pedido.store.name} por CFBAMX:`,
    listaDeProductos(pedido.items),
    `Total: ${precioDe(pedido.total)} MXN. ${ENTREGAS[pedido.delivery.method]?.label ?? ''}.`,
    url,
  ].filter(Boolean).join('\n');
}

// De la tienda al comprador, según lo que acaba de pasar.
export function mensajeParaElComprador(pedido, tienda, url) {
  const nombre = pedido.buyer?.name ? `Hola ${pedido.buyer.name.split(' ')[0]}` : 'Hola';
  const de = `tu pedido ${pedido.id} de ${tienda}`;
  let cuerpo;
  switch (pedido.status) {
    case 'ready':
      cuerpo = pedido.delivery.method === 'match'
        ? `${de} ya está listo para entregártelo en el partido.`
        : `${de} ya está listo para recoger${pedido.delivery.promised?.address ? ` en ${pedido.delivery.promised.address}` : ''}${pedido.delivery.promised?.hours ? ` (${pedido.delivery.promised.hours})` : ''}.`;
      break;
    case 'shipped': {
      const envio = (pedido.history || []).find((h) => h.kind === 'shipped');
      cuerpo = `${de} ya va en camino${envio?.carrier ? ` por ${envio.carrier}` : ''}${envio?.tracking ? `, guía ${envio.tracking}` : ''}.`;
      break;
    }
    case 'delivered': cuerpo = `${de} quedó entregado. ¡Gracias por tu compra!`; break;
    case 'cancelled':
    case 'refunded': cuerpo = `cancelamos ${de} y te reembolsamos ${precioDe(pedido.total)} MXN por Mercado Pago.`; break;
    case 'paid': cuerpo = `recibimos el pago de ${de}. Ya lo estamos preparando.`; break;
    default: cuerpo = `te escribimos por ${de}.`;
  }
  return `${nombre}, ${cuerpo}\nAquí lo puedes ver: ${url}`;
}
