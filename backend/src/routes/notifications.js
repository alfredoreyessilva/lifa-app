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

  if (!email || !pubKey || !prvKey) {
    throw new Error('Faltan variables VAPID en .env');
  }

  // Asegura que el email tenga el prefijo mailto:
  const subject = email.startsWith('mailto:') ? email : `mailto:${email}`;
  webpush.setVapidDetails(subject, pubKey, prvKey);
  vapidConfigured = true;
}

// Clave pública para que el frontend se suscriba
router.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

// Guardar suscripción
router.post('/subscribe', asyncHandler(async (req, res) => {
  const { subscription, league_id, match_id } = req.body;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'Suscripción inválida' });
  }
  if (!league_id && !match_id) {
    return res.status(400).json({ error: 'Debes indicar una liga o un partido' });
  }

  await db.prepare(`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, league_id, match_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (endpoint, league_id, match_id) DO NOTHING
  `).run(
    subscription.endpoint,
    subscription.keys.p256dh,
    subscription.keys.auth,
    league_id || null,
    match_id  || null
  );

  res.status(201).json({ ok: true });
}));

// Cancelar suscripción
router.post('/unsubscribe', asyncHandler(async (req, res) => {
  const { subscription, league_id, match_id } = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ error: 'Endpoint requerido' });

  await db.prepare(`
    DELETE FROM push_subscriptions
    WHERE endpoint = ?
      AND league_id IS NOT DISTINCT FROM ?
      AND match_id  IS NOT DISTINCT FROM ?
  `).run(subscription.endpoint, league_id || null, match_id || null);

  res.json({ ok: true });
}));

// Endpoint que llama cron-job.org cada 5 minutos
router.post('/trigger', asyncHandler(async (req, res) => {
  const secret = req.headers['x-cron-secret'];
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  ensureVapid();

  const now  = Date.now();
  const sent = { upcoming: 0, live: 0, errors: 0 };

  const matches = await db.prepare(`
    SELECT m.*, l.name as league_name, l.slug as league_slug
    FROM matches m
    JOIN categories c ON c.id = m.category_id
    JOIN leagues l    ON l.id = c.league_id
    WHERE m.match_date IS NOT NULL
      AND m.home_score IS NULL
      AND m.away_score IS NULL
  `).all();

  for (const match of matches) {
    const matchTime = new Date(match.match_date).getTime();
    const endTime   = matchTime + LIVE_WINDOW_MS;
    const timeUntil = matchTime - now;

    const isUpcoming = timeUntil > 0 && timeUntil <= NOTIFY_WINDOW_MS;
    const isLive     = now >= matchTime && now < endTime;

    if (!isUpcoming && !isLive) continue;

    const leagueSubs = await db.prepare(`
      SELECT * FROM push_subscriptions WHERE league_id = (
        SELECT league_id FROM categories WHERE id = ?
      )
    `).all(match.category_id);

    const matchSubs = await db.prepare(`
      SELECT * FROM push_subscriptions WHERE match_id = ?
    `).all(match.id);

    const allSubs = [...leagueSubs, ...matchSubs].filter(
      (sub, idx, arr) => arr.findIndex((s) => s.endpoint === sub.endpoint) === idx
    );

    if (allSubs.length === 0) continue;

    const title = isLive
      ? `🔴 EN VIVO — ${match.home_team} vs ${match.away_team}`
      : `⏰ Próximo — ${match.home_team} vs ${match.away_team}`;

    const body = isLive
      ? 'El partido ya comenzó. ¡No te lo pierdas!'
      : 'El partido empieza en menos de 1 hora.';

    const payload = JSON.stringify({
      title,
      body,
      url: `/categorias/${match.category_id}/calendario`,
      icon: '/favicon.svg',
    });

    for (const sub of allSubs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        if (isLive) sent.live++; else sent.upcoming++;
      } catch (err) {
        if (err.statusCode === 410) {
          await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
        }
        sent.errors++;
      }
    }
  }

  res.json({ ok: true, sent });
}));

export default router;