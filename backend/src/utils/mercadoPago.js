import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HORAS_PARA_PAGAR, referenciaDe } from './compras.js';

// Mercado Pago de cada tienda (README, "Compras en la vitrina" → "Mercado Pago:
// el dinero va directo a la tienda"). La tienda autoriza a CFBAMX a cobrar a su
// nombre, y cada pedido abre un cobro con ese permiso: el dinero le llega directo.
//
// Sin librería, a propósito (regla de dependencias de CLAUDE.md): son cinco
// llamadas con fetch —cambiar el código por el permiso, renovarlo, abrir un
// cobro, preguntar un pago y reembolsarlo—. Lo que no toca la red —las llaves
// cifradas, el enlace para conectar con su `state` firmado, la firma de un aviso,
// qué renglón deja cada estado de un pago y el cobro que se arma— es puro y lo
// prueba el CI.
//
// `MP_API_BASE` apunta las llamadas a otro lado: las pruebas usan un Mercado
// Pago de mentira (tests/fakes/mercadoPago.mjs).

export const VARIABLES_DE_MERCADO_PAGO = [
  'MP_CLIENT_ID', 'MP_CLIENT_SECRET', 'MP_WEBHOOK_SECRET', 'MP_TOKEN_KEY', 'SITE_URL', 'API_PUBLIC_URL',
];

// Sin alguna, las compras no existen: falla cerrado, como emailAvailable().
export function faltanVariables(entorno = process.env) {
  return VARIABLES_DE_MERCADO_PAGO.filter((v) => !String(entorno[v] ?? '').trim());
}
export const mercadoPagoConfigurado = (entorno = process.env) => faltanVariables(entorno).length === 0;

const sinDiagonal = (url) => String(url ?? '').trim().replace(/\/+$/, '');
export const apiDeMercadoPago = (entorno = process.env) => sinDiagonal(entorno.MP_API_BASE || 'https://api.mercadopago.com');
const autorizacionDeMercadoPago = (entorno = process.env) => entorno.MP_AUTH_URL || 'https://auth.mercadopago.com/authorization';
// Con credenciales de prueba: el código se cambia por un permiso de prueba
// (`test_token`) y el comprador va al checkout de prueba.
export const modoDePrueba = (entorno = process.env) => ['1', 'true', 'si', 'sí'].includes(String(entorno.MP_SANDBOX ?? '').toLowerCase());

const iguales = (a, b) => {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
};

// ── Las llaves de la tienda, cifradas ────────────────────────────────────
//
// Con el permiso de una tienda se cobra y se reembolsa a su nombre: en la base
// van cifradas con AES-256-GCM, que además detecta si alguien las alteró. La
// llave sale de MP_TOKEN_KEY (cualquier texto largo; se pasa por SHA-256 para
// tener los 32 bytes). Si MP_TOKEN_KEY cambia, las tiendas reconectan.

const llaveDe = (secreto) => createHash('sha256').update(String(secreto)).digest();

export function cifrar(texto, secreto = process.env.MP_TOKEN_KEY) {
  if (!secreto) throw new Error('Falta MP_TOKEN_KEY');
  const iv = randomBytes(12);
  const cifrador = createCipheriv('aes-256-gcm', llaveDe(secreto), iv);
  const datos = Buffer.concat([cifrador.update(String(texto), 'utf8'), cifrador.final()]);
  return ['v1', iv.toString('base64url'), cifrador.getAuthTag().toString('base64url'), datos.toString('base64url')].join('.');
}

export function descifrar(guardado, secreto = process.env.MP_TOKEN_KEY) {
  if (!secreto) throw new Error('Falta MP_TOKEN_KEY');
  const [version, iv, etiqueta, datos] = String(guardado ?? '').split('.');
  if (version !== 'v1' || !iv || !etiqueta || !datos) throw new Error('La llave guardada no tiene el formato esperado');
  const descifrador = createDecipheriv('aes-256-gcm', llaveDe(secreto), Buffer.from(iv, 'base64url'));
  descifrador.setAuthTag(Buffer.from(etiqueta, 'base64url'));
  return Buffer.concat([descifrador.update(Buffer.from(datos, 'base64url')), descifrador.final()]).toString('utf8');
}

// ── Conectar la cuenta de la tienda ──────────────────────────────────────
//
// El `state` que viaja a Mercado Pago y regresa: la tienda, quién apretó el
// botón y hasta cuándo vale (10 minutos, lo mismo que dura el código de Mercado
// Pago), firmado. Al regresar, el backend exige además que quien lo trae con su
// sesión sea la misma persona: un enlace robado no conecta otra cuenta.

const MINUTOS_PARA_CONECTAR = 10;

export function estadoParaConectar({ organizationId, userId, ahora = Date.now(), secreto = process.env.MP_CLIENT_SECRET }) {
  const vence = ahora + MINUTOS_PARA_CONECTAR * 60_000;
  const cuerpo = `${Number(organizationId)}.${Number(userId)}.${vence}`;
  const firma = createHmac('sha256', String(secreto)).update(`conectar:${cuerpo}`).digest('base64url');
  return `${cuerpo}.${firma}`;
}

export function leerEstadoParaConectar(estado, { ahora = Date.now(), secreto = process.env.MP_CLIENT_SECRET } = {}) {
  const partes = String(estado ?? '').split('.');
  if (partes.length !== 4) return null;
  const [organizacion, usuario, vence, firma] = partes;
  const esperada = createHmac('sha256', String(secreto)).update(`conectar:${organizacion}.${usuario}.${vence}`).digest('base64url');
  if (!iguales(firma, esperada)) return null;
  if (!(Number(vence) > ahora)) return null;
  return { organizationId: Number(organizacion), userId: Number(usuario) };
}

// A donde regresa Mercado Pago: una página del sitio que le pasa el código al
// backend con la sesión (frontend/src/pages/MercadoPagoConnect.jsx). Tiene que
// ser exactamente la que está dada de alta en la aplicación de Mercado Pago.
export const regresoDeConectar = (entorno = process.env) => `${sinDiagonal(entorno.SITE_URL)}/mercadopago/conectar`;

export function enlaceParaConectar({ estado, entorno = process.env }) {
  const url = new URL(autorizacionDeMercadoPago(entorno));
  url.searchParams.set('client_id', String(entorno.MP_CLIENT_ID ?? ''));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('platform_id', 'mp');
  url.searchParams.set('state', estado);
  url.searchParams.set('redirect_uri', regresoDeConectar(entorno));
  return url.toString();
}

// ── El aviso de Mercado Pago ─────────────────────────────────────────────
//
// Mercado Pago firma cada aviso: `x-signature: ts=…,v1=…`, donde v1 es el
// HMAC-SHA256, con la clave secreta de los avisos de la aplicación, de
// `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`. Si falta un dato, su
// pedazo no va. Aun con la firma buena no se le cree al aviso: se le pregunta el
// pago a Mercado Pago (routes/shop.js).

export function manifiestoDelAviso({ dataId, xRequestId, ts }) {
  let manifiesto = '';
  if (dataId) manifiesto += `id:${String(dataId).toLowerCase()};`;
  if (xRequestId) manifiesto += `request-id:${xRequestId};`;
  if (ts) manifiesto += `ts:${ts};`;
  return manifiesto;
}

export function partesDeLaFirma(xSignature) {
  const partes = {};
  for (const pedazo of String(xSignature ?? '').split(',')) {
    const [clave, ...resto] = pedazo.split('=');
    if (clave && resto.length) partes[clave.trim()] = resto.join('=').trim();
  }
  return partes;
}

export function firmaDelAvisoValida({ xSignature, xRequestId, dataId, secreto = process.env.MP_WEBHOOK_SECRET }) {
  if (!secreto) return false;
  const { ts, v1 } = partesDeLaFirma(xSignature);
  if (!ts || !v1) return false;
  const esperada = createHmac('sha256', String(secreto)).update(manifiestoDelAviso({ dataId, xRequestId, ts })).digest('hex');
  return iguales(v1, esperada);
}

// Lo que haría Mercado Pago: para el de mentira de las pruebas.
export function firmarAviso({ dataId, xRequestId, ts = String(Date.now()), secreto }) {
  const v1 = createHmac('sha256', String(secreto)).update(manifiestoDelAviso({ dataId, xRequestId, ts })).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

// El renglón que deja cada estado de un pago. "En revisión" y la ficha de OXXO
// sin pagar son lo mismo para quien compra: pendiente. Un estado que no está
// aquí no deja nada.
export function renglonDePago(estado) {
  switch (estado) {
    case 'approved':
      return 'payment_approved';
    case 'pending':
    case 'in_process':
    case 'authorized':
      return 'payment_pending';
    case 'rejected':
    case 'cancelled':
      return 'payment_rejected';
    case 'refunded':
      return 'refunded';
    case 'charged_back':
      return 'charged_back';
    default:
      return null;
  }
}

// ¿Este pago es de este pedido? La referencia, la moneda y el monto, al
// centavo. Un pago que no cuadra no se registra.
export function pagoCuadra(pago, pedido) {
  if (!pago || !pedido) return false;
  if (pago.external_reference !== referenciaDe(pedido.id)) return false;
  if ((pago.currency_id || 'MXN') !== (pedido.currency || 'MXN')) return false;
  return Math.round(Number(pago.transaction_amount) * 100) === Math.round(Number(pedido.total) * 100);
}

// ── El cobro ─────────────────────────────────────────────────────────────

// Mercado Pago pide las fechas con su zona: "2026-11-17T18:00:00.000+00:00".
const fechaParaMercadoPago = (fecha) => new Date(fecha).toISOString().replace('Z', '+00:00');

// La preferencia de Checkout Pro de un pedido: sus productos al precio que se
// guardó, el envío como un renglón más, la referencia, a dónde regresa quien
// paga, a dónde avisa Mercado Pago y cuándo vence (72 horas desde el pedido,
// también la ficha de OXXO). La comisión solo viaja si no es 0.
export function cobroDe({ pedido, renglones, entorno = process.env }) {
  const items = renglones.map((r) => ({
    id: String(r.product_id ?? `renglon-${r.id}`),
    title: (r.size_label ? `${r.product_name} · ${r.size_label}` : r.product_name).slice(0, 250),
    quantity: Number(r.quantity),
    unit_price: Number(r.unit_price),
    currency_id: 'MXN',
    ...(r.product_image_url ? { picture_url: r.product_image_url } : {}),
  }));
  if (Number(pedido.shipping_fee) > 0) {
    items.push({ id: 'envio', title: 'Envío a domicilio', quantity: 1, unit_price: Number(pedido.shipping_fee), currency_id: 'MXN' });
  }
  const pagina = `${sinDiagonal(entorno.SITE_URL)}/pedido/${pedido.token}`;
  const vence = fechaParaMercadoPago(new Date(pedido.created_at).getTime() + HORAS_PARA_PAGAR * 3_600_000);
  return {
    items,
    payer: { name: pedido.buyer_name, ...(pedido.buyer_email ? { email: pedido.buyer_email } : {}) },
    external_reference: referenciaDe(pedido.id),
    notification_url: `${sinDiagonal(entorno.API_PUBLIC_URL)}/api/shop/mercadopago/webhook?pedido=${pedido.id}`,
    back_urls: { success: pagina, pending: pagina, failure: pagina },
    auto_return: 'approved',
    expires: true,
    expiration_date_to: vence,
    date_of_expiration: vence,
    metadata: { cfbamx_order_id: pedido.id },
    ...(Number(pedido.fee_amount) > 0 ? { marketplace_fee: Number(pedido.fee_amount) } : {}),
  };
}

// ── Las llamadas ─────────────────────────────────────────────────────────

export class ErrorDeMercadoPago extends Error {
  constructor(mensaje, { status, datos } = {}) {
    super(mensaje);
    this.status = status;
    this.datos = datos;
  }
}

async function llamar(ruta, { method = 'GET', token, body, idempotencia, entorno = process.env } = {}) {
  let respuesta;
  try {
    respuesta = await fetch(`${apiDeMercadoPago(entorno)}${ruta}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(idempotencia ? { 'X-Idempotency-Key': idempotencia } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new ErrorDeMercadoPago(`No se pudo hablar con Mercado Pago: ${e.message}`);
  }
  const crudo = await respuesta.text();
  let datos = null;
  try { datos = crudo ? JSON.parse(crudo) : null; } catch { datos = { mensaje: crudo.slice(0, 300) }; }
  if (!respuesta.ok) {
    throw new ErrorDeMercadoPago(datos?.message || datos?.error || `Mercado Pago contestó ${respuesta.status}`, {
      status: respuesta.status,
      datos,
    });
  }
  return datos;
}

// El código que trae la tienda de regreso, por su permiso.
export function cambiarCodigo(code, entorno = process.env) {
  return llamar('/oauth/token', {
    method: 'POST',
    entorno,
    body: {
      client_id: entorno.MP_CLIENT_ID,
      client_secret: entorno.MP_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: regresoDeConectar(entorno),
      ...(modoDePrueba(entorno) ? { test_token: true } : {}),
    },
  });
}

// Mercado Pago entrega otro permiso y otra llave para renovar: se guardan los dos.
export function renovarPermiso(refreshToken, entorno = process.env) {
  return llamar('/oauth/token', {
    method: 'POST',
    entorno,
    body: {
      client_id: entorno.MP_CLIENT_ID,
      client_secret: entorno.MP_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    },
  });
}

export const abrirCobro = (token, preferencia, entorno = process.env) =>
  llamar('/checkout/preferences', { method: 'POST', token, body: preferencia, entorno });

export const consultarPago = (token, paymentId, entorno = process.env) =>
  llamar(`/v1/payments/${encodeURIComponent(paymentId)}`, { token, entorno });

// Reembolso completo. La llave de idempotencia es el pedido: apretar dos veces
// "Cancelar y reembolsar" no reembolsa dos veces.
export const reembolsar = (token, paymentId, idempotencia, entorno = process.env) =>
  llamar(`/v1/payments/${encodeURIComponent(paymentId)}/refunds`, { method: 'POST', token, body: {}, idempotencia, entorno });

// Lo que guarda una conexión, ya con las llaves cifradas.
export function conexionDe(respuesta, ahora = Date.now()) {
  const segundos = Number(respuesta?.expires_in);
  return {
    provider_user_id: String(respuesta?.user_id ?? ''),
    access_token_enc: cifrar(respuesta.access_token),
    refresh_token_enc: respuesta.refresh_token ? cifrar(respuesta.refresh_token) : null,
    public_key: respuesta.public_key ?? null,
    live_mode: typeof respuesta.live_mode === 'boolean' ? respuesta.live_mode : null,
    expires_at: Number.isFinite(segundos) && segundos > 0 ? new Date(ahora + segundos * 1000).toISOString() : null,
  };
}
