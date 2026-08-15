import express from 'express';
import crypto from 'crypto';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isNonEmptyString } from '../utils/validation.js';

const router = express.Router();

function generateJoinCode() {
  return crypto.randomBytes(6).toString('hex'); // ej. "a1b2c3d4e5f6"
}

// Crear una quiniela — la persona que la crea queda como primer miembro
// automáticamente (sus predicciones cuentan desde ahora, igual que
// cualquiera más que se una después).
router.post('/', authRequired, asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'Ponle un nombre a tu quiniela' });

  const joinCode = generateJoinCode();
  const pool = await db.prepare(`
    INSERT INTO pools (name, join_code, owner_user_id) VALUES (?, ?, ?) RETURNING *
  `).get(name.trim(), joinCode, req.user.id);

  await db.prepare(`
    INSERT INTO pool_members (pool_id, user_id) VALUES (?, ?)
  `).run(pool.id, req.user.id);

  res.status(201).json(pool);
}));

// Mis quinielas (a las que pertenezco), con cuántos miembros tiene cada una.
router.get('/mine', authRequired, asyncHandler(async (req, res) => {
  const pools = await db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM pool_members WHERE pool_id = p.id) AS member_count
    FROM pools p
    JOIN pool_members pm ON pm.pool_id = p.id AND pm.user_id = ?
    ORDER BY p.created_at DESC
  `).all(req.user.id);
  res.json(pools);
}));

// Vista pública de una quiniela por su código (para mostrar antes de pedir
// sesión, igual que la vista previa de una invitación de equipo).
router.get('/:code', asyncHandler(async (req, res) => {
  const pool = await db.prepare(`
    SELECT p.id, p.name, p.join_code, (SELECT COUNT(*) FROM pool_members WHERE pool_id = p.id) AS member_count
    FROM pools p WHERE p.join_code = ?
  `).get(req.params.code);
  if (!pool) return res.status(404).json({ error: 'Esta quiniela no existe' });
  res.json(pool);
}));

// Unirse — se puede usar el link las veces que haga falta (no es de un
// solo uso, a diferencia de las invitaciones de equipo). Si ya eras
// miembro, no pasa nada (no se reinicia tu joined_at).
router.post('/:code/join', authRequired, asyncHandler(async (req, res) => {
  const pool = await db.prepare('SELECT * FROM pools WHERE join_code = ?').get(req.params.code);
  if (!pool) return res.status(404).json({ error: 'Esta quiniela no existe' });

  await db.prepare(`
    INSERT INTO pool_members (pool_id, user_id) VALUES (?, ?)
    ON CONFLICT (pool_id, user_id) DO NOTHING
  `).run(pool.id, req.user.id);

  res.json(pool);
}));

// Ranking interno de la quiniela, sobre una lista de partidos (los que se
// están viendo en ese calendario) — solo pueden verlo sus miembros. Sin
// mínimo de predicciones (grupo chico y de confianza, se ve a todos desde
// el principio). Solo cuentan las predicciones hechas DESDE que cada quien
// se unió — por eso el filtro p.created_at >= pm.joined_at.
router.get('/:code/ranking', authRequired, asyncHandler(async (req, res) => {
  const pool = await db.prepare('SELECT * FROM pools WHERE join_code = ?').get(req.params.code);
  if (!pool) return res.status(404).json({ error: 'Esta quiniela no existe' });

  const membership = await db.prepare(
    'SELECT id FROM pool_members WHERE pool_id = ? AND user_id = ?'
  ).get(pool.id, req.user.id);
  if (!membership) return res.status(403).json({ error: 'No perteneces a esta quiniela' });

  const idsParam = req.query.matchIds;
  const matchIds = (idsParam || '').split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n));

  let rows;
  if (matchIds.length === 0) {
    rows = await db.prepare(`
      SELECT u.id AS user_id, u.name, 0 AS total, 0 AS graded, 0 AS correct
      FROM pool_members pm JOIN users u ON u.id = pm.user_id
      WHERE pm.pool_id = ?
    `).all(pool.id);
  } else {
    const placeholders = matchIds.map(() => '?').join(',');
    rows = await db.prepare(`
      SELECT
        u.id AS user_id,
        u.name,
        COUNT(p.id) AS total,
        COUNT(p.id) FILTER (WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL) AS graded,
        COUNT(p.id) FILTER (
          WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL AND (
            (p.pick = 'home' AND m.home_score > m.away_score) OR
            (p.pick = 'away' AND m.away_score > m.home_score) OR
            (p.pick = 'tie'  AND m.home_score = m.away_score)
          )
        ) AS correct
      FROM pool_members pm
      JOIN users u ON u.id = pm.user_id
      LEFT JOIN predictions p ON p.user_id = pm.user_id
        AND p.match_id IN (${placeholders})
        AND p.created_at >= pm.joined_at
      LEFT JOIN matches m ON m.id = p.match_id
      WHERE pm.pool_id = ?
      GROUP BY u.id, u.name
    `).all(...matchIds, pool.id);
  }

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

  res.json({ pool: { name: pool.name, joinCode: pool.join_code }, ranking });
}));

export default router;
