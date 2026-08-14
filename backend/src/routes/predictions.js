import express from 'express';
import db from '../config/db.js';
import { authRequired, optionalAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

const VALID_PICKS = new Set(['home', 'away', 'tie']);

// Votar quién gana un partido. Requiere sesión. Una sola vez por partido y
// por usuario — el voto queda fijo para siempre, como una quiniela de
// papel: no hay ruta para editarlo ni borrarlo. Se rechaza si el partido
// ya arrancó (comparando match_date contra la hora del servidor).
router.post('/', authRequired, asyncHandler(async (req, res) => {
  const { match_id, pick } = req.body;
  if (!match_id || !VALID_PICKS.has(pick)) {
    return res.status(400).json({ error: 'Debes indicar match_id y un pick válido (home, away o tie)' });
  }

  const match = await db.prepare(`
    SELECT id, (match_date::timestamptz <= NOW()) as started
    FROM matches WHERE id = ?
  `).get(match_id);
  if (!match) return res.status(404).json({ error: 'Partido no encontrado' });
  if (match.started) return res.status(400).json({ error: 'Ya no se puede votar, el partido ya empezó' });

  const existing = await db.prepare(
    'SELECT id FROM predictions WHERE match_id = ? AND user_id = ?'
  ).get(match_id, req.user.id);
  if (existing) {
    return res.status(409).json({ error: 'Ya votaste en este partido — tu voto es definitivo' });
  }

  await db.prepare(
    'INSERT INTO predictions (match_id, user_id, pick) VALUES (?, ?, ?)'
  ).run(match_id, req.user.id, pick);

  res.status(201).json({ ok: true });
}));

// Resumen de uno o varios partidos a la vez (?matchIds=1,2,3), para pintar
// varias tarjetas de una lista sin mandar una petición por cada una.
// Sin sesión: solo cuenta los votos totales. Con sesión: además dice qué
// votó esta persona en cada partido (myPick), que es lo que el frontend
// usa para decidir si mostrar los botones de votar o ya el porcentaje.
router.get('/summary', optionalAuth, asyncHandler(async (req, res) => {
  const idsParam = req.query.matchIds;
  if (!idsParam) return res.status(400).json({ error: 'Falta matchIds' });

  const matchIds = idsParam.split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n));
  if (matchIds.length === 0) return res.json({});

  const placeholders = matchIds.map(() => '?').join(',');

  const counts = await db.prepare(`
    SELECT match_id, pick, COUNT(*) as count
    FROM predictions
    WHERE match_id IN (${placeholders})
    GROUP BY match_id, pick
  `).all(...matchIds);

  const mine = req.user
    ? await db.prepare(`
        SELECT match_id, pick FROM predictions
        WHERE match_id IN (${placeholders}) AND user_id = ?
      `).all(...matchIds, req.user.id)
    : [];

  const result = {};
  for (const id of matchIds) {
    result[id] = { home: 0, away: 0, tie: 0, total: 0, myPick: null };
  }
  for (const row of counts) {
    result[row.match_id][row.pick] = Number(row.count);
    result[row.match_id].total += Number(row.count);
  }
  for (const row of mine) {
    result[row.match_id].myPick = row.pick;
  }

  res.json(result);
}));

// Mis estadísticas de predicciones: cuántas lleva en total, cuántas ya se
// pueden calificar (el partido tiene marcador guardado — no basta con que
// esté "finalizado" por tiempo, ver nota en matchStatus.js del frontend) y
// cuántas acertó. El % solo se calcula sobre las calificadas.
router.get('/my-stats', authRequired, asyncHandler(async (req, res) => {
  const row = await db.prepare(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL) AS graded,
      COUNT(*) FILTER (
        WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL AND (
          (p.pick = 'home' AND m.home_score > m.away_score) OR
          (p.pick = 'away' AND m.away_score > m.home_score) OR
          (p.pick = 'tie'  AND m.home_score = m.away_score)
        )
      ) AS correct
    FROM predictions p
    JOIN matches m ON m.id = p.match_id
    WHERE p.user_id = ?
  `).get(req.user.id);

  const total   = Number(row.total);
  const graded  = Number(row.graded);
  const correct = Number(row.correct);

  res.json({
    total,
    graded,
    correct,
    pending: total - graded,
    accuracyPct: graded > 0 ? Math.round((correct / graded) * 100) : null,
  });
}));

// Ranking de un calendario específico (los mismos partidos que se están
// viendo en pantalla, sin importar si son de una categoría completa o de
// un torneo entero): quiénes predijeron en esos partidos, ordenados por %
// de aciertos. Aparecen quienes ya hicieron al menos MIN_PREDICTIONS
// predicciones EN ESE MISMO calendario — no hace falta que ya estén
// calificadas (con marcador guardado), así la gente puede ver quién más
// participa desde antes de que arranque la temporada. El % de aciertos
// solo se calcula sobre las que sí ya tienen resultado.
const MIN_PREDICTIONS_FOR_RANKING = 10;

router.get('/ranking', asyncHandler(async (req, res) => {
  const idsParam = req.query.matchIds;
  if (!idsParam) return res.status(400).json({ error: 'Falta matchIds' });

  const matchIds = idsParam.split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n));
  if (matchIds.length === 0) return res.json([]);

  const placeholders = matchIds.map(() => '?').join(',');

  const rows = await db.prepare(`
    SELECT
      u.id AS user_id,
      u.name,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL) AS graded,
      COUNT(*) FILTER (
        WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL AND (
          (p.pick = 'home' AND m.home_score > m.away_score) OR
          (p.pick = 'away' AND m.away_score > m.home_score) OR
          (p.pick = 'tie'  AND m.home_score = m.away_score)
        )
      ) AS correct
    FROM predictions p
    JOIN matches m ON m.id = p.match_id
    JOIN users u   ON u.id = p.user_id
    WHERE p.match_id IN (${placeholders})
    GROUP BY u.id, u.name
    HAVING COUNT(*) >= ?
  `).all(...matchIds, MIN_PREDICTIONS_FOR_RANKING);

  const ranking = rows
    .map((r) => {
      const total   = Number(r.total);
      const graded  = Number(r.graded);
      const correct = Number(r.correct);
      return {
        userId: r.user_id,
        name: r.name,
        total,
        graded,
        correct,
        accuracyPct: graded > 0 ? Math.round((correct / graded) * 100) : null,
      };
    })
    .sort((a, b) => {
      if (a.accuracyPct === null && b.accuracyPct === null) return b.graded - a.graded || b.total - a.total;
      if (a.accuracyPct === null) return 1;
      if (b.accuracyPct === null) return -1;
      return b.accuracyPct - a.accuracyPct || b.correct - a.correct;
    });

  res.json(ranking);
}));

export default router;
