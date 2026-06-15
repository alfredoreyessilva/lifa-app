import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { categoryOwnerRequired, matchOwnerRequired, leagueOwnerRequired, teamOwnerRequired } from '../middleware/ownership.js';

const router = express.Router();

/* ===================== CATEGORÍAS ===================== */

// Editar categoría
router.put('/categories/:categoryId', authRequired, categoryOwnerRequired, (req, res) => {
  const { name, sort_order } = req.body;
  db.prepare(`
    UPDATE categories SET name = COALESCE(?, name), sort_order = COALESCE(?, sort_order) WHERE id = ?
  `).run(name, sort_order, req.category.id);
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.category.id));
});

// Eliminar categoría
router.delete('/categories/:categoryId', authRequired, categoryOwnerRequired, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.category.id);
  res.json({ ok: true });
});

/* ===================== PARTIDOS ===================== */

// Crear partido en una categoría
router.post('/categories/:categoryId/matches', authRequired, categoryOwnerRequired, (req, res) => {
  const { home_team, away_team, match_date, venue, stream_url, week_label, status } = req.body;
  if (!home_team || !away_team || !match_date) {
    return res.status(400).json({ error: 'Se requieren equipo local, visitante y fecha' });
  }

  const result = db.prepare(`
    INSERT INTO matches (category_id, home_team, away_team, match_date, venue, stream_url, week_label, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'scheduled'))
  `).run(req.category.id, home_team, away_team, match_date, venue || null, stream_url || null, week_label || null, status);

  res.status(201).json(db.prepare('SELECT * FROM matches WHERE id = ?').get(result.lastInsertRowid));
});

// Editar partido (incluye link de transmisión, marcador, status)
router.put('/matches/:id', authRequired, matchOwnerRequired, (req, res) => {
  const { home_team, away_team, match_date, venue, stream_url, week_label, status, home_score, away_score } = req.body;
  const m = req.match;

  db.prepare(`
    UPDATE matches SET
      home_team = COALESCE(?, home_team),
      away_team = COALESCE(?, away_team),
      match_date = COALESCE(?, match_date),
      venue = COALESCE(?, venue),
      stream_url = COALESCE(?, stream_url),
      week_label = COALESCE(?, week_label),
      status = COALESCE(?, status),
      home_score = COALESCE(?, home_score),
      away_score = COALESCE(?, away_score)
    WHERE id = ?
  `).run(home_team, away_team, match_date, venue, stream_url, week_label, status, home_score, away_score, m.id);

  res.json(db.prepare('SELECT * FROM matches WHERE id = ?').get(m.id));
});

// Eliminar partido
router.delete('/matches/:id', authRequired, matchOwnerRequired, (req, res) => {
  db.prepare('DELETE FROM matches WHERE id = ?').run(req.match.id);
  res.json({ ok: true });
});

/* ===================== EQUIPOS ===================== */

// Crear equipo en una liga
router.post('/leagues/:leagueId/teams', authRequired, leagueOwnerRequired, (req, res) => {
  const { name, logo_url, location, contact_email, contact_phone, facebook_url, instagram_url, twitter_url, website_url, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre del equipo es obligatorio' });

  const result = db.prepare(`
    INSERT INTO teams (league_id, name, logo_url, location, contact_email, contact_phone, facebook_url, instagram_url, twitter_url, website_url, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.league.id, name, logo_url || null, location || null, contact_email || null, contact_phone || null,
    facebook_url || null, instagram_url || null, twitter_url || null, website_url || null, sort_order || 0
  );

  res.status(201).json(db.prepare('SELECT * FROM teams WHERE id = ?').get(result.lastInsertRowid));
});

// Editar equipo
router.put('/teams/:id', authRequired, teamOwnerRequired, (req, res) => {
  const { name, logo_url, location, contact_email, contact_phone, facebook_url, instagram_url, twitter_url, website_url, sort_order } = req.body;
  const t = req.team;

  db.prepare(`
    UPDATE teams SET
      name = COALESCE(?, name),
      logo_url = COALESCE(?, logo_url),
      location = COALESCE(?, location),
      contact_email = COALESCE(?, contact_email),
      contact_phone = COALESCE(?, contact_phone),
      facebook_url = COALESCE(?, facebook_url),
      instagram_url = COALESCE(?, instagram_url),
      twitter_url = COALESCE(?, twitter_url),
      website_url = COALESCE(?, website_url),
      sort_order = COALESCE(?, sort_order)
    WHERE id = ?
  `).run(name, logo_url, location, contact_email, contact_phone, facebook_url, instagram_url, twitter_url, website_url, sort_order, t.id);

  res.json(db.prepare('SELECT * FROM teams WHERE id = ?').get(t.id));
});

// Eliminar equipo
router.delete('/teams/:id', authRequired, teamOwnerRequired, (req, res) => {
  db.prepare('DELETE FROM teams WHERE id = ?').run(req.team.id);
  res.json({ ok: true });
});

/* ===================== PANEL DE LIGA (resumen para el dueño) ===================== */

// Obtener todo lo que necesita el representante para editar su liga
router.get('/leagues/:leagueId/manage', authRequired, leagueOwnerRequired, (req, res) => {
  const league = req.league;
  const categories = db.prepare('SELECT * FROM categories WHERE league_id = ? ORDER BY sort_order ASC, name ASC').all(league.id);
  const categoriesWithMatches = categories.map(cat => ({
    ...cat,
    matches: db.prepare('SELECT * FROM matches WHERE category_id = ? ORDER BY match_date ASC').all(cat.id)
  }));
  const teams = db.prepare('SELECT * FROM teams WHERE league_id = ? ORDER BY sort_order ASC, name ASC').all(league.id);
  res.json({ league, categories: categoriesWithMatches, teams });
});

export default router;
