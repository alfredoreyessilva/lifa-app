import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  playedBefore, recentResults, resultOf, sideOfMatch, standingOf, weekMatches,
} from '../../src/utils/matchContext.js';
import { computeStandings } from '../../src/utils/standings.js';

const terminado = (id, fecha, local, marcadorLocal, visita, marcadorVisita, extra = {}) => ({
  id,
  match_date: fecha,
  home_team_id: local,
  away_team_id: visita,
  home_team: `E${local}`,
  away_team: `E${visita}`,
  home_score: marcadorLocal,
  away_score: marcadorVisita,
  is_final: true,
  week_label: '1',
  phase_type: 'round_robin',
  counts_for_standings: true,
  ...extra,
});

const equipos = new Map([
  [1, { team_id: 1, logo_url: 'uno.png', away_logo_url: 'uno-v.png' }],
  [2, { team_id: 2, logo_url: 'dos.png', away_logo_url: null }],
]);

test('playedBefore: corta por fecha, sin este partido ni los de la misma hora', () => {
  const este = { id: 3, match_date: '2026-10-10T20:00:00.000Z' };
  const lista = [
    { id: 1, match_date: '2026-10-03T20:00:00.000Z' },
    { id: 2, match_date: '2026-10-10T20:00:00.000Z' },
    este,
    { id: 4, match_date: '2026-10-17T20:00:00.000Z' },
    { id: 5, match_date: null },
  ];
  assert.deepEqual(playedBefore(este, lista).map((m) => m.id), [1]);
});

test('playedBefore: un partido con fecha por definir se compara contra todos los demás', () => {
  const este = { id: 3, match_date: null };
  const lista = [{ id: 1, match_date: '2026-10-03T20:00:00.000Z' }, este, { id: 5, match_date: null }];
  assert.deepEqual(playedBefore(este, lista).map((m) => m.id), [1, 5]);
});

test('playedBefore: compara instantes, no texto, aunque la zona venga escrita distinto', () => {
  // match_date es TEXT: "2026-10-10T06:00-06:00" es más tarde que "07:00Z"
  // aunque como cadena salga antes.
  const este = { id: 2, match_date: '2026-10-10T07:00:00.000Z' };
  const lista = [{ id: 1, match_date: '2026-10-10T06:00:00-06:00' }, este];
  assert.deepEqual(playedBefore(este, lista).map((m) => m.id), []);
});

test('resultOf: gana, pierde o empata', () => {
  assert.equal(resultOf(21, 14), 'G');
  assert.equal(resultOf(7, 14), 'P');
  assert.equal(resultOf(14, 14), 'E');
});

test('recentResults: del más reciente al más viejo, con los puntos del lado del equipo', () => {
  const lista = [
    terminado(1, '2026-09-01T20:00:00Z', 1, 21, 2, 14),
    terminado(2, '2026-09-08T20:00:00Z', 2, 28, 1, 7),
  ];
  const r = recentResults(1, lista, equipos);
  assert.deepEqual(r.map((x) => x.match_id), [2, 1]);
  assert.equal(r[0].is_home, false);
  assert.equal(r[0].opponent, 'E2');
  assert.equal(r[0].opponent_logo_url, 'dos.png');
  assert.equal(r[0].scored, 7);
  assert.equal(r[0].allowed, 28);
  assert.equal(r[0].result, 'P');
});

test('recentResults: no cuenta lo que no se jugó, ni un 0-0 inventado, ni un scrimmage', () => {
  const lista = [
    terminado(1, '2026-09-01T20:00:00Z', 1, 21, 2, 14, { is_final: false }),
    terminado(2, '2026-09-08T20:00:00Z', 1, null, 2, null),
    terminado(3, '2026-09-15T20:00:00Z', 1, 7, 2, 0, { phase_type: 'exhibition' }),
  ];
  assert.deepEqual(recentResults(1, lista, equipos), []);
});

test('recentResults: los playoffs sí, aunque no sumen al récord', () => {
  const lista = [terminado(1, '2026-09-01T20:00:00Z', 1, 21, 2, 14, {
    phase_type: 'single_elimination', counts_for_standings: false,
  })];
  assert.equal(recentResults(1, lista, equipos).length, 1);
});

test('recentResults: un rival de fuera de la rama sale con su nombre y sin logo', () => {
  const r = recentResults(1, [terminado(1, '2026-09-01T20:00:00Z', 1, 21, 99, 14)], equipos);
  assert.equal(r[0].opponent, 'E99');
  assert.equal(r[0].opponent_logo_url, null);
});

test('recentResults: se queda con los últimos cinco', () => {
  const lista = Array.from({ length: 7 }, (_, i) =>
    terminado(i + 1, `2026-09-0${i + 1}T20:00:00Z`, 1, 21, 2, 14));
  assert.deepEqual(recentResults(1, lista, equipos).map((x) => x.match_id), [7, 6, 5, 4, 3]);
});

test('standingOf: el récord es uno y los lugares, uno por tabla', () => {
  const fila = {
    team_id: 1, rank: 2, wins: 3, losses: 1, ties: 0, played: 4, points_for: 80, points_against: 40,
    home_record: {}, away_record: {}, streak: 'G2',
  };
  const tablas = [
    { level: 'conference', scope_name: 'NACIONAL', rows: [{ team_id: 9, rank: 1 }, fila, { team_id: 8, rank: 3 }] },
    { level: 'group', scope_name: 'BAJÍO', rows: [{ ...fila, rank: 1 }, { team_id: 8, rank: 2 }] },
    { level: 'group', scope_name: 'CENTRO', rows: [{ team_id: 7, rank: 1 }] },
  ];
  const s = standingOf(1, tablas);
  assert.equal(s.wins, 3);
  assert.deepEqual(s.places, [
    { level: 'conference', scope_name: 'NACIONAL', rank: 2, of: 3 },
    { level: 'group', scope_name: 'BAJÍO', rank: 1, of: 2 },
  ]);
});

test('standingOf: sin juegos no hay lugar que decir, y fuera de la rama no hay equipo', () => {
  const fila = { team_id: 1, rank: 1, wins: 0, losses: 0, ties: 0, played: 0, points_for: 0, points_against: 0 };
  assert.deepEqual(standingOf(1, [{ level: 'branch', scope_name: null, rows: [fila] }]).places, []);
  assert.equal(standingOf(2, [{ level: 'branch', scope_name: null, rows: [fila] }]), null);
});

test('sideOfMatch: un partido que no sabe de qué equipo habla no afirma nada', () => {
  assert.equal(sideOfMatch(null, [], [], equipos), null);
});

test('El récord con que llegó: el partido de la Jornada 2 no ve la Jornada 3', () => {
  // De punta a punta con el motor real de la tabla: es la promesa de esta pieza.
  const teams = [{ team_id: 1, name: 'E1' }, { team_id: 2, name: 'E2' }];
  const j1 = terminado(1, '2026-09-01T20:00:00Z', 1, 21, 2, 14);
  const j2 = terminado(2, '2026-09-08T20:00:00Z', 2, 21, 1, 14);
  const j3 = terminado(3, '2026-09-15T20:00:00Z', 1, 21, 2, 14);
  const antes = playedBefore(j2, [j1, j2, j3]);
  const tablas = [{ level: 'branch', scope_name: null, rows: computeStandings({ teams, matches: antes }) }];

  const lado = sideOfMatch(1, tablas, antes, equipos);
  assert.equal(`${lado.wins}-${lado.losses}`, '1-0');
  assert.equal(lado.streak, 'G1');
  assert.deepEqual(lado.recent.map((r) => r.match_id), [1]);
});

test('weekMatches: los demás de la jornada, con el logo de visitante si lo tiene', () => {
  const este = terminado(1, '2026-09-01T20:00:00Z', 1, 21, 2, 14);
  const lista = [
    este,
    terminado(2, '2026-09-01T23:00:00Z', 2, 7, 1, 3),
    terminado(3, '2026-09-08T20:00:00Z', 1, 7, 2, 3, { week_label: '2' }),
  ];
  const r = weekMatches(este, lista, equipos);
  assert.deepEqual(r.map((m) => m.id), [2]);
  assert.equal(r[0].home_logo_url, 'dos.png');
  assert.equal(r[0].away_logo_url, 'uno-v.png');
});

test('weekMatches: sin logo de visitante usa el de siempre, y sin jornada no hay lista', () => {
  const este = terminado(1, '2026-09-01T20:00:00Z', 1, 21, 2, 14);
  const otro = terminado(2, '2026-09-01T23:00:00Z', 1, 7, 2, 3);
  assert.equal(weekMatches(este, [este, otro], equipos)[0].away_logo_url, 'dos.png');
  assert.deepEqual(weekMatches({ ...este, week_label: null }, [este, otro], equipos), []);
});
