import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

// "Mi cartelera": junta en una sola lista los partidos que le interesan al
// usuario, por cualquiera de estas razones:
//   1) Sigue ESE partido ("Seguir este partido").
//   2) Sigue a un EQUIPO ("Seguir a X") — se expande a todos los partidos
//      (pasados y futuros) de ese equipo en esa liga, o en cualquier liga si
//      el seguimiento no dice cuál (un equipo independiente juega en varias).
//   3) Predijo quién gana ese partido.
// Un mismo partido puede caer en más de una razón — aparece una sola vez,
// con banderas que dicen por qué está ahí. Se queda en la lista para siempre,
// incluso después de jugarse (es un historial).
//
// Desde el 2026-09-24 es también el lugar de "Partidos que sigo", que leía lo
// mismo y se retiró (README, "Notificaciones"). Por eso distingue cómo lo
// sigues: `followed_directly` se puede dejar desde aquí; `followed_team` se
// deja desde la página del equipo.
router.get('/', authRequired, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const matchSubs = await db.prepare(`
    SELECT DISTINCT match_id FROM push_subscriptions
    WHERE user_id = ? AND match_id IS NOT NULL
  `).all(userId);

  // Las suscripciones por equipo se expanden una por una a sus partidos —
  // son pocas por usuario normalmente, así que no hace falta una sola
  // consulta más compleja para esto.
  const teamSubs = await db.prepare(`
    SELECT DISTINCT league_id, team_name FROM push_subscriptions
    WHERE user_id = ? AND team_name IS NOT NULL AND match_id IS NULL
  `).all(userId);

  const teamByMatch = new Map();
  for (const sub of teamSubs) {
    const rows = sub.league_id != null
      ? await db.prepare(`
          SELECT m.id FROM matches m
          JOIN categories c ON c.id = m.category_id
          WHERE c.league_id = ?
            AND (UPPER(m.home_team) = UPPER(?) OR UPPER(m.away_team) = UPPER(?))
            AND m.is_draft = FALSE
        `).all(sub.league_id, sub.team_name, sub.team_name)
      : await db.prepare(`
          SELECT m.id FROM matches m
          WHERE (UPPER(m.home_team) = UPPER(?) OR UPPER(m.away_team) = UPPER(?))
            AND m.is_draft = FALSE
        `).all(sub.team_name, sub.team_name);
    rows.forEach((r) => { if (!teamByMatch.has(r.id)) teamByMatch.set(r.id, sub.team_name); });
  }

  const directIds = new Set(matchSubs.map((r) => r.match_id));
  const notifiedIds = new Set([...directIds, ...teamByMatch.keys()]);

  const predictions = await db.prepare(`
    SELECT match_id, pick FROM predictions WHERE user_id = ?
  `).all(userId);
  const pickByMatch = new Map(predictions.map((p) => [p.match_id, p.pick]));

  const allIds = new Set([...notifiedIds, ...pickByMatch.keys()]);
  if (allIds.size === 0) return res.json([]);

  const idsArr = [...allIds];
  const placeholders = idsArr.map(() => '?').join(',');

  const matches = await db.prepare(`
    SELECT
      m.*,
      c.auto_status_enabled      AS auto_status_enabled,
      c.auto_status_window_hours AS auto_status_window_hours,
      l.name AS league_name,
      l.slug AS league_slug,
      th.logo_url AS home_logo_url,
      COALESCE(ta.away_logo_url, ta.logo_url) AS away_logo_url
    FROM matches m
    LEFT JOIN categories c ON c.id = m.category_id
    LEFT JOIN leagues l    ON l.id = c.league_id
    LEFT JOIN teams th     ON th.league_id = c.league_id AND UPPER(th.name) = UPPER(m.home_team)
    LEFT JOIN teams ta     ON ta.league_id = c.league_id AND UPPER(ta.name) = UPPER(m.away_team)
    WHERE m.id IN (${placeholders})
  `).all(...idsArr);

  const result = matches.map((m) => ({
    ...m,
    // `notified` se conserva con su nombre de siempre: es "lo sigues, de una
    // forma u otra". Las otras dos dicen de cuál.
    notified:  notifiedIds.has(m.id),
    followed_directly: directIds.has(m.id),
    followed_team:     directIds.has(m.id) ? null : (teamByMatch.get(m.id) ?? null),
    predicted: pickByMatch.has(m.id),
    myPick:    pickByMatch.get(m.id) || null,
  }));

  res.json(result);
}));

export default router;
