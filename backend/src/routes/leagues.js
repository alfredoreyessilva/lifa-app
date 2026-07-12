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

// Detalle de un solo partido (usado para el link "compartir partido").
// Se registra con path literal "matches" en el primer segmento, así que
// nunca choca con la ruta "/:slug" (que es de un solo segmento) ni con
// "/:slug/teams" (cuyo segundo segmento siempre es la palabra "teams").
router.get('/matches/:matchId', asyncHandler(async (req, res) => {
  const match = await db.prepare(`
    SELECT
      m.*,
      c.name    AS category_name,
      c.season  AS season,
      c.year    AS year,
      l.id      AS league_id,
      l.name    AS league_name,
      l.slug    AS league_slug,
      l.logo_url AS league_logo_url,
      l.timezone AS league_timezone,
      th.logo_url AS home_logo_url,
      ta.logo_url AS away_logo_url
    FROM matches m
    LEFT JOIN categories c ON c.id = m.category_id
    LEFT JOIN leagues l    ON l.id = c.league_id
    LEFT JOIN teams th     ON th.league_id = l.id AND UPPER(th.name) = UPPER(m.home_team)
    LEFT JOIN teams ta     ON ta.league_id = l.id AND UPPER(ta.name) = UPPER(m.away_team)
    WHERE m.id = ?
  `).get(req.params.matchId);

  if (!match) return res.status(404).json({ error: 'Partido no encontrado' });

  res.json(match);
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

  const teams = await db.prepare(`
    SELECT id, name, logo_url
    FROM teams WHERE league_id = ?
    ORDER BY sort_order ASC, name ASC
  `).all(league.id);

  res.json({ ...league, categories, teams });
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

// Metadatos ligeros para compartir el calendario de una categoría (usado por el
// middleware de Vercel para armar los meta tags Open Graph al compartir un link).
// Si se pasa ?team=Nombre, además devuelve el logo de ese equipo específico.
router.get('/categories/:categoryId/share-meta', asyncHandler(async (req, res) => {
  const category = await db.prepare(`
    SELECT c.*, l.name AS league_name, l.slug AS league_slug,
           l.logo_url AS league_logo_url, l.id AS league_id
    FROM categories c
    JOIN leagues l ON l.id = c.league_id
    WHERE c.id = ?
  `).get(req.params.categoryId);

  if (!category) return res.status(404).json({ error: 'Categoría no encontrada' });

  let team_logo_url = null;
  const teamName = req.query.team;
  if (teamName) {
    const team = await db.prepare(`
      SELECT logo_url FROM teams WHERE league_id = ? AND UPPER(name) = UPPER(?)
    `).get(category.league_id, teamName);
    team_logo_url = team?.logo_url || null;
  }

  res.json({
    league_name: category.league_name,
    league_slug: category.league_slug,
    league_logo_url: category.league_logo_url,
    category_name: category.name,
    team_name: teamName || null,
    team_logo_url,
  });
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
  const {
    name, logo_url, cover_url, state, description, timezone,
    facebook_url, instagram_url, twitter_url, youtube_url,
    tiktok_url, website_url, whatsapp,
  } = req.body;

  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre de la liga es obligatorio' });
  if (logo_url     && !isValidUrl(logo_url))     return res.status(400).json({ error: 'El logo no es una dirección web válida' });
  if (cover_url    && !isValidUrl(cover_url))    return res.status(400).json({ error: 'La portada no es una dirección web válida' });
  if (facebook_url && !isValidUrl(facebook_url)) return res.status(400).json({ error: 'El enlace de Facebook no es válido' });
  if (instagram_url && !isValidUrl(instagram_url)) return res.status(400).json({ error: 'El enlace de Instagram no es válido' });
  if (twitter_url  && !isValidUrl(twitter_url))  return res.status(400).json({ error: 'El enlace de X/Twitter no es válido' });
  if (youtube_url  && !isValidUrl(youtube_url))  return res.status(400).json({ error: 'El enlace de YouTube no es válido' });
  if (tiktok_url   && !isValidUrl(tiktok_url))   return res.status(400).json({ error: 'El enlace de TikTok no es válido' });
  if (website_url  && !isValidUrl(website_url))  return res.status(400).json({ error: 'El sitio web no es válido' });
  if (timezone     && !isValidTimezone(timezone)) return res.status(400).json({ error: 'La zona horaria seleccionada no es válida' });

  let slug = slugify(name);
  const existing = await db.prepare('SELECT id FROM leagues WHERE slug = ?').get(slug);
  if (existing) slug = `${slug}-${Date.now().toString().slice(-5)}`;

  const result = await db.prepare(`
    INSERT INTO leagues (name, slug, logo_url, cover_url, state, description, owner_user_id, status, timezone,
      facebook_url, instagram_url, twitter_url, youtube_url, tiktok_url, website_url, whatsapp)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name.trim(), slug, logo_url || null, cover_url || null,
    state || null, description || null, req.user.id,
    timezone || 'America/Mexico_City',
    facebook_url || null, instagram_url || null, twitter_url || null,
    youtube_url || null, tiktok_url || null, website_url || null, whatsapp || null
  );

  res.status(201).json(await db.prepare('SELECT * FROM leagues WHERE id = ?').get(result.lastInsertRowid));
}));

function toNull(value) {
  return value === undefined ? null : value;
}

router.put('/:id', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const {
    name, logo_url, cover_url, state, description, timezone,
    facebook_url, instagram_url, twitter_url, youtube_url,
    tiktok_url, website_url, whatsapp,
  } = req.body;
  const league = req.league;

  if (logo_url      && !isValidUrl(logo_url))      return res.status(400).json({ error: 'El logo no es una dirección web válida' });
  if (cover_url     && !isValidUrl(cover_url))     return res.status(400).json({ error: 'La portada no es una dirección web válida' });
  if (name !== undefined && !isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre de la liga no puede estar vacío' });
  if (timezone      && !isValidTimezone(timezone)) return res.status(400).json({ error: 'La zona horaria seleccionada no es válida' });
  if (facebook_url  && !isValidUrl(facebook_url))  return res.status(400).json({ error: 'El enlace de Facebook no es válido' });
  if (instagram_url && !isValidUrl(instagram_url)) return res.status(400).json({ error: 'El enlace de Instagram no es válido' });
  if (twitter_url   && !isValidUrl(twitter_url))   return res.status(400).json({ error: 'El enlace de X/Twitter no es válido' });
  if (youtube_url   && !isValidUrl(youtube_url))   return res.status(400).json({ error: 'El enlace de YouTube no es válido' });
  if (tiktok_url    && !isValidUrl(tiktok_url))    return res.status(400).json({ error: 'El enlace de TikTok no es válido' });
  if (website_url   && !isValidUrl(website_url))   return res.status(400).json({ error: 'El sitio web no es válido' });

  await db.prepare(`
    UPDATE leagues SET
      name          = COALESCE(?, name),
      logo_url      = COALESCE(?, logo_url),
      cover_url     = COALESCE(?, cover_url),
      state         = COALESCE(?, state),
      description   = COALESCE(?, description),
      timezone      = COALESCE(?, timezone),
      facebook_url  = COALESCE(?, facebook_url),
      instagram_url = COALESCE(?, instagram_url),
      twitter_url   = COALESCE(?, twitter_url),
      youtube_url   = COALESCE(?, youtube_url),
      tiktok_url    = COALESCE(?, tiktok_url),
      website_url   = COALESCE(?, website_url),
      whatsapp      = COALESCE(?, whatsapp)
    WHERE id = ?
  `).run(
    toNull(name ? name.trim() : name),
    toNull(logo_url), toNull(cover_url),
    toNull(state), toNull(description), toNull(timezone),
    toNull(facebook_url), toNull(instagram_url), toNull(twitter_url),
    toNull(youtube_url), toNull(tiktok_url), toNull(website_url),
    toNull(whatsapp), league.id
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