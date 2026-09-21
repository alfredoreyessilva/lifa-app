import express from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { categoryOwnerRequired, matchOwnerRequired, matchScoreRequired, leagueOwnerRequired, teamOwnerRequired, venueOwnerRequired, groupOwnerRequired, branchOwnerRequired, conferenceOwnerRequired, tournamentOwnerRequired, phaseOwnerRequired, titleOwnerRequired } from '../middleware/ownership.js';
import { isValidEmail, isValidUrl, isValidGoogleMapsUrl, isNonEmptyString } from '../utils/validation.js';
import {
  isValidTimezone,
  zonedTimeToUtcISO,
  localDateTimeStringToUtcISO,
  getLocalPartsInZone,
  parseLocalDateTimeString,
} from '../utils/timezones.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notifyMatchFollowers } from '../utils/pushNotifier.js';
import { PHASE_TYPES, PHASE_TYPE_KEYS } from '../utils/matchPhase.js';
import { TIEBREAKER_CATALOG, TIEBREAKER_PRESETS } from '../utils/standings.js';
import { buildBranchStandings } from '../utils/branchStandings.js';
import { interruptoresDeCategoria } from '../utils/rosterVisibility.js';
import { orgTieneMiembros } from '../utils/orgMembers.js';

const router = express.Router();

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

// Fase 3 — avisos push en tiempo real a los SEGUIDORES de un partido, tras
// guardar una edición. Compara la fila antes/después y manda push solo por
// lo que cambió de verdad. Nunca lanza hacia afuera (el que llama la envuelve
// en try/catch); pushNotifier además captura sus propios errores de red.
// Coordina con el cronjob a través de las mismas banderas notified_live /
// notified_final para que un evento no se avise dos veces.
async function pushMatchEditAlerts(before, after) {
  if (!after || after.is_draft) return;

  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const hadScore = num(before.home_score) !== null && num(before.away_score) !== null;
  const hasScore = num(after.home_score)  !== null && num(after.away_score)  !== null;

  // 1. Marcador final: pasó de "sin marcador completo" a "con marcador
  //    completo" y aún no se había avisado.
  if (!before.notified_final && !hadScore && hasScore) {
    await notifyMatchFollowers(after.id, {
      eventType: 'final_score',
      title: `🏆 Marcador final — ${after.home_team} vs ${after.away_team}`,
      body:  `Resultado: ${after.home_team} ${after.home_score} · ${after.away_team} ${after.away_score}.`,
      url:   `/partidos/${after.id}`,
    });
    await db.prepare('UPDATE matches SET notified_final = TRUE WHERE id = ?').run(after.id);
  }

  // 2. Arranque manual: el organizador marcó "en vivo" antes de que el cron
  //    lo detectara (o en una categoría sin auto-status).
  if (after.status === 'live' && before.status !== 'live' && !before.notified_live) {
    await notifyMatchFollowers(after.id, {
      eventType: 'live',
      title: `🔴 EN VIVO — ${after.home_team} vs ${after.away_team}`,
      body:  '¡El partido ya comenzó!',
      url:   `/partidos/${after.id}`,
    });
    await db.prepare('UPDATE matches SET notified_live = TRUE WHERE id = ?').run(after.id);
  }

  // 3. Cambio de fecha/hora o de sede en un partido que todavía no ocurre.
  const dateChanged  = String(before.match_date) !== String(after.match_date);
  const venueChanged = (before.venue_id || null) !== (after.venue_id || null);
  const isFuture     = new Date(after.match_date).getTime() > Date.now();
  if (isFuture && (dateChanged || venueChanged)) {
    const body =
      dateChanged && venueChanged ? 'Cambiaron la fecha/hora y la sede de este partido.'
      : dateChanged               ? 'Cambió la fecha u hora de este partido.'
      :                             'Cambió la sede de este partido.';
    await notifyMatchFollowers(after.id, {
      eventType: 'schedule_change',
      title: `📅 Cambio de programación — ${after.home_team} vs ${after.away_team}`,
      body,
      url:   `/partidos/${after.id}`,
    });
  }
}
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

  // Los dos interruptores del roster público viajan juntos por el mismo motivo
  // que el de arriba: editar el nombre de la categoría no puede apagarle la
  // foto a nadie, ni encenderla. Si la edición no los menciona, no se tocan.
  const roster = interruptoresDeCategoria(req.body);
  const rosterSql = roster ? ',\n      roster_public = ?,\n      roster_photos = ?' : '';

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
  if (roster) {
    params.push(roster.roster_public, roster.roster_photos);
  }
  params.push(req.category.id);

  await db.prepare(`
    UPDATE categories SET
      name       = COALESCE(?, name),
      sort_order = COALESCE(?, sort_order),
      season     = COALESCE(?, season),
      year       = COALESCE(?, year),
      auto_status_enabled      = COALESCE(?, auto_status_enabled),
      auto_status_window_hours = ${hoursSql}${rosterSql}
    WHERE id = ?
  `).run(...params);

  res.json(await db.prepare('SELECT * FROM categories WHERE id = ?').get(req.category.id));
}));

router.delete('/categories/:categoryId', authRequired, categoryOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM categories WHERE id = ?').run(req.category.id);
  res.json({ ok: true });
}));

// Renombra un torneo (y opcionalmente cambia su año). No toca nada de lo
// que cuelga de él.
router.put('/tournaments/:tournamentId', authRequired, tournamentOwnerRequired, asyncHandler(async (req, res) => {
  const { name, year, sort_order, logo_url } = req.body;
  if (name !== undefined && !isNonEmptyString(name)) {
    return res.status(400).json({ error: 'El nombre del torneo no puede estar vacío' });
  }
  if (year !== undefined && !Number.isInteger(parseInt(year))) {
    return res.status(400).json({ error: 'El año no es válido' });
  }

  await db.prepare(`
    UPDATE tournaments SET
      name       = COALESCE(?, name),
      year       = COALESCE(?, year),
      sort_order = COALESCE(?, sort_order),
      logo_url   = COALESCE(?, logo_url)
    WHERE id = ?
  `).run(
    toNull(name ? name.trim() : name),
    toNull(year !== undefined ? parseInt(year) : year),
    toNull(sort_order),
    toNull(logo_url),
    req.tournament.id,
  );

  res.json(await db.prepare('SELECT * FROM tournaments WHERE id = ?').get(req.tournament.id));
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

router.put('/branches/:branchId', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  const { name, sort_order } = req.body;
  if (name !== undefined && !isNonEmptyString(name)) {
    return res.status(400).json({ error: 'El nombre de la rama no puede estar vacío' });
  }

  await db.prepare(`
    UPDATE branches SET
      name       = COALESCE(?, name),
      sort_order = COALESCE(?, sort_order)
    WHERE id = ?
  `).run(
    toNull(name ? name.trim() : name),
    toNull(sort_order),
    req.branch.id,
  );

  res.json(await db.prepare('SELECT * FROM branches WHERE id = ?').get(req.branch.id));
}));

// Borra una rama y, en cascada, sus conferencias, grupos y partidos.
router.delete('/branches/:branchId', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM branches WHERE id = ?').run(req.branch.id);
  res.json({ ok: true });
}));

// Partidos de una Rama con todos los campos que MatchForm.jsx necesita para
// crear/editar un partido de verdad: marcador, sede, links, zona horaria,
// estado, etc.
router.get('/branches/:branchId/matches', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  const matches = await db.prepare(`
    SELECT
      m.*,
      c.auto_status_enabled      AS auto_status_enabled,
      c.auto_status_window_hours AS auto_status_window_hours
    FROM matches m
    JOIN categories c ON c.id = m.category_id
    WHERE m.branch_id = ?
    ORDER BY m.match_date ASC
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
      c.auto_status_enabled      AS auto_status_enabled,
      c.auto_status_window_hours AS auto_status_window_hours,
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

router.put('/conferences/:conferenceId', authRequired, conferenceOwnerRequired, asyncHandler(async (req, res) => {
  const { name, sort_order } = req.body;
  if (name !== undefined && !isNonEmptyString(name)) {
    return res.status(400).json({ error: 'El nombre de la conferencia no puede estar vacío' });
  }

  await db.prepare(`
    UPDATE conferences SET
      name       = COALESCE(?, name),
      sort_order = COALESCE(?, sort_order)
    WHERE id = ?
  `).run(
    toNull(name ? name.trim() : name),
    toNull(sort_order),
    req.conference.id,
  );

  res.json(await db.prepare('SELECT * FROM conferences WHERE id = ?').get(req.conference.id));
}));

// Borra una conferencia y, en cascada, sus grupos. Los partidos que apunten
// a esa conferencia (conference_id) quedan sin conferencia, no se borran.
router.delete('/conferences/:conferenceId', authRequired, conferenceOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM conferences WHERE id = ?').run(req.conference.id);
  res.json({ ok: true });
}));

// Grupo colgado DIRECTO de la rama, sin conferencia — ambos niveles son
// opcionales e independientes (ver comentario en db.js sobre groups.branch_id).
router.post('/branches/:branchId/groups', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  const { name, sort_order } = req.body;
  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre del grupo es obligatorio' });

  const result = await db.prepare(`
    INSERT INTO groups (category_id, branch_id, name, sort_order)
    VALUES (?, ?, ?, ?)
  `).run(req.category.id, req.branch.id, name.trim(), sort_order || 0);

  res.status(201).json(await db.prepare('SELECT * FROM groups WHERE id = ?').get(result.lastInsertRowid));
}));

// Todos los grupos de la rama de una sola vez: los colgados directo de
// ella + los que cuelgan de cualquiera de sus conferencias — para la
// pestaña "Grupos" del panel, que los muestra juntos en una sola lista.
router.get('/branches/:branchId/groups', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  const groups = await db.prepare(`
    SELECT g.*, c.name AS conference_name
    FROM groups g
    LEFT JOIN conferences c ON c.id = g.conference_id
    WHERE g.branch_id = ?
       OR g.conference_id IN (SELECT id FROM conferences WHERE branch_id = ?)
    ORDER BY c.name ASC NULLS FIRST, g.sort_order ASC, g.name ASC
  `).all(req.branch.id, req.branch.id);
  res.json(groups);
}));

// Equipos inscritos en esta rama. Antes era una conclusión implícita (el
// equipo aparecía porque ya tenía partidos); ahora es explícito, para poder
// subirle su roster desde antes de que exista el calendario.
//
// Trae además la conferencia/grupo del equipo dentro de esta rama: es el dato
// del que los partidos deducen su conferencia, en vez de capturarla uno por
// uno (ver utils/matchScope.js).
router.get('/branches/:branchId/teams', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  const teams = await db.prepare(`
    SELECT bt.id AS branch_team_id, t.id, t.name, t.logo_url,
           bt.conference_id, cf.name AS conference_name,
           bt.group_id,      g.name  AS group_name
    FROM branch_teams bt
    JOIN teams t ON t.id = bt.team_id
    LEFT JOIN conferences cf ON cf.id = bt.conference_id
    LEFT JOIN groups      g  ON g.id  = bt.group_id
    WHERE bt.branch_id = ?
    ORDER BY t.name
  `).all(req.branch.id);
  res.json(teams);
}));

// Valida que la conferencia y el grupo que se quieren asignar a un equipo
// pertenezcan de verdad a ESTA rama. Sin esto se podría colar el id de una
// conferencia de otra liga y los partidos quedarían derivando hacia una
// estructura que no les corresponde. Devuelve el error, o null si todo bien.
async function validateScopeForBranch(branch, conferenceId, groupId) {
  if (conferenceId) {
    const conference = await db.prepare('SELECT * FROM conferences WHERE id = ? AND branch_id = ?')
      .get(conferenceId, branch.id);
    if (!conference) return 'La conferencia indicada no pertenece a esta rama';
  }
  if (groupId) {
    const group = await db.prepare(`
      SELECT g.* FROM groups g
      WHERE g.id = ?
        AND (g.branch_id = ? OR g.conference_id IN (SELECT id FROM conferences WHERE branch_id = ?))
    `).get(groupId, branch.id, branch.id);
    if (!group) return 'El grupo indicado no pertenece a esta rama';
    // Si vienen los dos, tienen que ser coherentes entre sí: un grupo que
    // cuelga de la conferencia B no puede representar al equipo en la A.
    if (conferenceId && group.conference_id && Number(group.conference_id) !== Number(conferenceId)) {
      return 'El grupo elegido no pertenece a esa conferencia';
    }
  }
  return null;
}

// Inscribe un equipo a esta rama. Solo la liga puede hacerlo (branchOwnerRequired
// da acceso por dueño de LIGA, no de equipo) — se decidió explícitamente no
// permitir que un equipo se auto-inscriba.
//
// conference_id/group_id son opcionales: una rama que no se divide en
// conferencias simplemente no los manda. Cuando sí vienen, es el momento en
// que se dice UNA vez lo que antes se repetía en cada partido.
router.post('/branches/:branchId/teams', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  const { team_id, conference_id, group_id } = req.body;
  if (!team_id) return res.status(400).json({ error: 'team_id es obligatorio' });

  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(team_id);
  if (!team) return res.status(404).json({ error: 'Equipo no encontrado' });

  const scopeError = await validateScopeForBranch(req.branch, conference_id, group_id);
  if (scopeError) return res.status(400).json({ error: scopeError });

  // DO UPDATE en vez de DO NOTHING: volver a inscribir un equipo que ya
  // estaba, ahora con conferencia, tiene que poder corregirla y no salir en
  // silencio sin haber hecho nada.
  const branchTeam = await db.prepare(`
    INSERT INTO branch_teams (branch_id, team_id, conference_id, group_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (branch_id, team_id) DO UPDATE
      SET conference_id = EXCLUDED.conference_id,
          group_id      = EXCLUDED.group_id
    RETURNING *
  `).get(req.branch.id, team_id, conference_id || null, group_id || null);

  res.status(201).json(branchTeam);
}));

// Cambia la conferencia/grupo de un equipo YA inscrito, sin tener que darlo
// de baja y volverlo a inscribir. Al cambiarla, todos los partidos de ese
// equipo en esta rama pasan a derivar la conferencia nueva de inmediato: no
// hay nada que actualizar partido por partido.
router.put('/branches/:branchId/teams/:teamId', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  const { conference_id, group_id } = req.body;

  const existing = await db.prepare('SELECT * FROM branch_teams WHERE branch_id = ? AND team_id = ?')
    .get(req.branch.id, req.params.teamId);
  if (!existing) return res.status(404).json({ error: 'Ese equipo no está inscrito en esta rama' });

  const scopeError = await validateScopeForBranch(req.branch, conference_id, group_id);
  if (scopeError) return res.status(400).json({ error: scopeError });

  const updated = await db.prepare(`
    UPDATE branch_teams SET conference_id = ?, group_id = ?
    WHERE branch_id = ? AND team_id = ?
    RETURNING *
  `).get(conference_id || null, group_id || null, req.branch.id, req.params.teamId);

  res.json(updated);
}));

router.delete('/branches/:branchId/teams/:teamId', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM branch_teams WHERE branch_id = ? AND team_id = ?').run(req.branch.id, req.params.teamId);
  res.json({ ok: true });
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
  const { home_team, away_team, match_date_local, venue_id, group_id, group_id_2, conference_id, conference_override_id, stream_links, ticket_links, week_label, status, home_score, away_score, timezone, branch_id, phase_id } = req.body;
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
    INSERT INTO matches (category_id, branch_id, home_team, away_team, home_team_id, away_team_id, match_date, venue_id, group_id, group_id_2, conference_id, conference_override_id, stream_links, ticket_links, week_label, status, home_score, away_score, timezone, phase_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    // Si el partido sí tiene grupo, la conferencia se sabe por ahí — no se
    // guardan las dos cosas a la vez, para no tener dos fuentes de verdad.
    //
    // Normalmente esto ya ni llega: el formulario dejó de mandar conference_id
    // porque la conferencia se deduce de los equipos. Se sigue aceptando para
    // la liga que todavía no le puso conferencia a sus equipos — ahí este
    // valor es el único que hay, y sirve de respaldo (ver utils/matchScope.js).
    group_id ? null : (conference_id || null),
    // La excepción explícita: "este partido va en ESTA conferencia aunque sus
    // equipos digan otra". Casi siempre null.
    conference_override_id || null,
    JSON.stringify(Array.isArray(stream_links) ? stream_links.filter((u) => u && u.trim()) : []),
    JSON.stringify(Array.isArray(ticket_links) ? ticket_links.filter((u) => u && u.trim()) : []),
    week_label  ? week_label.trim().toUpperCase() : null,
    resolvedStatus,
    home_score === '' || home_score === undefined ? null : home_score,
    away_score === '' || away_score === undefined ? null : away_score,
    // Se guarda SIEMPRE la zona ya resuelta (nunca null), para que el
    // partido nunca quede con una zona horaria ambigua en la base de datos.
    effectiveTimezone,
    // Fase del calendario (temporada regular, playoffs…). En null se deriva
    // de week_label al leer — ver utils/matchPhase.js — así que ninguna liga
    // tiene que capturarla para que su tabla de posiciones salga bien.
    phase_id || null,
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

    // Opcional: importar a una Rama concreta de esta categoría (modelo nuevo).
    // Si viene, cada partido nace con branch_id, y los grupos se buscan en el
    // ámbito de la rama (directos + los de sus conferencias) en vez de la
    // categoría entera.
    let branchId = null;
    if (req.body.branch_id) {
      const branch = await db.prepare('SELECT * FROM branches WHERE id = ? AND category_id = ?')
        .get(req.body.branch_id, req.category.id);
      if (!branch) return res.status(400).json({ error: 'La rama indicada no pertenece a esta categoría' });
      branchId = branch.id;
    }

    // Equipos y sedes reales de esta liga, y grupos de esta categoría (o de la
    // rama, si se indicó una), para intentar hacer coincidir el texto del
    // Excel contra ellos (sin importar mayúsculas/minúsculas) y así no
    // reintroducir duplicados por texto libre.
    const registeredTeams  = await db.prepare(`
      SELECT id, name, home_stream_links, away_stream_links, home_ticket_links, away_ticket_links
      FROM teams WHERE league_id = ?
    `).all(req.league.id);
    const registeredVenues = await db.prepare('SELECT id, name FROM venues WHERE league_id = ?').all(req.league.id);
    const registeredGroups = branchId
      ? await db.prepare(`
          SELECT id, name FROM groups
          WHERE branch_id = ? OR conference_id IN (SELECT id FROM conferences WHERE branch_id = ?)
        `).all(branchId, branchId)
      : await db.prepare('SELECT id, name FROM groups WHERE category_id = ?').all(req.category.id);

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
        // home_team_id/away_team_id: el importador guardaba SOLO el nombre en
        // texto, así que un partido importado no sabía contra qué fila de
        // `teams` corresponde. Eso dejaba fuera de la derivación de
        // conferencia (utils/matchScope.js) a todo calendario cargado por
        // Excel — justo el camino por el que entran los calendarios grandes.
        // Cuando el nombre no coincide con ningún equipo registrado queda en
        // null, igual que antes, y el partido se importa de todos modos (ya
        // se avisa de eso en `warnings`).
        const result = await db.prepare(`
          INSERT INTO matches (category_id, branch_id, home_team, away_team, home_team_id, away_team_id, match_date, venue, venue_id, group_id, group_id_2, stream_links, ticket_links, week_label, status, home_score, away_score, timezone)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          req.category.id,
          branchId,
          homeTeam,
          awayTeam,
          homeTeamMatch ? homeTeamMatch.id : null,
          awayTeamMatch ? awayTeamMatch.id : null,
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

router.put('/matches/:id', authRequired, matchScoreRequired, asyncHandler(async (req, res) => {
  // match_date_local: igual que en creación, el string crudo del input
  // <datetime-local> (o ausente, si esta edición no toca la fecha/hora).
  const { home_team, away_team, match_date_local, venue_id, group_id, group_id_2, conference_id, conference_override_id, stream_links, ticket_links, week_label, status, home_score, away_score, timezone, branch_id, category_id, is_draft, phase_id } = req.body;
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

  // Si el partido efectivo termina CON grupo, la conferencia se sabe por
  // ahí (nunca se guardan las dos a la vez, para no tener dos fuentes de
  // verdad) — igual que en creación.
  const effectiveConferenceId = resolved.group_id
    ? null
    : (conference_id !== undefined ? (conference_id || null) : m.conference_id);

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
      conference_id = ?,
      conference_override_id = ?,
      branch_id    = ?,
      category_id  = COALESCE(?, category_id),
      is_draft     = COALESCE(?, is_draft),
      stream_links = COALESCE(?, stream_links),
      ticket_links = COALESCE(?, ticket_links),
      week_label   = COALESCE(?, week_label),
      status       = COALESCE(?, status),
      home_score   = COALESCE(?, home_score),
      away_score   = COALESCE(?, away_score),
      timezone     = COALESCE(?, timezone),
      phase_id     = ?
    WHERE id = ?
  `).run(
    toNull(home_team), toNull(away_team),
    homeTeamId, awayTeamId,
    toNull(matchDateUtc),
    venue_id  !== undefined ? (venue_id  || null) : m.venue_id,
    group_id  !== undefined ? (group_id  || null) : m.group_id,
    group_id_2 !== undefined ? (group_id_2 || null) : m.group_id_2,
    effectiveConferenceId,
    conference_override_id !== undefined ? (conference_override_id || null) : m.conference_override_id,
    branch_id !== undefined ? (branch_id || null) : m.branch_id,
    toNull(category_id),
    toNull(is_draft),
    toLinksJson(stream_links), toLinksJson(ticket_links), toNull(week_label), toNull(status),
    toNull(home_score), toNull(away_score), toNull(resolvedTimezone),
    // Se escribe directo (sin COALESCE) para poder BORRAR la fase mandando
    // null; con COALESCE, quitarla una vez puesta seria imposible.
    phase_id !== undefined ? (phase_id || null) : m.phase_id,
    m.id
  );

  const updatedMatch = await db.prepare('SELECT * FROM matches WHERE id = ?').get(m.id);
  // No bloqueamos la respuesta con el envío de push (puede tardar por red).
  // pushNotifier ya captura sus propios errores; aquí solo lo dejamos logueado.
  pushMatchEditAlerts(m, updatedMatch).catch((err) =>
    console.error('Error al mandar avisos push de edición de partido:', err)
  );
  res.json(updatedMatch);
}));

// --- Estado manual del partido (nuevo, aislado) ---
// A propósito NO reutiliza el PUT general de arriba (que además exige
// marcador cuando el estado es "finished"). Subir estadísticas nunca debe
// depender de en qué estado esté el partido — son dos cosas separadas — así
// que esta ruta SOLO toca la columna status, sin exigir ni tocar el marcador.
// Los tres valores guardados en la base de datos siguen siendo los mismos de
// siempre (scheduled/live/finished); "Iniciado" es solo el texto que ve el
// organizador para el valor "live" — no se agrega ningún valor nuevo.

router.patch('/matches/:id/status', authRequired, matchScoreRequired, asyncHandler(async (req, res) => {
  const { status } = req.body;
  const VALID_STATUSES = ['scheduled', 'live', 'finished'];
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Estado no válido. Debe ser scheduled, live o finished.' });
  }

  await db.prepare('UPDATE matches SET status = ? WHERE id = ?').run(status, req.match.id);

  const updatedMatch = await db.prepare('SELECT * FROM matches WHERE id = ?').get(req.match.id);
  pushMatchEditAlerts(req.match, updatedMatch).catch((err) =>
    console.error('Error al mandar avisos push de cambio de estado de partido:', err)
  );
  res.json(updatedMatch);
}));

router.delete('/matches/:id', authRequired, matchOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM matches WHERE id = ?').run(req.match.id);
  res.json({ ok: true });
}));

/* ===================== EQUIPOS ===================== */

function validateTeamFields({ contact_email, facebook_url, instagram_url, twitter_url, website_url, logo_url, away_logo_url, cover_url, home_stream_links, away_stream_links, home_ticket_links, away_ticket_links }) {
  if (contact_email && !isValidEmail(contact_email)) return 'El correo de contacto no tiene un formato válido';
  if (facebook_url  && !isValidUrl(facebook_url))    return 'El enlace de Facebook no es una dirección web válida';
  if (instagram_url && !isValidUrl(instagram_url))   return 'El enlace de Instagram no es una dirección web válida';
  if (twitter_url   && !isValidUrl(twitter_url))     return 'El enlace de X / Twitter no es una dirección web válida';
  if (website_url   && !isValidUrl(website_url))     return 'El sitio web no es una dirección web válida';
  if (logo_url      && !isValidUrl(logo_url))        return 'El logo no es una dirección web válida';
  if (away_logo_url && !isValidUrl(away_logo_url))   return 'El logo de visitante no es una dirección web válida';
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

// slugify simple, mismo patrón que routes/leagues.js y routes/organizations.js.
function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Crea la fila de "organizations" (identidad/verificación, ver
// organizations.is_verified) que le corresponde a un equipo — mismo shape
// que el backfill de db.js, pero al crear el equipo, no hasta el próximo
// arranque del servidor. El slug no se usa para navegación pública todavía,
// solo cumple la restricción UNIQUE de organizations.slug.
async function createTeamOrganization(name, { country_id, logo_url, description, website_url } = {}) {
  let slug = slugify(name);
  const existing = await db.prepare('SELECT id FROM organizations WHERE slug = ?').get(slug);
  if (existing) slug = `${slug}-${Date.now().toString().slice(-5)}`;

  return db.prepare(`
    INSERT INTO organizations (name, slug, type, country_id, logo_url, description, website_url, status)
    VALUES (?, ?, 'team', ?, ?, ?, ?, 'active')
    RETURNING *
  `).get(name, slug, country_id || null, logo_url || null, description || null, website_url || null);
}

// Mismo equipo, con country_id/description/is_verified pegados desde su
// organización — esos tres campos viven en "organizations" (la capa de
// identidad común), no se duplican en "teams".
async function getTeamWithOrgFields(id) {
  return db.prepare(`
    SELECT t.*, o.country_id AS country_id, o.description AS description, o.is_verified AS is_verified
    FROM teams t
    LEFT JOIN organizations o ON o.id = t.organization_id
    WHERE t.id = ?
  `).get(id);
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
    name, logo_url, away_logo_url, cover_url, location, contact_email, contact_phone,
    facebook_url, instagram_url, twitter_url, website_url, sort_order,
    home_stream_links, away_stream_links, home_ticket_links, away_ticket_links,
  } = req.body;

  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre del equipo es obligatorio' });

  const validationError = validateTeamFields({ contact_email, facebook_url, instagram_url, twitter_url, website_url, logo_url, away_logo_url, cover_url, home_stream_links, away_stream_links, home_ticket_links, away_ticket_links });
  if (validationError) return res.status(400).json({ error: validationError });

  const result = await db.prepare(`
    INSERT INTO teams (league_id, name, logo_url, away_logo_url, cover_url, location, contact_email, contact_phone, facebook_url, instagram_url, twitter_url, website_url, sort_order, home_stream_links, away_stream_links, home_ticket_links, away_ticket_links)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.league.id, name.trim().toUpperCase(),
    logo_url      || null,
    away_logo_url || null,
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

  // Y lo da de alta en el roster de la liga (`league_teams`), que es la tabla
  // que contesta "¿este equipo es de esta liga?" en el modelo nuevo — la que
  // usa la cobranza, y la que permite que un equipo esté en varias ligas.
  // `teams.league_id` de arriba es la columna del modelo viejo y sigue ahí
  // porque medio `leagues.js` la lee todavía (ver "Pendientes abiertos").
  //
  // Sin esta línea, la fila de league_teams solo aparecía en el SIGUIENTE
  // arranque del servidor, por el backfill de initSchema(): un equipo recién
  // creado no era cobrable hasta el próximo deploy. No se notaba mientras la
  // cobranza validaba con la columna vieja.
  await db.prepare(
    'INSERT INTO league_teams (league_id, team_id) VALUES (?, ?) ON CONFLICT (league_id, team_id) DO NOTHING'
  ).run(req.league.id, result.lastInsertRowid);

  // Le crea su organización de identidad de una vez (antes solo se generaba
  // en el backfill del próximo arranque del servidor, ver initSchema en
  // db.js) — así el equipo ya es verificable desde /admin sin esperar un
  // redeploy, igual que un equipo independiente recién registrado.
  const newTeam = await db.prepare('SELECT * FROM teams WHERE id = ?').get(result.lastInsertRowid);
  const org = await createTeamOrganization(newTeam.name, { logo_url: newTeam.logo_url, website_url: newTeam.website_url });
  await db.prepare('UPDATE teams SET organization_id = ? WHERE id = ?').run(org.id, newTeam.id);

  res.status(201).json(await getTeamWithOrgFields(newTeam.id));
}));

// Registro de un equipo INDEPENDIENTE: sin liga, con el mismo mecanismo de
// identidad/verificación que cualquier otra organización (ver
// organizations.is_verified y PUT /admin/organizations/:id/verify). Quien
// lo registra queda como 'owner' de inmediato — a diferencia de un equipo
// creado por una liga (arriba), que nace sin representante hasta que
// alguien reclama una invitación (ver routes/invites.js).
router.post('/teams', authRequired, asyncHandler(async (req, res) => {
  const {
    name, logo_url, away_logo_url, cover_url, location, contact_email, contact_phone,
    facebook_url, instagram_url, twitter_url, website_url, sort_order,
    home_stream_links, away_stream_links, home_ticket_links, away_ticket_links,
    country_id, description, show_on_platform,
  } = req.body;

  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre del equipo es obligatorio' });

  const validationError = validateTeamFields({ contact_email, facebook_url, instagram_url, twitter_url, website_url, logo_url, away_logo_url, cover_url, home_stream_links, away_stream_links, home_ticket_links, away_ticket_links });
  if (validationError) return res.status(400).json({ error: validationError });

  if (country_id) {
    const country = await db.prepare('SELECT id FROM countries WHERE id = ?').get(country_id);
    if (!country) return res.status(400).json({ error: 'El país seleccionado no es válido' });
  }

  const trimmedName = name.trim().toUpperCase();
  const org = await createTeamOrganization(trimmedName, { country_id, logo_url, description, website_url });

  const result = await db.prepare(`
    INSERT INTO teams (
      league_id, organization_id, owner_user_id, name, logo_url, away_logo_url, cover_url, location,
      contact_email, contact_phone, facebook_url, instagram_url, twitter_url, website_url, sort_order,
      home_stream_links, away_stream_links, home_ticket_links, away_ticket_links, show_on_platform
    )
    VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    org.id, req.user.id, trimmedName,
    logo_url      || null,
    away_logo_url || null,
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
    show_on_platform ? true : false,
  );

  await db.prepare(`
    INSERT INTO organization_members (organization_id, user_id, role)
    VALUES (?, ?, 'owner')
  `).run(org.id, req.user.id);

  res.status(201).json(await getTeamWithOrgFields(result.lastInsertRowid));
}));

router.put('/teams/:id', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const {
    name, logo_url, away_logo_url, cover_url, location, contact_email, contact_phone,
    facebook_url, instagram_url, twitter_url, website_url, sort_order,
    home_stream_links, away_stream_links, home_ticket_links, away_ticket_links,
    country_id, description, show_on_platform, brand_color,
  } = req.body;
  const t = req.team;

  const resolved = {
    contact_email: contact_email ?? t.contact_email,
    facebook_url:  facebook_url  ?? t.facebook_url,
    instagram_url: instagram_url ?? t.instagram_url,
    twitter_url:   twitter_url   ?? t.twitter_url,
    website_url:   website_url   ?? t.website_url,
    logo_url:      logo_url      ?? t.logo_url,
    away_logo_url: away_logo_url ?? t.away_logo_url,
    cover_url:     cover_url     ?? t.cover_url,
    home_stream_links, away_stream_links, home_ticket_links, away_ticket_links,
  };
  const validationError = validateTeamFields(resolved);
  if (validationError) return res.status(400).json({ error: validationError });

  if (country_id) {
    const country = await db.prepare('SELECT id FROM countries WHERE id = ?').get(country_id);
    if (!country) return res.status(400).json({ error: 'El país seleccionado no es válido' });
  }

  await db.prepare(`
    UPDATE teams SET
      name              = COALESCE(?, name),
      logo_url          = COALESCE(?, logo_url),
      away_logo_url     = COALESCE(?, away_logo_url),
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
      away_ticket_links = COALESCE(?, away_ticket_links),
      show_on_platform  = COALESCE(?, show_on_platform)
    WHERE id = ?
  `).run(
    toNull(name),          toNull(logo_url),      toNull(away_logo_url), toNull(cover_url),
    toNull(location),      toNull(contact_email), toNull(contact_phone),
    toNull(facebook_url),  toNull(instagram_url), toNull(twitter_url),
    toNull(website_url),   toNull(sort_order),
    toLinksJson(home_stream_links), toLinksJson(away_stream_links),
    toLinksJson(home_ticket_links), toLinksJson(away_ticket_links),
    toNull(show_on_platform),
    t.id,
  );

  // brand_color va aparte del UPDATE de arriba porque ese usa COALESCE(?, col)
  // en todas sus columnas — con ese patrón un campo nunca se puede vaciar, y
  // aquí sí hace falta: el botón "Quitar" del selector de color manda null
  // para que el panel regrese al amarillo de CFBAMX. Solo se toca si la clave
  // viene en el cuerpo, así que un PUT que no la mencione no borra el color.
  if (Object.prototype.hasOwnProperty.call(req.body, 'brand_color')) {
    const color = isNonEmptyString(brand_color) ? brand_color.trim() : null;
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      return res.status(400).json({ error: 'El color del club debe ser un hexadecimal tipo #1B5E20' });
    }
    await db.prepare('UPDATE teams SET brand_color = ? WHERE id = ?').run(color, t.id);
  }

  // country_id/description viven en la organización del equipo (la capa de
  // identidad común), no en "teams" — solo se tocan si el equipo ya tiene
  // una (todo equipo nuevo desde ahora la tiene; uno viejo la recibe en el
  // próximo arranque del servidor, ver backfill en db.js).
  if (t.organization_id && (country_id !== undefined || description !== undefined)) {
    await db.prepare(`
      UPDATE organizations SET
        country_id  = COALESCE(?, country_id),
        description = COALESCE(?, description)
      WHERE id = ?
    `).run(toId(country_id), toNull(description), t.organization_id);
  }

  const updatedTeam = await getTeamWithOrgFields(t.id);
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

// Eliminar un equipo, y el único candado que tiene: que no lo administre nadie
// más. Ver README, "Quién puede eliminar un equipo, y por qué ese candado y no
// otro".
//
// El `DELETE FROM teams` encadena a los DOS libros de dinero —
// `team_ledger_entries` por `team_id`, y `club_ledger_entries` vía
// `club_members` — que la regla 5 de CLAUDE.md declara inborrables. Mientras el
// equipo sea solo de la liga eso está bien: el único historial que se destruye
// es el de la liga misma, sobre un equipo que ella creó, y nadie más tiene nada
// que perder ahí. En cuanto hay otra persona administrando, lo que cuelga del
// equipo —padrón del club, cuotas de las familias, el acceso de sus dueños—
// dejó de ser suyo, y ya no lo puede borrar.
//
// El candado NO es "¿ya tiene movimientos?", a propósito: eso le prohibiría a
// la liga deshacer un equipo que creó por error y al que ya le cargó algo, que
// es justo el caso donde solo se daña a sí misma.
//
// `orgTieneMiembros()` es la MISMA pregunta que contesta "¿se administra solo?"
// en el resto del modelo — no hay un segundo estado que pueda contradecirla. Y
// es de una sola vía sin guardar nada: una organización con miembros no puede
// volver a quedar vacía, porque `DELETE /organizations/:id/members/:userId`
// rechaza quitar al último (400) y rechaza quitar a un owner sin ceder antes el
// puesto (409).
router.delete('/teams/:id', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  if (await orgTieneMiembros(req.team.organization_id)) {
    return res.status(409).json({
      error: 'Este equipo ya tiene su propia administración, así que no se puede eliminar. Si ya no participa, sácalo de tu liga o de un torneo.',
    });
  }

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
    name, institution, cover_url, address, city, contact_phone, contact_email, sort_order,
  } = req.body;

  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre de la sede es obligatorio' });
  // La ciudad es obligatoria en toda sede nueva: es lo que permite generar
  // automáticamente accesos comerciales del partido (Hotel, y a futuro
  // Vuelos) sin que un admin tenga que configurar nada por partido. Como
  // las sedes no se comparten entre ligas, cada liga la captura una sola
  // vez, al dar de alta la sede.
  if (!isNonEmptyString(city)) return res.status(400).json({ error: 'La ciudad de la sede es obligatoria' });

  const validationError = validateVenueFields({ contact_email, cover_url, address });
  if (validationError) return res.status(400).json({ error: validationError });

  const result = await db.prepare(`
    INSERT INTO venues (league_id, name, institution, cover_url, address, city, contact_phone, contact_email, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.league.id,
    name.trim().toUpperCase(),
    institution   ? institution.trim().toUpperCase()   : null,
    cover_url     || null,
    address       ? address.trim()                     : null,
    city.trim().toUpperCase(),
    contact_phone ? contact_phone.trim().toUpperCase() : null,
    contact_email || null,
    sort_order    || 0,
  );

  res.status(201).json(await db.prepare('SELECT * FROM venues WHERE id = ?').get(result.lastInsertRowid));
}));

router.put('/venues/:id', authRequired, venueOwnerRequired, asyncHandler(async (req, res) => {
  const {
    name, institution, cover_url, address, city, contact_phone, contact_email, sort_order,
  } = req.body;
  const v = req.venue;

  // Igual que en la creación: la ciudad no puede quedar vacía. Esto
  // también es lo que permite "completar" (backfill) sedes viejas que se
  // crearon antes de este campo — al guardar cualquier cambio en una sede
  // vieja sin ciudad, se le exige capturarla en ese mismo momento.
  const resolvedCity = city !== undefined ? city : v.city;
  if (!isNonEmptyString(resolvedCity)) return res.status(400).json({ error: 'La ciudad de la sede es obligatoria' });

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
      city          = COALESCE(?, city),
      contact_phone = COALESCE(?, contact_phone),
      contact_email = COALESCE(?, contact_email),
      sort_order    = COALESCE(?, sort_order)
    WHERE id = ?
  `).run(
    toNull(name),        toNull(institution),   toNull(cover_url),
    toNull(address),     toNull(city ? city.toUpperCase() : city), toNull(contact_phone), toNull(contact_email),
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


// ── Fases, títulos y tabla de posiciones ─────────────────────────────────
//
// Las tres cosas viven juntas porque son el mismo modelo: la FASE dice qué
// juegos cuentan, la TABLA los cuenta, y el TÍTULO dice a qué nivel de esa
// tabla (o de qué partido) sale un campeón. Ver utils/standings.js para el
// reglamento de desempates y utils/branchStandings.js para el armado.

// Catálogo para poblar los selectores del panel. Es estático — sale del
// código, no de la base — así que el frontend no tiene que repetir la lista
// de criterios ni las etiquetas: si mañana se agrega un criterio nuevo al
// catálogo, aparece solo en el panel sin tocar el frontend.
router.get('/standings-catalog', authRequired, asyncHandler(async (req, res) => {
  res.json({
    tiebreakers: Object.entries(TIEBREAKER_CATALOG).map(([key, def]) => ({
      key, label: def.label, help: def.help || null, universe: def.universe,
    })),
    presets: Object.entries(TIEBREAKER_PRESETS).map(([key, p]) => ({
      key, label: p.label, description: p.description,
      tiebreakers: p.tiebreakers, multi_team_mode: p.multi_team_mode,
      points_win: p.points_win ?? null,
      points_draw: p.points_draw ?? null,
      points_loss: p.points_loss ?? null,
    })),
    phase_types: Object.entries(PHASE_TYPES).map(([key, p]) => ({
      key, label: p.label, counts_for_standings: p.counts_for_standings,
    })),
  });
}));

// --- Fases ---

router.get('/branches/:branchId/phases', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  const phases = await db.prepare(`
    SELECT p.*,
           (SELECT COUNT(*)::int FROM matches m WHERE m.phase_id = p.id) AS match_count,
           q.from_scope, q.top_n, q.plus_best_n, q.of_rank, q.target_phase_id
    FROM phases p
    LEFT JOIN phase_qualifications q ON q.phase_id = p.id
    WHERE p.branch_id = ?
    ORDER BY p.sort_order ASC, p.id ASC
  `).all(req.branch.id);

  // Las jornadas que ya existen en el calendario de esta rama, y cuántos de
  // sus partidos siguen SIN fase propia. Es lo que permite crear una fase y
  // adoptar de un golpe los partidos que ya la tenían escrita como texto —
  // sin esto, una liga con 133 partidos tendría que editarlos uno por uno.
  const weekLabels = await db.prepare(`
    SELECT UPPER(COALESCE(m.week_label, '')) AS label,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE m.phase_id IS NULL)::int AS unassigned
    FROM matches m
    WHERE m.branch_id = ? AND m.is_draft = FALSE AND m.week_label IS NOT NULL AND m.week_label <> ''
    GROUP BY 1
    ORDER BY 1
  `).all(req.branch.id);

  res.json({ phases, week_labels: weekLabels });
}));

router.post('/branches/:branchId/phases', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  const { name, type, counts_for_standings, sort_order, adopt_week_labels } = req.body;
  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre de la fase es obligatorio' });
  if (type !== undefined && !PHASE_TYPE_KEYS.includes(type)) {
    return res.status(400).json({ error: 'Tipo de fase no válido' });
  }

  const phaseType = type || 'regular';
  // Si no se dice explícitamente, el default lo pone el TIPO de fase: una
  // eliminatoria nace sin contar para la tabla, una regular contando. Que se
  // pueda cambiar es a propósito: hay ligas donde el repechaje sí suma.
  const counts = counts_for_standings === undefined
    ? PHASE_TYPES[phaseType].counts_for_standings
    : Boolean(counts_for_standings);

  const result = await db.prepare(`
    INSERT INTO phases (branch_id, name, type, counts_for_standings, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.branch.id, name.trim(), phaseType, counts, sort_order || 0);

  // Adopción opcional: los partidos de estas jornadas pasan a esta fase. Solo
  // toca los que NO tienen fase todavía — una fase ya asignada a mano manda
  // sobre esto y no se pisa nunca.
  let adopted = 0;
  const labels = Array.isArray(adopt_week_labels)
    ? adopt_week_labels.filter((l) => typeof l === 'string' && l.trim()).map((l) => l.trim().toUpperCase())
    : [];
  if (labels.length) {
    const upd = await db.prepare(`
      UPDATE matches SET phase_id = ?
      WHERE branch_id = ? AND phase_id IS NULL
        AND UPPER(COALESCE(week_label, '')) = ANY(?)
    `).run(result.lastInsertRowid, req.branch.id, labels);
    adopted = upd.changes;
  }

  const phase = await db.prepare('SELECT * FROM phases WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...phase, adopted });
}));

router.put('/phases/:phaseId', authRequired, phaseOwnerRequired, asyncHandler(async (req, res) => {
  const { name, type, counts_for_standings, sort_order } = req.body;
  if (name !== undefined && !isNonEmptyString(name)) {
    return res.status(400).json({ error: 'El nombre de la fase no puede estar vacío' });
  }
  if (type !== undefined && !PHASE_TYPE_KEYS.includes(type)) {
    return res.status(400).json({ error: 'Tipo de fase no válido' });
  }

  await db.prepare(`
    UPDATE phases SET
      name                 = COALESCE(?, name),
      type                 = COALESCE(?, type),
      counts_for_standings = COALESCE(?, counts_for_standings),
      sort_order           = COALESCE(?, sort_order)
    WHERE id = ?
  `).run(
    toNull(name ? name.trim() : name),
    toNull(type),
    counts_for_standings === undefined ? null : Boolean(counts_for_standings),
    toNull(sort_order),
    req.phase.id,
  );

  res.json(await db.prepare('SELECT * FROM phases WHERE id = ?').get(req.phase.id));
}));

// Borrar una fase NO borra sus partidos: quedan con phase_id en NULL y su
// fase vuelve a derivarse de week_label, que es el respaldo de siempre.
// Es lo mismo que hace el borrado de una conferencia con sus partidos.
router.delete('/phases/:phaseId', authRequired, phaseOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM phases WHERE id = ?').run(req.phase.id);
  res.json({ ok: true });
}));

// Regla de clasificación de una fase: "de esta fase pasan los primeros N de
// cada grupo / conferencia / de la tabla general". Es UNA por fase (si ya
// había, se reemplaza) — dos reglas distintas para la misma fase no
// describirían nada, se contradirían.
router.put('/phases/:phaseId/qualification', authRequired, phaseOwnerRequired, asyncHandler(async (req, res) => {
  const { from_scope, top_n, plus_best_n, of_rank, target_phase_id } = req.body;

  if (!['branch', 'conference', 'group'].includes(from_scope)) {
    return res.status(400).json({ error: 'El alcance debe ser rama, conferencia o grupo' });
  }
  const topN = Number(top_n);
  if (!Number.isInteger(topN) || topN < 1) {
    return res.status(400).json({ error: 'Cuántos clasifican debe ser un número de 1 o más' });
  }
  const plusN = plus_best_n === undefined || plus_best_n === null || plus_best_n === '' ? 0 : Number(plus_best_n);
  if (!Number.isInteger(plusN) || plusN < 0) {
    return res.status(400).json({ error: 'Los lugares extra deben ser 0 o más' });
  }

  if (target_phase_id) {
    const target = await db.prepare('SELECT id FROM phases WHERE id = ? AND branch_id = ?')
      .get(Number(target_phase_id), req.branch.id);
    if (!target) return res.status(400).json({ error: 'La fase de destino no existe en esta rama' });
  }

  await db.prepare('DELETE FROM phase_qualifications WHERE phase_id = ?').run(req.phase.id);
  await db.prepare(`
    INSERT INTO phase_qualifications (phase_id, from_scope, top_n, plus_best_n, of_rank, target_phase_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    req.phase.id, from_scope, topN, plusN,
    // `of_rank` solo significa algo si hay lugares extra: es "qué lugar se
    // compara entre tablas" (3 = los mejores terceros). Sin lugares extra no
    // hay nada que comparar, así que se guarda en null.
    plusN > 0 ? (Number(of_rank) || topN + 1) : null,
    target_phase_id ? Number(target_phase_id) : null,
  );

  res.json(await db.prepare('SELECT * FROM phase_qualifications WHERE phase_id = ?').get(req.phase.id));
}));

router.delete('/phases/:phaseId/qualification', authRequired, phaseOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM phase_qualifications WHERE phase_id = ?').run(req.phase.id);
  res.json({ ok: true });
}));


// --- Configuración de la tabla ---

router.put('/branches/:branchId/standings-config', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  const {
    standings_levels, tiebreakers, tiebreaker_mode, tiebreakers_by_level,
    points_win, points_draw, points_loss,
  } = req.body;

  const LEVELS = ['branch', 'conference', 'group'];
  if (standings_levels !== undefined) {
    if (!Array.isArray(standings_levels) || standings_levels.some((l) => !LEVELS.includes(l))) {
      return res.status(400).json({ error: 'Los niveles de la tabla deben ser rama, conferencia o grupo' });
    }
  }

  // Misma validación para la lista de la rama y para la de cada nivel, en un
  // solo lugar: si un criterio desconocido se colara, la tabla se ordenaría
  // ignorándolo en silencio, que es la peor forma de fallar.
  const listaInvalida = (lista) => {
    if (!Array.isArray(lista) || !lista.length) return 'Hace falta al menos un criterio de desempate';
    const unknown = lista.find((k) => !TIEBREAKER_CATALOG[k]);
    return unknown ? `Criterio de desempate desconocido: ${unknown}` : null;
  };

  if (tiebreakers !== undefined) {
    const error = listaInvalida(tiebreakers);
    if (error) return res.status(400).json({ error });
  }
  if (tiebreaker_mode !== undefined && !['restart', 'sequential'].includes(tiebreaker_mode)) {
    return res.status(400).json({ error: 'El modo de empate múltiple debe ser restart o sequential' });
  }

  // Reglamento propio por nivel. Se manda el mapa COMPLETO: lo que no venga
  // se borra, y {} devuelve todos los niveles a heredar el de la rama. Es a
  // propósito — un merge parcial haría imposible quitar un nivel sin inventar
  // un valor centinela.
  if (tiebreakers_by_level !== undefined) {
    if (tiebreakers_by_level === null || typeof tiebreakers_by_level !== 'object' || Array.isArray(tiebreakers_by_level)) {
      return res.status(400).json({ error: 'El reglamento por nivel debe venir como un objeto por nivel' });
    }
    for (const [nivel, cfg] of Object.entries(tiebreakers_by_level)) {
      if (!LEVELS.includes(nivel)) {
        return res.status(400).json({ error: `Nivel desconocido: ${nivel}` });
      }
      const error = listaInvalida(cfg?.tiebreakers);
      if (error) return res.status(400).json({ error: `${error} (en el nivel ${nivel})` });
      if (cfg.multi_team_mode !== undefined && !['restart', 'sequential'].includes(cfg.multi_team_mode)) {
        return res.status(400).json({ error: `El modo de empate múltiple del nivel ${nivel} debe ser restart o sequential` });
      }
    }
  }

  // Los tres puntos van juntos o no van: dejar points_win puesto y
  // points_draw en NULL daría una tabla que suma con un reglamento a medias.
  const pointsGiven = [points_win, points_draw, points_loss].filter((v) => v !== undefined && v !== null);
  if (pointsGiven.length && pointsGiven.length < 3) {
    return res.status(400).json({ error: 'Para usar sistema de puntos hay que definir los tres valores (ganar, empatar, perder)' });
  }

  await db.prepare(`
    UPDATE branches SET
      standings_levels = COALESCE(?::jsonb, standings_levels),
      tiebreakers      = COALESCE(?::jsonb, tiebreakers),
      tiebreaker_mode  = COALESCE(?, tiebreaker_mode),
      tiebreakers_by_level = CASE WHEN ?::boolean THEN ?::jsonb ELSE tiebreakers_by_level END,
      points_win       = ?,
      points_draw      = ?,
      points_loss      = ?
    WHERE id = ?
  `).run(
    standings_levels === undefined ? null : JSON.stringify(standings_levels),
    tiebreakers === undefined ? null : JSON.stringify(tiebreakers),
    toNull(tiebreaker_mode),
    // Dos parámetros para una columna: el primero dice si esta petición toca
    // el mapa por nivel y el segundo trae el valor. Hace falta porque aquí
    // null SIGNIFICA algo ("quítalo todo"), así que el COALESCE que usan las
    // demás columnas para decir "no tocar" no sirve.
    tiebreakers_by_level !== undefined,
    tiebreakers_by_level === undefined || !Object.keys(tiebreakers_by_level).length
      ? null
      : JSON.stringify(tiebreakers_by_level),
    points_win ?? null,
    points_draw ?? null,
    points_loss ?? null,
    req.branch.id,
  );

  res.json(await db.prepare('SELECT * FROM branches WHERE id = ?').get(req.branch.id));
}));

// --- Títulos ---

router.get('/branches/:branchId/titles', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  res.json(await db.prepare(`
    SELECT ti.*, ph.name AS phase_name
    FROM titles ti
    LEFT JOIN phases ph ON ph.id = ti.phase_id
    WHERE ti.branch_id = ?
    ORDER BY ti.sort_order ASC, ti.id ASC
  `).all(req.branch.id));
}));

router.post('/branches/:branchId/titles', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  const { name, scope, decided_by, phase_id, sort_order } = req.body;
  const error = await validateTitle({ name, scope, decided_by, phase_id, branchId: req.branch.id });
  if (error) return res.status(400).json({ error });

  const by = decided_by || 'match';
  const result = await db.prepare(`
    INSERT INTO titles (branch_id, name, scope, decided_by, phase_id, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    req.branch.id, name.trim(), scope, by,
    by === 'match' ? Number(phase_id) : null,
    sort_order || 0,
  );

  res.status(201).json(await db.prepare('SELECT * FROM titles WHERE id = ?').get(result.lastInsertRowid));
}));

router.put('/titles/:titleId', authRequired, titleOwnerRequired, asyncHandler(async (req, res) => {
  const { name, scope, decided_by, phase_id, sort_order } = req.body;
  const merged = {
    name: name ?? req.title.name,
    scope: scope ?? req.title.scope,
    decided_by: decided_by ?? req.title.decided_by,
    phase_id: phase_id === undefined ? req.title.phase_id : phase_id,
    branchId: req.branch.id,
  };
  const error = await validateTitle(merged);
  if (error) return res.status(400).json({ error });

  await db.prepare(`
    UPDATE titles SET
      name       = ?,
      scope      = ?,
      decided_by = ?,
      phase_id   = ?,
      sort_order = COALESCE(?, sort_order)
    WHERE id = ?
  `).run(
    merged.name.trim(), merged.scope, merged.decided_by,
    merged.decided_by === 'match' ? Number(merged.phase_id) : null,
    toNull(sort_order),
    req.title.id,
  );

  res.json(await db.prepare('SELECT * FROM titles WHERE id = ?').get(req.title.id));
}));

router.delete('/titles/:titleId', authRequired, titleOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM titles WHERE id = ?').run(req.title.id);
  res.json({ ok: true });
}));

// El campeón normalmente NO se guarda: se deriva al leer. Esto guarda la
// EXCEPCIÓN — "el campeón es este otro aunque los números digan lo
// contrario" (desempate por sorteo, sanción, título compartido). Mismo papel
// que matches.conference_override_id.
router.put('/titles/:titleId/winner', authRequired, titleOwnerRequired, asyncHandler(async (req, res) => {
  const { scope_id, team_id, note } = req.body;
  if (!Number.isInteger(Number(team_id))) return res.status(400).json({ error: 'Falta el equipo campeón' });

  // El título de rama no tiene alcance concreto; los de conferencia/grupo sí,
  // y sin él no se sabría de cuál de las conferencias se está hablando.
  const scopeId = req.title.scope === 'branch' ? null : Number(scope_id);
  if (req.title.scope !== 'branch' && !Number.isInteger(scopeId)) {
    return res.status(400).json({ error: 'Falta decir de qué conferencia o grupo es este campeón' });
  }

  const enrolled = await db.prepare(
    'SELECT 1 FROM branch_teams WHERE branch_id = ? AND team_id = ?'
  ).get(req.branch.id, Number(team_id));
  if (!enrolled) return res.status(400).json({ error: 'Ese equipo no está inscrito en esta rama' });

  // Un solo campeón por (título, alcance): se borra el anterior y se escribe
  // el nuevo. Los dos índices únicos parciales de db.js lo respaldan del lado
  // de la base, incluido el caso scope_id = NULL.
  if (scopeId === null) {
    await db.prepare('DELETE FROM title_overrides WHERE title_id = ? AND scope_id IS NULL').run(req.title.id);
  } else {
    await db.prepare('DELETE FROM title_overrides WHERE title_id = ? AND scope_id = ?').run(req.title.id, scopeId);
  }

  await db.prepare(`
    INSERT INTO title_overrides (title_id, scope_id, team_id, note, created_by_user_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.title.id, scopeId, Number(team_id), isNonEmptyString(note) ? note.trim() : null, req.user.id);

  res.json({ ok: true });
}));

// Quita el campeón puesto a mano: el título vuelve a derivarse solo.
router.delete('/titles/:titleId/winner', authRequired, titleOwnerRequired, asyncHandler(async (req, res) => {
  const scopeId = req.query.scope_id ? Number(req.query.scope_id) : null;
  if (scopeId === null) {
    await db.prepare('DELETE FROM title_overrides WHERE title_id = ? AND scope_id IS NULL').run(req.title.id);
  } else {
    await db.prepare('DELETE FROM title_overrides WHERE title_id = ? AND scope_id = ?').run(req.title.id, scopeId);
  }
  res.json({ ok: true });
}));

async function validateTitle({ name, scope, decided_by, phase_id, branchId }) {
  if (!isNonEmptyString(name)) return 'El nombre del título es obligatorio';
  if (!['branch', 'conference', 'group'].includes(scope)) {
    return 'El nivel del título debe ser rama, conferencia o grupo';
  }
  const by = decided_by || 'match';
  if (!['standings', 'match'].includes(by)) return 'El título se define por tabla o por partido';

  if (by === 'match') {
    if (!Number.isInteger(Number(phase_id))) {
      return 'Un título que se define por partido necesita decir en qué fase se juega';
    }
    const phase = await db.prepare('SELECT * FROM phases WHERE id = ? AND branch_id = ?').get(Number(phase_id), branchId);
    if (!phase) return 'Esa fase no existe en esta rama';
  }
  return null;
}

// La tabla completa para el panel: incluye la configuración y las fases con
// todos sus campos, que la vista pública no necesita.
router.get('/branches/:branchId/standings', authRequired, branchOwnerRequired, asyncHandler(async (req, res) => {
  res.json(await buildBranchStandings(req.branch.id));
}));


export default router;
