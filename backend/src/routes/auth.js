import express from 'express';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import db from '../config/db.js';
import { signToken, authRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { isValidEmail } from '../utils/validation.js';
import { sendVerificationEmail } from '../utils/email.js';

const router = express.Router();

const VERIFICATION_CODE_TTL_MINUTES = 10;
const MAX_VERIFICATION_ATTEMPTS = 5;

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Crea un código nuevo para el usuario y lo manda por correo. Se usa tanto
// al registrarse como al pedir un reenvío — cada llamada agrega una fila
// nueva (no pisa la anterior), y al verificar solo cuenta la más reciente.
async function issueVerificationCode(userId, email, name) {
  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + VERIFICATION_CODE_TTL_MINUTES * 60 * 1000);
  await db.prepare(
    'INSERT INTO email_verification_codes (user_id, code, expires_at) VALUES (?, ?, ?)'
  ).run(userId, code, expiresAt.toISOString());
  await sendVerificationEmail(email, name, code);
}

// true solo cuando el backend tiene configurado Resend. Mientras esto sea
// false (ej. todavía no compras un dominio propio para el remitente), el
// frontend NO le muestra a nadie la pantalla de "revisa tu código" — sería
// engañoso pedirle un código a alguien si el correo nunca puede llegarle.
// En cuanto agregues RESEND_API_KEY y EMAIL_FROM en el backend, esto se
// activa solo, sin tocar código de nuevo.
function emailVerificationAvailable() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

// Sin valor por defecto a propósito, igual que JWT_SECRET — mejor que el
// servidor avise claramente a que "Continuar con Google" falle en silencio.
function getGoogleClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      'Falta la variable de entorno GOOGLE_CLIENT_ID. Defínela con el Client ID de OAuth ' +
      '(tipo "Web application") desde Google Cloud Console.'
    );
  }
  return { client: new OAuth2Client(clientId), clientId };
}

router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Faltan campos: nombre, email, contraseña' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Ese correo no tiene un formato válido' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Ese correo ya está registrado' });

  const hash = bcrypt.hashSync(password, 10);
  // email_verified se inserta explícitamente en FALSE: la columna tiene
  // DEFAULT TRUE (para no afectar cuentas ya existentes), así que una
  // cuenta nueva de correo+contraseña solo queda "sin verificar" porque
  // aquí lo pedimos a propósito.
  const result = await db.prepare(
    'INSERT INTO users (name, email, password_hash, role, email_verified) VALUES (?, ?, ?, ?, ?)'
  ).run(name, email, hash, 'rep', false);

  const user = { id: result.lastInsertRowid, name, email, role: 'rep', email_verified: false };

  // Si Resend no está configurado todavía (ej. falta un dominio propio para
  // el remitente), directamente no intentamos mandar el código — evita un
  // error innecesario en el log y, más importante, el frontend usa
  // emailVerificationAvailable para no mostrarle a nadie una pantalla de
  // "revisa tu código" que jamás le va a llegar.
  const canVerify = emailVerificationAvailable();
  if (canVerify) {
    // Si el envío falla de todos modos (ej. Resend caído en ese momento),
    // no tumbamos el registro — la cuenta ya quedó creada y el usuario
    // puede pedir el código de nuevo desde "Reenviar código".
    try {
      await issueVerificationCode(user.id, user.email, user.name);
    } catch (err) {
      console.error('No se pudo enviar el código de verificación al registrarse:', err.message);
    }
  }

  res.status(201).json({ token: signToken(user), user, emailVerificationAvailable: canVerify });
}));

router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Faltan email o contraseña' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

  // Cuenta creada (o vinculada) solo con Google: no tiene password_hash,
  // así que no puede entrar por este camino. Se lo decimos claro en vez de
  // un genérico "credenciales inválidas", porque aquí no hay nada que
  // "adivinar" — ya sabemos que el correo existe (lo dice /register).
  if (!user.password_hash) {
    return res.status(401).json({
      error: 'Esta cuenta se creó con Google. Usa el botón "Continuar con Google" para entrar.',
    });
  }
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  const safeUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    email_verified: user.email_verified,
  };
  res.json({ token: signToken(safeUser), user: safeUser, emailVerificationAvailable: emailVerificationAvailable() });
}));

// Verifica el código de 6 dígitos que llegó por correo. No redirige a
// ningún lado — el frontend lo llama desde la misma pantalla de registro,
// así el usuario nunca "sale" de la página para confirmar su cuenta.
router.post('/verify-email', authRequired, asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Falta el código' });

  const user = await db.prepare(
    'SELECT id, name, email, role, email_verified FROM users WHERE id = ?'
  ).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (user.email_verified) return res.json({ user });

  const record = await db.prepare(
    'SELECT * FROM email_verification_codes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(user.id);

  if (!record) {
    return res.status(400).json({ error: 'No hay ningún código pendiente. Pide uno nuevo.' });
  }
  if (new Date(record.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Ese código ya venció. Pide uno nuevo.' });
  }
  if (record.attempts >= MAX_VERIFICATION_ATTEMPTS) {
    return res.status(429).json({ error: 'Demasiados intentos con ese código. Pide uno nuevo.' });
  }
  if (String(code).trim() !== record.code) {
    await db.prepare('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?').run(record.id);
    return res.status(400).json({ error: 'Código incorrecto' });
  }

  await db.prepare('UPDATE users SET email_verified = TRUE WHERE id = ?').run(user.id);
  await db.prepare('DELETE FROM email_verification_codes WHERE user_id = ?').run(user.id);

  res.json({ user: { ...user, email_verified: true } });
}));

// Pide un código nuevo (ej. el primero no llegó o venció). Usa el mismo
// limitador que login/registro para no permitir un reenvío masivo.
router.post('/resend-code', authRequired, authLimiter, asyncHandler(async (req, res) => {
  const user = await db.prepare(
    'SELECT id, name, email, email_verified FROM users WHERE id = ?'
  ).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (user.email_verified) return res.status(400).json({ error: 'Ese correo ya está verificado' });

  await issueVerificationCode(user.id, user.email, user.name);
  res.json({ ok: true });
}));

// Login/registro con Google. El frontend manda el "credential" (un ID
// token JWT) que devuelve el botón de Google Identity Services — aquí se
// verifica contra los servidores de Google (no se confía en el token a
// ciegas) y, si es válido, Google ya garantiza que esa persona controla
// ese correo: no hace falta código de verificación en este camino.
router.post('/google', authLimiter, asyncHandler(async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'Falta el token de Google' });

  const { client, clientId } = getGoogleClient();
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'No se pudo verificar la cuenta de Google' });
  }

  if (!payload?.email) {
    return res.status(400).json({ error: 'Google no devolvió un correo válido' });
  }

  const googleId = payload.sub;
  const email = payload.email;
  const name = (payload.name || email.split('@')[0]).toUpperCase();

  let user = await db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);

  if (!user) {
    // Puede que ya exista una cuenta de correo+contraseña con este mismo
    // correo (de antes de tener Google) — en vez de crear una cuenta
    // duplicada, la vinculamos con Google y de paso queda verificada
    // (Google ya confirmó ese correo).
    user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (user) {
      await db.prepare(
        'UPDATE users SET google_id = ?, email_verified = TRUE WHERE id = ?'
      ).run(googleId, user.id);
    } else {
      const result = await db.prepare(
        'INSERT INTO users (name, email, password_hash, role, email_verified, google_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(name, email, null, 'rep', true, googleId);
      user = { id: result.lastInsertRowid, name, email, role: 'rep' };
    }
  }

  const safeUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    email_verified: true,
  };
  res.json({ token: signToken(safeUser), user: safeUser });
}));

router.get('/me', authRequired, asyncHandler(async (req, res) => {
  const user = await db.prepare(
    'SELECT id, name, email, role, email_verified FROM users WHERE id = ?'
  ).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const leagues = await db.prepare('SELECT id, name, slug, logo_url, status FROM leagues WHERE owner_user_id = ?').all(user.id);
  const teams = await db.prepare(`
    SELECT t.*, l.name AS league_name, l.slug AS league_slug
    FROM teams t
    JOIN leagues l ON l.id = t.league_id
    WHERE t.owner_user_id = ?
  `).all(user.id);
  // Campo nuevo, aditivo: todas las organizaciones donde el usuario es
  // miembro activo (owner/admin/editor), vía organization_members. "leagues"
  // y "teams" arriba siguen calculándose igual que siempre (por
  // owner_user_id) — el frontend todavía los usa así. "organizations" es la
  // fuente que el panel va a adoptar en el siguiente paso, y a futuro es la
  // única que va a poder mostrar organizaciones con más de un miembro.
  const organizations = await db.prepare(`
    SELECT o.id, o.name, o.slug, o.type, o.logo_url, o.status, o.is_verified, om.role AS member_role
    FROM organization_members om
    JOIN organizations o ON o.id = om.organization_id
    WHERE om.user_id = ? AND om.status = 'active'
    ORDER BY o.type, o.name
  `).all(user.id);
  res.json({ user, leagues, teams, organizations });
}));

export default router;
