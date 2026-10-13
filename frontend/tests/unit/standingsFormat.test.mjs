// Pruebas de cómo se escribe una tabla de posiciones y de qué columnas lleva
// su imagen para compartir (utils/standingsFormat.js).
//
// Lo que importa: que la imagen diga lo mismo que la tabla en pantalla —las
// mismas columnas, en el mismo orden, con las cifras escritas igual— y que no
// pierda ninguna de las marcas que la tabla enseña.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pct, recordLabel, rowQualifies, scopeLabel, cutoffLabel,
  imageColumns, cellText, tableMarks,
} from '../../src/utils/standingsFormat.js';

const fila = (extra = {}) => ({
  team_id: 1, rank: 1, name: 'BORREGOS TEC MTY',
  played: 4, wins: 3, losses: 1, ties: 0,
  win_pct: 0.75, table_points: null,
  points_for: 120, points_against: 80, point_diff: 40,
  scope_record: { wins: 2, losses: 1, ties: 0 },
  streak: 'G2', unresolved_tie: false,
  ...extra,
});

const ids = (columns) => columns.map((c) => c.id);

test('el porcentaje se escribe como en las tablas deportivas', () => {
  assert.equal(pct(1), '1.000');
  assert.equal(pct(0.75), '.750');
  assert.equal(pct(0.5), '.500');
  assert.equal(pct(0), '.000');
});

test('el récord lleva empates solo si los hubo', () => {
  assert.equal(recordLabel({ wins: 3, losses: 1, ties: 0 }), '3-1');
  assert.equal(recordLabel({ wins: 3, losses: 1, ties: 2 }), '3-1-2');
  assert.equal(recordLabel(null), '—');
});

test('clasifican los primeros N, y el comodín aunque su lugar no alcance', () => {
  assert.equal(rowQualifies(fila({ rank: 2 }), 2), true);
  assert.equal(rowQualifies(fila({ rank: 3 }), 2), false);
  assert.equal(rowQualifies(fila({ rank: 1 }), 0), false);
  assert.equal(rowQualifies(fila({ rank: 3, qualified_as: 'wildcard' }), 2), true);
  assert.equal(rowQualifies(fila({ rank: 5, qualified_as: 'wildcard' }), 0), true);
});

test('la imagen nombra la tabla completa, sin repetir la palabra', () => {
  assert.equal(scopeLabel('conference', 'NACIONAL'), 'Conferencia NACIONAL');
  assert.equal(scopeLabel('conference', '14 GRANDES'), 'Conferencia 14 GRANDES');
  assert.equal(scopeLabel('group', 'A'), 'Grupo A');
  assert.equal(scopeLabel('group', 'GRUPO A'), 'GRUPO A');
  assert.equal(scopeLabel('conference', 'Conferencia Norte'), 'Conferencia Norte');
  assert.equal(scopeLabel('conference', '  NACIONAL  '), 'Conferencia NACIONAL');
});

test('la tabla general no lleva nombre', () => {
  assert.equal(scopeLabel('branch', null), '');
  assert.equal(scopeLabel('conference', ''), '');
  assert.equal(scopeLabel('conference', null), '');
});

test('la fecha de corte va escrita completa, en español', () => {
  assert.equal(cutoffLabel(new Date(2026, 9, 12, 12)), 'Al 12 de octubre de 2026');
  assert.equal(cutoffLabel(new Date(2027, 0, 3, 12)), 'Al 3 de enero de 2027');
});

test('una tabla general lleva todas las columnas de la pantalla, en su orden', () => {
  const columns = imageColumns({ level: 'branch', rows: [fila()] }, false);
  assert.deepEqual(ids(columns), ['played', 'wins', 'losses', 'pct', 'pf', 'pc', 'diff', 'streak']);
});

test('una tabla de conferencia también lleva PF y PC, además de su récord EN CONF.', () => {
  const columns = imageColumns({ level: 'conference', rows: [fila()] }, false);
  assert.deepEqual(ids(columns), ['played', 'wins', 'losses', 'pct', 'scope', 'pf', 'pc', 'diff', 'streak']);
  assert.equal(columns.find((c) => c.id === 'scope').label, 'EN CONF.');
});

test('con empates y puntos aparecen E y PTS, y la de grupo dice EN GRUPO', () => {
  const rows = [fila({ ties: 1, table_points: 10 }), fila({ team_id: 2, rank: 2 })];
  const columns = imageColumns({ level: 'group', rows }, true);
  assert.deepEqual(
    ids(columns),
    ['played', 'wins', 'losses', 'ties', 'points', 'scope', 'pf', 'pc', 'diff', 'streak'],
  );
  assert.equal(columns.find((c) => c.id === 'scope').label, 'EN GRUPO');
});

test('la E solo aparece si alguien empató, igual que en pantalla', () => {
  const sinEmpates = imageColumns({ level: 'branch', rows: [fila(), fila({ team_id: 2 })] }, false);
  assert.ok(!ids(sinEmpates).includes('ties'));
  const conEmpate = imageColumns({ level: 'branch', rows: [fila(), fila({ team_id: 2, ties: 1 })] }, false);
  assert.ok(ids(conEmpate).includes('ties'));
});

test('la cifra que ordena la tabla es la resaltada', () => {
  const conPct = imageColumns({ level: 'branch', rows: [fila()] }, false);
  assert.deepEqual(conPct.filter((c) => c.highlight).map((c) => c.id), ['pct']);
  const conPuntos = imageColumns({ level: 'branch', rows: [fila()] }, true);
  assert.deepEqual(conPuntos.filter((c) => c.highlight).map((c) => c.id), ['points']);
});

test('cada celda se escribe igual que en la tabla', () => {
  const r = fila({ point_diff: 40, table_points: 9 });
  assert.equal(cellText('pct', r), '.750');
  assert.equal(cellText('points', r), '9');
  assert.equal(cellText('points', fila({ table_points: null })), '0');
  assert.equal(cellText('diff', r), '+40');
  assert.equal(cellText('diff', fila({ point_diff: -12 })), '-12');
  assert.equal(cellText('diff', fila({ point_diff: 0 })), '0');
  assert.equal(cellText('scope', r), '2-1');
  assert.equal(cellText('streak', r), 'G2');
  assert.equal(cellText('streak', fila({ streak: null })), '—');
  assert.equal(cellText('pf', r), '120');
  assert.equal(cellText('pc', r), '80');
});

test('la leyenda solo explica las marcas que la tabla trae', () => {
  const limpia = { qualifying_count: 0, rows: [fila(), fila({ team_id: 2, rank: 2 })] };
  assert.deepEqual(tableMarks(limpia), { qualifies: false, unresolvedTie: false });

  const conCorte = { qualifying_count: 1, rows: [fila(), fila({ team_id: 2, rank: 2 })] };
  assert.equal(tableMarks(conCorte).qualifies, true);

  const empatada = { qualifying_count: 0, rows: [fila({ unresolved_tie: true }), fila({ team_id: 2, unresolved_tie: true })] };
  assert.equal(tableMarks(empatada).unresolvedTie, true);
});
