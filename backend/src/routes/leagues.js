import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { leagueOwnerRequired } from '../middleware/ownership.js';

const router = express.Router();

function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Listar todas las ligas aprobadas (página de inicio)
router.get('/', (req, res) => {
  const leagues = db.prepare(`
    SELECT id, name, slug, logo_url, state, description
    FROM leagues WHERE status = 'approved'
    ORDER BY name ASC
  `).all();
  res.json(leagues);
});

// Detalle de una liga + sus categorías, por slug
router.get('/:slug', (req, res) => {
  const league = db.prepare(`SELECT * FROM leagues WHERE slug = ? AND status = 'approved'`).get(req.params.slug);
  if (!league) return res.status(404).json({ error: 'Liga no encontrada' });

  const categories = db.prepare(`
    SELECT id, name, sort_order FROM categories WHERE league_id = ? ORDER BY sort_order ASC, name ASC
  `).all(league.id);

  res.json({ ...league, categories });
});

// Equipos de una liga (público)
router.get('/:slug/teams', (req, res) => {
  const league = db.prepare(`SELECT * FROM leagues WHERE slug = ? AND status = 'approved'`).get(req.params.slug);
  if (!league) return res.status(404).json({ error: 'Liga no encontrada' });

  const teams = db.prepare(`
    SELECT id, name, logo_url, location, contact_email, contact_phone, facebook_url, instagram_url, twitter_url, website_url
    FROM teams WHERE league_id = ? ORDER BY sort_order ASC, name ASC
  `).all(league.id);

  res.json(teams);
});


// Calendario de una categoría (público)
router.get('/categories/:categoryId/matches', (req, res) => {
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.categoryId);
  if (!category) return res.status(404).json({ error: 'Categoría no encontrada' });

  const matches = db.prepare(`
    SELECT * FROM matches WHERE category_id = ? ORDER BY match_date ASC
  `).all(category.id);

  res.json({ category, matches });
});

// --- Registro de nueva liga (requiere cuenta de representante) ---
router.post('/', authRequired, (req, res) => {
  const { name, logo_url, state, description } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre de la liga es obligatorio' });

  let slug = slugify(name);
  const existing = db.prepare('SELECT id FROM leagues WHERE slug = ?').get(slug);
  if (existing) slug = `${slug}-${Date.now().toString().slice(-5)}`;

  const result = db.prepare(`
    INSERT INTO leagues (name, slug, logo_url, state, description, owner_user_id, status)
    VALUES (?, ?, ?, ?, ?, ?, 'approved')
  `).run(name, slug, logo_url || null, state || null, description || null, req.user.id);

  const league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(league);
});

// --- Edición de liga (solo dueño/admin) ---
router.put('/:id', authRequired, leagueOwnerRequired, (req, res) => {
  const { name, logo_url, state, description } = req.body;
  const league = req.league;

  db.prepare(`
    UPDATE leagues SET
      name = COALESCE(?, name),
      logo_url = COALESCE(?, logo_url),
      state = COALESCE(?, state),
      description = COALESCE(?, description)
    WHERE id = ?
  `).run(name, logo_url, state, description, league.id);

  res.json(db.prepare('SELECT * FROM leagues WHERE id = ?').get(league.id));
});

// --- Categorías ---

// Crear categoría
router.post('/:leagueId/categories', authRequired, leagueOwnerRequired, (req, res) => {
  const { name, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre de la categoría es obligatorio' });

  const result = db.prepare(`
    INSERT INTO categories (league_id, name, sort_order) VALUES (?, ?, ?)
  `).run(req.league.id, name, sort_order || 0);

  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid));
});

export default router;
