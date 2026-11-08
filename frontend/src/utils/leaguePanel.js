// Lo que el panel de una liga calcula con el árbol que le llega
// (GET /leagues/:id/tree): en qué estado va cada partido, qué le toca atender a
// la liga, qué fila cae en qué filtro. Funciones puras, porque es lo único de
// esta pantalla que se puede probar sin Postgres.
//
// Nada de esto se guarda: se resuelve al leer (regla 4 de CLAUDE.md). El estado
// de un partido sale de su `status`, de su fecha y del estado automático de su
// categoría, igual que en el calendario público (`getMatchStatus`).

import { getMatchStatus } from './matchStatus.js';
import { jornadaLabel, ordenarCalendario } from './matchDisplay.js';
import { scopeName } from './matchScope.js';
import { formatNumber, matchesSearch, normalize, pluralize } from './adminPanel.js';

const HORA = 60 * 60 * 1000;

/* ---------- El árbol, rama por rama ---------- */

// Casi todo el panel trabaja rama por rama, y una rama sola no sabe de qué torneo
// ni de qué categoría es. Esto la regresa con los dos.
export function branchesOf(tree) {
  const out = [];
  for (const t of tree?.tournaments ?? []) {
    for (const c of t.categories ?? []) {
      for (const b of c.branches ?? []) out.push({ t, c, b });
    }
  }
  return out;
}

export function findBranch(tree, branchId) {
  return branchesOf(tree).find(({ b }) => String(b.id) === String(branchId)) ?? null;
}

// "LIGA MAYOR 2026 · COLEGIAL UNIVERSITARIO": de dónde es una rama, para cuando
// se nombra lejos de su torneo (el Resumen, el encabezado de la rama).
//
// Una categoría o rama `is_placeholder` es "Sin clasificar": donde el Excel de
// un torneo deja lo que no supo acomodar. Se nombra igual que las demás, porque
// su nombre es justo lo que avisa que hay algo por revisar.
export function branchPath({ t, c }) {
  return [[t.name, t.year].filter(Boolean).join(' '), c.name].filter(Boolean).join(' · ');
}

// La ruta completa, con la rama.
export const branchName = (entry) => `${branchPath(entry)} · ${entry.b.name}`;

/* ---------- El estado de un partido ---------- */

const tieneMarcador = (m) => m.home_score !== null && m.home_score !== undefined
  && m.away_score !== null && m.away_score !== undefined;

// Cuándo se da por terminado un partido que nadie cerró: su hora, más la ventana
// del estado automático de su categoría (3 h si no dice), más una hora. Es la
// misma cuenta del aviso "Falta capturar un marcador" (routes/notifications.js,
// NOMINAL_END), para que el panel y la bandeja digan lo mismo.
function yaDebioTerminar(match, category, now) {
  if (!match.match_date) return false;
  const ventana = Number(category?.auto_status_window_hours) || 3;
  return now > new Date(match.match_date).getTime() + (ventana + 1) * HORA;
}

// En qué va un partido, visto por quien lo administra:
//
//   live      se está jugando
//   played    terminó y tiene marcador
//   missing   terminó, o ya debió terminar, y no tiene marcador
//   unclosed  ya debió terminar y tiene marcador, pero nadie lo dio por final;
//             en una categoría sin estado automático se queda así para siempre,
//             y mientras tanto el calendario lo enseña como programado
//   upcoming  por jugar: sin fecha, o su hora todavía no pasa
export function matchState(match, category, now = Date.now()) {
  const status = getMatchStatus({
    ...match,
    auto_status_enabled: category?.auto_status_enabled,
    auto_status_window_hours: category?.auto_status_window_hours,
  }, now);
  if (status === 'live') return 'live';
  if (status === 'finished') return tieneMarcador(match) ? 'played' : 'missing';
  if (yaDebioTerminar(match, category, now)) return tieneMarcador(match) ? 'unclosed' : 'missing';
  return 'upcoming';
}

// Lo que le toca capturar a la liga. Un borrador no cuenta: no está publicado, y
// el aviso de la bandeja tampoco lo toma en cuenta.
export const needsCapture = (m) => !m.is_draft && (m.state === 'missing' || m.state === 'unclosed');

// Los partidos de una rama, en el orden del calendario público y con su estado.
export function branchCalendar(category, branch, now = Date.now()) {
  return ordenarCalendario(branch.matches ?? []).map((m) => ({ ...m, state: matchState(m, category, now) }));
}

// La búsqueda del calendario. "jornada 3" o "J3" piden esa jornada: buscando
// palabra por palabra, el "3" encontraba la sede "23 de Octubre" y metía partidos
// de la jornada 2. Lo demás busca en los equipos, la jornada y lo que se pase en
// `extra` (la sede, la conferencia).
export function matchSearch(query, match, extra = []) {
  const q = normalize(query).trim();
  const jornada = /^(?:jornada\s+(.+)|j\s*(\d+))$/.exec(q);
  if (jornada) return normalize(match.week_label).trim() === (jornada[1] ?? jornada[2]).trim();
  return matchesSearch(query, [match.home_team, match.away_team, jornadaLabel(match.week_label), ...extra]);
}

// Las celdas del marcador de una rama, que además filtran su calendario. Las
// opcionales solo salen cuando tienen partidos (ver `countFilters`).
export const CALENDAR_FILTERS = [
  { key: 'todos',        label: 'Partidos',     test: () => true },
  { key: 'por-jugar',    label: 'Por jugar',    test: (m) => m.state === 'upcoming' },
  { key: 'en-vivo',      label: 'En vivo',      test: (m) => m.state === 'live', optional: true },
  { key: 'jugados',      label: 'Jugados',      test: (m) => m.state === 'played' },
  // Lo único de la rama que pide algo hoy: por eso va en amarillo.
  { key: 'por-capturar', label: 'Por capturar', test: needsCapture, attention: true },
  { key: 'borradores',   label: 'Borradores',   test: (m) => Boolean(m.is_draft), optional: true, attention: true },
];

/* ---------- Conferencias y grupos de una rama ---------- */

// Los destinos a los que se puede asignar un equipo de esta rama. Una
// conferencia con grupos ofrece las dos cosas: la conferencia a secas (el
// equipo cuelga directo de ella) y cada uno de sus grupos.
export function scopeOptions(b) {
  const opts = [];
  for (const cf of (b.conferences || [])) {
    opts.push({ value: `c${cf.id}`, label: cf.name, conference_id: cf.id, group_id: null });
    for (const g of (cf.groups || [])) {
      opts.push({ value: `g${g.id}`, label: `${cf.name} — ${g.name}`, conference_id: cf.id, group_id: g.id });
    }
  }
  for (const g of (b.directGroups || [])) {
    opts.push({ value: `g${g.id}`, label: g.name, conference_id: null, group_id: g.id });
  }
  return opts;
}

// Una rama sin conferencias ni grupos no tiene nada que asignar: ahí la columna
// de conferencia ni siquiera aparece, para no ensuciar a las ligas que no se
// dividen (LFA, por ejemplo, juega todos contra todos).
export const hasScopeOptions = (b) => scopeOptions(b).length > 0;

export function currentScopeValue(team) {
  if (team.group_id) return `g${team.group_id}`;
  if (team.conference_id) return `c${team.conference_id}`;
  return '';
}

// Los inscritos que todavía no dicen su conferencia, en una rama que sí se
// divide: son justo los que hay que asignar para que sus partidos dejen de
// depender de lo que se haya capturado a mano.
export function unassignedTeams(b) {
  return hasScopeOptions(b) ? (b.teams || []).filter((tm) => !scopeName(tm)) : [];
}

// Equipos agrupados bajo el encabezado de su conferencia. Los que no tienen
// ninguna quedan hasta abajo, visibles a propósito.
export function groupTeamsByScope(b) {
  const teams = b.teams || [];
  if (!hasScopeOptions(b)) return [{ key: 'todos', label: null, teams }];

  const bloques = new Map();
  for (const tm of teams) {
    const label = scopeName(tm);
    const key = label || '__sin__';
    if (!bloques.has(key)) bloques.set(key, { key, label: label || 'Sin conferencia asignada', missing: !label, teams: [] });
    bloques.get(key).teams.push(tm);
  }
  return [...bloques.values()].sort((a, b2) => {
    if (a.key === '__sin__') return 1;
    if (b2.key === '__sin__') return -1;
    return a.label.localeCompare(b2.label);
  });
}

/* ---------- Cifras ---------- */

export function branchSummary(category, branch, now = Date.now()) {
  const calendar = branchCalendar(category, branch, now);
  const count = (test) => calendar.filter(test).length;
  return {
    matches: calendar.length,
    played: count((m) => m.state === 'played'),
    upcoming: count((m) => m.state === 'upcoming'),
    live: count((m) => m.state === 'live'),
    toCapture: count(needsCapture),
    drafts: count((m) => Boolean(m.is_draft)),
    teams: (branch.teams || []).length,
    unassigned: unassignedTeams(branch).length,
  };
}

export function leagueTotals(tree, now = Date.now()) {
  const totals = {
    tournaments: (tree?.tournaments ?? []).length,
    categories: 0,
    branches: 0,
    matches: 0,
    played: 0,
    upcoming: 0,
    live: 0,
    toCapture: 0,
    drafts: 0,
    teams: (tree?.teams ?? []).length,
    handedOver: (tree?.teams ?? []).filter((tm) => tm.owner_user_id).length,
    venues: (tree?.venues ?? []).length,
  };
  for (const t of tree?.tournaments ?? []) {
    for (const c of t.categories ?? []) {
      totals.categories += 1;
      for (const b of c.branches ?? []) {
        totals.branches += 1;
        const s = branchSummary(c, b, now);
        for (const key of ['matches', 'played', 'upcoming', 'live', 'toCapture', 'drafts']) totals[key] += s[key];
      }
    }
  }
  return totals;
}

// Cuántos pendientes lleva el aviso amarillo de "Torneos" en la barra lateral: lo
// mismo que lista "Lo que te toca", contado.
export function attentionCount(tree, now = Date.now()) {
  return leagueAttention(tree, now).reduce((sum, item) => sum + item.count, 0);
}

/* ---------- Lo que le toca a la liga ---------- */

// Lo que sale arriba del Resumen. Cada renglón lleva a la rama, ya filtrada en lo
// que hay que resolver.
export function leagueAttention(tree, now = Date.now()) {
  const items = [];
  for (const entry of branchesOf(tree)) {
    const { c, b } = entry;
    const s = branchSummary(c, b, now);
    const where = branchName(entry);
    const base = `?seccion=torneos&rama=${b.id}`;
    if (s.toCapture > 0) {
      items.push({
        key: `capturar-${b.id}`,
        count: s.toCapture,
        text: s.toCapture === 1 ? '1 partido por capturar' : `${formatNumber(s.toCapture)} partidos por capturar`,
        where,
        to: `${base}&filtro=por-capturar`,
      });
    }
    if (s.drafts > 0) {
      items.push({
        key: `borradores-${b.id}`,
        count: s.drafts,
        text: `${pluralize(s.drafts, 'partido')} en borrador, sin publicar`,
        where,
        to: `${base}&filtro=borradores`,
      });
    }
    if (s.unassigned > 0) {
      items.push({
        key: `conferencia-${b.id}`,
        count: s.unassigned,
        text: `${pluralize(s.unassigned, 'equipo')} sin conferencia`,
        where,
        to: `${base}&vista=equipos`,
      });
    }
  }
  return items;
}

/* ---------- Lo próximo y lo último ---------- */

function partidosDeLaLiga(tree, now) {
  return branchesOf(tree).flatMap((entry) => branchCalendar(entry.c, entry.b, now)
    .filter((m) => !m.is_draft)
    .map((m) => ({ match: m, ...entry })));
}

// Lo que se está jugando y lo que sigue, en orden de fecha. Sin fecha no entra:
// no se sabe cuándo es "lo próximo".
export function upcomingFeed(tree, now = Date.now(), limit = 6) {
  const fecha = (row) => new Date(row.match.match_date).getTime();
  const vivos = partidosDeLaLiga(tree, now).filter((row) => row.match.state === 'live');
  const siguientes = partidosDeLaLiga(tree, now)
    .filter((row) => row.match.state === 'upcoming' && row.match.match_date)
    .sort((a, b) => fecha(a) - fecha(b));
  return [...vivos, ...siguientes].slice(0, limit);
}

// Los últimos marcadores, el más reciente arriba.
export function resultsFeed(tree, now = Date.now(), limit = 6) {
  const fecha = (row) => (row.match.match_date ? new Date(row.match.match_date).getTime() : 0);
  return partidosDeLaLiga(tree, now)
    .filter((row) => row.match.state === 'played')
    .sort((a, b) => fecha(b) - fecha(a))
    .slice(0, limit);
}

/* ---------- Equipos y sedes de la liga ---------- */

// En qué ramas juega cada equipo de la liga.
export function teamBranches(tree) {
  const map = new Map();
  for (const entry of branchesOf(tree)) {
    for (const tm of entry.b.teams ?? []) {
      if (!map.has(tm.id)) map.set(tm.id, []);
      map.get(tm.id).push(entry);
    }
  }
  return map;
}

export const TEAM_FILTERS = [
  { key: 'todos',         label: 'Equipos',              test: () => true },
  { key: 'solos',         label: 'Se administran solos', test: (tm) => Boolean(tm.owner_user_id) },
  { key: 'sin-entregar',  label: 'Sin entregar',         test: (tm) => !tm.owner_user_id },
  { key: 'sin-inscribir', label: 'Sin inscribir',        test: (tm) => tm.branchCount === 0, optional: true },
];

// Cuántos partidos se juegan en cada sede.
export function venueUsage(tree) {
  const map = new Map();
  for (const { b } of branchesOf(tree)) {
    for (const m of b.matches ?? []) {
      if (m.venue_id) map.set(m.venue_id, (map.get(m.venue_id) || 0) + 1);
    }
  }
  return map;
}

export const VENUE_FILTERS = [
  { key: 'todas',   label: 'Sedes',        test: () => true },
  { key: 'en-uso',  label: 'Con partidos', test: (v) => v.matchCount > 0 },
  { key: 'sin-uso', label: 'Sin partidos', test: (v) => v.matchCount === 0, optional: true },
];

/* ---------- La liga ---------- */

// Publicar es decisión de CFBAMX, a pedido de la liga (README, "Organizaciones:
// publicar y verificar"): la liga puede estar publicada, haberlo pedido, o ninguna.
export function visibilityOf(league) {
  if (!league) return null;
  if (league.is_public) return 'publica';
  if (league.publish_requested) return 'solicitud';
  return 'privada';
}

export const VISIBILITY = {
  publica:   { tone: 'on',  label: 'Pública' },
  solicitud: { tone: 'ask', label: 'Solicitud enviada' },
  privada:   { tone: 'off', label: 'Privada' },
};
