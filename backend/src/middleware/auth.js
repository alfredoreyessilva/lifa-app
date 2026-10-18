import jwt from 'jsonwebtoken';
import db from '../config/db.js';
import { segundoDelCambio, tokenSigueVigente } from '../utils/sesiones.js';

// Sin valor por defecto a propósito: si JWT_SECRET no está definida, cualquier
// persona podría firmar tokens válidos usando el mismo secreto público que
// tenía este archivo antes. Mejor que el servidor falle a que arranque inseguro.
//
// OJO: leemos process.env.JWT_SECRET dentro de una función (getJwtSecret), NO
// en el top-level del módulo. En ESM, los `import` de otros archivos (como
// este) se resuelven y ejecutan ANTES de que corra `dotenv.config()` en
// server.js, así que si leyéramos process.env.JWT_SECRET aquí arriba,
// siempre lo veríamos vacío y el servidor jamás arrancaría. El mismo patrón
// ya se usa en upload.js para Cloudinary, por la misma razón.
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'Falta la variable de entorno JWT_SECRET. Defínela antes de iniciar el servidor ' +
      '(cualquier cadena larga y aleatoria sirve, ej. generada con `openssl rand -hex 32`).'
    );
  }
  return secret;
}

export function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    getJwtSecret(),
    { expiresIn: '7d' }
  );
}

// ── Las sesiones que cerró un cambio de contraseña ──
//
// Al cambiar la contraseña se cierran TODAS las sesiones abiertas (README,
// "Recuperar la contraseña", 2026-10-17). El token no se guarda en ningún
// lado, así que cerrarlas es rechazar el que se firmó antes del cambio, y eso
// pide saber cuándo cambió: una consulta por petición con sesión.
//
// Por eso la caché. Vive en la memoria de este proceso y dura 60 s, y el
// cambio de contraseña la actualiza al instante (rememberPasswordChange): con
// una sola instancia, que es lo que corre hoy en Render, la revocación es
// inmediata. Con varias, la que no hizo el cambio puede aceptar el token viejo
// hasta un minuto.
const CAMBIO_VIGENTE_MS = 60 * 1000;
const MAX_CAMBIOS_EN_CACHE = 5000;
const cambiosDeContrasena = new Map(); // userId -> { segundo, leidoEn }

function guardarCambio(userId, segundo) {
  // Un tope burdo y no un LRU: con cinco mil sesiones distintas en un minuto
  // este proceso tiene problemas más grandes que una consulta de más.
  if (cambiosDeContrasena.size >= MAX_CAMBIOS_EN_CACHE) cambiosDeContrasena.clear();
  cambiosDeContrasena.set(userId, { segundo, leidoEn: Date.now() });
}

async function segundoDelUltimoCambio(userId) {
  const key = Number(userId);
  // Un token sin id de usuario no tiene contraseña que haya cambiado, y
  // preguntarle a la base por `NaN` truena con 500 en vez de contestar.
  if (!Number.isInteger(key)) return null;
  const visto = cambiosDeContrasena.get(key);
  if (visto && Date.now() - visto.leidoEn < CAMBIO_VIGENTE_MS) return visto.segundo;

  const row = await db.prepare('SELECT password_changed_at FROM users WHERE id = ?').get(key);
  const segundo = segundoDelCambio(row?.password_changed_at);
  guardarCambio(key, segundo);
  return segundo;
}

// Lo llama el cambio de contraseña (routes/auth.js) justo después de
// guardarlo, para que este proceso no siga aceptando los tokens viejos el
// minuto que le quedara a la caché.
export function rememberPasswordChange(userId, changedAt) {
  guardarCambio(Number(userId), segundoDelCambio(changedAt));
}

async function sesionVigente(payload) {
  return tokenSigueVigente(payload.iat, await segundoDelUltimoCambio(payload.id));
}

const SESION_CERRADA = 'Tu contraseña cambió: vuelve a iniciar sesión';

function tokenDe(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

// Express 4 no atrapa la promesa de un middleware: si la consulta falla, el
// error va a `next(err)` a mano, o la petición se queda colgada.
export function authRequired(req, res, next) {
  const token = tokenDe(req);
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret());
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
  sesionVigente(payload).then((vigente) => {
    if (!vigente) return res.status(401).json({ error: SESION_CERRADA });
    req.user = payload;
    next();
  }, next);
}

// Como authRequired, pero nunca rechaza la petición — si no hay token, es
// inválido o lo cerró un cambio de contraseña, sigue de largo sin req.user.
// Sirve para rutas públicas que dan más información cuando sí sabemos quién
// eres (ej. el resumen de predicciones: cualquiera lo puede ver, pero si hay
// sesión también devolvemos tu propio voto).
export function optionalAuth(req, res, next) {
  const token = tokenDe(req);
  if (!token) return next();
  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret());
  } catch {
    // token vencido o inválido: seguimos como si no hubiera sesión
    return next();
  }
  sesionVigente(payload).then((vigente) => {
    if (vigente) req.user = payload;
    next();
  }, next);
}
