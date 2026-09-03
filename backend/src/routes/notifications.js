import express from 'express';
import webpush from 'web-push';
import jwt from 'jsonwebtoken';
import db from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { leagueOwnerRequired, teamOwnerRequired } from '../middleware/ownership.js';

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

// Trigger del cron job
router.post('/trigger', asyncHandler(async (req, res) => {
  const secret = req.headers['x-cron-secret'];
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }

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
  // Fase 3 — recordatorios a la BANDEJA de la liga (in-app, sin push a nadie).
  // Van a la tabla `notifications` (recipient_type='league'), igual que los
  // avisos de admin. Son de una sola vez: al enviarlos se marca la bandera
  // correspondiente y el cron ya no vuelve a mirar ese partido.
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

  res.json({ ok: true });
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