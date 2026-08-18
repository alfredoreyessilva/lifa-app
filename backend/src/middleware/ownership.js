import db from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isOrgMember } from '../utils/orgMembers.js';

export const leagueOwnerRequired = asyncHandler(async (req, res, next) => {
  const leagueId = Number(req.params.leagueId || req.params.id);
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId);
  if (!league) return res.status(404).json({ error: 'Liga no encontrada' });
  // Piloto de la migración a organization_members: primero se pregunta por
  // membresía en la organización de la liga. owner_user_id se deja como
  // respaldo (no se quita) — si por lo que sea la liga no tuviera
  // organization_id o el usuario no apareciera todavía en
  // organization_members, el acceso de siempre sigue funcionando igual.
  // Una vez confirmado que esto corre bien en producción, el respaldo se
  // puede retirar (no en esta migración, más adelante).
  const isMember = await isOrgMember(req.user.id, league.organization_id);
  if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
    req.league = league;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre esta liga' });
});

export const tournamentOwnerRequired = asyncHandler(async (req, res, next) => {
  const tournamentId = Number(req.params.tournamentId);
  const tournament = await db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(tournament.league_id);
  const isMember = await isOrgMember(req.user.id, league.organization_id);
  if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
    req.league = league;
    req.tournament = tournament;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre este torneo' });
});

export const branchOwnerRequired = asyncHandler(async (req, res, next) => {
  const branchId = Number(req.params.branchId);
  const branch = await db.prepare('SELECT * FROM branches WHERE id = ?').get(branchId);
  if (!branch) return res.status(404).json({ error: 'Rama no encontrada' });
  const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(branch.category_id);
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(category.league_id);
  const isMember = await isOrgMember(req.user.id, league.organization_id);
  if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
    req.league = league;
    req.category = category;
    req.branch = branch;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre esta rama' });
});

export const conferenceOwnerRequired = asyncHandler(async (req, res, next) => {
  const conferenceId = Number(req.params.conferenceId);
  const conference = await db.prepare('SELECT * FROM conferences WHERE id = ?').get(conferenceId);
  if (!conference) return res.status(404).json({ error: 'Conferencia no encontrada' });
  const branch = await db.prepare('SELECT * FROM branches WHERE id = ?').get(conference.branch_id);
  const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(branch.category_id);
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(category.league_id);
  const isMember = await isOrgMember(req.user.id, league.organization_id);
  if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
    req.league = league;
    req.category = category;
    req.branch = branch;
    req.conference = conference;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre esta conferencia' });
});

export const categoryOwnerRequired = asyncHandler(async (req, res, next) => {
  const categoryId = Number(req.params.categoryId);
  const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
  if (!category) return res.status(404).json({ error: 'Categoría no encontrada' });
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(category.league_id);
  const isMember = await isOrgMember(req.user.id, league.organization_id);
  if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
    req.league = league;
    req.category = category;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre esta categoría' });
});

export const matchOwnerRequired = asyncHandler(async (req, res, next) => {
  const matchId = Number(req.params.id);
  const match = await db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Partido no encontrado' });
  const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(match.category_id);
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(category.league_id);
  const isMember = await isOrgMember(req.user.id, league.organization_id);
  if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
    req.league = league;
    req.category = category;
    req.match = match;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre este partido' });
});

export const teamOwnerRequired = asyncHandler(async (req, res, next) => {
  const teamId = Number(req.params.id);
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  if (!team) return res.status(404).json({ error: 'Equipo no encontrado' });
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(team.league_id);
  // El dueño directo del equipo (representante de medios) puede editar el
  // perfil de SU equipo, igual que el dueño de la liga o un admin. Ahora se
  // pregunta por membresía tanto en la organización de la liga como en la
  // del equipo (son organizaciones distintas) — cualquiera de las dos
  // formas de acceso, la nueva o la de owner_user_id, sigue funcionando.
  const isLeagueMember = await isOrgMember(req.user.id, league.organization_id);
  const isTeamMember = await isOrgMember(req.user.id, team.organization_id);
  if (
    req.user.role === 'admin' ||
    isLeagueMember ||
    isTeamMember ||
    league.owner_user_id === req.user.id ||
    team.owner_user_id === req.user.id
  ) {
    req.league = league;
    req.team = team;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre este equipo' });
});

// Para gestionar invitaciones de un equipo (generar/revocar representante):
// a propósito NO se le permite esto al representante del equipo mismo, solo
// a quien administra la liga completa (o un admin) — para que nadie pueda
// "regalar" su propio equipo a alguien más sin que la liga se entere.
export const teamLeagueOwnerRequired = asyncHandler(async (req, res, next) => {
  const teamId = Number(req.params.teamId || req.params.id);
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  if (!team) return res.status(404).json({ error: 'Equipo no encontrado' });
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(team.league_id);
  const isMember = await isOrgMember(req.user.id, league.organization_id);
  if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
    req.league = league;
    req.team = team;
    return next();
  }
  return res.status(403).json({ error: 'Solo el representante de la liga puede gestionar esto' });
});

export const venueOwnerRequired = asyncHandler(async (req, res, next) => {
  const venueId = Number(req.params.id);
  const venue = await db.prepare('SELECT * FROM venues WHERE id = ?').get(venueId);
  if (!venue) return res.status(404).json({ error: 'Sede no encontrada' });
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(venue.league_id);
  const isMember = await isOrgMember(req.user.id, league.organization_id);
  if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
    req.league = league;
    req.venue = venue;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre esta sede' });
});

export const groupOwnerRequired = asyncHandler(async (req, res, next) => {
  const groupId = Number(req.params.id);
  const group = await db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
  const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(group.category_id);
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(category.league_id);
  const isMember = await isOrgMember(req.user.id, league.organization_id);
  if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
    req.league = league;
    req.category = category;
    req.group = group;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre este grupo' });
});

// Da acceso al roster de UN equipo dentro de UNA rama específica — a quien
// administra la liga (dueña de la rama) O a quien administra ese equipo,
// igual que teamOwnerRequired. La diferencia es que además valida que el
// equipo esté inscrito en branch_teams: no se puede subir roster de un
// equipo que la liga no haya inscrito en esa rama primero.
export const branchTeamOwnerRequired = asyncHandler(async (req, res, next) => {
  const branchId = Number(req.params.branchId);
  const teamId = Number(req.params.teamId);

  const branch = await db.prepare('SELECT * FROM branches WHERE id = ?').get(branchId);
  if (!branch) return res.status(404).json({ error: 'Rama no encontrada' });
  const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(branch.category_id);
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(category.league_id);
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  if (!team) return res.status(404).json({ error: 'Equipo no encontrado' });

  const enrolled = await db.prepare('SELECT 1 FROM branch_teams WHERE branch_id = ? AND team_id = ?').get(branchId, teamId);
  if (!enrolled) return res.status(400).json({ error: 'Este equipo no está inscrito en esta rama todavía' });

  const isLeagueMember = await isOrgMember(req.user.id, league.organization_id);
  const isTeamMember = await isOrgMember(req.user.id, team.organization_id);
  if (
    req.user.role === 'admin' ||
    isLeagueMember ||
    isTeamMember ||
    league.owner_user_id === req.user.id ||
    team.owner_user_id === req.user.id
  ) {
    req.league = league;
    req.category = category;
    req.branch = branch;
    req.team = team;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre el roster de este equipo en esta rama' });
});
