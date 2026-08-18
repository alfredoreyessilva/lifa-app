import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { teamOwnerRequired } from '../middleware/ownership.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isNonEmptyString } from '../utils/validation.js';

const router = express.Router();

// Roster de un equipo: solo los jugadores con membresía activa
// (end_date IS NULL) en ese equipo, ordenados por número de jugador.
router.get('/teams/:id/roster', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const teamId = req.team.id;
  const roster = await db.prepare(`
    SELECT p.id, p.first_name, p.last_name, p.birth_date, p.photo_url,
           ptm.id AS membership_id, ptm.jersey_number, ptm.position, ptm.season, ptm.start_date
    FROM player_team_memberships ptm
    JOIN players p ON p.id = ptm.player_id
    WHERE ptm.team_id = ? AND ptm.end_date IS NULL
    ORDER BY ptm.jersey_number NULLS LAST, p.last_name
  `).all(teamId);
  res.json({ roster });
}));

// Agrega un jugador nuevo (todavía sin cuenta propia, user_id queda NULL) y
// de una vez lo da de alta en el roster del equipo, en un solo paso — es el
// caso más común: el equipo registra a alguien que nunca ha usado la app.
router.post('/teams/:id/roster', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const teamId = req.team.id;
  const { first_name, last_name, birth_date, position, jersey_number, photo_url, season } = req.body;

  if (!isNonEmptyString(first_name) || !isNonEmptyString(last_name)) {
    return res.status(400).json({ error: 'Nombre y apellido son obligatorios' });
  }

  const player = await db.prepare(`
    INSERT INTO players (first_name, last_name, birth_date, position, jersey_number, photo_url)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(first_name.trim(), last_name.trim(), birth_date || null, position || null, jersey_number || null, photo_url || null);

  const membership = await db.prepare(`
    INSERT INTO player_team_memberships (player_id, team_id, season, jersey_number, position)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `).get(player.id, teamId, season || null, jersey_number || null, position || null);

  res.status(201).json({ player, membership });
}));

// Mueve a un jugador al equipo :id (el de la URL), cerrando cualquier
// membresía activa que tuviera en otro equipo (end_date = hoy) y abriendo
// una nueva en el equipo destino — sin borrar la fila vieja, así el
// historial ("2024 Lobos, 2025 Borregos") queda completo.
//
// LIMITACIÓN CONOCIDA, a propósito: solo valida permiso sobre el equipo
// DESTINO (vía teamOwnerRequired), no sobre el equipo de origen. Hoy es
// seguro porque una sola persona administra todos los equipos de prueba.
// El día que dos equipos con dueños distintos necesiten un traspaso real,
// esto necesita convertirse en un flujo de solicitud/aprobación entre
// ambas organizaciones (ver organization_relationships, semanas 5-6) — no
// construirlo ahora es deliberado, no un descuido.
router.post('/:playerId/move-to-team/:id', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const playerId = Number(req.params.playerId);
  const destinationTeamId = req.team.id;
  const { season, jersey_number, position } = req.body;

  const player = await db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });

  await db.prepare(`
    UPDATE player_team_memberships
    SET end_date = CURRENT_DATE, status = 'ended'
    WHERE player_id = ? AND end_date IS NULL
  `).run(playerId);

  const membership = await db.prepare(`
    INSERT INTO player_team_memberships (player_id, team_id, season, jersey_number, position)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `).get(playerId, destinationTeamId, season || null, jersey_number || null, position || null);

  res.status(201).json({ player, membership });
}));

export default router;
