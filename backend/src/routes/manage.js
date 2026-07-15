import express from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { categoryOwnerRequired, matchOwnerRequired, leagueOwnerRequired, teamOwnerRequired, venueOwnerRequired } from '../middleware/ownership.js';
import { isValidEmail, isValidUrl, isNonEmptyString } from '../utils/validation.js';
import { isValidTimezone } from '../utils/timezones.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

function toNull(value) {
  return value === undefined ? null : value;
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

/* ===================== PARTIDOS ===================== */

function validateMatchFields({ home_team, away_team, stream_url, tickets_url, status, home_score, away_score, timezone }) {
  if (home_team && away_team && home_team.trim().toLowerCase() === away_team.trim().toLowerCase()) {
    return 'El equipo local y el equipo visitante no pueden ser el mismo';
  }
  if (stream_url  && !isValidUrl(stream_url))  return 'El link de transmisión no es una dirección web válida';
  if (tickets_url && !isValidUrl(tickets_url)) return 'El link de boletos no es una dirección web válida';
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
  const { home_team, away_team, match_date, venue_id, stream_url, tickets_url, week_label, status, home_score, away_score, timezone } = req.body;
  if (!isNonEmptyString(home_team) || !isNonEmptyString(away_team) || !match_date) {
    return res.status(400).json({ error: 'Se requieren equipo local, visitante y fecha' });
  }

  const resolvedStatus = status || 'scheduled';
  const validationError = validateMatchFields({ home_team, away_team, stream_url, tickets_url, status: resolvedStatus, home_score, away_score, timezone });
  if (validationError) return res.status(400).json({ error: validationError });

  const result = await db.prepare(`
    INSERT INTO matches (category_id, home_team, away_team, match_date, venue_id, stream_url, tickets_url, week_label, status, home_score, away_score, timezone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.category.id,
    home_team.trim().toUpperCase(),
    away_team.trim().toUpperCase(),
    match_date,
    venue_id  || null,
    stream_url  || null,
    tickets_url || null,
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

    const imported = [];
    const skipped  = [];

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

        const fechaRaw  = get(['Fecha', 'fecha', 'FECHA']);
        const horaRaw   = get(['Hora', 'hora', 'HORA']);
        const homeTeam  = get(['Equipo Local', 'equipo local', 'local', 'home']);
        const awayTeam  = get(['Equipo Visitante', 'equipo visitante', 'visitante', 'away']);
        const venue     = get(['Sede', 'sede', 'SEDE']);
        const weekLabel = get(['Jornada', 'jornada', 'JORNADA', 'Week', 'week']);
        const streamUrl = get(['Link de transmisión', 'link de transmision', 'stream', 'url', 'transmision']);

        if (!homeTeam || !awayTeam) {
          skipped.push({ row: rowN, reason: 'Faltan equipos local o visitante' });
          continue;
        }

        if (homeTeam.toLowerCase() === awayTeam.toLowerCase()) {
          skipped.push({ row: rowN, reason: 'El equipo local y visitante son iguales' });
          continue;
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

        const result = await db.prepare(`
          INSERT INTO matches (category_id, home_team, away_team, match_date, venue, stream_url, week_label, status, home_score, away_score)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          req.category.id,
          homeTeam.toUpperCase(),
          awayTeam.toUpperCase(),
          matchDate   || null,
          venue       ? venue.toUpperCase()     : null,
          validStream || null,
          weekLabel   ? weekLabel.toUpperCase() : null,
          'scheduled',
          null,
          null,
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
    });
  })
);

router.put('/matches/:id', authRequired, matchOwnerRequired, asyncHandler(async (req, res) => {
  const { home_team, away_team, match_date, venue_id, stream_url, tickets_url, week_label, status, home_score, away_score, timezone } = req.body;
  const m = req.match;

  const resolved = {
    home_team:   home_team   ?? m.home_team,
    away_team:   away_team   ?? m.away_team,
    match_date:  match_date  ?? m.match_date,
    stream_url:  stream_url  ?? m.stream_url,
    tickets_url: tickets_url ?? m.tickets_url,
    status:      status      ?? m.status,
    home_score:  home_score  !== undefined ? home_score : m.home_score,
    away_score:  away_score  !== undefined ? away_score : m.away_score,
    timezone:    timezone    ?? m.timezone,
  };

  const validationError = validateMatchFields(resolved);
  if (validationError) return res.status(400).json({ error: validationError });

  await db.prepare(`
    UPDATE matches SET
      home_team   = COALESCE(?, home_team),
      away_team   = COALESCE(?, away_team),
      match_date  = COALESCE(?, match_date),
      venue_id    = ?,
      stream_url  = COALESCE(?, stream_url),
      tickets_url = COALESCE(?, tickets_url),
      week_label  = COALESCE(?, week_label),
      status      = COALESCE(?, status),
      home_score  = COALESCE(?, home_score),
      away_score  = COALESCE(?, away_score),
      timezone    = COALESCE(?, timezone)
    WHERE id = ?
  `).run(
    toNull(home_team), toNull(away_team), toNull(match_date),
    venue_id !== undefined ? (venue_id || null) : m.venue_id,
    toNull(stream_url), toNull(tickets_url), toNull(week_label), toNull(status),
    toNull(home_score), toNull(away_score), toNull(timezone), m.id
  );

  res.json(await db.prepare('SELECT * FROM matches WHERE id = ?').get(m.id));
}));

router.delete('/matches/:id', authRequired, matchOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM matches WHERE id = ?').run(req.match.id);
  res.json({ ok: true });
}));

/* ===================== EQUIPOS ===================== */

function validateTeamFields({ contact_email, facebook_url, instagram_url, twitter_url, website_url, logo_url, cover_url }) {
  if (contact_email && !isValidEmail(contact_email)) return 'El correo de contacto no tiene un formato válido';
  if (facebook_url  && !isValidUrl(facebook_url))    return 'El enlace de Facebook no es una dirección web válida';
  if (instagram_url && !isValidUrl(instagram_url))   return 'El enlace de Instagram no es una dirección web válida';
  if (twitter_url   && !isValidUrl(twitter_url))     return 'El enlace de X / Twitter no es una dirección web válida';
  if (website_url   && !isValidUrl(website_url))     return 'El sitio web no es una dirección web válida';
  if (logo_url      && !isValidUrl(logo_url))        return 'El logo no es una dirección web válida';
  if (cover_url     && !isValidUrl(cover_url))       return 'La imagen de portada no es una dirección web válida';
  return null;
}

router.post('/leagues/:leagueId/teams', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const {
    name, logo_url, cover_url, location, contact_email, contact_phone,
    facebook_url, instagram_url, twitter_url, website_url, sort_order,
  } = req.body;

  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre del equipo es obligatorio' });

  const validationError = validateTeamFields({ contact_email, facebook_url, instagram_url, twitter_url, website_url, logo_url, cover_url });
  if (validationError) return res.status(400).json({ error: validationError });

  const result = await db.prepare(`
    INSERT INTO teams (league_id, name, logo_url, cover_url, location, contact_email, contact_phone, facebook_url, instagram_url, twitter_url, website_url, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  );

  res.status(201).json(await db.prepare('SELECT * FROM teams WHERE id = ?').get(result.lastInsertRowid));
}));

router.put('/teams/:id', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const {
    name, logo_url, cover_url, location, contact_email, contact_phone,
    facebook_url, instagram_url, twitter_url, website_url, sort_order,
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
  };
  const validationError = validateTeamFields(resolved);
  if (validationError) return res.status(400).json({ error: validationError });

  await db.prepare(`
    UPDATE teams SET
      name          = COALESCE(?, name),
      logo_url      = COALESCE(?, logo_url),
      cover_url     = COALESCE(?, cover_url),
      location      = COALESCE(?, location),
      contact_email = COALESCE(?, contact_email),
      contact_phone = COALESCE(?, contact_phone),
      facebook_url  = COALESCE(?, facebook_url),
      instagram_url = COALESCE(?, instagram_url),
      twitter_url   = COALESCE(?, twitter_url),
      website_url   = COALESCE(?, website_url),
      sort_order    = COALESCE(?, sort_order)
    WHERE id = ?
  `).run(
    toNull(name),          toNull(logo_url),      toNull(cover_url),
    toNull(location),      toNull(contact_email), toNull(contact_phone),
    toNull(facebook_url),  toNull(instagram_url), toNull(twitter_url),
    toNull(website_url),   toNull(sort_order),    t.id,
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
    }))
  );
  const teams  = await db.prepare('SELECT * FROM teams WHERE league_id = ? ORDER BY sort_order ASC, name ASC').all(league.id);
  const venues = await db.prepare('SELECT * FROM venues WHERE league_id = ? ORDER BY sort_order ASC, name ASC').all(league.id);
  res.json({ league, categories: categoriesWithMatches, teams, venues });
}));

export default router;
