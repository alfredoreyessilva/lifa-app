import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { teamOwnerRequired, matchOwnerRequired, branchTeamOwnerRequired } from '../middleware/ownership.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isNonEmptyString } from '../utils/validation.js';
import { MATCH_GRADABLE_SQL, PREDICTION_CORRECT_SQL } from '../utils/scoring.js';

const router = express.Router();

// OBSOLETO (corrección roster-por-rama): este endpoint da el roster de TODO
// el equipo mezclado, sin separar por rama/categoría — eso es justo lo que
// se corrigió. Se deja vivo por ahora, sin que nada lo llame ya, y se retira
// en el siguiente paso una vez que la pantalla nueva esté conectada.
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

// OBSOLETO, mismo motivo que el de arriba.
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

// Roster de un equipo DENTRO DE UNA RAMA específica — el reemplazo correcto
// de los dos endpoints obsoletos de arriba. branchTeamOwnerRequired ya
// valida que el equipo esté inscrito en la rama antes de llegar aquí.
router.get('/branches/:branchId/teams/:teamId/roster', authRequired, branchTeamOwnerRequired, asyncHandler(async (req, res) => {
  const roster = await db.prepare(`
    SELECT p.id, p.first_name, p.last_name, p.birth_date, p.photo_url,
           ptm.id AS membership_id, ptm.jersey_number, ptm.position, ptm.season, ptm.start_date
    FROM player_team_memberships ptm
    JOIN players p ON p.id = ptm.player_id
    WHERE ptm.team_id = ? AND ptm.branch_id = ? AND ptm.end_date IS NULL
    ORDER BY ptm.jersey_number NULLS LAST, p.last_name
  `).all(req.team.id, req.branch.id);
  res.json({ roster });
}));

// Agrega un jugador nuevo y lo da de alta en el roster de este equipo, en
// ESTA rama específica — branch_id ya no se pregunta, se toma del contexto
// (la URL), tal como se decidió: "se sobreentiende que se subió en esa
// rama de esa categoría".
router.post('/branches/:branchId/teams/:teamId/roster', authRequired, branchTeamOwnerRequired, asyncHandler(async (req, res) => {
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
    INSERT INTO player_team_memberships (player_id, team_id, branch_id, season, jersey_number, position)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(player.id, req.team.id, req.branch.id, season || null, jersey_number || null, position || null);

  res.status(201).json({ player, membership });
}));

// Mueve a un jugador YA EXISTENTE (dado de alta antes, en otra rama u otro
// equipo) al roster de este equipo, en esta rama. Cierra su membresía
// activa anterior (donde sea que estuviera) y abre una nueva aquí — mismo
// patrón de historial que el traspaso de abajo.
router.post('/branches/:branchId/teams/:teamId/roster/:playerId/move', authRequired, branchTeamOwnerRequired, asyncHandler(async (req, res) => {
  const playerId = Number(req.params.playerId);
  const { season, jersey_number, position } = req.body;

  const player = await db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });

  await db.prepare(`
    UPDATE player_team_memberships
    SET end_date = CURRENT_DATE, status = 'ended'
    WHERE player_id = ? AND end_date IS NULL
  `).run(playerId);

  const membership = await db.prepare(`
    INSERT INTO player_team_memberships (player_id, team_id, branch_id, season, jersey_number, position)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(playerId, req.team.id, req.branch.id, season || null, jersey_number || null, position || null);

  res.status(201).json({ player, membership });
}));

// OBSOLETO (corrección roster-por-rama): reemplazado por
// /branches/:branchId/teams/:teamId/roster/:playerId/move de arriba, que sí
// registra en qué rama queda el jugador. Se deja vivo, sin uso, mismo
// criterio que los otros dos endpoints obsoletos de este archivo.
//
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

const STAT_FIELDS = [
  'pass_completions', 'pass_attempts', 'pass_yards', 'pass_td', 'interceptions_thrown',
  'rush_attempts', 'rush_yards', 'rush_td',
  'receptions', 'receiving_yards', 'receiving_td',
  'tackles', 'sacks', 'interceptions_def',
  'field_goals_made', 'extra_points_made',
];

// Todas las estadísticas capturadas de un partido, para mostrar la tabla
// completa (ambos equipos) de una sola vez.
router.get('/matches/:id/stats', authRequired, matchOwnerRequired, asyncHandler(async (req, res) => {
  const stats = await db.prepare(`
    SELECT s.*, p.first_name, p.last_name
    FROM player_match_stats s
    JOIN players p ON p.id = s.player_id
    WHERE s.match_id = ?
    ORDER BY s.team_id, p.last_name
  `).all(req.match.id);
  res.json({ stats });
}));

// Crea o actualiza (upsert) la estadística de UN jugador en UN partido.
// team_id tiene que ser el equipo local o visitante YA CONECTADO a este
// partido (home_team_id / away_team_id) — si el partido todavía no está
// conectado con sus equipos, se pide sincronizar primero (botón "Conectar
// equipos con sus partidos" en el panel de la liga) en vez de dejar
// capturar estadísticas de un equipo sin confirmar que de verdad jugó ahí.
router.put('/matches/:id/stats/:playerId', authRequired, matchOwnerRequired, asyncHandler(async (req, res) => {
  const match = req.match;
  const playerId = Number(req.params.playerId);
  const { team_id } = req.body;

  if (!team_id) return res.status(400).json({ error: 'team_id es obligatorio' });
  if (!match.home_team_id && !match.away_team_id) {
    return res.status(400).json({ error: 'Este partido todavía no está conectado con sus equipos. Sincronízalo primero desde el panel de la liga.' });
  }
  if (Number(team_id) !== match.home_team_id && Number(team_id) !== match.away_team_id) {
    return res.status(400).json({ error: 'Ese equipo no es local ni visitante en este partido' });
  }

  const player = await db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });

  // Arma las 16 columnas a partir del body, con 0 por default para las que
  // no vengan — así el formulario del frontend puede mandar solo las que
  // aplican a la posición del jugador (ej. un RB no manda pass_yards).
  const values = STAT_FIELDS.map((f) => Number(req.body[f] || 0));

  const stat = await db.prepare(`
    INSERT INTO player_match_stats (player_id, match_id, team_id, ${STAT_FIELDS.join(', ')})
    VALUES (?, ?, ?, ${STAT_FIELDS.map(() => '?').join(', ')})
    ON CONFLICT (player_id, match_id) DO UPDATE SET
      team_id = EXCLUDED.team_id,
      ${STAT_FIELDS.map((f) => `${f} = EXCLUDED.${f}`).join(', ')}
    RETURNING *
  `).get(playerId, match.id, team_id, ...values);

  res.json({ stat });
}));

// Tarjeta del jugador: identidad + trayectoria + estadísticas acumuladas +
// (si el jugador ya reclamó su perfil, es decir tiene user_id) sus stats de
// predicciones y participación en quinielas. Público, sin authRequired —
// una tarjeta de jugador debe poder verse igual que cualquier partido o
// liga hoy, no solo por quien administra su equipo.
router.get('/:id/card', asyncHandler(async (req, res) => {
  const playerId = Number(req.params.id);
  const player = await db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Jugador no encontrado' });

  const trajectory = await db.prepare(`
    SELECT ptm.id AS membership_id, ptm.season, ptm.position, ptm.jersey_number,
           ptm.start_date, ptm.end_date,
           t.id AS team_id, t.name AS team_name, t.logo_url AS team_logo_url
    FROM player_team_memberships ptm
    JOIN teams t ON t.id = ptm.team_id
    WHERE ptm.player_id = ?
    ORDER BY ptm.start_date DESC
  `).all(playerId);

  const statsRow = await db.prepare(`
    SELECT
      COUNT(*) AS games_played,
      COALESCE(SUM(pass_completions), 0)   AS pass_completions,
      COALESCE(SUM(pass_attempts), 0)      AS pass_attempts,
      COALESCE(SUM(pass_yards), 0)         AS pass_yards,
      COALESCE(SUM(pass_td), 0)            AS pass_td,
      COALESCE(SUM(interceptions_thrown),0)AS interceptions_thrown,
      COALESCE(SUM(rush_attempts), 0)      AS rush_attempts,
      COALESCE(SUM(rush_yards), 0)         AS rush_yards,
      COALESCE(SUM(rush_td), 0)            AS rush_td,
      COALESCE(SUM(receptions), 0)         AS receptions,
      COALESCE(SUM(receiving_yards), 0)    AS receiving_yards,
      COALESCE(SUM(receiving_td), 0)       AS receiving_td,
      COALESCE(SUM(tackles), 0)            AS tackles,
      COALESCE(SUM(sacks), 0)              AS sacks,
      COALESCE(SUM(interceptions_def), 0)  AS interceptions_def,
      COALESCE(SUM(field_goals_made), 0)   AS field_goals_made,
      COALESCE(SUM(extra_points_made), 0)  AS extra_points_made
    FROM player_match_stats
    WHERE player_id = ?
  `).get(playerId);

  // Predicciones y quinielas solo existen si el jugador ya reclamó su
  // perfil (player.user_id lleno) — un jugador dado de alta por su equipo,
  // sin cuenta propia todavía, simplemente no tiene esta parte de la
  // tarjeta (queda en null, no en 0 — son cosas distintas: "no aplica" vs
  // "aplica pero en cero").
  let predictions = null;
  let pools = null;
  if (player.user_id) {
    const predRow = await db.prepare(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE ${MATCH_GRADABLE_SQL}) AS graded,
        COUNT(*) FILTER (WHERE ${PREDICTION_CORRECT_SQL}) AS correct
      FROM predictions p
      JOIN matches m ON m.id = p.match_id
      JOIN categories c ON c.id = m.category_id
      WHERE p.user_id = ?
    `).get(player.user_id);
    const total = Number(predRow.total);
    const graded = Number(predRow.graded);
    const correct = Number(predRow.correct);
    predictions = {
      total, graded, correct,
      pending: total - graded,
      accuracyPct: graded > 0 ? Math.round((correct / graded) * 100) : null,
    };

    const poolRow = await db.prepare('SELECT COUNT(*) AS total FROM pool_members WHERE user_id = ?').get(player.user_id);
    pools = { participations: Number(poolRow.total) };
  }

  res.json({
    player,
    trajectory,
    stats: {
      gamesPlayed: Number(statsRow.games_played),
      passCompletions: Number(statsRow.pass_completions),
      passAttempts: Number(statsRow.pass_attempts),
      passYards: Number(statsRow.pass_yards),
      passTd: Number(statsRow.pass_td),
      interceptionsThrown: Number(statsRow.interceptions_thrown),
      rushAttempts: Number(statsRow.rush_attempts),
      rushYards: Number(statsRow.rush_yards),
      rushTd: Number(statsRow.rush_td),
      receptions: Number(statsRow.receptions),
      receivingYards: Number(statsRow.receiving_yards),
      receivingTd: Number(statsRow.receiving_td),
      tackles: Number(statsRow.tackles),
      sacks: Number(statsRow.sacks),
      interceptionsDef: Number(statsRow.interceptions_def),
      fieldGoalsMade: Number(statsRow.field_goals_made),
      extraPointsMade: Number(statsRow.extra_points_made),
    },
    predictions,
    pools,
  });
}));

export default router;
