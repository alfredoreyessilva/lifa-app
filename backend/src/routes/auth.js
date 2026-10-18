import express from 'express';
import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import db from '../config/db.js';
import { signToken, authRequired, rememberPasswordChange } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { isValidEmail } from '../utils/validation.js';
import { emailAvailable, sendVerificationEmail, sendPasswordResetEmail } from '../utils/email.js';
import { permisosDeRol, etiquetaDeRol } from '../utils/orgRoles.js';

const router = express.Router();

const VERIFICATION_CODE_TTL_MINUTES = 10;
const MAX_VERIFICATION_ATTEMPTS = 5;

// Recuperar la contraseña (README, "Recuperar la contraseña", 2026-10-17).
const RESET_CODE_TTL_MINUTES = 10;
const MAX_RESET_ATTEMPTS = 5;
const MAX_RESET_CODES_PER_HOUR = 5;

// Seis dígitos, de 100000 a 999999. Sale de `crypto` y no de `Math.random()`,
// que no sirve para secretos: el mismo código que confirma un correo es el
// que, en la recuperación, entrega la cuenta entera.
function generateVerificationCode() {
  return String(randomInt(100000, 1000000));
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
// activa solo, sin tocar código de nuevo. (El backend de pruebas lo prende
// con EMAIL_TRANSPORT=log, ver utils/email.js.)
function emailVerificationAvailable() {
  return emailAvailable();
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

// ── Recuperar la contraseña ─────────────────────────────────────────────
//
// README, "Recuperar la contraseña" (2026-10-17). Un código de 6 dígitos por
// correo —no un link: se teclea en el mismo aparato donde está la app—, que
// dura 10 minutos y aguanta 5 intentos. Hasta 5 códigos por hora por cuenta,
// además del limitador por IP. Y al cambiarla se cierran todas las sesiones
// abiertas (middleware/auth.js).

// Pide un código. Responde lo mismo exista o no la cuenta, por higiene y no
// como promesa: /register ya dice con un 409 si un correo está registrado, así
// que esconderlo aquí no protegería nada.
router.post('/password-reset/request', authLimiter, asyncHandler(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Ese correo no tiene un formato válido' });
  }
  // No se le pide a nadie un código que no le puede llegar: mismo criterio que
  // la verificación, que sin Resend ni siquiera muestra su pantalla.
  if (!emailVerificationAvailable()) {
    return res.status(503).json({ error: 'Por ahora no podemos mandar el código por correo. Intenta más tarde.' });
  }

  const user = await db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email);
  if (user) {
    const code = generateVerificationCode();
    // El tope por cuenta va en la misma sentencia que el INSERT, para que dos
    // peticiones juntas no lo crucen contando cada una por su lado. De paso se
    // barre lo de hace más de una hora, que ya venció y ya no cuenta para el
    // tope. La vigencia se escribe con NOW(): se compara con NOW() al canjear,
    // y así vive entera en el reloj de la base.
    const nuevo = await db.prepare(`
      WITH vencidos AS (
        DELETE FROM password_reset_codes
        WHERE user_id = ? AND created_at < NOW() - INTERVAL '1 hour'
      )
      INSERT INTO password_reset_codes (user_id, code, expires_at)
      SELECT ?, ?, NOW() + ?::int * INTERVAL '1 minute'
      WHERE (
        SELECT COUNT(*) FROM password_reset_codes
        WHERE user_id = ? AND created_at >= NOW() - INTERVAL '1 hour'
      ) < ?::int
      RETURNING id
    `).get(user.id, user.id, code, RESET_CODE_TTL_MINUTES, user.id, MAX_RESET_CODES_PER_HOUR);

    // Si el envío falla (Resend caído en ese momento), la respuesta no cambia:
    // la persona pide otro con "Reenviar código", igual que en el registro.
    if (nuevo) {
      try {
        await sendPasswordResetEmail(user.email, user.name, code);
      } catch (err) {
        console.error('No se pudo enviar el código para recuperar la contraseña:', err.message);
      }
    }
  }

  res.json({ ok: true });
}));

// Canjea el código por una contraseña nueva. Responde lo mismo que /login: la
// persona entra directo, con un token firmado DESPUÉS del cambio.
router.post('/password-reset/confirm', authLimiter, asyncHandler(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const code = String(req.body?.code ?? '').trim();
  const password = req.body?.password;
  if (!email || !code || !password) {
    return res.status(400).json({ error: 'Faltan campos: correo, código y contraseña nueva' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  // Sin cuenta, la misma respuesta que una cuenta sin código pendiente.
  const sinCodigo = { error: 'No hay ningún código pendiente para ese correo. Pide uno nuevo.' };
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!user) return res.status(400).json(sinCodigo);

  // El intento se GASTA antes de comparar, en la misma sentencia que revisa
  // que el código sea el más reciente, que siga vigente y que le queden
  // intentos. Leer y luego sumar dejaría que veinte peticiones al mismo tiempo
  // leyeran "0 intentos" y consiguieran veinte comparaciones contra un código
  // que entrega la cuenta entera.
  const intento = await db.prepare(`
    UPDATE password_reset_codes SET attempts = attempts + 1
    WHERE id = (
      SELECT id FROM password_reset_codes
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
      AND expires_at > NOW()
      AND attempts < ?
    RETURNING code, attempts
  `).get(user.id, MAX_RESET_ATTEMPTS);

  if (!intento) {
    // No hubo intento: falta decirle por qué. Se pregunta en el reloj de la
    // base, el mismo que escribió la vigencia.
    const ultimo = await db.prepare(`
      SELECT expires_at <= NOW() AS vencido, attempts >= ? AS agotado
      FROM password_reset_codes
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get(MAX_RESET_ATTEMPTS, user.id);
    if (!ultimo) return res.status(400).json(sinCodigo);
    if (ultimo.agotado) return res.status(429).json({ error: 'Demasiados intentos con ese código. Pide uno nuevo.' });
    return res.status(400).json({ error: 'Ese código ya venció. Pide uno nuevo.' });
  }

  if (intento.code !== code) {
    const quedan = MAX_RESET_ATTEMPTS - intento.attempts;
    return res.status(400).json({
      error: quedan === 0 ? 'Código incorrecto. Ya no le quedan intentos: pide uno nuevo.'
        : quedan === 1 ? 'Código incorrecto. Te queda 1 intento.'
        : `Código incorrecto. Te quedan ${quedan} intentos.`,
    });
  }

  // La hora del cambio la pone ESTE reloj y no NOW(): es el mismo que firma el
  // token de abajo, y el `iat` del token se compara contra ella (ver
  // utils/sesiones.js). Con relojes distintos, el token recién entregado
  // podría nacer revocado.
  //
  // Todo en una sola sentencia: la contraseña, la hora, el correo ya
  // verificado —el código probó lo mismo que la verificación— y los códigos
  // pendientes de los dos tipos. Repartido en varias llamadas, cada una va por
  // su conexión del pool y no hay transacción que las junte.
  const changedAt = new Date();
  const hash = bcrypt.hashSync(password, 10);
  const updated = await db.prepare(`
    WITH codigos AS (
      DELETE FROM password_reset_codes WHERE user_id = ?
    ), verificacion AS (
      DELETE FROM email_verification_codes WHERE user_id = ?
    )
    UPDATE users
    SET password_hash = ?, password_changed_at = ?, email_verified = TRUE
    WHERE id = ?
    RETURNING id, name, email, role, email_verified
  `).get(user.id, user.id, hash, changedAt.toISOString(), user.id);

  // Este proceso deja de aceptar los tokens viejos desde ya, sin esperar a que
  // venza su caché.
  rememberPasswordChange(updated.id, changedAt);

  const safeUser = {
    id: updated.id,
    name: updated.name,
    email: updated.email,
    role: updated.role,
    email_verified: updated.email_verified,
  };
  res.json({ token: signToken(safeUser), user: safeUser, emailVerificationAvailable: emailVerificationAvailable() });
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
  // Antes solo por owner_user_id (un único dueño). Ahora también cuentan
  // como propias las ligas/equipos donde el usuario es administrador vía
  // organization_members — así alguien que aceptó una invitación de
  // administrador (ver POST /invites/organizations/:id/admins) también las
  // ve en "Mi panel", no solo el dueño original.
  const leagues = await db.prepare(`
    SELECT l.id, l.name, l.slug, l.logo_url, l.status, l.organization_id,
           COALESCE(om.role, CASE WHEN l.owner_user_id = ? THEN 'owner' END) AS my_role
    FROM leagues l
    LEFT JOIN organization_members om
           ON om.organization_id = l.organization_id AND om.user_id = ? AND om.status = 'active'
    WHERE l.owner_user_id = ? OR om.id IS NOT NULL
  `).all(user.id, user.id, user.id);
  // LEFT JOIN a propósito: un equipo independiente (registrado sin liga,
  // ver POST /manage/teams) tiene league_id NULL — con INNER JOIN
  // simplemente desaparecía de "Mi panel" para su propio dueño.
  // country_id/description/is_verified vienen de su organización (la capa
  // de identidad común), no existen como columna propia de "teams".
  const teams = await db.prepare(`
    SELECT t.*, l.name AS league_name, l.slug AS league_slug,
           o.country_id AS country_id, o.description AS description, o.is_verified AS is_verified,
           COALESCE(om.role, CASE WHEN t.owner_user_id = ? THEN 'owner' END) AS my_role
    FROM teams t
    LEFT JOIN leagues l        ON l.id = t.league_id
    LEFT JOIN organizations o  ON o.id = t.organization_id
    LEFT JOIN organization_members om
           ON om.organization_id = t.organization_id AND om.user_id = ? AND om.status = 'active'
    WHERE t.owner_user_id = ? OR om.id IS NOT NULL
  `).all(user.id, user.id, user.id);
  // Campo nuevo, aditivo: todas las organizaciones donde el usuario es
  // miembro activo (owner/admin/editor), vía organization_members. "leagues"
  // y "teams" arriba ya incluyen esto también (ver EXISTS de arriba), así
  // que un administrador invitado aparece en ambos lados sin tener que
  // migrar OrgLogoBar todavía. "organizations" sigue siendo la fuente que el
  // panel va a adoptar en el siguiente paso para los tipos que no son liga
  // ni equipo (medios, proveedores, tiendas, clínicas).
  const organizations = await db.prepare(`
    SELECT o.id, o.name, o.slug, o.type, o.logo_url, o.status, o.is_verified, om.role AS member_role
    FROM organization_members om
    JOIN organizations o ON o.id = om.organization_id
    WHERE om.user_id = ? AND om.status = 'active'
    ORDER BY o.type, o.name
  `).all(user.id);
  // Con qué rol entra esta persona a cada cosa, y qué puede hacer con él —
  // resuelto aquí, no deducido en el frontend.
  //
  // Es lo que deja esconder lo que un rol no puede hacer. Y es solo para
  // esconder: quien decide de verdad es la guarda del backend. Un permiso de
  // más enseña un botón que va a dar 403; uno de menos esconde algo que sí se
  // podía. Ninguno de los dos abre nada.
  //
  // `my_role` sale de organization_members o, si no hay fila, de
  // `owner_user_id` — misma convención que `organizationAdminRequired`: esa
  // columna significa dueño. Un rol desconocido devuelve lista vacía
  // (`permisosDeRol` falla cerrado), así que en el peor caso se esconde de más.
  const conPermisos = (filas, tipo) => filas.map((fila) => ({
    ...fila,
    my_permissions: permisosDeRol(tipo, fila.my_role),
    my_role_label: etiquetaDeRol(fila.my_role, tipo),
  }));

  res.json({
    user,
    leagues: conPermisos(leagues, 'league'),
    teams: conPermisos(teams, 'team'),
    organizations: organizations.map((o) => ({
      ...o,
      my_role: o.member_role,
      my_permissions: permisosDeRol(o.type, o.member_role),
      my_role_label: etiquetaDeRol(o.member_role, o.type),
    })),
  });
}));

export default router;
