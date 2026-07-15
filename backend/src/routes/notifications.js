import express from 'express';
import webpush from 'web-push';
import db from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';

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

// Envía las notificaciones en paralelo (no una por una) para que el cronjob no tarde
// demasiado y cron-job.org no lo marque como fallido/deshabilitado.
async function sendToSubs(subs, payload) {
  const results = await Promise.allSettled(
    subs.map((sub) =>
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
        expiredEndpoints.push(subs[idx].endpoint);
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

// Suscribirse — acepta league_id, match_id o team_name
router.post('/subscribe', asyncHandler(async (req, res) => {
  const { subscription, league_id, match_id, team_name } = req.body;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'Suscripción inválida' });
  }
  if (!league_id && !match_id && !team_name) {
    return res.status(400).json({ error: 'Debes indicar una liga, partido o equipo' });
  }

  await db.prepare(`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, league_id, match_id, team_name)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT ON CONSTRAINT push_subscriptions_unique DO NOTHING
  `).run(
    subscription.endpoint,
    subscription.keys.p256dh,
    subscription.keys.auth,
    league_id  || null,
    match_id   || null,
    team_name  || null
  );

  res.status(201).json({ ok: true });
}));

// Verificar si ya está suscrito
router.post('/check', asyncHandler(async (req, res) => {
  const { endpoint, league_id, match_id, team_name } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Endpoint requerido' });

  const sub = await db.prepare(`
    SELECT id FROM push_subscriptions
    WHERE endpoint = ?
      AND league_id IS NOT DISTINCT FROM ?
      AND match_id  IS NOT DISTINCT FROM ?
      AND team_name IS NOT DISTINCT FROM ?
  `).get(endpoint, league_id || null, match_id || null, team_name || null);

  res.json({ subscribed: !!sub });
}));

// Cancelar suscripción
router.post('/unsubscribe', asyncHandler(async (req, res) => {
  const { subscription, league_id, match_id, team_name } = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ error: 'Endpoint requerido' });

  await db.prepare(`
    DELETE FROM push_subscriptions
    WHERE endpoint  = ?
      AND league_id IS NOT DISTINCT FROM ?
      AND match_id  IS NOT DISTINCT FROM ?
      AND team_name IS NOT DISTINCT FROM ?
  `).run(
    subscription.endpoint,
    league_id  || null,
    match_id   || null,
    team_name  || null
  );

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

  // Solo trae partidos dentro de la ventana relevante (3h antes a 1h después de "ahora")
  // y que aún les falte alguna notificación por enviar. Esto evita que la tabla completa
  // de partidos sin marcador se revise en cada corrida del cronjob.
  const matches = await db.prepare(`
    SELECT m.*, c.league_id,
           l.name as league_name, l.slug as league_slug
    FROM matches m
    JOIN categories c ON c.id = m.category_id
    JOIN leagues l    ON l.id = c.league_id
    WHERE m.match_date IS NOT NULL
      AND m.home_score IS NULL
      AND m.away_score IS NULL
      AND (m.notified_upcoming = FALSE OR m.notified_live = FALSE)
      AND m.match_date::timestamptz BETWEEN (NOW() - INTERVAL '3 hours') AND (NOW() + INTERVAL '1 hour')
  `).all();

  for (const match of matches) {
    const matchTime = new Date(match.match_date).getTime();
    const endTime   = matchTime + LIVE_WINDOW_MS;
    const timeUntil = matchTime - now;

    // Solo se considera "por notificar" si esa notificación específica no se ha enviado antes
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

    // 1. Suscriptores de la liga
    const leagueSubs = await db.prepare(`
      SELECT * FROM push_subscriptions
      WHERE league_id = ? AND match_id IS NULL AND team_name IS NULL
    `).all(match.league_id);

    // 2. Suscriptores del partido específico
    const matchSubs = await db.prepare(`
      SELECT * FROM push_subscriptions
      WHERE match_id = ? AND team_name IS NULL
    `).all(match.id);

    // 3. Suscriptores del equipo local o visitante — solo de ESTA liga.
    // (league_id = ? cubre las suscripciones nuevas, ya correctamente scoped;
    // league_id IS NULL cubre suscripciones viejas que no se pudieron migrar
    // automáticamente por ser ambiguas — mismo comportamiento que ya tenían.)
    const teamSubs = await db.prepare(`
      SELECT * FROM push_subscriptions
      WHERE team_name IN (?, ?) AND match_id IS NULL AND (league_id = ? OR league_id IS NULL)
    `).all(match.home_team, match.away_team, match.league_id);

    // Unir y deduplicar por endpoint
    const allSubs = [...leagueSubs, ...matchSubs, ...teamSubs].filter(
      (sub, idx, arr) => arr.findIndex((s) => s.endpoint === sub.endpoint) === idx
    );

    if (allSubs.length > 0) {
      await sendToSubs(allSubs, payload);
    }

    // Se marca como notificado aunque no hubiera suscriptores, para no volver a
    // evaluar este mismo evento (próximo/en vivo) en la siguiente corrida del cronjob.
    const notifiedColumn = isLive ? 'notified_live' : 'notified_upcoming';
    await db.prepare(`UPDATE matches SET ${notifiedColumn} = TRUE WHERE id = ?`).run(match.id);
  }

  res.json({ ok: true });
}));

export default router;