import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { leagueOwnerRequired } from '../middleware/ownership.js';
import { isValidUrl, isNonEmptyString } from '../utils/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

router.get('/', asyncHandler(async (req, res) => {
  const leagues = await db.prepare(`
    SELECT id, name, slug, logo_url, state, description
    FROM leagues WHERE status = 'approved'
    ORDER BY name ASC
  `).all();
  res.json(leagues);
}));

router.get('/:slug', asyncHandler(async (req, res) => {
  const league = await db.prepare(`SELECT * FROM leagues WHERE slug = ? AND status = 'approved'`).get(req.params.slug);
  if (!league) return res.status(404).json({ error: 'Liga no encontrada' });
  const categories = await db.prepare(`
    SELECT id, name, sort_order FROM categories WHERE league_id = ? ORDER BY sort_order ASC, name ASC
  `).all(league.id);
  res.json({ ...league, categories });
}));

router.get('/:slug/teams', asyncHandler(async (req, res) => {
  const league = await db.prepare(`SELECT * FROM leagues WHERE slug = ? AND status = 'approved'`).get(req.params.slug);
  if (!league) return res.status(404).json({ error: 'Liga no encontrada' });
  const teams = await db.prepare(`
    SELECT id, name, logo_url, location, contact_email, contact_phone, facebook_url, instagram_url, twitter_url, website_url
    FROM teams WHERE league_id = ? ORDER BY sort_order ASC, name ASC
  `).all(league.id);
  res.json(teams);
}));

router.get('/categories/:categoryId/matches', asyncHandler(async (req, res) => {
  const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.categoryId);
  if (!category) return res.status(404).json({ error: 'Categoría no encontrada' });
  const matches = await db.prepare(`
    SELECT * FROM matches WHERE category_id = ? ORDER BY match_date ASC
  `).all(category.id);
  res.json({ category, matches });
}));

router.post('/', authRequired, asyncHandler(async (req, res) => {
  const { name, logo_url, state, description } = req.body;
  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre de la liga es obligatorio' });
  if (logo_url && !isValidUrl(logo_url)) return res.status(400).json({ error: 'El logo no es una dirección web válida' });

  let slug = slugify(name);
  const existing = await db.prepare('SELECT id FROM leagues WHERE slug = ?').get(slug);
  if (existing) slug = `${slug}-${Date.now().toString().slice(-5)}`;

  const result = await db.prepare(`
    INSERT INTO leagues (name, slug, logo_url, state, description, owner_user_id, status)
    VALUES (?, ?, ?, ?, ?, ?, 'approved')
  `).run(name.trim(), slug, logo_url || null, state || null, description || null, req.user.id);

  res.status(201).json(await db.prepare('SELECT * FROM leagues WHERE id = ?').get(result.lastInsertRowid));
}));

function toNull(value) {
  return value === undefined ? null : value;
}

router.put('/:id', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const { name, logo_url, state, description } = req.body;
  const league = req.league;

  if (logo_url && !isValidUrl(logo_url)) return res.status(400).json({ error: 'El logo no es una dirección web válida' });
  if (name !== undefined && !isNonEmptyString(name)) {
    return res.status(400).json({ error: 'El nombre de la liga no puede estar vacío' });
  }

  await db.prepare(`
    UPDATE leagues SET
      name = COALESCE(?, name),
      logo_url = COALESCE(?, logo_url),
      state = COALESCE(?, state),
      description = COALESCE(?, description)
    WHERE id = ?
  `).run(toNull(name ? name.trim() : name), toNull(logo_url), toNull(state), toNull(description), league.id);

  res.json(await db.prepare('SELECT * FROM leagues WHERE id = ?').get(league.id));
}));

router.post('/:leagueId/categories', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const { name, sort_order } = req.body;
  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre de la categoría es obligatorio' });

  const result = await db.prepare(`
    INSERT INTO categories (league_id, name, sort_order) VALUES (?, ?, ?)
  `).run(req.league.id, name.trim(), sort_order || 0);

  res.status(201).json(await db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid));
}));

export default router;