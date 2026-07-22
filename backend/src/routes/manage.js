import express from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { categoryOwnerRequired, matchOwnerRequired, leagueOwnerRequired, teamOwnerRequired, venueOwnerRequired, groupOwnerRequired } from '../middleware/ownership.js';
import { isValidEmail, isValidUrl, isNonEmptyString } from '../utils/validation.js';
import { isValidTimezone } from '../utils/timezones.js';
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
function computeMatchStatus(matchDateIso) {
  if (!matchDateIso) return 'scheduled';
  const now       = Date.now();
  const matchTime = new Date(matchDateIso).getTime();
  const endTime   = matchTime + LIVE_WINDOW_MS;
  if (now < matchTime) return 'scheduled';
  if (now < endTime)   return 'live';
  return 'finished';
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
  const { name, sort_order, season, year } = req.body;
  if (name !== undefined && !isNonEmptyString(name)) {
    return res.status(400).json({ error: 'El nombre de la categoría no puede estar vacío' });
  }
  await db.prepare(`
    UPDATE categories SET
      name       = COALESCE(?, name),
      sort_order = COALESCE(?, sort_order),
      season     = COALESCE(?, season),
      year       = COALESCE(?, year)
    WHERE id = ?
  `).run(
    toNull(name ? name.trim().toUpperCase() : name),
    toNull(sort_order),
    toNull(season ? season.trim().toUpperCase() : season),
    toNull(year ? parseInt(year) : year),
    req.category.id
  );
  res.json(await db.prepare('SELECT * FROM categories WHERE id = ?').get(req.category.id));
}));

router.delete('/categories/:categoryId', authRequired, categoryOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM categories WHERE id = ?').run(req.category.id);
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

  // Marcador obligatorio solo cuando el estado es finalizado
  if (status === 'finished') {
    if (home_score === null || home_score === undefined || home_score === '') {
      return 'El marcador local es obligatorio cuando el partido está finalizado';
    }
    if (away_score === null || away_score === undefined || away_score === '') {
      return 'El marcador visitante es obligatorio cuando el partido está finalizado';
    }
  }
  if (home_score !== null && home_score !== undefined && home_score !== '' && Number(home_score) < 0) {
    return 'El marcador local no puede ser negativo';
  }
  if (away_score !== null && away_score !== undefined && away_score !== '' && Number(away_score) < 0) {
    return 'El marcador visitante no puede ser negativo';
  }
  return null;
}

router.post('/categories/:categoryId/matches', authRequired, categoryOwnerRequired, asyncHandler(async (req, res) => {
  const { home_team, away_team, match_date, venue_id, group_id, group_id_2, stream_links, ticket_links, week_label, status, home_score, away_score, timezone } = req.body;
  if (!isNonEmptyString(home_team) || !isNonEmptyString(away_team) || !match_date) {
    return res.status(400).json({ error: 'Se requieren equipo local, visitante y fecha' });
  }

  const resolvedStatus = status || 'scheduled';
  const validationError = validateMatchFields({ home_team, away_team, stream_links, ticket_links, status: resolvedStatus, home_score, away_score, timezone, group_id, group_id_2 });
  if (validationError) return res.status(400).json({ error: validationError });

  const result = await db.prepare(`
    INSERT INTO matches (category_id, home_team, away_team, match_date, venue_id, group_id, group_id_2, stream_links, ticket_links, week_label, status, home_score, away_score, timezone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.category.id,
    home_team.trim().toUpperCase(),
    away_team.trim().toUpperCase(),
    match_date,
    venue_id  || null,
    group_id  || null,
    group_id_2 || null,
    JSON.stringify(Array.isArray(stream_links) ? stream_links.filter((u) => u && u.trim()) : []),
    JSON.stringify(Array.isArray(ticket_links) ? ticket_links.filter((u) => u && u.trim()) : []),
    week_label  ? week_label.trim().toUpperCase() : null,
    resolvedStatus,
    home_score === '' || home_score === undefined ? null : home_score,
    away_score === '' || away_score === undefined ? null : away_score,
    timezone || null
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
    const registeredTeams  = await db.prepare('SELECT id, name FROM teams WHERE league_id = ?').all(req.league.id);
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
          let parsedDate = null;
          const rawFechaKey = Object.keys(row).find(k => k.trim().toLowerCase() === 'fecha');
          if (rawFechaKey && row[rawFechaKey] instanceof Date) {
            parsedDate = new Date(row[rawFechaKey]);
          }
          if (!parsedDate || isNaN(parsedDate)) {
            const dmyMatch = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/.exec(fechaRaw);
            if (dmyMatch) {
              parsedDate = new Date(Number(dmyMatch[3]), Number(dmyMatch[2]) - 1, Number(dmyMatch[1]));
            }
          }
          if (!parsedDate || isNaN(parsedDate)) {
            const ymdMatch = /^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/.exec(fechaRaw);
            if (ymdMatch) {
              parsedDate = new Date(Number(ymdMatch[1]), Number(ymdMatch[2]) - 1, Number(ymdMatch[3]));
            }
          }
          if (parsedDate && !isNaN(parsedDate)) {
            if (horaRaw) {
              const timeMatch = /^(\d{1,2}):(\d{2})/.exec(horaRaw);
              if (timeMatch) {
                parsedDate.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
              }
            }
            matchDate = parsedDate.toISOString();
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

        const status = computeMatchStatus(matchDate);

        const result = await db.prepare(`
          INSERT INTO matches (category_id, home_team, away_team, match_date, venue, venue_id, group_id, group_id_2, stream_url, tickets_url, week_label, status, home_score, away_score, timezone)
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
          validStream   || null,
          validTicketsUrl || null,
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

router.put('/matches/:id', authRequired, matchOwnerRequired, asyncHandler(async (req, res) => {
  const { home_team, away_team, match_date, venue_id, group_id, group_id_2, stream_links, ticket_links, week_label, status, home_score, away_score, timezone } = req.body;
  const m = req.match;

  const resolved = {
    home_team:   home_team   ?? m.home_team,
    away_team:   away_team   ?? m.away_team,
    match_date:  match_date  ?? m.match_date,
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

  await db.prepare(`
    UPDATE matches SET
      home_team    = COALESCE(?, home_team),
      away_team    = COALESCE(?, away_team),
      match_date   = COALESCE(?, match_date),
      venue_id     = ?,
      group_id     = ?,
      group_id_2   = ?,
      stream_links = COALESCE(?, stream_links),
      ticket_links = COALESCE(?, ticket_links),
      week_label   = COALESCE(?, week_label),
      status       = COALESCE(?, status),
      home_score   = COALESCE(?, home_score),
      away_score   = COALESCE(?, away_score),
      timezone     = COALESCE(?, timezone)
    WHERE id = ?
  `).run(
    toNull(home_team), toNull(away_team), toNull(match_date),
    venue_id  !== undefined ? (venue_id  || null) : m.venue_id,
    group_id  !== undefined ? (group_id  || null) : m.group_id,
    group_id_2 !== undefined ? (group_id_2 || null) : m.group_id_2,
    toLinksJson(stream_links), toLinksJson(ticket_links), toNull(week_label), toNull(status),
    toNull(home_score), toNull(away_score), toNull(timezone), m.id
  );

  res.json(await db.prepare('SELECT * FROM matches WHERE id = ?').get(m.id));
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

  res.json(await db.prepare('SELECT * FROM teams WHERE id = ?').get(t.id));
}));

router.delete('/teams/:id', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM teams WHERE id = ?').run(req.team.id);
  res.json({ ok: true });
}));

/* ===================== SEDES ===================== */

function validateVenueFields({ contact_email, cover_url }) {
  if (contact_email && !isValidEmail(contact_email)) return 'El correo de contacto no tiene un formato válido';
  if (cover_url      && !isValidUrl(cover_url))       return 'La imagen de portada no es una dirección web válida';
  return null;
}

router.post('/leagues/:leagueId/venues', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const {
    name, institution, cover_url, address, contact_phone, contact_email, sort_order,
  } = req.body;

  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre de la sede es obligatorio' });

  const validationError = validateVenueFields({ contact_email, cover_url });
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
