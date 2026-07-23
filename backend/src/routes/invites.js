import express from 'express';
import crypto from 'crypto';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { teamLeagueOwnerRequired } from '../middleware/ownership.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

function generateToken() {
  return crypto.randomBytes(12).toString('hex'); // ej. "a1b2c3d4e5f6…"
}

/* ===================== GENERAR INVITACIÓN DE EQUIPO ===================== */
// Solo el representante de la liga (o un admin) puede generar esto — ver
// teamLeagueOwnerRequired. Si ya había una invitación sin usar para este
// equipo, se elimina primero para que solo quede una vigente a la vez.
router.post('/teams/:teamId', authRequired, teamLeagueOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare(`DELETE FROM invites WHERE team_id = ? AND used_at IS NULL`).run(req.team.id);

  const token = generateToken();
  await db.prepare(`
    INSERT INTO invites (token, type, team_id, created_by)
    VALUES (?, 'team', ?, ?)
  `).run(token, req.team.id, req.user.id);

  res.status(201).json({ token });
}));

/* ===================== QUITAR REPRESENTANTE DE UN EQUIPO ===================== */
router.delete('/teams/:teamId/owner', authRequired, teamLeagueOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare(`UPDATE teams SET owner_user_id = NULL WHERE id = ?`).run(req.team.id);
  // Limpiamos también cualquier invitación pendiente que hubiera quedado sin usar.
  await db.prepare(`DELETE FROM invites WHERE team_id = ? AND used_at IS NULL`).run(req.team.id);
  res.json({ ok: true });
}));

/* ===================== VER INFO PÚBLICA DE UNA INVITACIÓN ===================== */
// Pública (sin sesión) — para mostrarle a la persona qué va a reclamar antes
// de pedirle que inicie sesión o se registre.
router.get('/:token', asyncHandler(async (req, res) => {
  const invite = await db.prepare(`
    SELECT
      i.token, i.type, i.used_at,
      t.id AS team_id, t.name AS team_name, t.logo_url AS team_logo_url,
      l.name AS league_name
    FROM invites i
    LEFT JOIN teams t   ON t.id = i.team_id
    LEFT JOIN leagues l ON l.id = t.league_id
    WHERE i.token = ?
  `).get(req.params.token);

  if (!invite) return res.status(404).json({ error: 'Esta invitación no existe o ya no es válida' });
  if (invite.used_at) return res.status(410).json({ error: 'Esta invitación ya fue utilizada' });

  res.json(invite);
}));

/* ===================== RECLAMAR UNA INVITACIÓN ===================== */
// Requiere sesión iniciada (el frontend manda a la persona a iniciar sesión
// o crear una cuenta primero si hace falta).
router.post('/:token/claim', authRequired, asyncHandler(async (req, res) => {
  const invite = await db.prepare(`SELECT * FROM invites WHERE token = ?`).get(req.params.token);
  if (!invite) return res.status(404).json({ error: 'Esta invitación no existe o ya no es válida' });
  if (invite.used_at) return res.status(410).json({ error: 'Esta invitación ya fue utilizada' });

  if (invite.type === 'team') {
    await db.prepare(`UPDATE teams SET owner_user_id = ? WHERE id = ?`).run(req.user.id, invite.team_id);
  }

  await db.prepare(`UPDATE invites SET used_by = ?, used_at = CURRENT_TIMESTAMP WHERE id = ?`).run(req.user.id, invite.id);

  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(invite.team_id);
  res.json({ ok: true, team });
}));

export default router;
