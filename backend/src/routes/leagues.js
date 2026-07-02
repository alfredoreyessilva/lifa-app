import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { leagueOwnerRequired } from '../middleware/ownership.js';
import { isValidUrl, isNonEmptyString } from '../utils/validation.js';
import { isValidTimezone } from '../utils/timezones.js';
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
  const league = await db.prepare(`
    SELECT * FROM leagues WHERE slug = ? AND status = 'approved'
  `).get(req.params.slug);
  if (!league) return res.status(404).json({ error: 'Liga no encontrada' });

  const categories = await db.prepare(`
    SELECT id, name, season, year, sort_order
    FROM categories WHERE league_id = ?
    ORDER BY sort_order ASC, name ASC
  `).all(league.id);

  res.json({ ...league, categories });
}));

router.get('/:slug/teams', asyncHandler(async (req, res) => {
  const league = await db.prepare(`
    SELECT * FROM leagues WHERE slug = ? AND status = 'approved'
  `).get(req.params.slug);
  if (!league) return res.status(404).json({ error: 'Liga no encontrada' });

  const teams = await db.prepare(`
    SELECT id, name, logo_url, cover_url, location, contact_email, contact_phone,
           facebook_url, instagram_url, twitter_url, website_url
    FROM teams WHERE league_id = ?
    ORDER BY sort_order ASC, name ASC
  `).all(league.id);

  res.json(teams);
}));

router.get('/categories/:categoryId/matches', asyncHandler(async (req, res) => {
  const category = await db.prepare(`
    SELECT * FROM categories WHERE id = ?
  `).get(req.params.categoryId);
  if (!category) return res.status(404).json({ error: 'Categoría no encontrada' });

  const matches = await db.prepare(`
    SELECT
      m.*,
      th.logo_url AS home_logo_url,
      ta.logo_url AS away_logo_url
    FROM matches m
    LEFT JOIN categories c  ON c.id  = m.category_id
    LEFT JOIN teams th      ON th.league_id = c.league_id
                           AND UPPER(th.name) = UPPER(m.home_team)
    LEFT JOIN teams ta      ON ta.league_id = c.league_id
                           AND UPPER(ta.name) = UPPER(m.away_team)
    WHERE m.category_id = ?
    ORDER BY m.match_date ASC
  `).all(category.id);

  res.json({ category, matches });
}));

router.post('/', authRequired, asyncHandler(async (req, res) => {
  const { name, logo_url, state, description, timezone } = req.body;
  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre de la liga es obligatorio' });
  if (logo_url && !isValidUrl(logo_url)) return res.status(400).json({ error: 'El logo no es una dirección web válida' });
  if (timezone && !isValidTimezone(timezone)) return res.status(400).json({ error: 'La zona horaria seleccionada no es válida' });

  let slug = slugify(name);
  const existing = await db.prepare('SELECT id FROM leagues WHERE slug = ?').get(slug);
  if (existing) slug = `${slug}-${Date.now().toString().slice(-5)}`;

  const result = await db.prepare(`
    INSERT INTO leagues (name, slug, logo_url, state, description, owner_user_id, status, timezone)
    VALUES (?, ?, ?, ?, ?, ?, 'approved', ?)
  `).run(
    name.trim(), slug, logo_url || null, state || null,
    description || null, req.user.id, timezone || 'America/Mexico_City'
  );

  res.status(201).json(await db.prepare('SELECT * FROM leagues WHERE id = ?').get(result.lastInsertRowid));
}));

function toNull(value) {
  return value === undefined ? null : value;
}

router.put('/:id', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const { name, logo_url, state, description, timezone } = req.body;
  const league = req.league;

  if (logo_url && !isValidUrl(logo_url)) return res.status(400).json({ error: 'El logo no es una dirección web válida' });
  if (name !== undefined && !isNonEmptyString(name)) {
    return res.status(400).json({ error: 'El nombre de la liga no puede estar vacío' });
  }
  if (timezone && !isValidTimezone(timezone)) {
    return res.status(400).json({ error: 'La zona horaria seleccionada no es válida' });
  }

  await db.prepare(`
    UPDATE leagues SET
      name        = COALESCE(?, name),
      logo_url    = COALESCE(?, logo_url),
      state       = COALESCE(?, state),
      description = COALESCE(?, description),
      timezone    = COALESCE(?, timezone)
    WHERE id = ?
  `).run(
    toNull(name ? name.trim() : name),
    toNull(logo_url),
    toNull(state),
    toNull(description),
    toNull(timezone),
    league.id
  );

  res.json(await db.prepare('SELECT * FROM leagues WHERE id = ?').get(league.id));
}));

router.post('/:leagueId/categories', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const { name, sort_order, season, year } = req.body;
  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre de la categoría es obligatorio' });

  const result = await db.prepare(`
    INSERT INTO categories (league_id, name, sort_order, season, year)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    req.league.id,
    name.trim().toUpperCase(),
    sort_order || 0,
    season ? season.trim().toUpperCase() : null,
    year ? parseInt(year) : null
  );

  res.status(201).json(await db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid));
}));

export default router;