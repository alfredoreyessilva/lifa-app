import express from 'express';
import webpush from 'web-push';
import jwt from 'jsonwebtoken';
import db from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { leagueOwnerRequired, teamOwnerRequired } from '../middleware/ownership.js';
import { runBillingReminders, runPlayerBillingReminders } from '../utils/billingReminders.js';
import { runMonthlyChargeGeneration } from '../utils/monthlyCharges.js';
import { runOncePerDay, registrarLlamada, podarBitacora } from '../utils/cronSchedule.js';

const router = express.Router();

const NOTIFY_WINDOW_MS = 60 * 60 * 1000;
const LIVE_WINDOW_MS   = 3  * 60 * 60 * 1000;

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return;
  const email  = process.env.VAPID_EMAIL;
  const pubKey = process.env.VAPID_PUBLIC_KEY;
  const prvKey = process.env.VAPID_PRIVATE_KEY;
  if (!email || !pubKey || !prvKey) throw new Error('Faltan variables VAPID en .env');
  const subject = email.startsWith('mailto:') ? email : `mailto:${email}`;
  webpush.setVapidDetails(subject, pubKey, prvKey);
  vapidConfigured = true;
}

// Envía las notificaciones en paralelo para que el cronjob no tarde
async function sendToSubs(subs, payload) {
  const validSubs = subs.filter((sub) => sub.endpoint && sub.p256dh && sub.auth);
  if (validSubs.length === 0) return 0;

  const results = await Promise.allSettled(
    validSubs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      )
    )
  );

  let errors = 0;
  const expiredEndpoints = [];

  results.forEach((result, idx) => {
    if (result.status === 'rejected') {
      errors++;
      if (result.reason?.statusCode === 410) {
        expiredEndpoints.push(validSubs[idx].endpoint);
      }
    }
  });

  if (expiredEndpoints.length > 0) {
    await Promise.allSettled(
      expiredEndpoints.map((endpoint) =>
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint)
      )
    );
  }

  return errors;
}

// Clave pública VAPID
router.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

// Suscribirse o actualizar preferencias — acepta opciones granulares
// y permite guardar seguimiento en bandeja (in-app) sin requerir push de navegador.
router.post('/subscribe', authRequired, asyncHandler(async (req, res) => {
  const { subscription, preferences, league_id, match_id, team_name } = req.body;
  if (!league_id && !match_id && !team_name) {
    return res.status(400).json({ error: 'Debes indicar una liga, partido o equipo' });
  }

  const inApp = preferences?.in_app !== undefined ? Boolean(preferences.in_app) : true;
  const pushEnabled = Boolean(subscription?.endpoint && preferences?.push_enabled);
  const notifyUpcoming = preferences?.notify_upcoming !== undefined ? Boolean(preferences.notify_upcoming) : true;
  const notifyLive = preferences?.notify_live !== undefined ? Boolean(preferences.notify_live) : true;
  const notifyFinal = preferences?.notify_final !== undefined ? Boolean(preferences.notify_final) : true;
  const notifyChanges = preferences?.notify_changes !== undefined ? Boolean(preferences.notify_changes) : true;

  // Limpiamos cualquier registro previo idéntico para este usuario antes de insertar
  await db.prepare(`
    DELETE FROM push_subscriptions
    WHERE user_id = ?
      AND league_id IS NOT DISTINCT FROM ?
      AND match_id  IS NOT DISTINCT FROM ?
      AND team_name IS NOT DISTINCT FROM ?
  `).run(req.user.id, league_id || null, match_id || null, team_name || null);

  await db.prepare(`
    INSERT INTO push_subscriptions (
      endpoint, p256dh, auth, league_id, match_id, team_name, user_id,
      in_app, push_enabled, notify_upcoming, notify_live, notify_final, notify_changes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    subscription?.endpoint || null,
    subscription?.keys?.p256dh || null,
    subscription?.keys?.auth || null,
    league_id  || null,
    match_id   || null,
    team_name  || null,
    req.user.id,
    inApp,
    pushEnabled,
    notifyUpcoming,
    notifyLive,
    notifyFinal,
    notifyChanges
  );

  res.status(201).json({
    ok: true,
    preferences: {
      in_app: inApp,
      push_enabled: pushEnabled,
      notify_upcoming: notifyUpcoming,
      notify_live: notifyLive,
      notify_final: notifyFinal,
      notify_changes: notifyChanges,
    }
  });
}));

// Verificar si ya está suscrito y devolver preferencias actuales
router.post('/check', asyncHandler(async (req, res) => {
  const { endpoint, league_id, match_id, team_name } = req.body;

  let userId = null;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
      userId = decoded.id;
    } catch {}
  }

  let sub = null;
  if (userId) {
    sub = await db.prepare(`
      SELECT * FROM push_subscriptions
      WHERE user_id = ?
        AND league_id IS NOT DISTINCT FROM ?
        AND match_id  IS NOT DISTINCT FROM ?
        AND team_name IS NOT DISTINCT FROM ?
    `).get(userId, league_id || null, match_id || null, team_name || null);
  }

  if (!sub && endpoint) {
    sub = await db.prepare(`
      SELECT * FROM push_subscriptions
      WHERE endpoint = ?
        AND league_id IS NOT DISTINCT FROM ?
        AND match_id  IS NOT DISTINCT FROM ?
        AND team_name IS NOT DISTINCT FROM ?
    `).get(endpoint, league_id || null, match_id || null, team_name || null);
  }

  res.json({
    subscribed: !!sub,
    preferences: sub ? {
      in_app: sub.in_app !== false,
      push_enabled: Boolean(sub.push_enabled),
      notify_upcoming: sub.notify_upcoming !== false,
      notify_live: sub.notify_live !== false,
      notify_final: sub.notify_final !== false,
      notify_changes: sub.notify_changes !== false,
    } : null
  });
}));

// Cancelar suscripción general
router.post('/unsubscribe', asyncHandler(async (req, res) => {
  const { subscription, league_id, match_id, team_name } = req.body;

  let userId = null;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
      userId = decoded.id;
    } catch {}
  }

  if (userId) {
    await db.prepare(`
      DELETE FROM push_subscriptions
      WHERE user_id = ?
        AND league_id IS NOT DISTINCT FROM ?
        AND match_id  IS NOT DISTINCT FROM ?
        AND team_name IS NOT DISTINCT FROM ?
    `).run(userId, league_id || null, match_id || null, team_name || null);
  }

  if (subscription?.endpoint) {
    await db.prepare(`
      DELETE FROM push_subscriptions
      WHERE endpoint = ?
        AND league_id IS NOT DISTINCT FROM ?
        AND match_id  IS NOT DISTINCT FROM ?
        AND team_name IS NOT DISTINCT FROM ?
    `).run(subscription.endpoint, league_id || null, match_id || null, team_name || null);
  }

  res.json({ ok: true });
}));

// Partidos que sigue el usuario (vía suscripciones vinculadas a su user_id)
router.get('/followed-matches', authRequired, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const matchSubs = await db.prepare(`
    SELECT DISTINCT match_id FROM push_subscriptions
    WHERE user_id = ? AND match_id IS NOT NULL
  `).all(userId);

  const teamSubs = await db.prepare(`
    SELECT DISTINCT league_id, team_name FROM push_subscriptions
    WHERE user_id = ? AND team_name IS NOT NULL AND league_id IS NOT NULL
  `).all(userId);

  const teamMatchIds = new Set();
  for (const sub of teamSubs) {
    const rows = await db.prepare(`
      SELECT m.id FROM matches m
      JOIN categories c ON c.id = m.category_id
      WHERE c.league_id = ?
        AND (UPPER(m.home_team) = UPPER(?) OR UPPER(m.away_team) = UPPER(?))
        AND m.is_draft = FALSE
    `).all(sub.league_id, sub.team_name, sub.team_name);
    rows.forEach((r) => teamMatchIds.add(r.id));
  }

  const allMatchIds = Array.from(new Set([...matchSubs.map((r) => r.match_id), ...teamMatchIds]));
  if (allMatchIds.length === 0) return res.json({ matches: [] });

  const placeholders = allMatchIds.map(() => '?').join(',');
  const matches = await db.prepare(`
    SELECT
      m.*,
      c.name AS category_name,
      c.season AS season,
      c.year AS year,
      c.auto_status_enabled AS auto_status_enabled,
      c.auto_status_window_hours AS auto_status_window_hours,
      l.id AS league_id,
      l.name AS league_name,
      l.slug AS league_slug,
      l.logo_url AS league_logo_url,
      l.timezone AS league_timezone,
      th.logo_url AS home_logo_url,
      COALESCE(ta.away_logo_url, ta.logo_url) AS away_logo_url,
      v.name AS venue_name,
      v.city AS venue_city
    FROM matches m
    LEFT JOIN categories c ON c.id = m.category_id
    LEFT JOIN leagues l    ON l.id = c.league_id
    LEFT JOIN teams th     ON th.league_id = l.id AND UPPER(th.name) = UPPER(m.home_team)
    LEFT JOIN teams ta     ON ta.league_id = l.id AND UPPER(ta.name) = UPPER(m.away_team)
    LEFT JOIN venues v     ON v.id = m.venue_id
    WHERE m.id IN (${placeholders}) AND m.is_draft = FALSE
    ORDER BY m.match_date ASC
  `).all(...allMatchIds);

  res.json({ matches });
}));

// Dejar de seguir un partido puntual desde el centro de notificaciones
router.post('/unfollow-match', authRequired, asyncHandler(async (req, res) => {
  const { match_id } = req.body;
  if (!match_id) return res.status(400).json({ error: 'match_id requerido' });

  await db.prepare(`
    DELETE FROM push_subscriptions
    WHERE user_id = ? AND match_id = ?
  `).run(req.user.id, match_id);

  res.json({ ok: true });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Bloque de ALTA frecuencia: todo lo que depende de la hora de un partido.
//
// Vive en su propia función, y no en línea dentro del handler, por dos motivos
// que en realidad son uno solo — es la mitad del cron que necesita correr cada
// pocos minutos, y es la mitad que puede fallar sin que eso le cueste nada a
// la otra.
//
// Antes estaba todo en el mismo handler, así que cualquier error aquí impedía
// que corrieran la cobranza y la generación de mensualidades. El caso más
// claro era la primera línea: `ensureVapid()` LANZA si faltan las variables
// VAPID, y estaba antes de todo, de modo que una configuración de push
// incompleta bastaba para que el club dejara de facturar — dos cosas que no
// tienen absolutamente nada que ver entre sí.
// ─────────────────────────────────────────────────────────────────────────────
async function faseDePartidos() {
  ensureVapid();

  const now = Date.now();

  const matches = await db.prepare(`
    SELECT m.*, c.league_id,
           l.name as league_name, l.slug as league_slug
    FROM matches m
    JOIN categories c ON c.id = m.category_id
    JOIN leagues l    ON l.id = c.league_id
    WHERE m.match_date IS NOT NULL
      AND m.is_draft = FALSE
      AND m.home_score IS NULL
      AND m.away_score IS NULL
      AND (m.notified_upcoming = FALSE OR m.notified_live = FALSE)
      AND m.match_date::timestamptz BETWEEN (NOW() - INTERVAL '3 hours') AND (NOW() + INTERVAL '1 hour')
  `).all();

  for (const match of matches) {
    const matchTime = new Date(match.match_date).getTime();
    const endTime   = matchTime + LIVE_WINDOW_MS;
    const timeUntil = matchTime - now;

    const isUpcoming = timeUntil > 0 && timeUntil <= NOTIFY_WINDOW_MS && !match.notified_upcoming;
    const isLive     = now >= matchTime && now < endTime && !match.notified_live;

    if (!isUpcoming && !isLive) continue;

    const title = isLive
      ? `🔴 EN VIVO — ${match.home_team} vs ${match.away_team}`
      : `⏰ Próximo — ${match.home_team} vs ${match.away_team}`;

    const body = isLive
      ? 'El partido ya comenzó. ¡No te lo pierdas!'
      : 'El partido empieza en menos de 1 hora.';

    const payload = {
      title,
      body,
      url:  `/categorias/${match.category_id}/calendario`,
      icon: '/favicon.svg',
    };

    // Filtramos suscriptores con push habilitado y preferencia coincidente
    const prefCol = isLive ? 'notify_live' : 'notify_upcoming';

    const leagueSubs = await db.prepare(`
      SELECT * FROM push_subscriptions
      WHERE league_id = ? AND match_id IS NULL AND team_name IS NULL
        AND endpoint IS NOT NULL
        AND (push_enabled = TRUE OR push_enabled IS NULL)
        AND (${prefCol} = TRUE OR ${prefCol} IS NULL)
    `).all(match.league_id);

    const matchSubs = await db.prepare(`
      SELECT * FROM push_subscriptions
      WHERE match_id = ? AND team_name IS NULL
        AND endpoint IS NOT NULL
        AND (push_enabled = TRUE OR push_enabled IS NULL)
        AND (${prefCol} = TRUE OR ${prefCol} IS NULL)
    `).all(match.id);

    const teamSubs = await db.prepare(`
      SELECT * FROM push_subscriptions
      WHERE team_name IN (?, ?) AND match_id IS NULL AND (league_id = ? OR league_id IS NULL)
        AND endpoint IS NOT NULL
        AND (push_enabled = TRUE OR push_enabled IS NULL)
        AND (${prefCol} = TRUE OR ${prefCol} IS NULL)
    `).all(match.home_team, match.away_team, match.league_id);

    const allSubs = [...leagueSubs, ...matchSubs, ...teamSubs].filter(
      (sub, idx, arr) => arr.findIndex((s) => s.endpoint === sub.endpoint) === idx
    );

    if (allSubs.length > 0) {
      await sendToSubs(allSubs, payload);
    }

    const notifiedColumn = isLive ? 'notified_live' : 'notified_upcoming';
    await db.prepare(`UPDATE matches SET ${notifiedColumn} = TRUE WHERE id = ?`).run(match.id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Recordatorios de captura a la BANDEJA de la liga (in-app, sin push a nadie).
  // Van a la tabla `notifications` (recipient_type='league'), igual que los
  // avisos de admin. Se quedan en el bloque frecuente, y no en el diario,
  // porque cuelgan de la hora de un partido igual que los avisos de arriba:
  // su disparo es "una hora después del fin nominal", no "una vez al día".
  //
  // Son de una sola vez: al enviarlos se marca la bandera correspondiente y
  // el cron ya no vuelve a mirar ese partido.
  //
  // El fin nominal de un partido se calcula como match_date + ventana de la
  // categoría (auto_status_window_hours, 3h por defecto). El recordatorio
  // entra 1h después de ese fin nominal. Solo se miran partidos de los
  // últimos 2 días para no reprocesar todo el histórico ni escanear la
  // tabla completa en cada corrida.
  // ─────────────────────────────────────────────────────────────────────────

  const NOMINAL_END = `
    m.match_date::timestamptz
    + (COALESCE(c.auto_status_window_hours, 3) || ' hours')::interval
    + INTERVAL '1 hour'
  `;

  // (1) Partido FINALIZADO (a mano o por auto-status) que sigue sin marcador.
  const missingScore = await db.prepare(`
    SELECT m.id, m.home_team, m.away_team, m.week_label, c.league_id
    FROM matches m
    JOIN categories c ON c.id = m.category_id
    WHERE m.is_draft = FALSE
      AND m.reminded_missing_score = FALSE
      AND (m.home_score IS NULL OR m.away_score IS NULL)
      AND m.match_date::timestamptz > NOW() - INTERVAL '2 days'
      AND NOW() > ${NOMINAL_END}
      AND (
        m.status = 'finished'
        OR (COALESCE(c.auto_status_enabled, FALSE) = TRUE AND m.status = 'scheduled')
      )
  `).all();

  for (const match of missingScore) {
    const jornada = match.week_label ? ` (${match.week_label})` : '';
    await db.prepare(`
      INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
      VALUES ('league', ?, 'score_reminder', ?, ?, ?)
    `).run(
      match.league_id,
      'Falta capturar un marcador ⏳',
      `El partido ${match.home_team} vs ${match.away_team}${jornada} terminó hace más de una hora y todavía no tiene marcador. Captúralo para mantener la tabla al día.`,
      JSON.stringify({ match_id: match.id, league_id: match.league_id, url: `/partidos/${match.id}` })
    );
    await db.prepare('UPDATE matches SET reminded_missing_score = TRUE WHERE id = ?').run(match.id);
  }

  // (2) Partido PROGRAMADO cuya fecha ya pasó y nunca se tocó (ni inicio ni
  //     final). Solo aplica a categorías SIN auto-status — si tuvieran
  //     auto-status, el partido ya contaría como finalizado y caería en (1).
  const notStarted = await db.prepare(`
    SELECT m.id, m.home_team, m.away_team, m.week_label, c.league_id
    FROM matches m
    JOIN categories c ON c.id = m.category_id
    WHERE m.is_draft = FALSE
      AND m.reminded_not_started = FALSE
      AND m.status = 'scheduled'
      AND COALESCE(c.auto_status_enabled, FALSE) = FALSE
      AND m.match_date::timestamptz > NOW() - INTERVAL '2 days'
      AND NOW() > ${NOMINAL_END}
  `).all();

  for (const match of notStarted) {
    const jornada = match.week_label ? ` (${match.week_label})` : '';
    await db.prepare(`
      INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
      VALUES ('league', ?, 'match_not_started', ?, ?, ?)
    `).run(
      match.league_id,
      'Un partido programado ya pasó 📅',
      `El partido ${match.home_team} vs ${match.away_team}${jornada} estaba programado y ya pasó su fecha, pero nunca se marcó como iniciado ni finalizado. Actualiza su estado, su marcador o su fecha.`,
      JSON.stringify({ match_id: match.id, league_id: match.league_id, url: `/partidos/${match.id}` })
    );
    await db.prepare('UPDATE matches SET reminded_not_started = TRUE WHERE id = ?').run(match.id);
  }
}

// Trigger del cron job.
//
// UN endpoint, DOS cadencias. Se puede llamar con la frecuencia que sea y las
// dos mitades quedan bien servidas:
//
//   - Los avisos de partido corren en CADA llamada. Su ventana es de una hora,
//     así que quieren la frecuencia más alta que el scheduler dé (~15 min).
//   - La cobranza y la mensualidad corren UNA VEZ AL DÍA, la reclame quien la
//     reclame. Ver utils/cronSchedule.js para por qué el candado es de la base
//     y no del código.
//
// Esto es lo que vuelve irrelevante el pendiente de "nadie sabe cada cuánto
// corre el cron" para la corrección del sistema: sigue siendo un dato que hay
// que ir a buscar, pero ya no es la diferencia entre facturar y no facturar.
//
// `?force=1` vuelve a correr las fases diarias aunque ya hayan corrido hoy.
// Va detrás del mismo CRON_SECRET y sirve para probar y para recuperar a mano.
//
// El secreto se acepta en DOS formatos: `x-cron-secret: <secreto>`, que es el
// de siempre, y `Authorization: Bearer <secreto>`. El segundo no es capricho:
// varios schedulers mandan solo ese (Vercel Cron, entre otros), y aceptar los
// dos es lo que deja cambiar de proveedor sin tocar el backend. Es el mismo
// secreto, no dos.
router.post('/trigger', asyncHandler(async (req, res) => {
  const esperado = process.env.CRON_SECRET;
  const cabecera = req.headers.authorization || '';
  const recibido = req.headers['x-cron-secret']
    || (cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null);

  // El `!esperado` va primero: sin CRON_SECRET configurado, los dos lados
  // serían undefined y cualquiera podría disparar el cron.
  if (!esperado || recibido !== esperado) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const forzar = req.query.force === '1' || req.query.force === 'true';

  // El latido, antes que nada: deja constancia de que el cron llamó, incluso
  // si todo lo de abajo se cae. Es de lo que sale la respuesta a "¿cada cuánto
  // corre?" y "¿sigue vivo?" en el panel de administración.
  const llamadasHoy = await registrarLlamada(db);

  // ── Cada corrida ──
  // Se captura el error en vez de dejarlo subir: lo que sigue es dinero y no
  // depende de nada de esto. Pero capturar no puede significar esconder — el
  // mensaje sube a la respuesta, que es el único rastro que deja este handler.
  let partidosError = null;
  try {
    await faseDePartidos();
  } catch (err) {
    console.error('[cron] la fase de partidos falló:', err);
    partidosError = err.message;
  }

  // ── Una vez al día ──
  // Las tres fases de dinero, en este orden a propósito: la mensualidad va
  // DESPUÉS de los recordatorios porque un cargo que nace hoy vence dentro de
  // cinco días, así que alcanza el aviso de "por vencer" de mañana sin
  // necesidad de adelantarlo, y los recordatorios siguen siendo lo último que
  // ve una corrida sobre datos estables.
  //
  // Las tres son idempotentes por su cuenta (banderas por fila las dos
  // primeras, índice único la tercera), así que el candado diario es una
  // mejora de cadencia, no la garantía de nada: si alguna corriera de más, no
  // pasaría nada malo. Por eso también se puede seguir llamando desde el panel
  // (la vía perezosa de la mensualidad) sin coordinarse con esto.
  const cobranza = await runOncePerDay(db, 'cobranza', async () => {
    const liga        = await runBillingReminders(db);
    const jugadores   = await runPlayerBillingReminders(db);
    const mensualidad = await runMonthlyChargeGeneration(db);
    // La bitácora se poda aquí y no en cada llamada: es mantenimiento, y este
    // bloque ya tiene la garantía de correr una sola vez al día.
    const podadas = await podarBitacora(db);
    return {
      billing_reminders:        liga,
      player_billing_reminders: jugadores,
      monthly_charges_created:  mensualidad.created,
      monthly_charges_error:    mensualidad.error,
      bitacora_podada:          podadas,
    };
  }, { force: forzar });

  res.json({
    ok: true,
    llamadas_hoy: llamadasHoy,
    partidos_error: partidosError,
    cobranza,
    // Se conservan en la raíz porque eran lo único que esta respuesta decía
    // hasta ahora, y del otro lado hay un servicio que no podemos inspeccionar.
    // `null` cuando el bloque diario no corrió: un 0 ahí se leería como
    // "corrió y no generó nada", que es justo lo contrario.
    monthly_charges_created: cobranza.resultado?.monthly_charges_created ?? null,
    monthly_charges_error:   cobranza.resultado?.monthly_charges_error   ?? null,
  });
}));

// Notificaciones de organizaciones (bandeja de entrada)
router.get('/league/:id', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const items = await db.prepare(`
    SELECT id, type, title, body, data, read_at, created_at
    FROM notifications
    WHERE recipient_type = 'league' AND recipient_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(req.league.id);

  res.json({ notifications: items });
}));

router.get('/team/:id', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const items = await db.prepare(`
    SELECT id, type, title, body, data, read_at, created_at
    FROM notifications
    WHERE recipient_type = 'team' AND recipient_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).all(req.team.id);

  res.json({ notifications: items });
}));

router.post('/league/:id/:notifId/read', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare(`
    UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
    WHERE id = ? AND recipient_type = 'league' AND recipient_id = ?
  `).run(Number(req.params.notifId), req.league.id);

  res.json({ ok: true });
}));

router.post('/team/:id/:notifId/read', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare(`
    UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
    WHERE id = ? AND recipient_type = 'team' AND recipient_id = ?
  `).run(Number(req.params.notifId), req.team.id);

  res.json({ ok: true });
}));

export default router;