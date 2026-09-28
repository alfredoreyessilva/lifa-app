import express from 'express';
import db from '../config/db.js';
import { authRequired, optionalAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { MATCH_GRADABLE_SQL, PREDICTION_CORRECT_SQL, PREDICTION_POINTS_SQL, MATCH_IS_EXHIBITION_SQL } from '../utils/scoring.js';
import { conPosiciones, porcentaje } from '../utils/rankingPredicciones.js';

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
// pueden calificar (el partido YA TERMINÓ y tiene marcador guardado — no basta
// con que haya marcador parcial mientras sigue en vivo, ver scoring.js) y
// cuántas acertó. El % solo se calcula sobre las calificadas. Los amistosos
// no cuentan (igual que en el ranking). Desde el 2026-09-27 eso se pregunta a
// la FASE (MATCH_IS_EXHIBITION_SQL), como el ranking de la quiniela, y no a la
// etiqueta 'SCRIMMAGE': medido en producción, las dos coincidían en todas las
// predicciones, así que no movió a nadie.
router.get('/my-stats', authRequired, asyncHandler(async (req, res) => {
  const row = await db.prepare(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE ${MATCH_GRADABLE_SQL}) AS graded,
      COUNT(*) FILTER (WHERE ${PREDICTION_CORRECT_SQL}) AS correct
    FROM predictions p
    JOIN matches m ON m.id = p.match_id
    JOIN categories c ON c.id = m.category_id
    WHERE p.user_id = ?
      AND NOT ${MATCH_IS_EXHIBITION_SQL}
  `).get(req.user.id);

  const total   = Number(row.total);
  const graded  = Number(row.graded);
  const correct = Number(row.correct);

  res.json({
    total,
    graded,
    correct,
    pending: total - graded,
    accuracyPct: porcentaje(correct, graded),
  });
}));

// Ranking de un calendario específico (los partidos que el frontend manda —
// siempre el calendario completo, nunca un recorte filtrado): quiénes
// predijeron en esos partidos, ordenados por PUNTOS. Puntos = 1 por acierto,
// 2 por acierto en fase final (playoff / semifinal / final). Los partidos de
// scrimmage no cuentan para nada. Aparece cualquiera que ya haya votado al
// menos MIN_PREDICTIONS partido(s) que sí cuenten. No hace falta que estén
// calificados; el % de aciertos se muestra aparte, solo sobre los que ya
// tienen resultado, y no interviene en el orden.
//
// Un partido solo reparte puntos cuando YA TERMINÓ (ver scoring.js): mientras
// sigue en vivo, el marcador parcial que va subiendo el organizador no
// califica a nadie todavía.
const MIN_PREDICTIONS_FOR_RANKING = 1;

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
      COUNT(*) FILTER (WHERE ${MATCH_GRADABLE_SQL}) AS graded,
      COUNT(*) FILTER (WHERE ${PREDICTION_CORRECT_SQL}) AS correct,
      COALESCE(SUM(${PREDICTION_POINTS_SQL}), 0) AS points
    FROM predictions p
    JOIN matches m ON m.id = p.match_id
    JOIN categories c ON c.id = m.category_id
    JOIN users u   ON u.id = p.user_id
    WHERE p.match_id IN (${placeholders})
      AND NOT ${MATCH_IS_EXHIBITION_SQL}
    GROUP BY u.id, u.name
    HAVING COUNT(*) >= ?
  `).all(...matchIds, MIN_PREDICTIONS_FOR_RANKING);

  // El orden y el lugar (`position`, compartido en un empate exacto) salen de
  // utils/rankingPredicciones.js, igual que en la quiniela y en los avisos de
  // "Mis notificaciones": un aviso que dice "vas 4.º" da el mismo número.
  const ranking = conPosiciones(rows.map((r) => {
    const total   = Number(r.total);
    const graded  = Number(r.graded);
    const correct = Number(r.correct);
    const points  = Number(r.points);
    return {
      userId: r.user_id,
      name: r.name,
      total,
      graded,
      correct,
      points,
      accuracyPct: porcentaje(correct, graded),
    };
  }));

  res.json(ranking);
}));

export default router;
