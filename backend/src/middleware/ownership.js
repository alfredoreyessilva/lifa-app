import db from '../config/db.js';

// Verifica que req.user sea owner de la liga indicada en params.leagueId (o admin)
export function leagueOwnerRequired(req, res, next) {
  const leagueId = Number(req.params.leagueId || req.params.id);
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId);
  if (!league) return res.status(404).json({ error: 'Liga no encontrada' });

  if (req.user.role === 'admin' || league.owner_user_id === req.user.id) {
    req.league = league;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre esta liga' });
}

// Para rutas que reciben category_id / match_id, resuelve la liga dueña y verifica
export function categoryOwnerRequired(req, res, next) {
  const categoryId = Number(req.params.categoryId);
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
  if (!category) return res.status(404).json({ error: 'Categoría no encontrada' });
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(category.league_id);

  if (req.user.role === 'admin' || league.owner_user_id === req.user.id) {
    req.league = league;
    req.category = category;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre esta categoría' });
}

export function matchOwnerRequired(req, res, next) {
  const matchId = Number(req.params.id);
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Partido no encontrado' });
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(match.category_id);
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(category.league_id);

  if (req.user.role === 'admin' || league.owner_user_id === req.user.id) {
    req.league = league;
    req.category = category;
    req.match = match;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre este partido' });
}

export function teamOwnerRequired(req, res, next) {
  const teamId = Number(req.params.id);
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  if (!team) return res.status(404).json({ error: 'Equipo no encontrado' });
  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(team.league_id);

  if (req.user.role === 'admin' || league.owner_user_id === req.user.id) {
    req.league = league;
    req.team = team;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre este equipo' });
}
