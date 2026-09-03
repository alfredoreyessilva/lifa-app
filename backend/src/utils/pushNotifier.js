import webpush from 'web-push';
import db from '../config/db.js';

let vapidConfigured = false;

export function ensureVapid() {
  if (vapidConfigured) return;
  const email  = process.env.VAPID_EMAIL;
  const pubKey = process.env.VAPID_PUBLIC_KEY;
  const prvKey = process.env.VAPID_PRIVATE_KEY;
  if (!email || !pubKey || !prvKey) return;
  const subject = email.startsWith('mailto:') ? email : `mailto:${email}`;
  webpush.setVapidDetails(subject, pubKey, prvKey);
  vapidConfigured = true;
}

export async function sendToSubs(subs, payload) {
  ensureVapid();
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

export async function notifyMatchFollowers(matchId, { eventType, title, body, url }) {
  try {
    const match = await db.prepare(`
      SELECT m.*, c.league_id
      FROM matches m
      JOIN categories c ON c.id = m.category_id
      WHERE m.id = ?
    `).get(matchId);

    if (!match) return;

    let prefCondition = '';
    if (eventType === 'final_score') {
      prefCondition = 'AND (notify_final = TRUE OR notify_final IS NULL)';
    } else if (eventType === 'schedule_change') {
      prefCondition = 'AND (notify_changes = TRUE OR notify_changes IS NULL)';
    } else if (eventType === 'live') {
      prefCondition = 'AND (notify_live = TRUE OR notify_live IS NULL)';
    } else if (eventType === 'upcoming') {
      prefCondition = 'AND (notify_upcoming = TRUE OR notify_upcoming IS NULL)';
    }

    const leagueSubs = await db.prepare(`
      SELECT * FROM push_subscriptions
      WHERE league_id = ? AND match_id IS NULL AND team_name IS NULL
        AND endpoint IS NOT NULL
        AND (push_enabled = TRUE OR push_enabled IS NULL)
        ${prefCondition}
    `).all(match.league_id);

    const matchSubs = await db.prepare(`
      SELECT * FROM push_subscriptions
      WHERE match_id = ? AND team_name IS NULL
        AND endpoint IS NOT NULL
        AND (push_enabled = TRUE OR push_enabled IS NULL)
        ${prefCondition}
    `).all(match.id);

    const teamSubs = await db.prepare(`
      SELECT * FROM push_subscriptions
      WHERE team_name IN (?, ?) AND match_id IS NULL AND (league_id = ? OR league_id IS NULL)
        AND endpoint IS NOT NULL
        AND (push_enabled = TRUE OR push_enabled IS NULL)
        ${prefCondition}
    `).all(match.home_team, match.away_team, match.league_id);

    const allSubs = [...leagueSubs, ...matchSubs, ...teamSubs].filter(
      (sub, idx, arr) => arr.findIndex((s) => s.endpoint === sub.endpoint) === idx
    );

    if (allSubs.length > 0) {
      await sendToSubs(allSubs, {
        title,
        body,
        url: url || `/partidos/${match.id}`,
        icon: '/favicon.svg',
      });
    }
  } catch (err) {
    console.error('Error al enviar notificaciones push a seguidores del partido:', err);
  }
}
