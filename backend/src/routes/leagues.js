import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { leagueOwnerRequired, tournamentOwnerRequired } from '../middleware/ownership.js';
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
    FROM leagues WHERE is_public = TRUE
    ORDER BY name ASC
  `).all();
  res.json(leagues);
}));

// Todo lo necesario para armar el sitemap.xml: solo de ligas públicas, y
// solo categorías/partidos que de verdad tienen contenido publicado (nada
// de calendarios vacíos ni partidos en borrador). Lo consume
// frontend/api/sitemap.js (función serverless de Vercel), no el frontend
// normal — por eso no necesita paginación ni filtros, siempre es todo.
router.get('/sitemap-data', asyncHandler(async (req, res) => {
  const [leagueSlugs, tournamentIds, categoryIds, matches] = await Promise.all([
    db.prepare(`SELECT slug FROM leagues WHERE is_public = TRUE`).all(),
    db.prepare(`
      SELECT t.id FROM tournaments t
      JOIN leagues l ON l.id = t.league_id
      WHERE l.is_public = TRUE
    `).all(),
    db.prepare(`
      SELECT DISTINCT c.id FROM categories c
      JOIN leagues l ON l.id = c.league_id
      JOIN matches m ON m.category_id = c.id AND m.is_draft = FALSE
      WHERE l.is_public = TRUE
    `).all(),
    db.prepare(`
      SELECT m.id, m.match_date FROM matches m
      JOIN categories c ON c.id = m.category_id
      JOIN leagues l ON l.id = c.league_id
      WHERE l.is_public = TRUE AND m.is_draft = FALSE
    `).all(),
  ]);

  res.json({
    leagueSlugs:   leagueSlugs.map((r) => r.slug),
    tournamentIds: tournamentIds.map((r) => r.id),
    categoryIds:   categoryIds.map((r) => r.id),
    matches:       matches.map((r) => ({ id: r.id, matchDate: r.match_date })),
  });
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
      c.auto_status_enabled      AS auto_status_enabled,
      c.auto_status_window_hours AS auto_status_window_hours,
      l.id      AS league_id,
      l.name    AS league_name,
      l.slug    AS league_slug,
      l.logo_url AS league_logo_url,
      l.timezone AS league_timezone,
      th.logo_url AS home_logo_url,
      COALESCE(ta.away_logo_url, ta.logo_url) AS away_logo_url,
      v.name        AS venue_name,
      v.institution AS venue_institution,
      v.address     AS venue_address,
      g.name        AS group_name,
      g2.name       AS group_name_2
    FROM matches m
    LEFT JOIN categories c ON c.id = m.category_id
    LEFT JOIN leagues l    ON l.id = c.league_id
    LEFT JOIN teams th     ON th.league_id = l.id AND UPPER(th.name) = UPPER(m.home_team)
    LEFT JOIN teams ta     ON ta.league_id = l.id AND UPPER(ta.name) = UPPER(m.away_team)
    LEFT JOIN venues v     ON v.id = m.venue_id
    LEFT JOIN groups g     ON g.id = m.group_id
    LEFT JOIN groups g2    ON g2.id = m.group_id_2
    WHERE m.id = ? AND m.is_draft = FALSE
  `).get(req.params.matchId);

  if (!match) return res.status(404).json({ error: 'Partido no encontrado' });

  res.json(match);
}));

// Todos los equipos que son miembro del roster (league_teams) de AL MENOS
// una liga publicada — para la sección "Equipos" de la página de inicio.
// Un mismo equipo puede estar en el roster de varias ligas; se muestra una
// sola vez (DISTINCT ON), usando la liga pública más antigua como contexto
// para el botón de "Notificarme" de su ficha.
router.get('/all-teams', asyncHandler(async (req, res) => {
  const teams = await db.prepare(`
    SELECT DISTINCT ON (t.id)
      t.id, t.name, t.logo_url, t.cover_url, t.location, t.contact_email, t.contact_phone,
      t.facebook_url, t.instagram_url, t.twitter_url, t.website_url,
      l.id AS league_id
    FROM teams t
    JOIN league_teams lt ON lt.team_id = t.id
    JOIN leagues l        ON l.id = lt.league_id AND l.is_public = TRUE
    ORDER BY t.id, l.id ASC
  `).all();
  res.json(teams);
}));

router.get('/:slug', asyncHandler(async (req, res) => {
  const league = await db.prepare(`
    SELECT * FROM leagues WHERE slug = ? AND is_public = TRUE
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

  // Torneos públicos de la liga, del más antiguo al más reciente. No hay
  // bandera de "torneo borrador": un torneo es visible en cuanto existe,
  // solo los PARTIDOS se ocultan individualmente con is_draft.
  const tournaments = await db.prepare(`
    SELECT id, name, year, logo_url
    FROM tournaments WHERE league_id = ?
    ORDER BY year ASC, sort_order ASC, id ASC
  `).all(league.id);

  res.json({ ...league, categories, teams, tournaments });
}));

router.get('/:slug/teams', asyncHandler(async (req, res) => {
  const league = await db.prepare(`
    SELECT * FROM leagues WHERE slug = ? AND is_public = TRUE
  `).get(req.params.slug);
  if (!league) return res.status(404).json({ error: 'Liga no encontrada' });

  // Equipos "de la casa" de la liga = los que están en su roster
  // (league_teams), no los que tienen teams.league_id apuntando aquí
  // (ese es el modelo viejo, y un equipo puede ser miembro de varias
  // ligas a la vez con el modelo nuevo).
  const teams = await db.prepare(`
    SELECT t.id, t.name, t.logo_url, t.cover_url, t.location, t.contact_email, t.contact_phone,
           t.facebook_url, t.instagram_url, t.twitter_url, t.website_url
    FROM league_teams lt
    JOIN teams t ON t.id = lt.team_id
    WHERE lt.league_id = ?
    ORDER BY t.sort_order ASC, t.name ASC
  `).all(league.id);

  res.json(teams);
}));

router.get('/:slug/venues', asyncHandler(async (req, res) => {
  const league = await db.prepare(`
    SELECT * FROM leagues WHERE slug = ? AND is_public = TRUE
  `).get(req.params.slug);
  if (!league) return res.status(404).json({ error: 'Liga no encontrada' });

  const venues = await db.prepare(`
    SELECT id, name, institution, cover_url, address, contact_phone, contact_email
    FROM venues WHERE league_id = ?
    ORDER BY sort_order ASC, name ASC
  `).all(league.id);

  res.json(venues);
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
      c.auto_status_enabled      AS auto_status_enabled,
      c.auto_status_window_hours AS auto_status_window_hours,
      th.logo_url AS home_logo_url,
      COALESCE(ta.away_logo_url, ta.logo_url) AS away_logo_url,
      v.name        AS venue_name,
      v.institution AS venue_institution,
      v.address     AS venue_address,
      g.name        AS group_name,
      g2.name       AS group_name_2
    FROM matches m
    LEFT JOIN categories c  ON c.id  = m.category_id
    LEFT JOIN teams th      ON th.league_id = c.league_id
                           AND UPPER(th.name) = UPPER(m.home_team)
    LEFT JOIN teams ta      ON ta.league_id = c.league_id
                           AND UPPER(ta.name) = UPPER(m.away_team)
    LEFT JOIN venues v      ON v.id = m.venue_id
    LEFT JOIN groups g      ON g.id = m.group_id
    LEFT JOIN groups g2     ON g2.id = m.group_id_2
    WHERE m.category_id = ? AND m.is_draft = FALSE
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
    INSERT INTO leagues (name, slug, logo_url, cover_url, state, description, owner_user_id, timezone,
      facebook_url, instagram_url, twitter_url, youtube_url, tiktok_url, website_url, whatsapp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

// El dueño de la liga solicita aparecer en el panel público. Es solo una señal
// para el admin ("quiero promoción") — nunca publica la liga por sí sola.
router.put('/:id/request-publish', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('UPDATE leagues SET publish_requested = TRUE WHERE id = ?').run(req.league.id);
  res.json(await db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.league.id));
}));

// El dueño se arrepiente antes de que el admin la atienda.
router.put('/:id/cancel-request', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('UPDATE leagues SET publish_requested = FALSE WHERE id = ?').run(req.league.id);
  res.json(await db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.league.id));
}));

// El dueño puede ocultar su propia liga en cualquier momento, sin pedirle
// permiso a nadie. Al ocultarla, se resetea también la solicitud: si más
// adelante la quiere pública de nuevo, tiene que volver a pedirlo.
router.put('/:id/unpublish', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('UPDATE leagues SET is_public = FALSE, publish_requested = FALSE WHERE id = ?').run(req.league.id);
  res.json(await db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.league.id));
}));

router.post('/:leagueId/categories', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const { name, sort_order, season, year, auto_status_enabled, auto_status_window_hours } = req.body;
  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre de la categoría es obligatorio' });

  const result = await db.prepare(`
    INSERT INTO categories (league_id, name, sort_order, season, year, auto_status_enabled, auto_status_window_hours)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.league.id,
    name.trim().toUpperCase(),
    sort_order || 0,
    season ? season.trim().toUpperCase() : null,
    year ? parseInt(year) : null,
    auto_status_enabled ? true : false,
    auto_status_enabled ? parseInt(auto_status_window_hours) : null
  );

  res.status(201).json(await db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid));
}));

// Crea un torneo dentro de una liga. El año llega ya elegido desde la
// pantalla de selección de año (no se vuelve a pedir aquí, ver TournamentForm.jsx).
router.post('/:leagueId/tournaments', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const { name, year, logo_url, sort_order } = req.body;
  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre del torneo es obligatorio' });
  if (!year || isNaN(Number(year))) return res.status(400).json({ error: 'El año del torneo es obligatorio' });

  const result = await db.prepare(`
    INSERT INTO tournaments (league_id, name, year, logo_url, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    req.league.id,
    name.trim(),
    parseInt(year),
    logo_url ? logo_url.trim() : null,
    sort_order || 0
  );

  res.status(201).json(await db.prepare('SELECT * FROM tournaments WHERE id = ?').get(result.lastInsertRowid));
}));

// Lista los torneos de una liga. Si se manda ?year=2026, solo los de ese año
// (así es como se va a usar desde la pantalla "Año -> Torneos de ese año").
router.get('/:leagueId/tournaments', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const { year } = req.query;

  const tournaments = year
    ? await db.prepare(`
        SELECT * FROM tournaments WHERE league_id = ? AND year = ?
        ORDER BY sort_order ASC, name ASC
      `).all(req.league.id, parseInt(year))
    : await db.prepare(`
        SELECT * FROM tournaments WHERE league_id = ?
        ORDER BY year DESC, sort_order ASC, name ASC
      `).all(req.league.id);

  res.json(tournaments);
}));

// --- Pruebas de la nueva jerarquía (Torneo -> Categoría) ---
// Estas dos rutas son análogas a "categorías bajo liga", pero cuelgan de
// tournament_id. Todavía no las usa ninguna pantalla real, solo pantallas
// de prueba, mientras se termina de construir el modelo nuevo.

router.post('/tournaments/:tournamentId/categories', authRequired, tournamentOwnerRequired, asyncHandler(async (req, res) => {
  const { name, sort_order, auto_status_enabled, auto_status_window_hours } = req.body;
  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre de la categoría es obligatorio' });

  const result = await db.prepare(`
    INSERT INTO categories (league_id, tournament_id, name, sort_order, auto_status_enabled, auto_status_window_hours)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    req.tournament.league_id,
    req.tournament.id,
    name.trim().toUpperCase(),
    sort_order || 0,
    auto_status_enabled ? true : false,
    auto_status_enabled ? parseInt(auto_status_window_hours) : null
  );

  res.status(201).json(await db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid));
}));

router.get('/tournaments/:tournamentId/categories', authRequired, tournamentOwnerRequired, asyncHandler(async (req, res) => {
  const categories = await db.prepare(`
    SELECT * FROM categories WHERE tournament_id = ?
    ORDER BY sort_order ASC, name ASC
  `).all(req.tournament.id);
  res.json(categories);
}));

// --- Inscripción: qué Equipos participan en un Torneo ---
// A propósito, un equipo puede venir de CUALQUIER liga, no solo la dueña
// del torneo — por eso el equipo se busca aparte (ver /manage/teams/search)
// y aquí solo se guarda la conexión equipo↔torneo.

router.get('/tournaments/:tournamentId/teams', authRequired, tournamentOwnerRequired, asyncHandler(async (req, res) => {
  const teams = await db.prepare(`
    SELECT t.*, tt.id AS inscription_id, tt.created_at AS inscribed_at, l.name AS home_league_name
    FROM tournament_teams tt
    JOIN teams t ON t.id = tt.team_id
    LEFT JOIN leagues l ON l.id = t.league_id
    WHERE tt.tournament_id = ?
    ORDER BY t.name ASC
  `).all(req.tournament.id);
  res.json(teams);
}));

router.post('/tournaments/:tournamentId/teams', authRequired, tournamentOwnerRequired, asyncHandler(async (req, res) => {
  const { team_id } = req.body;
  if (!team_id) return res.status(400).json({ error: 'Falta el equipo a inscribir' });

  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(team_id);
  if (!team) return res.status(404).json({ error: 'Ese equipo no existe' });

  const existing = await db.prepare(
    'SELECT * FROM tournament_teams WHERE tournament_id = ? AND team_id = ?'
  ).get(req.tournament.id, team_id);
  if (existing) return res.status(400).json({ error: 'Ese equipo ya está inscrito en este torneo' });

  await db.prepare(
    'INSERT INTO tournament_teams (tournament_id, team_id) VALUES (?, ?)'
  ).run(req.tournament.id, team_id);

  // Reconciliación: partidos de ESTE torneo ya guardados con el nombre de
  // este equipo en texto, pero sin enlace real (porque el equipo aún no
  // estaba inscrito cuando se crearon) — se conectan aquí de una vez, para
  // siempre, en vez de depender de una búsqueda por texto en cada carga.
  await db.prepare(`
    UPDATE matches SET home_team_id = ?
    WHERE home_team_id IS NULL AND UPPER(home_team) = UPPER(?)
      AND category_id IN (SELECT id FROM categories WHERE tournament_id = ?)
  `).run(team.id, team.name, req.tournament.id);
  await db.prepare(`
    UPDATE matches SET away_team_id = ?
    WHERE away_team_id IS NULL AND UPPER(away_team) = UPPER(?)
      AND category_id IN (SELECT id FROM categories WHERE tournament_id = ?)
  `).run(team.id, team.name, req.tournament.id);

  res.status(201).json(team);
}));

router.delete('/tournaments/:tournamentId/teams/:teamId', authRequired, tournamentOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare(
    'DELETE FROM tournament_teams WHERE tournament_id = ? AND team_id = ?'
  ).run(req.tournament.id, req.params.teamId);
  res.json({ ok: true });
}));

// --- Membresía: qué Equipos son "de la casa" de una Liga ---
// A diferencia de la inscripción a un torneo, ser miembro de la liga hace
// al equipo elegible automáticamente para CUALQUIER torneo de esa liga,
// presente o futuro (ver resolveTeamId en manage.js) — no requiere
// inscripción aparte ni confirmación del equipo.

router.get('/:leagueId/roster', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const teams = await db.prepare(`
    SELECT t.*, lt.id AS membership_id, lt.created_at AS member_since, l.name AS home_league_name
    FROM league_teams lt
    JOIN teams t ON t.id = lt.team_id
    LEFT JOIN leagues l ON l.id = t.league_id
    WHERE lt.league_id = ?
    ORDER BY t.name ASC
  `).all(req.league.id);
  res.json(teams);
}));

router.post('/:leagueId/roster', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const { team_id } = req.body;
  if (!team_id) return res.status(400).json({ error: 'Falta el equipo a agregar' });

  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(team_id);
  if (!team) return res.status(404).json({ error: 'Ese equipo no existe' });

  const existing = await db.prepare(
    'SELECT * FROM league_teams WHERE league_id = ? AND team_id = ?'
  ).get(req.league.id, team_id);
  if (existing) return res.status(400).json({ error: 'Ese equipo ya es miembro de esta liga' });

  await db.prepare(
    'INSERT INTO league_teams (league_id, team_id) VALUES (?, ?)'
  ).run(req.league.id, team_id);

  // Reconciliación: partidos de CUALQUIER torneo de esta liga ya guardados
  // con el nombre de este equipo en texto, pero sin enlace real (porque el
  // equipo aún no era miembro del roster cuando se crearon) — se conectan
  // aquí de una vez, para siempre.
  await db.prepare(`
    UPDATE matches SET home_team_id = ?
    WHERE home_team_id IS NULL AND UPPER(home_team) = UPPER(?)
      AND category_id IN (
        SELECT id FROM categories WHERE tournament_id IN (
          SELECT id FROM tournaments WHERE league_id = ?
        )
      )
  `).run(team.id, team.name, req.league.id);
  await db.prepare(`
    UPDATE matches SET away_team_id = ?
    WHERE away_team_id IS NULL AND UPPER(away_team) = UPPER(?)
      AND category_id IN (
        SELECT id FROM categories WHERE tournament_id IN (
          SELECT id FROM tournaments WHERE league_id = ?
        )
      )
  `).run(team.id, team.name, req.league.id);

  res.status(201).json(team);
}));

router.delete('/:leagueId/roster/:teamId', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare(
    'DELETE FROM league_teams WHERE league_id = ? AND team_id = ?'
  ).run(req.league.id, req.params.teamId);
  res.json({ ok: true });
}));

// "Conectar equipos con sus partidos" (botón en la pantalla de roster).
// Repara partidos que se guardaron con el nombre del equipo en texto pero
// sin el enlace real (home_team_id/away_team_id), porque el equipo se
// agregó al roster/torneo DESPUÉS de crear esos partidos — antes de que
// existiera la reconciliación automática al agregar, o si el equipo ya
// era miembro desde antes de que esa reconciliación se construyera.
// Revisa TODO el roster de la liga y TODAS las inscripciones a sus
// torneos de una sola vez, no solo un equipo.
router.patch('/:leagueId/roster/sync-matches', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  let connected = 0;

  const rosterTeams = await db.prepare(`
    SELECT t.id, t.name FROM league_teams lt JOIN teams t ON t.id = lt.team_id WHERE lt.league_id = ?
  `).all(req.league.id);

  for (const team of rosterTeams) {
    const h = await db.prepare(`
      UPDATE matches SET home_team_id = ?
      WHERE home_team_id IS NULL AND UPPER(home_team) = UPPER(?)
        AND category_id IN (SELECT id FROM categories WHERE tournament_id IN (SELECT id FROM tournaments WHERE league_id = ?))
      RETURNING id
    `).all(team.id, team.name, req.league.id);
    const a = await db.prepare(`
      UPDATE matches SET away_team_id = ?
      WHERE away_team_id IS NULL AND UPPER(away_team) = UPPER(?)
        AND category_id IN (SELECT id FROM categories WHERE tournament_id IN (SELECT id FROM tournaments WHERE league_id = ?))
      RETURNING id
    `).all(team.id, team.name, req.league.id);
    connected += h.length + a.length;
  }

  const invitedTeams = await db.prepare(`
    SELECT t.id, t.name, tt.tournament_id
    FROM tournament_teams tt
    JOIN teams t        ON t.id = tt.team_id
    JOIN tournaments tr ON tr.id = tt.tournament_id
    WHERE tr.league_id = ?
  `).all(req.league.id);

  for (const team of invitedTeams) {
    const h = await db.prepare(`
      UPDATE matches SET home_team_id = ?
      WHERE home_team_id IS NULL AND UPPER(home_team) = UPPER(?)
        AND category_id IN (SELECT id FROM categories WHERE tournament_id = ?)
      RETURNING id
    `).all(team.id, team.name, team.tournament_id);
    const a = await db.prepare(`
      UPDATE matches SET away_team_id = ?
      WHERE away_team_id IS NULL AND UPPER(away_team) = UPPER(?)
        AND category_id IN (SELECT id FROM categories WHERE tournament_id = ?)
      RETURNING id
    `).all(team.id, team.name, team.tournament_id);
    connected += h.length + a.length;
  }

  res.json({ connected });
}));

// --- Lado público: pantalla de un Torneo específico ---
//
// Devuelve, en una sola llamada, todo lo que el frontend necesita para la
// navegación "inteligente" (saltar el paso de elegir categoría/rama cuando
// solo hay una opción) y para pintar el calendario público directamente:
// el torneo, sus partidos PUBLICADOS (is_draft = FALSE) con el nombre de
// categoría/rama/grupo/conferencia ya pegado, y los equipos que jugaron.
//
// La conferencia de un partido hoy solo se sabe indirectamente (partido ->
// grupo -> conferencia); un partido colgado directo de una conferencia sin
// grupos todavía no es posible de asignar desde MatchForm.jsx, así que ese
// caso simplemente no aparece agrupado en "ver por conferencia" por ahora.
router.get('/tournaments/:tournamentId/public', asyncHandler(async (req, res) => {
  const tournament = await db.prepare(`
    SELECT t.id, t.name, t.year, t.logo_url,
           l.id AS league_id, l.name AS league_name, l.slug AS league_slug
    FROM tournaments t
    JOIN leagues l ON l.id = t.league_id
    WHERE t.id = ? AND l.is_public = TRUE
  `).get(req.params.tournamentId);
  if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

  const matches = await db.prepare(`
    SELECT
      m.*,
      c.name        AS category_name,
      b.name        AS branch_name,
      th.logo_url   AS home_logo_url,
      COALESCE(ta.away_logo_url, ta.logo_url) AS away_logo_url,
      v.name        AS venue_name,
      v.institution AS venue_institution,
      v.address     AS venue_address,
      g.name        AS group_name,
      g2.name       AS group_name_2,
      COALESCE(confDirect.id, confViaGroup.id)     AS conference_id,
      COALESCE(confDirect.name, confViaGroup.name) AS conference_name
    FROM matches m
    JOIN categories c       ON c.id = m.category_id
    LEFT JOIN branches b    ON b.id = m.branch_id
    LEFT JOIN teams th      ON th.id = m.home_team_id
    LEFT JOIN teams ta      ON ta.id = m.away_team_id
    LEFT JOIN venues v      ON v.id = m.venue_id
    LEFT JOIN groups g      ON g.id = m.group_id
    LEFT JOIN groups g2     ON g2.id = m.group_id_2
    LEFT JOIN conferences confViaGroup ON confViaGroup.id = g.conference_id
    LEFT JOIN conferences confDirect   ON confDirect.id = m.conference_id
    WHERE c.tournament_id = ? AND m.is_draft = FALSE
    ORDER BY m.match_date ASC
  `).all(tournament.id);

  const teams = await db.prepare(`
    SELECT DISTINCT t.id, t.name, t.logo_url
    FROM teams t
    WHERE t.id IN (
      SELECT m.home_team_id FROM matches m
      JOIN categories c ON c.id = m.category_id
      WHERE c.tournament_id = ? AND m.is_draft = FALSE AND m.home_team_id IS NOT NULL
      UNION
      SELECT m.away_team_id FROM matches m
      JOIN categories c ON c.id = m.category_id
      WHERE c.tournament_id = ? AND m.is_draft = FALSE AND m.away_team_id IS NOT NULL
    )
    ORDER BY t.name ASC
  `).all(tournament.id, tournament.id);

  res.json({ tournament, matches, teams });
}));

export default router;
