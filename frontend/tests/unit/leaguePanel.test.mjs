// Pruebas de lo que calcula el panel de una liga (utils/leaguePanel.js). Los casos
// salen del árbol que de verdad contesta GET /leagues/:id/tree: ONEFA con el
// estado automático prendido y una ventana de 3 h, la LFA sin conferencias, y
// partidos programados con marcador que nadie cerró.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CALENDAR_FILTERS, TEAM_FILTERS, VENUE_FILTERS, attentionCount, branchCalendar, branchName, branchPath,
  branchSummary, branchesOf, currentScopeValue, findBranch, groupTeamsByScope, hasScopeOptions,
  leagueAttention, leagueTotals, matchSearch, matchState, needsCapture, resultsFeed, scopeOptions, teamBranches,
  unassignedTeams, upcomingFeed, venueUsage, visibilityOf,
} from '../../src/utils/leaguePanel.js';
import { countFilters } from '../../src/utils/adminPanel.js';

const AHORA = Date.parse('2026-11-07T20:00:00Z');
const hace = (horas) => new Date(AHORA - horas * 3600 * 1000).toISOString();
const en = (horas) => new Date(AHORA + horas * 3600 * 1000).toISOString();

const AUTO = { auto_status_enabled: true, auto_status_window_hours: 3 };
const MANUAL = { auto_status_enabled: false, auto_status_window_hours: 3 };

const partido = (id, extra = {}) => ({
  id, home_team: `Local ${id}`, away_team: `Visita ${id}`, status: 'scheduled',
  home_score: null, away_score: null, match_date: en(24), is_draft: false, week_label: '1', ...extra,
});

test('un partido cerrado a mano manda sobre el reloj', () => {
  assert.equal(matchState(partido(1, { status: 'finished', home_score: 21, away_score: 14 }), AUTO, AHORA), 'played');
  assert.equal(matchState(partido(1, { status: 'finished' }), AUTO, AHORA), 'missing');
  assert.equal(matchState(partido(1, { status: 'live', match_date: hace(30) }), MANUAL, AHORA), 'live');
});

test('con estado automático, la ventana de la categoría decide si ya se jugó', () => {
  assert.equal(matchState(partido(1, { match_date: hace(1) }), AUTO, AHORA), 'live');
  assert.equal(matchState(partido(1, { match_date: hace(4) }), AUTO, AHORA), 'missing');
  // Así llegan partidos de ONEFA: programados, con marcador y ya pasados.
  assert.equal(matchState(partido(1, { match_date: hace(4), home_score: 42, away_score: 49 }), AUTO, AHORA), 'played');
});

test('sin estado automático, uno programado se da por terminado una hora después de su ventana', () => {
  assert.equal(matchState(partido(1, { match_date: hace(2) }), MANUAL, AHORA), 'upcoming');
  assert.equal(matchState(partido(1, { match_date: hace(3.5) }), MANUAL, AHORA), 'upcoming');
  assert.equal(matchState(partido(1, { match_date: hace(4.5) }), MANUAL, AHORA), 'missing');
  // Tiene marcador, pero el calendario lo sigue enseñando como programado.
  assert.equal(matchState(partido(1, { match_date: hace(4.5), home_score: 7, away_score: 0 }), MANUAL, AHORA), 'unclosed');
  // La ventana es la de su categoría: con 2 h, a las 3.5 h ya pasó.
  assert.equal(matchState(partido(1, { match_date: hace(3.5) }), { ...MANUAL, auto_status_window_hours: 2 }, AHORA), 'missing');
});

test('sin fecha no está atrasado: se queda por jugar', () => {
  assert.equal(matchState(partido(1, { match_date: null }), AUTO, AHORA), 'upcoming');
  assert.equal(matchState(partido(1, { match_date: null }), MANUAL, AHORA), 'upcoming');
});

test('un borrador no es trabajo pendiente de capturar, aunque ya haya pasado', () => {
  assert.ok(needsCapture({ state: 'missing', is_draft: false }));
  assert.ok(needsCapture({ state: 'unclosed', is_draft: false }));
  assert.ok(!needsCapture({ state: 'missing', is_draft: true }));
  assert.ok(!needsCapture({ state: 'played', is_draft: false }));
});

const ramaONEFA = {
  id: 17,
  name: 'Varonil',
  conferences: [
    { id: 7, name: '14 GRANDES', groups: [] },
    { id: 8, name: 'NACIONAL', groups: [{ id: 3, name: 'Grupo A' }] },
  ],
  directGroups: [],
  teams: [
    { id: 16, name: 'AUTÉNTICOS TIGRES UANL', conference_id: 7, conference_name: '14 GRANDES' },
    { id: 18, name: 'BORREGOS CCM', conference_id: 8, conference_name: 'NACIONAL', group_id: 3, group_name: 'Grupo A' },
    { id: 21, name: 'AZTECAS UDLAP', conference_id: null, conference_name: null },
  ],
  matches: [
    partido(1, { status: 'finished', home_score: 21, away_score: 14, match_date: hace(200), venue_id: 4 }),
    partido(2, { match_date: hace(30), venue_id: 4 }),
    partido(3, { match_date: hace(30), is_draft: true }),
    partido(4, { match_date: hace(1) }),
    partido(5, { match_date: en(48), venue_id: 9 }),
    partido(6, { match_date: null, week_label: '2' }),
    partido(7, { match_date: en(24) }),
  ],
};
const ramaLFA = {
  id: 30, name: 'Varonil', conferences: [], directGroups: [],
  teams: [{ id: 16, name: 'AUTÉNTICOS TIGRES UANL' }, { id: 40, name: 'OSOS' }],
  matches: [partido(31, { status: 'finished', home_score: 3, away_score: 10, match_date: hace(100) })],
};
const arbol = {
  league: { id: 13, is_public: true },
  teams: [{ id: 16, owner_user_id: 5 }, { id: 18 }, { id: 21 }, { id: 40 }, { id: 99 }],
  venues: [{ id: 4 }, { id: 9 }, { id: 12 }],
  tournaments: [
    { id: 1, name: 'LIGA MAYOR', year: 2026, categories: [{ id: 2, name: 'COLEGIAL UNIVERSITARIO', ...AUTO, branches: [ramaONEFA] }] },
    { id: 5, name: 'TAZÓN', year: 2025, categories: [{ id: 6, name: 'PROFESIONAL', ...MANUAL, branches: [ramaLFA] }] },
  ],
};

test('cada rama sabe de qué torneo y de qué categoría es', () => {
  const ramas = branchesOf(arbol);
  assert.deepEqual(ramas.map(({ b }) => b.id), [17, 30]);
  assert.equal(branchPath(ramas[0]), 'LIGA MAYOR 2026 · COLEGIAL UNIVERSITARIO');
  assert.equal(branchName(ramas[0]), 'LIGA MAYOR 2026 · COLEGIAL UNIVERSITARIO · Varonil');
  assert.equal(findBranch(arbol, '30').c.name, 'PROFESIONAL');
  assert.equal(findBranch(arbol, 999), null);
  assert.deepEqual(branchesOf(null), []);
});

test('el calendario de una rama sale en el orden público y con su estado', () => {
  const cal = branchCalendar(arbol.tournaments[0].categories[0], ramaONEFA, AHORA);
  assert.deepEqual(cal.map((m) => m.state), ['played', 'missing', 'missing', 'live', 'upcoming', 'upcoming', 'upcoming']);
  // El de fecha por definir no se va al principio: va al final de su jornada.
  assert.equal(cal[cal.length - 1].id, 6);
});

test('el marcador de la rama: las celdas opcionales solo salen con partidos', () => {
  const cal = branchCalendar(arbol.tournaments[0].categories[0], ramaONEFA, AHORA);
  const celdas = Object.fromEntries(countFilters(CALENDAR_FILTERS, cal).map((f) => [f.key, f.count]));
  assert.deepEqual(celdas, { todos: 7, 'por-jugar': 3, 'en-vivo': 1, jugados: 1, 'por-capturar': 1, borradores: 1 });

  const lfa = branchCalendar(arbol.tournaments[1].categories[0], ramaLFA, AHORA);
  assert.deepEqual(countFilters(CALENDAR_FILTERS, lfa).map((f) => f.key), ['todos', 'por-jugar', 'jugados', 'por-capturar']);
});

test('conferencias: qué se puede elegir y quién falta de asignar', () => {
  assert.deepEqual(scopeOptions(ramaONEFA).map((o) => o.label), ['14 GRANDES', 'NACIONAL', 'NACIONAL — Grupo A']);
  assert.ok(hasScopeOptions(ramaONEFA));
  assert.ok(!hasScopeOptions(ramaLFA));
  assert.deepEqual(unassignedTeams(ramaONEFA).map((t) => t.id), [21]);
  // Una rama que no se divide no tiene a nadie "sin conferencia".
  assert.deepEqual(unassignedTeams(ramaLFA), []);
  assert.equal(currentScopeValue(ramaONEFA.teams[1]), 'g3');
  assert.equal(currentScopeValue(ramaONEFA.teams[0]), 'c7');
  assert.equal(currentScopeValue(ramaONEFA.teams[2]), '');
});

test('los equipos sin conferencia van al final, a la vista', () => {
  const bloques = groupTeamsByScope(ramaONEFA);
  assert.deepEqual(bloques.map((b) => b.label), ['14 GRANDES', 'NACIONAL — Grupo A', 'Sin conferencia asignada']);
  assert.ok(bloques[2].missing);
  assert.deepEqual(groupTeamsByScope(ramaLFA).map((b) => b.label), [null]);
});

test('las cifras de la liga suman las de sus ramas', () => {
  const s = branchSummary(arbol.tournaments[0].categories[0], ramaONEFA, AHORA);
  assert.deepEqual(s, { matches: 7, played: 1, upcoming: 3, live: 1, toCapture: 1, drafts: 1, teams: 3, unassigned: 1 });
  const total = leagueTotals(arbol, AHORA);
  assert.equal(total.matches, 8);
  assert.equal(total.played, 2);
  assert.equal(total.tournaments, 2);
  assert.equal(total.categories, 2);
  assert.equal(total.branches, 2);
  assert.equal(total.teams, 5);
  assert.equal(total.handedOver, 1);
  assert.equal(total.venues, 3);
});

test('lo que le toca a la liga lleva a la rama, ya filtrada', () => {
  const items = leagueAttention(arbol, AHORA);
  assert.deepEqual(items.map((i) => [i.text, i.to]), [
    ['1 partido por capturar', '?seccion=torneos&rama=17&filtro=por-capturar'],
    ['1 partido en borrador, sin publicar', '?seccion=torneos&rama=17&filtro=borradores'],
    ['1 equipo sin conferencia', '?seccion=torneos&rama=17&vista=equipos'],
  ]);
  assert.equal(items[0].where, 'LIGA MAYOR 2026 · COLEGIAL UNIVERSITARIO · Varonil');
  assert.equal(attentionCount(arbol, AHORA), 3);
  // Una temporada cerrada no pide nada.
  assert.deepEqual(leagueAttention({ tournaments: [arbol.tournaments[1]] }, AHORA), []);
});

test('lo próximo: primero lo que se juega, luego por fecha; sin borradores ni fechas por definir', () => {
  const proximos = upcomingFeed(arbol, AHORA);
  assert.deepEqual(proximos.map((r) => r.match.id), [4, 7, 5]);
  assert.equal(proximos[0].b.id, 17);
  assert.deepEqual(resultsFeed(arbol, AHORA).map((r) => r.match.id), [31, 1]);
  assert.equal(upcomingFeed(arbol, AHORA, 1).length, 1);
});

test('equipos y sedes: dónde juega cada quien y cuánto se usa cada sede', () => {
  const ramas = teamBranches(arbol);
  assert.deepEqual(ramas.get(16).map(({ b }) => b.id), [17, 30]);
  assert.equal(ramas.get(99), undefined);

  const conRamas = arbol.teams.map((tm) => ({ ...tm, branchCount: ramas.get(tm.id)?.length ?? 0 }));
  assert.deepEqual(
    countFilters(TEAM_FILTERS, conRamas).map((f) => [f.key, f.count]),
    [['todos', 5], ['solos', 1], ['sin-entregar', 4], ['sin-inscribir', 1]],
  );

  const uso = venueUsage(arbol);
  assert.equal(uso.get(4), 2);
  assert.equal(uso.get(9), 1);
  assert.equal(uso.get(12), undefined);
  const sedes = arbol.venues.map((v) => ({ ...v, matchCount: uso.get(v.id) ?? 0 }));
  assert.deepEqual(countFilters(VENUE_FILTERS, sedes).map((f) => [f.key, f.count]), [['todas', 3], ['en-uso', 2], ['sin-uso', 1]]);
});

test('la visibilidad de la liga: publicada manda sobre una solicitud vieja', () => {
  assert.equal(visibilityOf({ is_public: true, publish_requested: true }), 'publica');
  assert.equal(visibilityOf({ is_public: false, publish_requested: true }), 'solicitud');
  assert.equal(visibilityOf({ is_public: false, publish_requested: false }), 'privada');
  assert.equal(visibilityOf(null), null);
});

test('buscar "jornada 3" trae esa jornada, no cualquier cosa con un 3', () => {
  // Así salía antes: la sede "23 DE OCTUBRE" metía un partido de la jornada 2.
  const j2 = { home_team: 'LEONES UAC', away_team: 'ÁGUILAS BLANCAS IPN', week_label: '2' };
  const j3 = { home_team: 'LINCES UVM', away_team: 'ZORROS CETYS', week_label: '3' };
  const sf = { home_team: 'LINCES UVM', away_team: 'BORREGOS', week_label: 'SEMIFINAL' };
  const sede = ['23 DE OCTUBRE'];
  assert.ok(!matchSearch('jornada 3', j2, sede));
  assert.ok(matchSearch('Jornada 3', j3, sede));
  assert.ok(matchSearch('j3', j3));
  assert.ok(matchSearch('J 3', j3));
  assert.ok(!matchSearch('j3', j2));
  assert.ok(matchSearch('jornada semifinal', sf));
  // Un equipo que empieza con J no se confunde con una jornada.
  assert.ok(matchSearch('jefes', { home_team: 'JEFES', away_team: 'OSOS', week_label: '1' }));
  // Lo demás busca palabra por palabra, sin acentos, en equipos, jornada y extra.
  assert.ok(matchSearch('aguilas uac', j2));
  assert.ok(matchSearch('octubre', j2, sede));
  assert.ok(matchSearch('', j2));
});

