import db from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const leagueOwnerRequired = asyncHandler(async (req, res, next) => {
  const leagueId = Number(req.params.leagueId || req.params.id);
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId);
  if (!league) return res.status(404).json({ error: 'Liga no encontrada' });
  if (req.user.role === 'admin' || league.owner_user_id === req.user.id) {
    req.league = league;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre esta liga' });
});

export const categoryOwnerRequired = asyncHandler(async (req, res, next) => {
  const categoryId = Number(req.params.categoryId);
  const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
  if (!category) return res.status(404).json({ error: 'Categoría no encontrada' });
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(category.league_id);
  if (req.user.role === 'admin' || league.owner_user_id === req.user.id) {
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
  if (req.user.role === 'admin' || league.owner_user_id === req.user.id) {
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
  if (req.user.role === 'admin' || league.owner_user_id === req.user.id) {
    req.league = league;
    req.team = team;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre este equipo' });
});