import express from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { categoryOwnerRequired, matchOwnerRequired, leagueOwnerRequired, teamOwnerRequired, venueOwnerRequired, groupOwnerRequired, branchOwnerRequired, conferenceOwnerRequired, tournamentOwnerRequired } from '../middleware/ownership.js';
import { isValidEmail, isValidUrl, isValidGoogleMapsUrl, isNonEmptyString } from '../utils/validation.js';
import {
  isValidTimezone,
  zonedTimeToUtcISO,
  localDateTimeStringToUtcISO,
  getLocalPartsInZone,
  parseLocalDateTimeString,
} from '../utils/timezones.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

function toNull(value) {
  return value === undefined ? null : value;
}

// Convierte un array de URLs a texto JSON para guardarlo en una columna
// jsonb — si el valor no vino en la petición, devuelve null (para que el
// COALESCE en el UPDATE conserve el valor que ya existía).
function toLinksJson(value) {
  if (value === undefined) return null;
  return JSON.stringify(Array.isArray(value) ? value.filter((u) => typeof u === 'string' && u.trim()) : []);
}

// Valida que cada elemento de una lista de links sea una URL válida.
function validateLinksList(links, label) {
  if (links === undefined) return null;
  if (!Array.isArray(links)) return `${label} debe ser una lista de direcciones web`;
  for (const url of links) {
    if (url && !isValidUrl(url)) return `Uno de los links de ${label} no es una dirección web válida`;
  }
  return null;
}

// Misma lógica que frontend/src/utils/matchStatus.js: el estado depende
// exclusivamente del horario (fecha + ventana de 3h) — el marcador NUNCA
// determina el estado, solo es un dato que se guarda aparte.
const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;
// Busca si el nombre de equipo (texto libre) coincide con un equipo real
// elegible para esa categoría — en este orden:
//   1. Miembro de la liga dueña del torneo (elegible en cualquiera de sus
//      torneos, presente o futuro, sin inscripción aparte).
//   2. Invitado específicamente a ESTE torneo (tournament_teams), aunque
//      sea de otra liga.
//   3. Si la categoría no pertenece a ningún torneo todavía (modelo
//      viejo), el roster de la liga, como se hacía antes.
// Se usa al guardar un partido para conectar home_team_id/away_team_id de
// verdad, sin que el organizador tenga que hacer nada distinto a escribir
// el nombre.
async function resolveTeamId(category, teamNameRaw) {
  if (!teamNameRaw) return null;
  const name = teamNameRaw.trim();
  if (!name) return null;

  if (category.tournament_id) {
    const member = await db.prepare(`
      SELECT t.id FROM league_teams lt
      JOIN teams t ON t.id = lt.team_id
      WHERE lt.league_id = ? AND t.name ILIKE ?
    `).get(category.league_id, name);
    if (member) return member.id;

    const inscribed = await db.prepare(`
      SELECT t.id FROM tournament_teams tt
      JOIN teams t ON t.id = tt.team_id
      WHERE tt.tournament_id = ? AND t.name ILIKE ?
    `).get(category.tournament_id, name);
    if (inscribed) return inscribed.id;
  }

  const leagueTeam = await db.prepare(
    'SELECT id FROM teams WHERE league_id = ? AND name ILIKE ?'
  ).get(category.league_id, name);
  return leagueTeam ? leagueTeam.id : null;
}

function computeMatchStatus(matchDateIso) {
  if (!matchDateIso) return 'scheduled';
  const now       = Date.now();
  const matchTime = new Date(matchDateIso).getTime();
  const endTime   = matchTime + LIVE_WINDOW_MS;
  if (now < matchTime) return 'scheduled';
  if (now < endTime)   return 'live';
  return 'finished';
}

// Busca (o crea, la primera vez) la categoría "Sin clasificar" de un
// torneo — donde caen los partidos del Excel cuya Categoría no coincidió
// con nada real. Se crea junto con su propia rama "Sin clasificar", para
// que el partido siempre tenga a dónde caer sin inventar datos sueltos.
async function getOrCreatePlaceholderCategory(tournamentId, leagueId) {
  const existing = await db.prepare(
    'SELECT * FROM categories WHERE tournament_id = ? AND is_placeholder = TRUE'
  ).get(tournamentId);
  if (existing) return existing;

  const result = await db.prepare(`
    INSERT INTO categories (league_id, tournament_id, name, is_placeholder)
    VALUES (?, ?, 'Sin clasificar', TRUE)
  `).run(leagueId, tournamentId);
  const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
  await getOrCreatePlaceholderBranch(category.id);
  return category;
}

// Busca (o crea) la rama "Sin clasificar" DENTRO de una categoría
// específica — se usa tanto para la categoría "Sin clasificar" general
// como para una rama que no coincidió dentro de una categoría real.
async function getOrCreatePlaceholderBranch(categoryId) {
  const existing = await db.prepare(
    'SELECT * FROM branches WHERE category_id = ? AND is_placeholder = TRUE'
  ).get(categoryId);
  if (existing) return existing;

  const result = await db.prepare(`
    INSERT INTO branches (category_id, name, is_placeholder)
    VALUES (?, 'Sin clasificar', TRUE)
  `).run(categoryId);
  return db.prepare('SELECT * FROM branches WHERE id = ?').get(result.lastInsertRowid);
}

const xlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls)$/.test(file.originalname.toLowerCase());
    if (ok) cb(null, true);
    else cb(new Error('Solo se permiten archivos .xlsx o .xls'));
  },
});

/* ===================== CATEGORÍAS ===================== */

router.put('/categories/:categoryId', authRequired, categoryOwnerRequired, asyncHandler(async (req, res) => {
  const { name, sort_order, season, year, auto_status_enabled, auto_status_window_hours } = req.body;
  if (name !== undefined && !isNonEmptyString(name)) {
    return res.status(400).json({ error: 'El nombre de la categoría no puede estar vacío' });
  }

  // auto_status_enabled y auto_status_window_hours viajan juntos: si no se
  // menciona el interruptor en esta edición, no tocamos ninguno de los dos
  // (para no borrar la configuración por accidente al editar solo el nombre).
  const touchingAutoStatus = auto_status_enabled !== undefined;
  const hoursSql = touchingAutoStatus ? '?' : 'auto_status_window_hours';

  const params = [
    toNull(name ? name.trim().toUpperCase() : name),
    toNull(sort_order),
    toNull(season ? season.trim().toUpperCase() : season),
    toNull(year ? parseInt(year) : year),
    toNull(auto_status_enabled),
  ];
  if (touchingAutoStatus) {
    params.push(auto_status_enabled ? parseInt(auto_status_window_hours) : null);
  }
  params.push(req.category.id);

  await db.prepare(`
    UPDATE categories SET
      name       = COALESCE(?, name),
      sort_order = COALESCE(?, sort_order),
      season     = COALESCE(?, season),
      year       = COALESCE(?, year),
      auto_status_enabled      = COALESCE(?, auto_status_enabled),
      auto_status_window_hours = ${hoursSql}
    WHERE id = ?
  `).run(...params);

  res.json(await db.prepare('SELECT * FROM categories WHERE id = ?').get(req.category.id));
}));

router.delete('/categories/:categoryId', authRequired, categoryOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM categories WHERE id = ?').run(req.category.id);
  res.json({ ok: true });
}));

// Borra el torneo completo, y en cascada TODO lo que cuelga de él:
// categorías, ramas, conferencias, grupos, y partidos. Es destructivo e
// irreversible (por eso el frontend pide escribir el nombre del torneo
// para confirmar antes de llamar esta ruta).
router.delete('/tournaments/:tournamentId', authRequired, tournamentOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM tournaments WHERE id = ?').run(req.tournament.id);
  res.json({ ok: true });
}));

/* ===================== GRUPOS ===================== */
// Un grupo pertenece a una categoría específica (ej. "Conferencia 14 Grandes"
// dentro de "Varonil Mayor 2026") — a diferencia de equipos/sedes, que son de
// toda la liga, cada categoría arma sus propios grupos.

router.post('/categories/:categoryId/groups', authRequired, categoryOwnerRequired, asyncHandler(async (req, res) => {
  const { name, description, sort_order } = req.body;
  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre del grupo es obligatorio' });

  const result = await db.prepare(`
    INSERT INTO groups (category_id, name, description, sort_order)
    VALUES (?, ?, ?, ?)
  `).run(
    req.category.id,
    name.trim().toUpperCase(),
    description ? description.trim() : null,
    sort_order || 0,
  );

  res.status(201).json(await db.prepare('SELECT * FROM groups WHERE id = ?').get(result.lastInsertRowid));
}));

// --- Pruebas de la nueva jerarquía (Categoría -> Rama) ---
// Igual que con torneos, todavía no la usa ninguna pantalla real, solo
// pantallas de prueba, mientras terminamos de construir el modelo nuevo.

router.post('/categories/:categoryId/branches', authRequired, categoryOwnerRequired, asyncHandler(async (req, res) => {
  const { name, sort_order } = req.body;
  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre de la rama es obligatorio' });

  const result = await db.prepare(`
    INSERT INTO branches (category_id, name, sort_order)
    VALUES (?, ?, ?)
  `).run(
    req.category.id,
    name.trim(),
    sort_order || 0,
  );

  res.status(201).json(await db.prepare('SELECT * FROM branches WHERE id = ?').get(result.lastInsertRowid));
}));

router.get('/categories/:categoryId/branches', authRequired, categoryOwnerRequired, asyncHandler(async (req, res) => {
  const branches = await db.prepare(`
    SELECT * FROM branches WHERE category_id = ?
    ORDER BY sort_order ASC, name ASC
  `).all(req.category.id);
  res.json(branches);
}));

// Partidos REALES (todos los campos) de una Rama — a diferencia de
// /branches/:branchId/matches-test (que era solo para probar la jerarquía
// con lo mínimo), esta ruta devuelve exactamente lo que MatchForm.jsx
// necesita para crear/editar un partido de verdad: marcador, sede, links,
// zona horaria, estado, etc.
router.get('/branches/:branchId/matches', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  const matches = await db.prepare(`
    SELECT * FROM matches WHERE branch_id = ?
    ORDER BY match_date ASC
  `).all(req.branch.id);
  res.json(matches);
}));

// Todos los partidos de un Torneo completo, sin importar de qué Categoría o
// Rama sean — para la pantalla "Partidos del Torneo" (donde también
// aterrizan los que suba un Excel, como borrador). Trae el nombre de la
// categoría y de la rama de cada uno, para poder mostrarlos identificados
// aunque vengan mezclados.
router.get('/tournaments/:tournamentId/matches', authRequired, tournamentOwnerRequired, asyncHandler(async (req, res) => {
  const matches = await db.prepare(`
    SELECT
      m.*,
      c.name AS category_name,
      b.name AS branch_name,
      c.is_placeholder AS category_needs_review,
      b.is_placeholder AS branch_needs_review
    FROM matches m
    JOIN categories c ON c.id = m.category_id
    LEFT JOIN branches b ON b.id = m.branch_id
    WHERE c.tournament_id = ?
    ORDER BY m.is_draft DESC, m.match_date ASC
  `).all(req.tournament.id);
  res.json(matches);
}));

// Publica de un jalón todos los borradores del torneo que YA se pueden
// publicar (su categoría y su rama, si tiene, no son "Sin clasificar").
// Los que sí necesitan revisión se quedan como borrador — igual que ya
// pasa con el botón "Publicar" individual, aquí nomás en lote.
router.patch('/tournaments/:tournamentId/publish-drafts', authRequired, tournamentOwnerRequired, asyncHandler(async (req, res) => {
  const published = await db.prepare(`
    UPDATE matches
    SET is_draft = FALSE
    WHERE is_draft = TRUE
      AND category_id IN (SELECT id FROM categories WHERE tournament_id = ? AND is_placeholder = FALSE)
      AND (branch_id IS NULL OR branch_id IN (SELECT id FROM branches WHERE is_placeholder = FALSE))
    RETURNING id
  `).all(req.tournament.id);

  const stillDraft = await db.prepare(`
    SELECT id FROM matches
    WHERE is_draft = TRUE
      AND category_id IN (SELECT id FROM categories WHERE tournament_id = ?)
  `).all(req.tournament.id);

  res.json({ published: published.length, skipped: stillDraft.length });
}));

// --- Pruebas de la nueva jerarquía (Rama -> Conferencia) ---

router.post('/branches/:branchId/conferences', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  const { name, sort_order } = req.body;
  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre de la conferencia es obligatorio' });

  const result = await db.prepare(`
    INSERT INTO conferences (branch_id, name, sort_order)
    VALUES (?, ?, ?)
  `).run(req.branch.id, name.trim(), sort_order || 0);

  res.status(201).json(await db.prepare('SELECT * FROM conferences WHERE id = ?').get(result.lastInsertRowid));
}));

router.get('/branches/:branchId/conferences', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  const conferences = await db.prepare(`
    SELECT * FROM conferences WHERE branch_id = ?
    ORDER BY sort_order ASC, name ASC
  `).all(req.branch.id);
  res.json(conferences);
}));

// --- Pruebas de la nueva jerarquía (Conferencia -> Grupo) ---

router.post('/conferences/:conferenceId/groups-test', authRequired, conferenceOwnerRequired, asyncHandler(async (req, res) => {
  const { name, sort_order } = req.body;
  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre del grupo es obligatorio' });

  const result = await db.prepare(`
    INSERT INTO groups (category_id, conference_id, name, sort_order)
    VALUES (?, ?, ?, ?)
  `).run(req.category.id, req.conference.id, name.trim(), sort_order || 0);

  res.status(201).json(await db.prepare('SELECT * FROM groups WHERE id = ?').get(result.lastInsertRowid));
}));

router.get('/conferences/:conferenceId/groups-test', authRequired, conferenceOwnerRequired, asyncHandler(async (req, res) => {
  const groups = await db.prepare(`
    SELECT * FROM groups WHERE conference_id = ?
    ORDER BY sort_order ASC, name ASC
  `).all(req.conference.id);
  res.json(groups);
}));

// --- Pruebas de la nueva jerarquía (Rama -> Partido) ---
// A propósito NO reutiliza el formulario/ruta real de partidos (que maneja
// zonas horarias, sedes, grupos, etc.) — aquí solo lo mínimo indispensable
// (equipos + fecha) para comprobar que un partido puede colgar de branch_id.
// El estado nace siempre "scheduled"; el botón de iniciar/finalizar es el
// siguiente paso pendiente, el motivo original de esta conversación.

router.post('/branches/:branchId/matches-test', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  const { home_team, away_team, match_date, group_id } = req.body;
  if (!isNonEmptyString(home_team) || !isNonEmptyString(away_team) || !isNonEmptyString(match_date)) {
    return res.status(400).json({ error: 'Se requieren equipo local, visitante y fecha' });
  }

  const result = await db.prepare(`
    INSERT INTO matches (category_id, branch_id, group_id, home_team, away_team, match_date, status)
    VALUES (?, ?, ?, ?, ?, ?, 'scheduled')
  `).run(
    req.branch.category_id,
    req.branch.id,
    group_id || null,
    home_team.trim(),
    away_team.trim(),
    match_date,
  );

  res.status(201).json(await db.prepare('SELECT * FROM matches WHERE id = ?').get(result.lastInsertRowid));
}));

router.get('/branches/:branchId/matches-test', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  const matches = await db.prepare(`
    SELECT * FROM matches WHERE branch_id = ?
    ORDER BY match_date ASC
  `).all(req.branch.id);
  res.json(matches);
}));

router.put('/groups/:id', authRequired, groupOwnerRequired, asyncHandler(async (req, res) => {
  const { name, description, sort_order } = req.body;
  if (name !== undefined && !isNonEmptyString(name)) {
    return res.status(400).json({ error: 'El nombre del grupo no puede estar vacío' });
  }

  await db.prepare(`
    UPDATE groups SET
      name        = COALESCE(?, name),
      description = COALESCE(?, description),
      sort_order  = COALESCE(?, sort_order)
    WHERE id = ?
  `).run(
    toNull(name ? name.trim().toUpperCase() : name),
    toNull(description),
    toNull(sort_order),
    req.group.id,
  );

  res.json(await db.prepare('SELECT * FROM groups WHERE id = ?').get(req.group.id));
}));

router.delete('/groups/:id', authRequired, groupOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM groups WHERE id = ?').run(req.group.id);
  res.json({ ok: true });
}));

/* ===================== PARTIDOS ===================== */

function validateMatchFields({ home_team, away_team, stream_links, ticket_links, status, home_score, away_score, timezone, group_id, group_id_2 }) {
  if (home_team && away_team && home_team.trim().toLowerCase() === away_team.trim().toLowerCase()) {
    return 'El equipo local y el equipo visitante no pueden ser el mismo';
  }
  if (group_id && group_id_2 && Number(group_id) === Number(group_id_2)) {
    return 'El segundo grupo debe ser distinto del primero (o déjalo vacío si no es un partido interconferencia)';
  }
  const streamLinksError = validateLinksList(stream_links, 'transmisión');
  if (streamLinksError) return streamLinksError;
  const ticketLinksError = validateLinksList(ticket_links, 'boletos');
  if (ticketLinksError) return ticketLinksError;
  if (timezone && !isValidTimezone(timezone))  return 'La zona horaria seleccionada no es válida';

  // El marcador nunca es obligatorio por el estado del partido — estado y
  // estadísticas son cosas separadas a propósito. Se puede guardar un
  // partido "finalizado" sin marcador (por capturarlo después) o con
  // marcador sin estar "finalizado" (por capturarlo antes/durante).
  if (home_score !== null && home_score !== undefined && home_score !== '' && Number(home_score) < 0) {
    return 'El marcador local no puede ser negativo';
  }
  if (away_score !== null && away_score !== undefined && away_score !== '' && Number(away_score) < 0) {
    return 'El marcador visitante no puede ser negativo';
  }
  return null;
}

router.post('/categories/:categoryId/matches', authRequired, categoryOwnerRequired, asyncHandler(async (req, res) => {
  // match_date_local: string crudo del input <datetime-local> del frontend
  // ("YYYY-MM-DDTHH:mm"), SIN ninguna conversión de zona horaria hecha en el
  // navegador. La única conversión a UTC autoritativa ocurre aquí, en el
  // backend, usando la zona horaria explícita del partido (nunca la zona
  // ambiente del servidor ni la del navegador de quien lo captura).
  const { home_team, away_team, match_date_local, venue_id, group_id, group_id_2, stream_links, ticket_links, week_label, status, home_score, away_score, timezone, branch_id } = req.body;
  if (!isNonEmptyString(home_team) || !isNonEmptyString(away_team) || !match_date_local) {
    return res.status(400).json({ error: 'Se requieren equipo local, visitante y fecha' });
  }

  const resolvedStatus = status || 'scheduled';
  const validationError = validateMatchFields({ home_team, away_team, stream_links, ticket_links, status: resolvedStatus, home_score, away_score, timezone, group_id, group_id_2 });
  if (validationError) return res.status(400).json({ error: validationError });

  // Cadena de respaldo de zona horaria: la del partido -> la de la liga
  // (siempre tiene un valor por el DEFAULT de la columna) -> México Centro.
  const effectiveTimezone = timezone || req.league.timezone || 'America/Mexico_City';
  const matchDateUtc = localDateTimeStringToUtcISO(match_date_local, effectiveTimezone);
  if (!matchDateUtc) return res.status(400).json({ error: 'La fecha y hora no son válidas' });

  const homeTeamId = await resolveTeamId(req.category, home_team);
  const awayTeamId = await resolveTeamId(req.category, away_team);

  const result = await db.prepare(`
    INSERT INTO matches (category_id, branch_id, home_team, away_team, home_team_id, away_team_id, match_date, venue_id, group_id, group_id_2, stream_links, ticket_links, week_label, status, home_score, away_score, timezone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.category.id,
    branch_id || null,
    home_team.trim().toUpperCase(),
    away_team.trim().toUpperCase(),
    homeTeamId,
    awayTeamId,
    matchDateUtc,
    venue_id  || null,
    group_id  || null,
    group_id_2 || null,
    JSON.stringify(Array.isArray(stream_links) ? stream_links.filter((u) => u && u.trim()) : []),
    JSON.stringify(Array.isArray(ticket_links) ? ticket_links.filter((u) => u && u.trim()) : []),
    week_label  ? week_label.trim().toUpperCase() : null,
    resolvedStatus,
    home_score === '' || home_score === undefined ? null : home_score,
    away_score === '' || away_score === undefined ? null : away_score,
    // Se guarda SIEMPRE la zona ya resuelta (nunca null), para que el
    // partido nunca quede con una zona horaria ambigua en la base de datos.
    effectiveTimezone

  );

  res.status(201).json(await db.prepare('SELECT * FROM matches WHERE id = ?').get(result.lastInsertRowid));
}));

/* ── IMPORTACIÓN MASIVA DESDE EXCEL ── */
router.post(
  '/categories/:categoryId/matches/import',
  authRequired,
  categoryOwnerRequired,
  xlsxUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const rows     = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rows.length === 0) {
      return res.status(400).json({ error: 'El archivo está vacío o no tiene filas de datos' });
    }

    // Equipos y sedes reales de esta liga, y grupos de esta categoría, para
    // intentar hacer coincidir el texto del Excel contra ellos (sin importar
    // mayúsculas/minúsculas) y así no reintroducir duplicados por texto libre.
    const registeredTeams  = await db.prepare(`
      SELECT id, name, home_stream_links, away_stream_links, home_ticket_links, away_ticket_links
      FROM teams WHERE league_id = ?
    `).all(req.league.id);
    const registeredVenues = await db.prepare('SELECT id, name FROM venues WHERE league_id = ?').all(req.league.id);
    const registeredGroups = await db.prepare('SELECT id, name FROM groups WHERE category_id = ?').all(req.category.id);

    function findTeam(name) {
      return registeredTeams.find((t) => t.name.toLowerCase() === name.toLowerCase());
    }
    function findVenue(name) {
      return registeredVenues.find((v) => v.name.toLowerCase() === name.toLowerCase());
    }
    function findGroup(name) {
      return registeredGroups.find((g) => g.name.toLowerCase() === name.toLowerCase());
    }

    const imported = [];
    const skipped  = [];
    const warnings = [];

    for (let i = 0; i < rows.length; i++) {
      const row  = rows[i];
      const rowN = i + 2;

      try {
        const get = (keys) => {
          for (const k of keys) {
            const found = Object.keys(row).find(
              (rk) => rk.trim().toLowerCase() === k.toLowerCase()
            );
            if (found !== undefined) return String(row[found] ?? '').trim();
          }
          return '';
        };

        const fechaRaw     = get(['Fecha', 'fecha', 'FECHA']);
        const horaRaw      = get(['Hora', 'hora', 'HORA']);
        const homeTeamRaw  = get(['Equipo Local', 'equipo local', 'local', 'home']);
        const awayTeamRaw  = get(['Equipo Visitante', 'equipo visitante', 'visitante', 'away']);
        const venueRaw     = get(['Sede', 'sede', 'SEDE']);
        const groupRaw     = get(['Grupo', 'grupo', 'GRUPO']);
        const group2Raw    = get(['Grupo 2', 'grupo 2', 'GRUPO 2', 'grupo2']);
        const weekLabel    = get(['Jornada', 'jornada', 'JORNADA', 'Week', 'week']);
        const streamUrl    = get(['Link de transmisión', 'link de transmision', 'stream', 'url', 'transmision']);
        const ticketsUrl   = get(['Link de boletos', 'link de boletos', 'boletos', 'tickets']);
        const timezoneRaw  = get(['Zona horaria', 'zona horaria', 'zona horaria (código)', 'timezone']);
        const homeScoreRaw = get(['Marcador Local', 'marcador local', 'home score']);
        const awayScoreRaw = get(['Marcador Visitante', 'marcador visitante', 'away score']);

        if (!homeTeamRaw || !awayTeamRaw) {
          skipped.push({ row: rowN, reason: 'Faltan equipos local o visitante' });
          continue;
        }

        if (homeTeamRaw.toLowerCase() === awayTeamRaw.toLowerCase()) {
          skipped.push({ row: rowN, reason: 'El equipo local y visitante son iguales' });
          continue;
        }

        // Equipos: si coincide con uno registrado se usa su nombre exacto;
        // si no, se importa igual con el texto tal cual y se avisa.
        const homeTeamMatch = findTeam(homeTeamRaw);
        const awayTeamMatch = findTeam(awayTeamRaw);
        const homeTeam = homeTeamMatch ? homeTeamMatch.name : homeTeamRaw.toUpperCase();
        const awayTeam = awayTeamMatch ? awayTeamMatch.name : awayTeamRaw.toUpperCase();
        if (!homeTeamMatch) warnings.push({ row: rowN, reason: `El equipo local "${homeTeamRaw}" no coincide con ningún equipo registrado — se importó tal cual escrito` });
        if (!awayTeamMatch) warnings.push({ row: rowN, reason: `El equipo visitante "${awayTeamRaw}" no coincide con ningún equipo registrado — se importó tal cual escrito` });

        // Sede: si coincide con una registrada, el partido queda conectado a
        // ella (venue_id); si no, se guarda solo el texto como respaldo.
        let venueId = null;
        if (venueRaw) {
          const venueMatch = findVenue(venueRaw);
          if (venueMatch) {
            venueId = venueMatch.id;
          } else {
            warnings.push({ row: rowN, reason: `La sede "${venueRaw}" no coincide con ninguna sede registrada — se guardó como texto sin conectar` });
          }
        }

        // Grupo: si coincide con uno registrado en esta categoría, el
        // partido queda conectado a él; si no, se importa sin grupo (el
        // texto libre de grupo no se guarda en ningún lado, a diferencia de
        // sede, porque grupo no tiene un campo de respaldo en texto).
        let groupId = null;
        if (groupRaw) {
          const groupMatch = findGroup(groupRaw);
          if (groupMatch) {
            groupId = groupMatch.id;
          } else {
            warnings.push({ row: rowN, reason: `El grupo "${groupRaw}" no coincide con ningún grupo registrado en esta categoría — el partido se importó sin grupo` });
          }
        }

        // Grupo 2: solo para partidos interconferencia (cruce entre dos
        // grupos). Se ignora si coincide con el mismo grupo que "Grupo".
        let groupId2 = null;
        if (group2Raw) {
          const group2Match = findGroup(group2Raw);
          if (!group2Match) {
            warnings.push({ row: rowN, reason: `El grupo 2 "${group2Raw}" no coincide con ningún grupo registrado en esta categoría — el partido se importó sin ese segundo grupo` });
          } else if (groupId && group2Match.id === groupId) {
            warnings.push({ row: rowN, reason: `El grupo 2 "${group2Raw}" es igual al grupo 1 — se ignoró (debe ser un grupo distinto)` });
          } else {
            groupId2 = group2Match.id;
          }
        }

        // Zona horaria: solo se usa si es un código válido; si no, el partido
        // usa la zona de la liga por defecto (igual que si se dejara vacía).
        let timezone = null;
        if (timezoneRaw) {
          if (isValidTimezone(timezoneRaw)) {
            timezone = timezoneRaw;
          } else {
            warnings.push({ row: rowN, reason: `La zona horaria "${timezoneRaw}" no es válida — se usó la zona de la liga por defecto` });
          }
        }

        // Link de boletos: se ignora si no es una URL válida (no bloquea la fila).
        let validTicketsUrl = '';
        if (ticketsUrl) {
          try { new URL(ticketsUrl); validTicketsUrl = ticketsUrl; }
          catch { warnings.push({ row: rowN, reason: `El link de boletos "${ticketsUrl}" no es una dirección web válida — se dejó vacío` }); }
        }

        // Marcador: solo se guarda si ambos vienen y son números válidos —
        // es solo un dato, NO determina el estado del partido (eso lo decide
        // exclusivamente el horario, ver computeMatchStatus más abajo).
        let homeScore = null;
        let awayScore = null;
        if (homeScoreRaw !== '' && awayScoreRaw !== '') {
          const hs = Number(homeScoreRaw);
          const as = Number(awayScoreRaw);
          if (Number.isInteger(hs) && hs >= 0 && Number.isInteger(as) && as >= 0) {
            homeScore = hs;
            awayScore = as;
          } else {
            warnings.push({ row: rowN, reason: 'El marcador no son números válidos — se importó el partido sin marcador' });
          }
        }

        let matchDate = null;
        if (fechaRaw) {
          let y = null, mo = null, d = null;

          const rawFechaKey = Object.keys(row).find(k => k.trim().toLowerCase() === 'fecha');
          if (rawFechaKey && row[rawFechaKey] instanceof Date) {
            const cellDate = row[rawFechaKey];
            y = cellDate.getFullYear(); mo = cellDate.getMonth() + 1; d = cellDate.getDate();
          }
          if (y === null) {
            const dmyMatch = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/.exec(fechaRaw);
            if (dmyMatch) { d = Number(dmyMatch[1]); mo = Number(dmyMatch[2]); y = Number(dmyMatch[3]); }
          }
          if (y === null) {
            const ymdMatch = /^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/.exec(fechaRaw);
            if (ymdMatch) { y = Number(ymdMatch[1]); mo = Number(ymdMatch[2]); d = Number(ymdMatch[3]); }
          }

          if (y !== null) {
            let hour = 0, minute = 0;
            if (horaRaw) {
              const timeMatch = /^(\d{1,2}):(\d{2})/.exec(horaRaw);
              if (timeMatch) { hour = Number(timeMatch[1]); minute = Number(timeMatch[2]); }
            }
            // Clave del fix: convertir usando la zona horaria de LA FILA (o la
            // de la liga como respaldo) — nunca la zona del servidor. Antes,
            // `new Date(y, m, d)` + `setHours` + `toISOString()` interpretaba
            // la hora capturada como si ya fuera la hora del servidor (UTC en
            // Render), ignorando por completo la columna "Zona horaria".
            const effectiveTz = timezone || req.league.timezone || 'America/Mexico_City';
            matchDate = zonedTimeToUtcISO(y, mo, d, hour, minute, effectiveTz);
          }
        }

        let validStream = '';
        if (streamUrl) {
          try {
            new URL(streamUrl);
            validStream = streamUrl;
          } catch {
            validStream = '';
          }
        }

        // Se combina el link del Excel (si trae uno) con los links
        // predeterminados del equipo local y del visitante — igual que ya
        // pasa cuando se crea un partido a mano desde el panel y se
        // selecciona el equipo. `dedupe` quita el link repetido si por
        // ejemplo el Excel trae el mismo link que ya tenía el equipo.
        const finalStreamLinks = dedupe([
          validStream,
          ...(homeTeamMatch ? asArray(homeTeamMatch.home_stream_links) : []),
          ...(awayTeamMatch ? asArray(awayTeamMatch.away_stream_links) : []),
        ]);
        const finalTicketLinks = dedupe([
          validTicketsUrl,
          ...(homeTeamMatch ? asArray(homeTeamMatch.home_ticket_links) : []),
          ...(awayTeamMatch ? asArray(awayTeamMatch.away_ticket_links) : []),
        ]);

        const status = computeMatchStatus(matchDate);

        // OJO: se guarda en stream_links/ticket_links (arreglos JSONB), NO en
        // las columnas viejas stream_url/tickets_url. El resto de la app
        // (botón "Ver partido", edición manual) solo lee las columnas nuevas
        // — guardar aquí en las viejas dejaba el link invisible para todo lo
        // demás, aunque sí quedara guardado en la base de datos.
        const result = await db.prepare(`
          INSERT INTO matches (category_id, home_team, away_team, match_date, venue, venue_id, group_id, group_id_2, stream_links, ticket_links, week_label, status, home_score, away_score, timezone)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          req.category.id,
          homeTeam,
          awayTeam,
          matchDate     || null,
          venueRaw      ? venueRaw.toUpperCase() : null,
          venueId,
          groupId,
          groupId2,
          JSON.stringify(finalStreamLinks),
          JSON.stringify(finalTicketLinks),
          weekLabel     ? weekLabel.toUpperCase() : null,
          status,
          homeScore,
          awayScore,
          timezone,
        );

        imported.push(result.lastInsertRowid);
      } catch (err) {
        skipped.push({ row: rowN, reason: err.message });
      }
    }

    res.status(201).json({
      imported:    imported.length,
      skipped:     skipped.length,
      skippedRows: skipped,
      warnings:    warnings.length,
      warningRows: warnings,
    });
  })
);

/* ── IMPORTACIÓN MASIVA DESDE EXCEL, A NIVEL TORNEO ──
   A diferencia de la importación por categoría (de arriba), aquí cada fila
   trae su propia Categoría y Rama — y las dos son OBLIGATORIAS: si no
   coinciden con algo que ya exista en este torneo, la fila se rechaza (no
   se "adivina" ni se crea nada solo). Todo lo que sí se importa nace como
   BORRADOR (is_draft = true) — nada se hace público hasta que alguien lo
   revise y publique desde "Partidos del Torneo".
   Conferencia/Grupo, por ahora, no se resuelven aquí (quedan sin asignar,
   igual que en la creación manual desde esta misma pantalla) — es una
   limitación conocida, pendiente para más adelante. */
router.post(
  '/tournaments/:tournamentId/matches/import',
  authRequired,
  tournamentOwnerRequired,
  xlsxUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const rows     = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rows.length === 0) {
      return res.status(400).json({ error: 'El archivo está vacío o no tiene filas de datos' });
    }

    const registeredCategories = await db.prepare(
      'SELECT id, name FROM categories WHERE tournament_id = ?'
    ).all(req.tournament.id);
    const registeredBranches = await db.prepare(`
      SELECT b.id, b.name, b.category_id
      FROM branches b
      JOIN categories c ON c.id = b.category_id
      WHERE c.tournament_id = ?
    `).all(req.tournament.id);
    const registeredTeams  = await db.prepare(`
      SELECT id, name, home_stream_links, away_stream_links, home_ticket_links, away_ticket_links
      FROM teams WHERE league_id = ?
    `).all(req.league.id);
    const registeredVenues = await db.prepare('SELECT id, name FROM venues WHERE league_id = ?').all(req.league.id);

    function findCategory(name) {
      return registeredCategories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    }
    function findBranch(categoryId, name) {
      return registeredBranches.find((b) => b.category_id === categoryId && b.name.toLowerCase() === name.toLowerCase());
    }
    function findTeam(name) {
      return registeredTeams.find((t) => t.name.toLowerCase() === name.toLowerCase());
    }
    function findVenue(name) {
      return registeredVenues.find((v) => v.name.toLowerCase() === name.toLowerCase());
    }

    const imported = [];
    const skipped  = [];
    const warnings = [];

    for (let i = 0; i < rows.length; i++) {
      const row  = rows[i];
      const rowN = i + 2;

      try {
        const get = (keys) => {
          for (const k of keys) {
            const found = Object.keys(row).find(
              (rk) => rk.trim().toLowerCase() === k.toLowerCase()
            );
            if (found !== undefined) return String(row[found] ?? '').trim();
          }
          return '';
        };

        const categoriaRaw = get(['Categoría', 'categoria', 'CATEGORÍA', 'CATEGORIA']);
        const ramaRaw      = get(['Rama', 'rama', 'RAMA']);
        const fechaRaw     = get(['Fecha', 'fecha', 'FECHA']);
        const horaRaw      = get(['Hora', 'hora', 'HORA']);
        const homeTeamRaw  = get(['Equipo Local', 'equipo local', 'local', 'home']);
        const awayTeamRaw  = get(['Equipo Visitante', 'equipo visitante', 'visitante', 'away']);
        const venueRaw     = get(['Sede', 'sede', 'SEDE']);
        const weekLabel    = get(['Jornada', 'jornada', 'JORNADA', 'Week', 'week']);
        const streamUrl    = get(['Link de transmisión', 'link de transmision', 'stream', 'url', 'transmision']);
        const ticketsUrl   = get(['Link de boletos', 'link de boletos', 'boletos', 'tickets']);
        const timezoneRaw  = get(['Zona horaria', 'zona horaria', 'zona horaria (código)', 'timezone']);
        const homeScoreRaw = get(['Marcador Local', 'marcador local', 'home score']);
        const awayScoreRaw = get(['Marcador Visitante', 'marcador visitante', 'away score']);

        // Categoría y Rama: si no coinciden con algo real, el partido cae
        // en "Sin clasificar" (se crea sola la primera vez) — nunca se
        // rechaza la fila. Ese partido simplemente no se podrá publicar
        // hasta que alguien lo edite y le asigne una categoría/rama real.
        let category = categoriaRaw ? findCategory(categoriaRaw) : null;
        if (!category) {
          if (categoriaRaw) {
            warnings.push({ row: rowN, reason: `La categoría "${categoriaRaw}" no existe en este torneo — el partido se subió a "Sin clasificar"` });
          } else {
            warnings.push({ row: rowN, reason: 'Falta la columna Categoría — el partido se subió a "Sin clasificar"' });
          }
          category = await getOrCreatePlaceholderCategory(req.tournament.id, req.league.id);
        }

        let branch = (!category.is_placeholder && ramaRaw) ? findBranch(category.id, ramaRaw) : null;
        if (!branch) {
          if (!category.is_placeholder && ramaRaw) {
            warnings.push({ row: rowN, reason: `La rama "${ramaRaw}" no existe dentro de la categoría "${categoriaRaw}" — el partido se subió a su "Sin clasificar"` });
          } else if (!category.is_placeholder) {
            warnings.push({ row: rowN, reason: 'Falta la columna Rama — el partido se subió a "Sin clasificar"' });
          }
          branch = await getOrCreatePlaceholderBranch(category.id);
        }

        if (!homeTeamRaw || !awayTeamRaw) {
          skipped.push({ row: rowN, reason: 'Faltan equipos local o visitante' });
          continue;
        }
        if (homeTeamRaw.toLowerCase() === awayTeamRaw.toLowerCase()) {
          skipped.push({ row: rowN, reason: 'El equipo local y visitante son iguales' });
          continue;
        }

        const homeTeamMatch = findTeam(homeTeamRaw);
        const awayTeamMatch = findTeam(awayTeamRaw);
        const homeTeam = homeTeamMatch ? homeTeamMatch.name : homeTeamRaw.toUpperCase();
        const awayTeam = awayTeamMatch ? awayTeamMatch.name : awayTeamRaw.toUpperCase();
        if (!homeTeamMatch) warnings.push({ row: rowN, reason: `El equipo local "${homeTeamRaw}" no coincide con ningún equipo registrado — se importó tal cual escrito` });
        if (!awayTeamMatch) warnings.push({ row: rowN, reason: `El equipo visitante "${awayTeamRaw}" no coincide con ningún equipo registrado — se importó tal cual escrito` });

        let venueId = null;
        if (venueRaw) {
          const venueMatch = findVenue(venueRaw);
          if (venueMatch) {
            venueId = venueMatch.id;
          } else {
            warnings.push({ row: rowN, reason: `La sede "${venueRaw}" no coincide con ninguna sede registrada — se guardó como texto sin conectar` });
          }
        }

        let timezone = null;
        if (timezoneRaw) {
          if (isValidTimezone(timezoneRaw)) {
            timezone = timezoneRaw;
          } else {
            warnings.push({ row: rowN, reason: `La zona horaria "${timezoneRaw}" no es válida — se usó la zona de la liga por defecto` });
          }
        }

        let validTicketsUrl = '';
        if (ticketsUrl) {
          try { new URL(ticketsUrl); validTicketsUrl = ticketsUrl; }
          catch { warnings.push({ row: rowN, reason: `El link de boletos "${ticketsUrl}" no es una dirección web válida — se dejó vacío` }); }
        }

        let homeScore = null;
        let awayScore = null;
        if (homeScoreRaw !== '' && awayScoreRaw !== '') {
          const hs = Number(homeScoreRaw);
          const as = Number(awayScoreRaw);
          if (Number.isInteger(hs) && hs >= 0 && Number.isInteger(as) && as >= 0) {
            homeScore = hs;
            awayScore = as;
          } else {
            warnings.push({ row: rowN, reason: 'El marcador no son números válidos — se importó el partido sin marcador' });
          }
        }

        let matchDate = null;
        if (fechaRaw) {
          let y = null, mo = null, d = null;

          const rawFechaKey = Object.keys(row).find((k) => k.trim().toLowerCase() === 'fecha');
          if (rawFechaKey && row[rawFechaKey] instanceof Date) {
            const cellDate = row[rawFechaKey];
            y = cellDate.getFullYear(); mo = cellDate.getMonth() + 1; d = cellDate.getDate();
          }
          if (y === null) {
            const dmyMatch = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/.exec(fechaRaw);
            if (dmyMatch) { d = Number(dmyMatch[1]); mo = Number(dmyMatch[2]); y = Number(dmyMatch[3]); }
          }
          if (y === null) {
            const ymdMatch = /^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/.exec(fechaRaw);
            if (ymdMatch) { y = Number(ymdMatch[1]); mo = Number(ymdMatch[2]); d = Number(ymdMatch[3]); }
          }

          if (y !== null) {
            let hour = 0, minute = 0;
            if (horaRaw) {
              const timeMatch = /^(\d{1,2}):(\d{2})/.exec(horaRaw);
              if (timeMatch) { hour = Number(timeMatch[1]); minute = Number(timeMatch[2]); }
            }
            const effectiveTz = timezone || req.league.timezone || 'America/Mexico_City';
            matchDate = zonedTimeToUtcISO(y, mo, d, hour, minute, effectiveTz);
          }
        }

        let validStream = '';
        if (streamUrl) {
          try { new URL(streamUrl); validStream = streamUrl; }
          catch { /* se ignora si no es válido, sin bloquear la fila */ }
        }

        const finalStreamLinks = dedupe([
          validStream,
          ...(homeTeamMatch ? asArray(homeTeamMatch.home_stream_links) : []),
          ...(awayTeamMatch ? asArray(awayTeamMatch.away_stream_links) : []),
        ]);
        const finalTicketLinks = dedupe([
          validTicketsUrl,
          ...(homeTeamMatch ? asArray(homeTeamMatch.home_ticket_links) : []),
          ...(awayTeamMatch ? asArray(awayTeamMatch.away_ticket_links) : []),
        ]);

        // Nace siempre "scheduled" y como borrador — nunca se calcula
        // live/finished al importar (ese cálculo ya no vive aquí, ver
        // matchStatus.js del lado del organizador una vez publicado).
        const result = await db.prepare(`
          INSERT INTO matches (category_id, branch_id, home_team, away_team, match_date, venue, venue_id, stream_links, ticket_links, week_label, status, home_score, away_score, timezone, is_draft)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, TRUE)
        `).run(
          category.id,
          branch.id,
          homeTeam,
          awayTeam,
          matchDate || null,
          venueRaw ? venueRaw.toUpperCase() : null,
          venueId,
          JSON.stringify(finalStreamLinks),
          JSON.stringify(finalTicketLinks),
          weekLabel ? weekLabel.toUpperCase() : null,
          homeScore,
          awayScore,
          timezone,
        );

        imported.push(result.lastInsertRowid);
      } catch (err) {
        skipped.push({ row: rowN, reason: err.message });
      }
    }

    res.status(201).json({
      imported:    imported.length,
      skipped:     skipped.length,
      skippedRows: skipped,
      warnings:    warnings.length,
      warningRows: warnings,
    });
  })
);

router.put('/matches/:id', authRequired, matchOwnerRequired, asyncHandler(async (req, res) => {
  // match_date_local: igual que en creación, el string crudo del input
  // <datetime-local> (o ausente, si esta edición no toca la fecha/hora).
  const { home_team, away_team, match_date_local, venue_id, group_id, group_id_2, stream_links, ticket_links, week_label, status, home_score, away_score, timezone, branch_id, category_id, is_draft } = req.body;
  const m = req.match;

  const effectiveCategoryId = category_id || m.category_id;
  const effectiveCategory   = await db.prepare('SELECT * FROM categories WHERE id = ?').get(effectiveCategoryId);

  // No se puede publicar (is_draft: false) un partido cuya Categoría o Rama
  // efectiva (la nueva, si se está cambiando en esta misma edición, o si no,
  // la que ya tenía) siga siendo la "Sin clasificar" automática.
  if (is_draft === false) {
    const effectiveBranchId = branch_id !== undefined ? branch_id : m.branch_id;
    const br = effectiveBranchId
      ? await db.prepare('SELECT is_placeholder FROM branches WHERE id = ?').get(effectiveBranchId)
      : null;
    if (effectiveCategory?.is_placeholder || br?.is_placeholder) {
      return res.status(400).json({ error: 'Este partido sigue en "Sin clasificar" — asígnale una categoría y rama reales antes de publicarlo.' });
    }
  }

  const resolved = {
    home_team:   home_team   ?? m.home_team,
    away_team:   away_team   ?? m.away_team,
    stream_links: stream_links ?? m.stream_links,
    ticket_links: ticket_links ?? m.ticket_links,
    status:      status      ?? m.status,
    home_score:  home_score  !== undefined ? home_score : m.home_score,
    away_score:  away_score  !== undefined ? away_score : m.away_score,
    timezone:    timezone    ?? m.timezone,
    group_id:    group_id    !== undefined ? group_id   : m.group_id,
    group_id_2:  group_id_2  !== undefined ? group_id_2 : m.group_id_2,
  };

  const validationError = validateMatchFields(resolved);
  if (validationError) return res.status(400).json({ error: validationError });

  // Solo se recalcula match_date si esta edición tocó la fecha/hora o la
  // zona horaria (si no tocó ninguna de las dos, matchDateUtc queda en null
  // y el COALESCE de abajo conserva el valor que ya existía).
  let matchDateUtc = null;
  if (match_date_local !== undefined || timezone !== undefined) {
    const effectiveTimezone = (timezone !== undefined ? timezone : m.timezone) || req.league.timezone || 'America/Mexico_City';

    let localParts;
    if (match_date_local !== undefined) {
      // Se editó la fecha/hora (con o sin cambio de zona también): se toma
      // tal cual el string crudo del formulario.
      localParts = parseLocalDateTimeString(match_date_local);
      if (!localParts) return res.status(400).json({ error: 'La fecha y hora no son válidas' });
    } else {
      // Solo se cambió la zona horaria, sin tocar la fecha/hora: se
      // RE-interpreta la misma hora de pared (la que ya estaba guardada, leída
      // en su zona anterior) dentro de la nueva zona — en vez de dejar el
      // instante UTC intacto, que dejaría la hora mostrada corrida.
      localParts = getLocalPartsInZone(m.match_date, m.timezone || req.league.timezone || 'America/Mexico_City');
    }

    matchDateUtc = zonedTimeToUtcISO(localParts.year, localParts.month, localParts.day, localParts.hour, localParts.minute, effectiveTimezone);
  }

  // Se guarda siempre la zona ya resuelta cuando se tocó algo de fecha/hora,
  // para que el partido nunca quede con una zona ambigua.
  const resolvedTimezone = (match_date_local !== undefined || timezone !== undefined)
    ? ((timezone !== undefined ? timezone : m.timezone) || req.league.timezone || 'America/Mexico_City')
    : null; // null aquí = "no tocar" para el COALESCE de abajo

  // Se re-resuelve en cada edición (no solo cuando cambia el nombre) — así,
  // si un equipo se inscribe al torneo DESPUÉS de haberse creado el
  // partido, la próxima vez que se edite el partido queda conectado solo.
  const homeTeamId = await resolveTeamId(effectiveCategory, resolved.home_team);
  const awayTeamId = await resolveTeamId(effectiveCategory, resolved.away_team);

  await db.prepare(`
    UPDATE matches SET
      home_team    = COALESCE(?, home_team),
      away_team    = COALESCE(?, away_team),
      home_team_id = ?,
      away_team_id = ?,
      match_date   = COALESCE(?, match_date),
      venue_id     = ?,
      group_id     = ?,
      group_id_2   = ?,
      branch_id    = ?,
      category_id  = COALESCE(?, category_id),
      is_draft     = COALESCE(?, is_draft),
      stream_links = COALESCE(?, stream_links),
      ticket_links = COALESCE(?, ticket_links),
      week_label   = COALESCE(?, week_label),
      status       = COALESCE(?, status),
      home_score   = COALESCE(?, home_score),
      away_score   = COALESCE(?, away_score),
      timezone     = COALESCE(?, timezone)
    WHERE id = ?
  `).run(
    toNull(home_team), toNull(away_team),
    homeTeamId, awayTeamId,
    toNull(matchDateUtc),
    venue_id  !== undefined ? (venue_id  || null) : m.venue_id,
    group_id  !== undefined ? (group_id  || null) : m.group_id,
    group_id_2 !== undefined ? (group_id_2 || null) : m.group_id_2,
    branch_id !== undefined ? (branch_id || null) : m.branch_id,
    toNull(category_id),
    toNull(is_draft),
    toLinksJson(stream_links), toLinksJson(ticket_links), toNull(week_label), toNull(status),
    toNull(home_score), toNull(away_score), toNull(resolvedTimezone), m.id
  );

  res.json(await db.prepare('SELECT * FROM matches WHERE id = ?').get(m.id));
}));

// --- Estado manual del partido (nuevo, aislado) ---
// A propósito NO reutiliza el PUT general de arriba (que además exige
// marcador cuando el estado es "finished"). Subir estadísticas nunca debe
// depender de en qué estado esté el partido — son dos cosas separadas — así
// que esta ruta SOLO toca la columna status, sin exigir ni tocar el marcador.
// Los tres valores guardados en la base de datos siguen siendo los mismos de
// siempre (scheduled/live/finished); "Iniciado" es solo el texto que ve el
// organizador para el valor "live" — no se agrega ningún valor nuevo.

router.patch('/matches/:id/status', authRequired, matchOwnerRequired, asyncHandler(async (req, res) => {
  const { status } = req.body;
  const VALID_STATUSES = ['scheduled', 'live', 'finished'];
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Estado no válido. Debe ser scheduled, live o finished.' });
  }

  await db.prepare('UPDATE matches SET status = ? WHERE id = ?').run(status, req.match.id);

  res.json(await db.prepare('SELECT * FROM matches WHERE id = ?').get(req.match.id));
}));

// Publicar un partido borrador (ej. los que llegaron de un Excel recién
// subido). Ruta aislada y mínima, igual que la de estado — solo toca
// is_draft, sin exigir ni tocar ningún otro dato del partido.
router.patch('/matches/:id/publish', authRequired, matchOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('UPDATE matches SET is_draft = FALSE WHERE id = ?').run(req.match.id);
  res.json(await db.prepare('SELECT * FROM matches WHERE id = ?').get(req.match.id));
}));

router.delete('/matches/:id', authRequired, matchOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM matches WHERE id = ?').run(req.match.id);
  res.json({ ok: true });
}));

/* ===================== EQUIPOS ===================== */

function validateTeamFields({ contact_email, facebook_url, instagram_url, twitter_url, website_url, logo_url, cover_url, home_stream_links, away_stream_links, home_ticket_links, away_ticket_links }) {
  if (contact_email && !isValidEmail(contact_email)) return 'El correo de contacto no tiene un formato válido';
  if (facebook_url  && !isValidUrl(facebook_url))    return 'El enlace de Facebook no es una dirección web válida';
  if (instagram_url && !isValidUrl(instagram_url))   return 'El enlace de Instagram no es una dirección web válida';
  if (twitter_url   && !isValidUrl(twitter_url))     return 'El enlace de X / Twitter no es una dirección web válida';
  if (website_url   && !isValidUrl(website_url))     return 'El sitio web no es una dirección web válida';
  if (logo_url      && !isValidUrl(logo_url))        return 'El logo no es una dirección web válida';
  if (cover_url     && !isValidUrl(cover_url))       return 'La imagen de portada no es una dirección web válida';
  const homeStreamError = validateLinksList(home_stream_links, 'transmisión en casa');
  if (homeStreamError) return homeStreamError;
  const awayStreamError = validateLinksList(away_stream_links, 'transmisión de visita');
  if (awayStreamError) return awayStreamError;
  const homeTicketError = validateLinksList(home_ticket_links, 'boletos en casa');
  if (homeTicketError) return homeTicketError;
  const awayTicketError = validateLinksList(away_ticket_links, 'boletos de visita');
  if (awayTicketError) return awayTicketError;
  return null;
}

// Busca equipos de CUALQUIER liga por nombre — para inscribir a un
// torneo un equipo que no sea de la liga dueña de ese torneo.
router.get('/teams/search', authRequired, asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);

  const teams = await db.prepare(`
    SELECT t.*, l.name AS home_league_name
    FROM teams t
    LEFT JOIN leagues l ON l.id = t.league_id
    WHERE t.name ILIKE ?
    ORDER BY t.name ASC
    LIMIT 20
  `).all(`%${q}%`);
  res.json(teams);
}));

router.post('/leagues/:leagueId/teams', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const {
    name, logo_url, cover_url, location, contact_email, contact_phone,
    facebook_url, instagram_url, twitter_url, website_url, sort_order,
    home_stream_links, away_stream_links, home_ticket_links, away_ticket_links,
  } = req.body;

  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre del equipo es obligatorio' });

  const validationError = validateTeamFields({ contact_email, facebook_url, instagram_url, twitter_url, website_url, logo_url, cover_url, home_stream_links, away_stream_links, home_ticket_links, away_ticket_links });
  if (validationError) return res.status(400).json({ error: validationError });

  const result = await db.prepare(`
    INSERT INTO teams (league_id, name, logo_url, cover_url, location, contact_email, contact_phone, facebook_url, instagram_url, twitter_url, website_url, sort_order, home_stream_links, away_stream_links, home_ticket_links, away_ticket_links)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.league.id, name.trim().toUpperCase(),
    logo_url      || null,
    cover_url     || null,
    location      ? location.trim().toUpperCase()      : null,
    contact_email || null,
    contact_phone ? contact_phone.trim().toUpperCase() : null,
    facebook_url  || null,
    instagram_url || null,
    twitter_url   || null,
    website_url   || null,
    sort_order    || 0,
    JSON.stringify(Array.isArray(home_stream_links) ? home_stream_links.filter((u) => u && u.trim()) : []),
    JSON.stringify(Array.isArray(away_stream_links) ? away_stream_links.filter((u) => u && u.trim()) : []),
    JSON.stringify(Array.isArray(home_ticket_links) ? home_ticket_links.filter((u) => u && u.trim()) : []),
    JSON.stringify(Array.isArray(away_ticket_links) ? away_ticket_links.filter((u) => u && u.trim()) : []),
  );

  res.status(201).json(await db.prepare('SELECT * FROM teams WHERE id = ?').get(result.lastInsertRowid));
}));

router.put('/teams/:id', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const {
    name, logo_url, cover_url, location, contact_email, contact_phone,
    facebook_url, instagram_url, twitter_url, website_url, sort_order,
    home_stream_links, away_stream_links, home_ticket_links, away_ticket_links,
  } = req.body;
  const t = req.team;

  const resolved = {
    contact_email: contact_email ?? t.contact_email,
    facebook_url:  facebook_url  ?? t.facebook_url,
    instagram_url: instagram_url ?? t.instagram_url,
    twitter_url:   twitter_url   ?? t.twitter_url,
    website_url:   website_url   ?? t.website_url,
    logo_url:      logo_url      ?? t.logo_url,
    cover_url:     cover_url     ?? t.cover_url,
    home_stream_links, away_stream_links, home_ticket_links, away_ticket_links,
  };
  const validationError = validateTeamFields(resolved);
  if (validationError) return res.status(400).json({ error: validationError });

  await db.prepare(`
    UPDATE teams SET
      name              = COALESCE(?, name),
      logo_url          = COALESCE(?, logo_url),
      cover_url         = COALESCE(?, cover_url),
      location          = COALESCE(?, location),
      contact_email     = COALESCE(?, contact_email),
      contact_phone     = COALESCE(?, contact_phone),
      facebook_url      = COALESCE(?, facebook_url),
      instagram_url     = COALESCE(?, instagram_url),
      twitter_url       = COALESCE(?, twitter_url),
      website_url       = COALESCE(?, website_url),
      sort_order        = COALESCE(?, sort_order),
      home_stream_links = COALESCE(?, home_stream_links),
      away_stream_links = COALESCE(?, away_stream_links),
      home_ticket_links = COALESCE(?, home_ticket_links),
      away_ticket_links = COALESCE(?, away_ticket_links)
    WHERE id = ?
  `).run(
    toNull(name),          toNull(logo_url),      toNull(cover_url),
    toNull(location),      toNull(contact_email), toNull(contact_phone),
    toNull(facebook_url),  toNull(instagram_url), toNull(twitter_url),
    toNull(website_url),   toNull(sort_order),
    toLinksJson(home_stream_links), toLinksJson(away_stream_links),
    toLinksJson(home_ticket_links), toLinksJson(away_ticket_links),
    t.id,
  );

  const updatedTeam = await db.prepare('SELECT * FROM teams WHERE id = ?').get(t.id);
  await syncTeamLinksToMatches(updatedTeam);
  res.json(updatedTeam);
}));

// Convierte de nuevo el jsonb que regresa Postgres a un array de JS
// (por si llega ya parseado o como texto, según el driver).
function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return []; } }
  return [];
}

function dedupe(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

// Después de guardar un equipo, sus links "en casa"/"de visita" actualizados
// se reflejan de inmediato en TODOS sus partidos que aún no se hayan jugado
// (programados o en vivo) — exacto, no solo agregando: si un link se quitó
// del equipo, también desaparece de esos partidos. Los partidos ya
// finalizados nunca se tocan, para no reescribir el historial.
async function syncTeamLinksToMatches(team) {
  const matches = await db.prepare(`
    SELECT
      m.id, m.home_team, m.away_team,
      th.home_stream_links AS h_stream, th.home_ticket_links AS h_ticket,
      ta.away_stream_links AS a_stream, ta.away_ticket_links AS a_ticket
    FROM matches m
    JOIN categories c ON c.id = m.category_id
    LEFT JOIN teams th ON th.league_id = c.league_id AND UPPER(th.name) = UPPER(m.home_team)
    LEFT JOIN teams ta ON ta.league_id = c.league_id AND UPPER(ta.name) = UPPER(m.away_team)
    WHERE c.league_id = ?
      AND m.status <> 'finished'
      AND (UPPER(m.home_team) = UPPER(?) OR UPPER(m.away_team) = UPPER(?))
  `).all(team.league_id, team.name, team.name);

  for (const m of matches) {
    const streamLinks = dedupe([...asArray(m.h_stream), ...asArray(m.a_stream)]);
    const ticketLinks = dedupe([...asArray(m.h_ticket), ...asArray(m.a_ticket)]);
    await db.prepare(`UPDATE matches SET stream_links = ?, ticket_links = ? WHERE id = ?`)
      .run(JSON.stringify(streamLinks), JSON.stringify(ticketLinks), m.id);
  }
}

router.delete('/teams/:id', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM teams WHERE id = ?').run(req.team.id);
  res.json({ ok: true });
}));

/* ===================== SEDES ===================== */

function validateVenueFields({ contact_email, cover_url, address }) {
  if (contact_email && !isValidEmail(contact_email)) return 'El correo de contacto no tiene un formato válido';
  if (cover_url      && !isValidUrl(cover_url))       return 'La imagen de portada no es una dirección web válida';
  if (address        && !isValidGoogleMapsUrl(address)) return 'El link de Google Maps no es válido (debe ser un link como https://maps.app.goo.gl/… o https://www.google.com/maps/…)';
  return null;
}

router.post('/leagues/:leagueId/venues', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const {
    name, institution, cover_url, address, contact_phone, contact_email, sort_order,
  } = req.body;

  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre de la sede es obligatorio' });

  const validationError = validateVenueFields({ contact_email, cover_url, address });
  if (validationError) return res.status(400).json({ error: validationError });

  const result = await db.prepare(`
    INSERT INTO venues (league_id, name, institution, cover_url, address, contact_phone, contact_email, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.league.id,
    name.trim().toUpperCase(),
    institution   ? institution.trim().toUpperCase()   : null,
    cover_url     || null,
    address       ? address.trim()                     : null,
    contact_phone ? contact_phone.trim().toUpperCase() : null,
    contact_email || null,
    sort_order    || 0,
  );

  res.status(201).json(await db.prepare('SELECT * FROM venues WHERE id = ?').get(result.lastInsertRowid));
}));

router.put('/venues/:id', authRequired, venueOwnerRequired, asyncHandler(async (req, res) => {
  const {
    name, institution, cover_url, address, contact_phone, contact_email, sort_order,
  } = req.body;
  const v = req.venue;

  const resolved = {
    contact_email: contact_email ?? v.contact_email,
    cover_url:     cover_url     ?? v.cover_url,
    address:       address       ?? v.address,
  };
  const validationError = validateVenueFields(resolved);
  if (validationError) return res.status(400).json({ error: validationError });

  await db.prepare(`
    UPDATE venues SET
      name          = COALESCE(?, name),
      institution   = COALESCE(?, institution),
      cover_url     = COALESCE(?, cover_url),
      address       = COALESCE(?, address),
      contact_phone = COALESCE(?, contact_phone),
      contact_email = COALESCE(?, contact_email),
      sort_order    = COALESCE(?, sort_order)
    WHERE id = ?
  `).run(
    toNull(name),        toNull(institution),   toNull(cover_url),
    toNull(address),     toNull(contact_phone), toNull(contact_email),
    toNull(sort_order),  v.id,
  );

  res.json(await db.prepare('SELECT * FROM venues WHERE id = ?').get(v.id));
}));

router.delete('/venues/:id', authRequired, venueOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM venues WHERE id = ?').run(req.venue.id);
  res.json({ ok: true });
}));

/* ===================== PANEL DE LIGA ===================== */

router.get('/leagues/:leagueId/manage', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const league = req.league;
  const categories = await db.prepare('SELECT * FROM categories WHERE league_id = ? ORDER BY sort_order ASC, name ASC').all(league.id);
  const categoriesWithMatches = await Promise.all(
    categories.map(async (cat) => ({
      ...cat,
      matches: await db.prepare('SELECT * FROM matches WHERE category_id = ? ORDER BY match_date ASC').all(cat.id),
      groups:  await db.prepare('SELECT * FROM groups WHERE category_id = ? ORDER BY sort_order ASC, name ASC').all(cat.id),
    }))
  );
  const teams  = await db.prepare('SELECT * FROM teams WHERE league_id = ? ORDER BY sort_order ASC, name ASC').all(league.id);
  const venues = await db.prepare('SELECT * FROM venues WHERE league_id = ? ORDER BY sort_order ASC, name ASC').all(league.id);
  res.json({ league, categories: categoriesWithMatches, teams, venues });
}));

export default router;
