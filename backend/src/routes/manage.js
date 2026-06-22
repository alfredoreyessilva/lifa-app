import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { categoryOwnerRequired, matchOwnerRequired, leagueOwnerRequired, teamOwnerRequired } from '../middleware/ownership.js';
import { isValidEmail, isValidUrl, isNonEmptyString } from '../utils/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

function toNull(value) {
  return value === undefined ? null : value;
}

/* ===================== CATEGORÍAS ===================== */

router.put('/categories/:categoryId', authRequired, categoryOwnerRequired, asyncHandler(async (req, res) => {
  const { name, sort_order } = req.body;
  if (name !== undefined && !isNonEmptyString(name)) {
    return res.status(400).json({ error: 'El nombre de la categoría no puede estar vacío' });
  }
  await db.prepare(`
    UPDATE categories SET name = COALESCE(?, name), sort_order = COALESCE(?, sort_order) WHERE id = ?
  `).run(toNull(name ? name.trim() : name), toNull(sort_order), req.category.id);
  res.json(await db.prepare('SELECT * FROM categories WHERE id = ?').get(req.category.id));
}));

router.delete('/categories/:categoryId', authRequired, categoryOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM categories WHERE id = ?').run(req.category.id);
  res.json({ ok: true });
}));

/* ===================== PARTIDOS ===================== */

function validateMatchFields({ home_team, away_team, stream_url, status, home_score, away_score, match_date }) {
  if (home_team && away_team && home_team.trim().toLowerCase() === away_team.trim().toLowerCase()) {
    return 'El equipo local y el equipo visitante no pueden ser el mismo';
  }
  if (stream_url && !isValidUrl(stream_url)) {
    return 'El link de transmisión no es una dirección web válida';
  }
  if (match_date) {
    const isPast = new Date(match_date) < new Date();
    if (isPast && status !== 'finished') {
      return 'Si la fecha del partido ya pasó, el estado debe ser "finished" (Finalizado)';
    }
  }
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
  const { home_team, away_team, match_date, venue, stream_url, week_label, status, home_score, away_score } = req.body;
  if (!isNonEmptyString(home_team) || !isNonEmptyString(away_team) || !match_date) {
    return res.status(400).json({ error: 'Se requieren equipo local, visitante y fecha' });
  }

  const resolvedStatus = status || 'scheduled';
  const validationError = validateMatchFields({ home_team, away_team, stream_url, status: resolvedStatus, home_score, away_score, match_date });
  if (validationError) return res.status(400).json({ error: validationError });

  const result = await db.prepare(`
    INSERT INTO matches (category_id, home_team, away_team, match_date, venue, stream_url, week_label, status, home_score, away_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.category.id, home_team.trim(), away_team.trim(), match_date, venue || null, stream_url || null,
    week_label || null, resolvedStatus,
    home_score === '' || home_score === undefined ? null : home_score,
    away_score === '' || away_score === undefined ? null : away_score
  );

  res.status(201).json(await db.prepare('SELECT * FROM matches WHERE id = ?').get(result.lastInsertRowid));
}));

router.put('/matches/:id', authRequired, matchOwnerRequired, asyncHandler(async (req, res) => {
  const { home_team, away_team, match_date, venue, stream_url, week_label, status, home_score, away_score } = req.body;
  const m = req.match;

  const resolved = {
    home_team: home_team ?? m.home_team,
    away_team: away_team ?? m.away_team,
    match_date: match_date ?? m.match_date,
    stream_url: stream_url ?? m.stream_url,
    status: status ?? m.status,
    home_score: home_score !== undefined ? home_score : m.home_score,
    away_score: away_score !== undefined ? away_score : m.away_score,
  };

  const validationError = validateMatchFields(resolved);
  if (validationError) return res.status(400).json({ error: validationError });

  await db.prepare(`
    UPDATE matches SET
      home_team = COALESCE(?, home_team),
      away_team = COALESCE(?, away_team),
      match_date = COALESCE(?, match_date),
      venue = COALESCE(?, venue),
      stream_url = COALESCE(?, stream_url),
      week_label = COALESCE(?, week_label),
      status = COALESCE(?, status),
      home_score = COALESCE(?, home_score),
      away_score = COALESCE(?, away_score)
    WHERE id = ?
  `).run(
    toNull(home_team), toNull(away_team), toNull(match_date), toNull(venue), toNull(stream_url),
    toNull(week_label), toNull(status), toNull(home_score), toNull(away_score), m.id
  );

  res.json(await db.prepare('SELECT * FROM matches WHERE id = ?').get(m.id));
}));

router.delete('/matches/:id', authRequired, matchOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM matches WHERE id = ?').run(req.match.id);
  res.json({ ok: true });
}));

/* ===================== EQUIPOS ===================== */

function validateTeamFields({ contact_email, facebook_url, instagram_url, twitter_url, website_url, logo_url }) {
  if (contact_email && !isValidEmail(contact_email)) return 'El correo de contacto no tiene un formato válido';
  if (facebook_url && !isValidUrl(facebook_url)) return 'El enlace de Facebook no es una dirección web válida';
  if (instagram_url && !isValidUrl(instagram_url)) return 'El enlace de Instagram no es una dirección web válida';
  if (twitter_url && !isValidUrl(twitter_url)) return 'El enlace de X / Twitter no es una dirección web válida';
  if (website_url && !isValidUrl(website_url)) return 'El sitio web no es una dirección web válida';
  if (logo_url && !isValidUrl(logo_url)) return 'El logo no es una dirección web válida';
  return null;
}

router.post('/leagues/:leagueId/teams', authRequired, leagueOwnerRequired, asyncHandler(async (req, res) => {
  const { name, logo_url, location, contact_email, contact_phone, facebook_url, instagram_url, twitter_url, website_url, sort_order } = req.body;
  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre del equipo es obligatorio' });

  const validationError = validateTeamFields({ contact_email, facebook_url, instagram_url, twitter_url, website_url, logo_url });
  if (validationError) return res.status(400).json({ error: validationError });

  const result = await db.prepare(`
    INSERT INTO teams (league_id, name, logo_url, location, contact_email, contact_phone, facebook_url, instagram_url, twitter_url, website_url, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.league.id, name.trim(), logo_url || null, location || null, contact_email || null, contact_phone || null,
    facebook_url || null, instagram_url || null, twitter_url || null, website_url || null, sort_order || 0
  );

  res.status(201).json(await db.prepare('SELECT * FROM teams WHERE id = ?').get(result.lastInsertRowid));
}));

router.put('/teams/:id', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  const { name, logo_url, location, contact_email, contact_phone, facebook_url, instagram_url, twitter_url, website_url, sort_order } = req.body;
  const t = req.team;

  const resolved = {
    contact_email: contact_email ?? t.contact_email,
    facebook_url: facebook_url ?? t.facebook_url,
    instagram_url: instagram_url ?? t.instagram_url,
    twitter_url: twitter_url ?? t.twitter_url,
    website_url: website_url ?? t.website_url,
    logo_url: logo_url ?? t.logo_url,
  };
  const validationError = validateTeamFields(resolved);
  if (validationError) return res.status(400).json({ error: validationError });

  await db.prepare(`
    UPDATE teams SET
      name = COALESCE(?, name),
      logo_url = COALESCE(?, logo_url),
      location = COALESCE(?, location),
      contact_email = COALESCE(?, contact_email),
      contact_phone = COALESCE(?, contact_phone),
      facebook_url = COALESCE(?, facebook_url),
      instagram_url = COALESCE(?, instagram_url),
      twitter_url = COALESCE(?, twitter_url),
      website_url = COALESCE(?, website_url),
      sort_order = COALESCE(?, sort_order)
    WHERE id = ?
  `).run(
    toNull(name), toNull(logo_url), toNull(location), toNull(contact_email), toNull(contact_phone),
    toNull(facebook_url), toNull(instagram_url), toNull(twitter_url), toNull(website_url), toNull(sort_order), t.id
  );

  res.json(await db.prepare('SELECT * FROM teams WHERE id = ?').get(t.id));
}));

router.delete('/teams/:id', authRequired, teamOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM teams WHERE id = ?').run(req.team.id);
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
  const teams = await db.prepare('SELECT * FROM teams WHERE league_id = ? ORDER BY sort_order ASC, name ASC').all(league.id);
  res.json({ league, categories: categoriesWithMatches, teams });
}));

export default router;