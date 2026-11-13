import { createHmac, randomBytes } from 'node:crypto';

// Las reglas de los premios por acertar (README, "Premios por acertar"): el
// código de cada ganador, la vigencia, los estados y lo que se valida al poner
// un premio. Puras y sin `db`, para probarlas sin Postgres; el SQL vive en
// routes/prizes.js, y el interruptor —un botón del Panel Admin— en
// utils/interruptores.js.
//
// Ojo para quien edite: aquí no se escribe ningún `type: '…'` literal. La
// prueba del catálogo de avisos cuenta esos literales en utils/bandeja.js como
// avisos calculados, y el premio NO es un aviso nuevo: viaja dentro del
// resultado de tu predicción (`prediction_result`).

// ── Lo que se valida al poner un premio ───────────────────────────────────
//
// Los mismos rangos que los CHECK de `prediction_prizes` en config/db.js y el
// formulario del panel (regla 6: un valor que viaja se cambia en los tres lados).

export const DESCUENTO_MINIMO = 5;
export const DESCUENTO_MAXIMO = 100;
// La pantalla ofrece estas; la base acepta de 1 a 365 para que ofrecer otra no
// pida migración.
export const VIGENCIAS = [7, 15, 30, 60];
export const VIGENCIA_MAXIMA = 365;

function enteroPositivo(valor) {
  const n = typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : valor;
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Lo que manda el panel al poner un premio. Devuelve `{ error }` con el primer
// problema, en las palabras de la pantalla, o `{ premio }` ya limpio.
export function validarPremio(cuerpo = {}) {
  const matchId = enteroPositivo(cuerpo.match_id);
  if (!matchId) return { error: 'Elige un partido' };
  const productId = enteroPositivo(cuerpo.product_id);
  if (!productId) return { error: 'Elige un producto de tu vitrina' };
  const descuento = enteroPositivo(cuerpo.discount_percent);
  if (!descuento || descuento < DESCUENTO_MINIMO || descuento > DESCUENTO_MAXIMO) {
    return { error: `El descuento va de ${DESCUENTO_MINIMO}% a ${DESCUENTO_MAXIMO}%, sin decimales` };
  }
  const dias = enteroPositivo(cuerpo.valid_days);
  if (!dias || dias > VIGENCIA_MAXIMA) {
    return { error: 'Elige cuántos días vale el premio después del partido' };
  }
  return { premio: { match_id: matchId, product_id: productId, discount_percent: descuento, valid_days: dias } };
}

// ── El código de cada ganador ─────────────────────────────────────────────
//
// `CFB-<premio>-<firma>`. La firma son 6 caracteres del HMAC del id de la
// persona con el secreto de ESE premio, en el base32 de Crockford: sin I, L, O
// ni U, que se confunden al dictarlo o al leerlo en un teléfono. No se guarda
// una fila por código: se recalcula igual cada vez.
//
// Seis caracteres son 30 bits. Alcanza porque el código solo se revisa desde el
// panel de la tienda dueña del premio: quien lo inventa en el mostrador no
// tiene contra qué probarlo.

export const LARGO_DE_FIRMA = 6;
const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIJO = 'CFB';

// El secreto de un premio nuevo. Va a `prediction_prizes.code_secret` y nunca
// sale del backend.
export function nuevoSecreto() {
  return randomBytes(16).toString('hex');
}

function base32(bytes, largo) {
  let valor = 0;
  let bits = 0;
  let salida = '';
  for (const byte of bytes) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5 && salida.length < largo) {
      salida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (salida.length >= largo) break;
    valor &= (1 << bits) - 1;
  }
  return salida;
}

export function firmaDe(secreto, userId) {
  const hmac = createHmac('sha256', String(secreto)).update(String(userId)).digest();
  return base32(hmac, LARGO_DE_FIRMA);
}

export function codigoDePremio(premio, userId) {
  return `${PREFIJO}-${premio.id}-${firmaDe(premio.code_secret, userId)}`;
}

// Lo que se lee de un código impreso o dictado: la O es cero, la I y la L son uno.
const comoSeLee = (texto) => texto.replace(/O/g, '0').replace(/[IL]/g, '1');

// Lo que alguien teclea en el mostrador, como venga: minúsculas, espacios o
// guiones de más o de menos, con O en vez de 0. Devuelve `{ prizeId, firma }`,
// o null si no tiene forma de código.
//
// Si trae separadores, ellos dicen dónde acaba el premio: "27 K7M2Q9", y lo que
// sigue es la firma aunque venga partida ("K7M2 Q9"). Así una firma a la que le
// falta un carácter no se lee como la de otro premio. Sin ningún separador, la
// firma son los ÚLTIMOS seis: "CFB277KM2Q9" es el premio 27, no el 277.
export function leerCodigo(texto) {
  if (typeof texto !== 'string') return null;
  const partes = texto.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (partes.length === 0) return null;
  if (partes[0].startsWith(PREFIJO)) partes[0] = partes[0].slice(PREFIJO.length);
  if (partes[0] === '') partes.shift();
  if (partes.length === 0) return null;

  let premio;
  let firma;
  if (partes.length === 1) {
    if (partes[0].length <= LARGO_DE_FIRMA) return null;
    premio = partes[0].slice(0, -LARGO_DE_FIRMA);
    firma = partes[0].slice(-LARGO_DE_FIRMA);
  } else {
    [premio] = partes;
    firma = partes.slice(1).join('');
  }
  premio = comoSeLee(premio);
  firma = comoSeLee(firma);
  if (!/^\d+$/.test(premio)) return null;
  if (firma.length !== LARGO_DE_FIRMA || ![...firma].every((c) => ALFABETO.includes(c))) return null;
  const prizeId = Number(premio);
  if (!Number.isSafeInteger(prizeId) || prizeId <= 0) return null;
  return { prizeId, firma };
}

// Cuál de los ganadores de un premio tiene esta firma. `ganadores` son ids de
// usuario. Null si ninguno: el código no es de un ganador de este premio.
export function ganadorDeLaFirma(premio, firma, ganadores) {
  for (const userId of ganadores) {
    if (firmaDe(premio.code_secret, userId) === firma) return userId;
  }
  return null;
}

// ── La vigencia y los estados ─────────────────────────────────────────────

const DIA_MS = 24 * 60 * 60 * 1000;

// Cuándo vence: N días después de que el partido terminó (`gradable_at`, la
// misma hora que reparte los puntos). Sin esa hora, el partido no ha
// terminado y no hay vencimiento todavía.
export function venceEl(gradableAt, dias) {
  if (gradableAt === null || gradableAt === undefined) return null;
  const inicio = new Date(gradableAt).getTime();
  if (Number.isNaN(inicio) || !Number.isFinite(Number(dias))) return null;
  return new Date(inicio + Number(dias) * DIA_MS);
}

// El premio de una persona: usado, vencido o todavía vale. Lo usado gana: un
// código que se cobró el último día sigue diciendo cuándo se usó.
export function estadoDelCanje({ redeemedAt, vence, ahora = new Date() }) {
  if (redeemedAt) return 'redeemed';
  if (vence && new Date(vence).getTime() < new Date(ahora).getTime()) return 'expired';
  return 'valid';
}

// El premio visto desde la tienda: abierto mientras se puede votar, en juego
// mientras se espera el resultado, y entregado cuando el partido ya calificó.
export function estadoDelPremio({ votacionCerrada, gradableAt }) {
  if (gradableAt) return 'awarded';
  if (votacionCerrada) return 'locked';
  return 'open';
}

// ── Cómo viaja un premio ──────────────────────────────────────────────────
//
// Una sola forma para la página del partido, la bandeja y "Mis premios", desde
// la fila que arma routes/prizes.js. Columnas nombradas una por una: la fila
// trae `code_secret`, y aquí es donde se queda.

// El producto como se prometió: la copia que guardó el premio, no el producto
// de hoy. `price` llega de Postgres como texto (NUMERIC) y sale como número, o
// null si la tienda no le puso precio.
export function productoDe(fila) {
  return {
    name: fila.product_name,
    price: fila.product_price === null || fila.product_price === undefined ? null : Number(fila.product_price),
    currency: fila.product_currency || 'MXN',
    image_url: fila.product_image_url || null,
  };
}

export function premioParaQuienLoVe(fila) {
  return {
    id: fila.id,
    discount_percent: Number(fila.discount_percent),
    valid_days: Number(fila.valid_days),
    product: productoDe(fila),
    store: {
      id: fila.organization_id,
      name: fila.store_name,
      logo_url: fila.store_logo_url || null,
      is_verified: fila.store_is_verified === true,
    },
  };
}

// El premio de un ganador: lo de arriba más su código, cuándo vence y si ya lo
// usó.
export function premioDelGanador(fila, userId, ahora = new Date()) {
  const vence = venceEl(fila.gradable_at, fila.valid_days);
  const redeemedAt = fila.redeemed_at ? new Date(fila.redeemed_at) : null;
  return {
    ...premioParaQuienLoVe(fila),
    code: codigoDePremio(fila, userId),
    expires_at: vence ? vence.toISOString() : null,
    redeemed_at: redeemedAt ? redeemedAt.toISOString() : null,
    status: estadoDelCanje({ redeemedAt, vence, ahora }),
  };
}
