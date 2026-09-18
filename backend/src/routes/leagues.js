import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { leagueOwnerRequired, tournamentOwnerRequired } from '../middleware/ownership.js';
import { isValidUrl, isNonEmptyString } from '../utils/validation.js';
import { isValidTimezone } from '../utils/timezones.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { MEXICO_STATES } from '../utils/mexicoStates.js';
import { MATCH_SCOPE_JOINS, MATCH_SCOPE_COLUMNS } from '../utils/matchScope.js';
import { buildBranchStandings } from '../utils/branchStandings.js';

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
    SELECT id, name, slug, logo_url, state, states, description
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
      CASE WHEN th.id IS NOT NULL THEN json_build_object(
        'id', th.id, 'name', th.name, 'logo_url', th.logo_url, 'cover_url', th.cover_url,
        'location', th.location, 'contact_email', th.contact_email, 'contact_phone', th.contact_phone,
        'facebook_url', th.facebook_url, 'instagram_url', th.instagram_url,
        'twitter_url', th.twitter_url, 'website_url', th.website_url,
        'is_verified', COALESCE(tho.is_verified, FALSE),
        'league_id', l.id
      ) END AS home_team_details,
      CASE WHEN ta.id IS NOT NULL THEN json_build_object(
        'id', ta.id, 'name', ta.name,
        'logo_url', COALESCE(ta.away_logo_url, ta.logo_url), 'cover_url', ta.cover_url,
        'location', ta.location, 'contact_email', ta.contact_email, 'contact_phone', ta.contact_phone,
        'facebook_url', ta.facebook_url, 'instagram_url', ta.instagram_url,
        'twitter_url', ta.twitter_url, 'website_url', ta.website_url,
        'is_verified', COALESCE(tao.is_verified, FALSE),
        'league_id', l.id
      ) END AS away_team_details,
      v.name        AS venue_name,
      v.institution AS venue_institution,
      v.address     AS venue_address,
      v.city        AS venue_city,
      v.cover_url     AS venue_cover_url,
      v.contact_phone AS venue_contact_phone,
      v.contact_email AS venue_contact_email,
      ${MATCH_SCOPE_COLUMNS},
      c.tournament_id AS tournament_id,
      tr.name       AS tournament_name
    FROM matches m
    LEFT JOIN categories c   ON c.id = m.category_id
    LEFT JOIN leagues l      ON l.id = c.league_id
    LEFT JOIN teams th       ON th.id = COALESCE(m.home_team_id, (
      SELECT t.id FROM teams t WHERE t.league_id = l.id AND UPPER(t.name) = UPPER(m.home_team) LIMIT 1
    ))
    LEFT JOIN teams ta       ON ta.id = COALESCE(m.away_team_id, (
      SELECT t.id FROM teams t WHERE t.league_id = l.id AND UPPER(t.name) = UPPER(m.away_team) LIMIT 1
    ))
    LEFT JOIN organizations tho ON tho.id = th.organization_id
    LEFT JOIN organizations tao ON tao.id = ta.organization_id
    LEFT JOIN venues v       ON v.id = m.venue_id
    LEFT JOIN tournaments tr ON tr.id = c.tournament_id
    ${MATCH_SCOPE_JOINS}
    WHERE m.id = ? AND m.is_draft = FALSE
  `).get(req.params.matchId);

  if (!match) return res.status(404).json({ error: 'Partido no encontrado' });

  // Partido anterior / siguiente dentro del mismo calendario, en el mismo
  // orden cronológico que muestran CalendarPage y TournamentPage
  // (match_date ASC, con el id como desempate estable). El alcance es el
  // Torneo cuando el partido pertenece a uno, o si no, la Categoría —
  // igual criterio que el botón "Ver calendario completo" de MatchPage.
  const scopeSql = match.tournament_id
    ? `JOIN categories c ON c.id = m.category_id WHERE c.tournament_id = ?`
    : `WHERE m.category_id = ?`;
  const scopeId = match.tournament_id || match.category_id;
  const neighbors = scopeId
    ? await db.prepare(`
        WITH ordered AS (
          SELECT m.id,
                 LAG(m.id)  OVER w AS prev_id,
                 LEAD(m.id) OVER w AS next_id
          FROM matches m
          ${scopeSql} AND m.is_draft = FALSE
          WINDOW w AS (ORDER BY m.match_date ASC, m.id ASC)
        )
        SELECT prev_id, next_id FROM ordered WHERE id = ?
      `).get(scopeId, match.id)
    : null;
  match.prev_match_id = neighbors?.prev_id ?? null;
  match.next_match_id = neighbors?.next_id ?? null;

  res.json(match);
}));

// Todos los equipos que aparecen en la sección "Equipos" del home: los que
// son miembro del roster (league_teams) de AL MENOS una liga publicada, MÁS
// los equipos INDEPENDIENTES (sin liga) que decidieron mostrarse ellos
// mismos (show_on_platform) — esa decisión es personal del equipo, sin
// aprobación de nadie (ver POST /manage/teams). Un mismo equipo puede
// estar en el roster de varias ligas; se muestra una sola vez (DISTINCT
// ON), usando la liga pública más antigua como contexto para el botón de
// "Notificarme" de su ficha; un equipo independiente no tiene ninguna.
router.get('/all-teams', asyncHandler(async (req, res) => {
  const teams = await db.prepare(`
    SELECT DISTINCT ON (t.id)
      t.id, t.name, t.logo_url, t.cover_url, t.location, t.contact_email, t.contact_phone,
      t.facebook_url, t.instagram_url, t.twitter_url, t.website_url,
      o.is_verified AS is_verified,
      l.id AS league_id
    FROM teams t
    LEFT JOIN organizations o ON o.id = t.organization_id
    LEFT JOIN league_teams lt ON lt.team_id = t.id
    LEFT JOIN leagues l       ON l.id = lt.league_id AND l.is_public = TRUE
    WHERE l.id IS NOT NULL
       OR (t.league_id IS NULL AND t.show_on_platform = TRUE)
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
           t.facebook_url, t.instagram_url, t.twitter_url, t.website_url,
           o.is_verified AS is_verified
    FROM league_teams lt
    JOIN teams t ON t.id = lt.team_id
    LEFT JOIN organizations o ON o.id = t.organization_id
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
    SELECT id, name, institution, cover_url, address, city, contact_phone, contact_email
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
    SELECT c.*, l.name AS league_name, l.logo_url AS league_logo_url,
           t.name AS tournament_name
    FROM categories c
    JOIN leagues l ON l.id = c.league_id
    LEFT JOIN tournaments t ON t.id = c.tournament_id
    WHERE c.id = ?
  `).get(req.params.categoryId);
  if (!category) return res.status(404).json({ error: 'Categoría no encontrada' });

  // Conferencia y grupo los resuelve MATCH_SCOPE_COLUMNS desde los equipos
  // que juegan (ver utils/matchScope.js), igual que en las otras dos consultas
  // públicas. Ojo: aquí los equipos se unen por NOMBRE, no por id, pero la
  // derivación sí usa m.home_team_id/m.away_team_id — un partido viejo sin
  // esas llaves cae al valor capturado a mano, que es justo el respaldo.
  const rows = await db.prepare(`
    SELECT
      m.*,
      c.auto_status_enabled      AS auto_status_enabled,
      c.auto_status_window_hours AS auto_status_window_hours,
      th.logo_url AS home_logo_url,
      COALESCE(ta.away_logo_url, ta.logo_url) AS away_logo_url,
      v.name        AS venue_name,
      v.institution AS venue_institution,
      v.address     AS venue_address,
      v.city        AS venue_city,
      ${MATCH_SCOPE_COLUMNS}
    FROM matches m
    LEFT JOIN categories c  ON c.id  = m.category_id
    LEFT JOIN teams th      ON th.league_id = c.league_id
                           AND UPPER(th.name) = UPPER(m.home_team)
    LEFT JOIN teams ta      ON ta.league_id = c.league_id
                           AND UPPER(ta.name) = UPPER(m.away_team)
    LEFT JOIN venues v      ON v.id = m.venue_id
    ${MATCH_SCOPE_JOINS}
    WHERE m.category_id = ? AND m.is_draft = FALSE
    ORDER BY m.match_date ASC
  `).all(category.id);

  // Los LEFT JOIN de arriba comparan equipos por nombre (UPPER(th.name) =
  // UPPER(m.home_team)), no por id. Si en algún momento quedó un equipo
  // duplicado en la tabla `teams` (mismo league_id, mismo nombre, dos
  // filas distintas — típicamente por un doble clic al crearlo o una
  // reimportación), el JOIN "abre" cada partido de ese equipo en dos
  // filas idénticas, y el calendario público terminaba mostrando el
  // partido repetido. Esto NO se soluciona borrando el equipo duplicado a
  // mano cada vez que aparezca: nos protegemos aquí quedándonos con una
  // sola fila por m.id antes de responder, sin importar cuántas veces se
  // haya repetido por el JOIN.
  const seenIds = new Set();
  const matches = rows.filter((m) => {
    if (seenIds.has(m.id)) return false;
    seenIds.add(m.id);
    return true;
  });

  res.json({ category, matches });
}));

// Mismo patrón que createTeamOrganization en manage.js: cada liga necesita su
// organización desde el momento en que se crea (no solo vía el backfill que
// corre al arrancar el servidor) — si no, se queda con organization_id en
// NULL hasta el siguiente reinicio, y mientras tanto cosas como "Invitar
// administrador" (que dependen de esa organización) no tienen dónde vivir.
async function createLeagueOrganization(name, { country_id, logo_url, description, website_url } = {}) {
  let slug = slugify(name);
  const existing = await db.prepare('SELECT id FROM organizations WHERE slug = ?').get(slug);
  if (existing) slug = `${slug}-${Date.now().toString().slice(-5)}`;

  return db.prepare(`
    INSERT INTO organizations (name, slug, type, country_id, logo_url, description, website_url, status)
    VALUES (?, ?, 'league', ?, ?, ?, ?, 'active')
    RETURNING *
  `).get(name, slug, country_id || null, logo_url || null, description || null, website_url || null);
}

// Un arreglo de estados a texto JSON para guardarlo en la columna jsonb
// "states" — mismo patrón que toLinksJson en manage.js.
function toStatesJson(value) {
  if (value === undefined) return null;
  return JSON.stringify(Array.isArray(value) ? value.filter((s) => typeof s === 'string' && s.trim()) : []);
}

router.post('/', authRequired, asyncHandler(async (req, res) => {
  const {
    name, logo_url, cover_url, country_id, state, states, description, timezone,
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

  // La lista fija de MEXICO_STATES solo se exige cuando el país elegido es
  // México — el resto de países, por ahora, no tiene esa restricción (siguen
  // sin selector de estado en el formulario). Una liga real casi siempre
  // opera en más de un estado, por eso "states" es un arreglo — "state"
  // (texto) se mantiene como resumen legible para lo que todavía lo muestra.
  let country = null;
  if (country_id) {
    country = await db.prepare('SELECT * FROM countries WHERE id = ?').get(country_id);
    if (!country) return res.status(400).json({ error: 'El país seleccionado no es válido' });
  }
  const isMexico = country?.code === 'MX';
  if (isMexico && (!Array.isArray(states) || states.length === 0 || states.some((s) => !MEXICO_STATES.includes(s)))) {
    return res.status(400).json({ error: 'Selecciona al menos un estado válido de México' });
  }

  let slug = slugify(name);
  const existing = await db.prepare('SELECT id FROM leagues WHERE slug = ?').get(slug);
  if (existing) slug = `${slug}-${Date.now().toString().slice(-5)}`;

  const org = await createLeagueOrganization(name.trim(), { country_id, logo_url, description, website_url });

  const result = await db.prepare(`
    INSERT INTO leagues (name, slug, logo_url, cover_url, country_id, state, states, description, owner_user_id, timezone,
      facebook_url, instagram_url, twitter_url, youtube_url, tiktok_url, website_url, whatsapp, organization_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name.trim(), slug, logo_url || null, cover_url || null, country_id || null,
    isMexico ? states.join(', ') : (state || null),
    toStatesJson(isMexico ? states : []),
    description || null, req.user.id,
    timezone || 'America/Mexico_City',
    facebook_url || null, instagram_url || null, twitter_url || null,
    youtube_url || null, tiktok_url || null, website_url || null, whatsapp || null,
    org.id
  );

  // Mismo patrón que POST /manage/teams: quien crea la liga queda de una vez
  // como 'owner' en organization_members, no solo en leagues.owner_user_id —
  // así "Invitar administrador" funciona desde el primer momento, sin
  // esperar al backfill que corre al arrancar el servidor.
  await db.prepare(`
    INSERT INTO organization_members (organization_id, user_id, role)
    VALUES (?, ?, 'owner')
  `).run(org.id, req.user.id);

  res.status(201).json(await db.prepare('SELECT * FROM leagues WHERE id = ?').get(result.lastInsertRowid));
}));

function toNull(value) {
  return value === undefined ? null : value;
}

// Igual que toNull pero para un id numérico: un <select> vacío manda '', no
// undefined, y '' en una columna INTEGER truena la consulta completa
// (22P02, "invalid input syntax for type integer"). Vacío aquí significa "no
// lo toques", igual que undefined, porque estas columnas se escriben con
// COALESCE(?, col).
function toId(value) {
  if (value === undefined || value === null || value === '') return null;
  return value;
}

router.put('/:id', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const {
    name, logo_url, cover_url, country_id, state, states, description, timezone,
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

  // Igual que en el registro: la lista fija de estados solo se exige si la
  // liga (ya sea que lo traiga esta petición o lo tuviera de antes) es de
  // México. Solo se valida si "states" viene en el body — si esta petición
  // no toca el estado (ej. solo cambia el logo), no se le exige de nuevo.
  let country = null;
  const effectiveCountryId = toId(country_id) ?? league.country_id;
  if (effectiveCountryId) {
    country = await db.prepare('SELECT * FROM countries WHERE id = ?').get(effectiveCountryId);
    if (!country) return res.status(400).json({ error: 'El país seleccionado no es válido' });
  }
  const isMexico = country?.code === 'MX';
  if (isMexico && states !== undefined
      && (!Array.isArray(states) || states.length === 0 || states.some((s) => !MEXICO_STATES.includes(s)))) {
    return res.status(400).json({ error: 'Selecciona al menos un estado válido de México' });
  }

  // "state" (texto) se mantiene como resumen legible: si mandaron un
  // arreglo nuevo de estados de México, se deriva de ahí; si no, se respeta
  // lo que venga en el body tal cual (o no se toca, como antes).
  const stateParam = (isMexico && Array.isArray(states)) ? states.join(', ') : state;

  await db.prepare(`
    UPDATE leagues SET
      name          = COALESCE(?, name),
      logo_url      = COALESCE(?, logo_url),
      cover_url     = COALESCE(?, cover_url),
      country_id    = COALESCE(?, country_id),
      state         = COALESCE(?, state),
      states        = COALESCE(?, states),
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
    toNull(logo_url), toNull(cover_url), toId(country_id),
    toNull(stateParam), toStatesJson(isMexico ? states : undefined),
    toNull(description), toNull(timezone),
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

// Toda la liga en una sola respuesta, para el panel unificado
// (/panel/liga/:id/estructura): la liga, sus equipos y sedes, y la jerarquía
// Torneo -> Categoría -> Rama -> (Conferencia) -> Grupo con los partidos y
// los equipos inscritos de cada rama ya embebidos. Así el panel hace UNA
// petición y todo el trabajo (crear/editar/borrar en cualquier nivel) pasa
// sin cambiar de página.
//
// Solo incluye lo que cuelga de un torneo. Las categorías del modelo viejo
// (sin tournament_id) NO se mezclan aquí — se reportan aparte en `legacy`
// para que el panel pueda enlazar a la pantalla clásica si todavía hay algo
// ahí.
router.get('/:leagueId/tree', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const leagueId = req.league.id;

  const [
    tournaments, categories, branches, conferences, groups,
    matches, branchTeams, teams, venues, legacy, phases, titles,
  ] = await Promise.all([
    db.prepare(`
      SELECT * FROM tournaments
      WHERE league_id = ?
      ORDER BY year DESC, sort_order ASC, name ASC
    `).all(leagueId),
    db.prepare(`
      SELECT c.* FROM categories c
      JOIN tournaments t ON t.id = c.tournament_id
      WHERE t.league_id = ?
      ORDER BY c.sort_order ASC, c.name ASC
    `).all(leagueId),
    db.prepare(`
      SELECT b.* FROM branches b
      JOIN categories c ON c.id = b.category_id
      JOIN tournaments t ON t.id = c.tournament_id
      WHERE t.league_id = ?
      ORDER BY b.sort_order ASC, b.name ASC
    `).all(leagueId),
    db.prepare(`
      SELECT cf.* FROM conferences cf
      JOIN branches b ON b.id = cf.branch_id
      JOIN categories c ON c.id = b.category_id
      JOIN tournaments t ON t.id = c.tournament_id
      WHERE t.league_id = ?
      ORDER BY cf.sort_order ASC, cf.name ASC
    `).all(leagueId),
    db.prepare(`
      SELECT g.* FROM groups g
      JOIN categories c ON c.id = g.category_id
      JOIN tournaments t ON t.id = c.tournament_id
      WHERE t.league_id = ? AND (g.branch_id IS NOT NULL OR g.conference_id IS NOT NULL)
      ORDER BY g.sort_order ASC, g.name ASC
    `).all(leagueId),
    db.prepare(`
      SELECT m.*, ${MATCH_SCOPE_COLUMNS} FROM matches m
      JOIN branches b ON b.id = m.branch_id
      JOIN categories c ON c.id = b.category_id
      JOIN tournaments t ON t.id = c.tournament_id
      ${MATCH_SCOPE_JOINS}
      WHERE t.league_id = ?
      ORDER BY m.match_date ASC, m.id ASC
    `).all(leagueId),
    db.prepare(`
      SELECT bt.branch_id, t.id, t.name, t.logo_url,
             bt.conference_id, cf.name AS conference_name,
             bt.group_id,      g.name  AS group_name
      FROM branch_teams bt
      JOIN teams t ON t.id = bt.team_id
      JOIN branches b ON b.id = bt.branch_id
      JOIN categories c ON c.id = b.category_id
      JOIN tournaments tn ON tn.id = c.tournament_id
      LEFT JOIN conferences cf ON cf.id = bt.conference_id
      LEFT JOIN groups      g  ON g.id  = bt.group_id
      WHERE tn.league_id = ?
      ORDER BY t.name ASC
    `).all(leagueId),
    db.prepare('SELECT * FROM teams WHERE league_id = ? ORDER BY sort_order ASC, name ASC').all(leagueId),
    db.prepare('SELECT * FROM venues WHERE league_id = ? ORDER BY sort_order ASC, name ASC').all(leagueId),
    db.prepare(`
      SELECT
        (SELECT COUNT(*)::int FROM categories WHERE league_id = ? AND tournament_id IS NULL) AS categories,
        (SELECT COUNT(*)::int FROM matches m JOIN categories c ON c.id = m.category_id
           WHERE c.league_id = ? AND c.tournament_id IS NULL) AS matches
    `).get(leagueId, leagueId),
    // Fases y títulos de cada rama. Van en el árbol (y no en una petición
    // aparte) porque el formulario de partido necesita las fases para poder
    // elegir una, y el árbol ya es la fuente única de todo lo demás.
    db.prepare(`
      SELECT ph.* FROM phases ph
      JOIN branches b ON b.id = ph.branch_id
      JOIN categories c ON c.id = b.category_id
      JOIN tournaments t ON t.id = c.tournament_id
      WHERE t.league_id = ?
      ORDER BY ph.sort_order ASC, ph.id ASC
    `).all(leagueId),
    db.prepare(`
      SELECT ti.* FROM titles ti
      JOIN branches b ON b.id = ti.branch_id
      JOIN categories c ON c.id = b.category_id
      JOIN tournaments t ON t.id = c.tournament_id
      WHERE t.league_id = ?
      ORDER BY ti.sort_order ASC, ti.id ASC
    `).all(leagueId),
  ]);

  const by = (rows, key) => {
    const out = {};
    for (const r of rows) (out[r[key]] ||= []).push(r);
    return out;
  };

  const matchesByBranch     = by(matches, 'branch_id');
  const branchTeamsByBranch  = by(branchTeams, 'branch_id');
  const phasesByBranch       = by(phases, 'branch_id');
  const titlesByBranch       = by(titles, 'branch_id');
  const groupsByConference   = {};
  const directGroupsByBranch = {};
  for (const g of groups) {
    if (g.conference_id) (groupsByConference[g.conference_id] ||= []).push(g);
    else if (g.branch_id) (directGroupsByBranch[g.branch_id] ||= []).push(g);
  }

  const conferencesByBranch = {};
  for (const cf of conferences) {
    (conferencesByBranch[cf.branch_id] ||= []).push({
      ...cf,
      groups: groupsByConference[cf.id] || [],
    });
  }

  const branchesByCategory = {};
  for (const b of branches) {
    (branchesByCategory[b.category_id] ||= []).push({
      ...b,
      conferences:  conferencesByBranch[b.id] || [],
      directGroups: directGroupsByBranch[b.id] || [],
      teams:        branchTeamsByBranch[b.id] || [],
      matches:      matchesByBranch[b.id] || [],
      phases:       phasesByBranch[b.id] || [],
      titles:       titlesByBranch[b.id] || [],
    });
  }

  const categoriesByTournament = {};
  for (const c of categories) {
    (categoriesByTournament[c.tournament_id] ||= []).push({
      ...c,
      branches: branchesByCategory[c.id] || [],
    });
  }

  res.json({
    league: req.league,
    teams,
    venues,
    legacy,
    tournaments: tournaments.map((t) => ({
      ...t,
      categories: categoriesByTournament[t.id] || [],
    })),
  });
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
// La conferencia y el grupo ya no se leen crudos de la fila: los resuelve
// MATCH_SCOPE_COLUMNS a partir de los equipos que juegan (ver utils/matchScope.js).
router.get('/tournaments/:tournamentId/public', asyncHandler(async (req, res) => {
  const tournament = await db.prepare(`
    SELECT t.id, t.name, t.year, t.logo_url,
           l.id AS league_id, l.name AS league_name, l.slug AS league_slug,
           l.logo_url AS league_logo_url
    FROM tournaments t
    JOIN leagues l ON l.id = t.league_id
    WHERE t.id = ? AND l.is_public = TRUE
  `).get(req.params.tournamentId);
  if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });

  const matches = await db.prepare(`
    SELECT
      m.*,
      c.name        AS category_name,
      c.auto_status_enabled      AS auto_status_enabled,
      c.auto_status_window_hours AS auto_status_window_hours,
      b.name        AS branch_name,
      th.logo_url   AS home_logo_url,
      COALESCE(ta.away_logo_url, ta.logo_url) AS away_logo_url,
      v.name        AS venue_name,
      v.institution AS venue_institution,
      v.address     AS venue_address,
      v.city        AS venue_city,
      ${MATCH_SCOPE_COLUMNS}
    FROM matches m
    JOIN categories c       ON c.id = m.category_id
    LEFT JOIN branches b    ON b.id = m.branch_id
    LEFT JOIN teams th      ON th.id = m.home_team_id
    LEFT JOIN teams ta      ON ta.id = m.away_team_id
    LEFT JOIN venues v      ON v.id = m.venue_id
    ${MATCH_SCOPE_JOINS}
    WHERE c.tournament_id = ? AND m.is_draft = FALSE
    ORDER BY m.match_date ASC
  `).all(tournament.id);

  const teams = await db.prepare(`
    SELECT DISTINCT t.id, t.name, t.logo_url, o.is_verified AS is_verified
    FROM teams t
    LEFT JOIN organizations o ON o.id = t.organization_id
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

  // Las ramas del torneo, para que la página pública sepa de cuáles puede
  // ofrecer tabla de posiciones sin tener que deducirlas de los partidos.
  // Se filtran las que no tienen ningún equipo inscrito: una rama vacía no
  // tiene tabla que mostrar.
  const branches = await db.prepare(`
    SELECT b.id, b.name, b.standings_levels, c.id AS category_id, c.name AS category_name,
           (SELECT COUNT(*)::int FROM branch_teams bt WHERE bt.branch_id = b.id) AS team_count
    FROM branches b
    JOIN categories c ON c.id = b.category_id
    WHERE c.tournament_id = ?
      AND EXISTS (SELECT 1 FROM branch_teams bt WHERE bt.branch_id = b.id)
    ORDER BY c.sort_order ASC, c.name ASC, b.sort_order ASC, b.name ASC
  `).all(tournament.id);

  res.json({ tournament, matches, teams, branches });
}));


// Tabla de posiciones pública de una rama.
//
// Va como endpoint aparte y no dentro del payload del torneo a propósito: la
// tabla solo hace falta cuando alguien abre esa pestaña, y calcularla en cada
// carga del calendario le costaría a todos los visitantes un trabajo que casi
// ninguno pidió.
//
// El filtro de visibilidad es el mismo de siempre (l.is_public): una liga que
// no está publicada no expone su tabla aunque alguien adivine el id de la rama.
router.get('/branches/:branchId/standings', asyncHandler(async (req, res) => {
  const branch = await db.prepare(`
    SELECT b.id, b.name, c.name AS category_name, t.id AS tournament_id,
           t.name AS tournament_name, t.year
    FROM branches b
    JOIN categories c   ON c.id = b.category_id
    JOIN tournaments t  ON t.id = c.tournament_id
    JOIN leagues l      ON l.id = t.league_id
    WHERE b.id = ? AND l.is_public = TRUE
  `).get(req.params.branchId);
  if (!branch) return res.status(404).json({ error: 'Rama no encontrada' });

  const standings = await buildBranchStandings(branch.id, { publicOnly: true });
  if (!standings) return res.status(404).json({ error: 'Rama no encontrada' });

  res.json({ ...standings, branch: { ...standings.branch, ...branch } });
}));


export default router;
