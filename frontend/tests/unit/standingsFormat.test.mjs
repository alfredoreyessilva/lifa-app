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
  imageColumns, cellText, tableMarks, goalAverageLabel, showsGoalAverage,
  tableDetail, splitName,
} from '../../src/utils/standingsFormat.js';
import { geometria } from '../../src/utils/standingsShareCard.js';
import { PINTURA_NEUTRA, pinturaDeZona } from '../../src/utils/teamPaint.js';
import { pinturaDelLogo } from '../../src/utils/useTeamPaint.js';

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

test('el goal average se escribe con tres decimales, y ∞ o — cuando no hay cociente', () => {
  assert.equal(goalAverageLabel(fila({ goal_average: 145 / 14 })), '10.357');
  assert.equal(goalAverageLabel(fila({ goal_average: 1.5 })), '1.500');
  assert.equal(goalAverageLabel(fila({ goal_average: 7 / 68 })), '0.103');
  // El backend lo manda en null con 0 en contra (JSON no lleva infinito).
  assert.equal(goalAverageLabel(fila({ goal_average: null, points_for: 21, points_against: 0 })), '∞');
  assert.equal(goalAverageLabel(fila({ goal_average: null, points_for: 0, points_against: 0 })), '—');
});

test('AVG solo aparece si el reglamento de la tabla usa el goal average', () => {
  const onefa = ['wins', 'h2h_wins', 'goal_average'];
  assert.equal(showsGoalAverage({ tiebreakers: onefa }), true);
  assert.equal(showsGoalAverage({ tiebreakers: ['wins', 'h2h_wins', 'point_diff', 'points_for'] }), false);
  assert.equal(showsGoalAverage({}), false);
  assert.equal(showsGoalAverage(null), false);

  // En la imagen va entre DIF y la racha, como en pantalla.
  const columns = imageColumns({ level: 'group', rows: [fila({ goal_average: 1.5 })], tiebreakers: onefa }, false);
  assert.deepEqual(ids(columns), ['played', 'wins', 'losses', 'pct', 'scope', 'pf', 'pc', 'diff', 'avg', 'streak']);
  assert.equal(columns.find((c) => c.id === 'avg').label, 'AVG');
  assert.equal(cellText('avg', fila({ goal_average: 1.5 })), '1.500');
  const sinAvg = imageColumns({ level: 'group', rows: [fila()], tiebreakers: ['wins', 'point_diff'] }, false);
  assert.ok(!ids(sinAvg).includes('avg'));
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

test('el detalle de la imagen nombra la tabla y la categoría, como la portada de un partido', () => {
  const contexto = 'COLEGIAL UNIVERSITARIO · Varonil';
  assert.equal(
    tableDetail({ level: 'conference', scope_name: 'NACIONAL' }, contexto),
    'Conferencia NACIONAL, COLEGIAL UNIVERSITARIO Varonil',
  );
  assert.equal(
    tableDetail({ level: 'group', scope_name: 'GRUPO A' }, contexto),
    'GRUPO A, COLEGIAL UNIVERSITARIO Varonil',
  );
  // La tabla general no lleva nombre, y una categoría sin rama no lleva separador.
  assert.equal(tableDetail({ level: 'branch', scope_name: null }, 'PROFESIONAL · Varonil'), 'PROFESIONAL Varonil');
  assert.equal(tableDetail({ level: 'branch', scope_name: null }, 'PROFESIONAL'), 'PROFESIONAL');
  assert.equal(tableDetail({ level: 'conference', scope_name: 'NACIONAL' }, null), 'Conferencia NACIONAL');
  assert.equal(tableDetail({ level: 'branch', scope_name: null }, null), '');
});

const FORMATOS = [['post', 1350], ['story', 1920]];

test('la cancha llena la imagen: de una línea de gol a la otra no sobra ni falta un pixel', () => {
  for (const [formato, alto] of FORMATOS) {
    for (let equipos = 0; equipos <= 40; equipos += 1) {
      const g = geometria(formato, alto, equipos);
      assert.equal(g.zonaArriba + g.renglon * g.franjas + g.zonaAbajo, alto, `${formato} con ${equipos}`);
      assert.ok(Number.isInteger(g.renglon), `${formato} con ${equipos}`);
    }
  }
});

test('la cancha es lo principal de la imagen, tenga los equipos que tenga', () => {
  for (const [formato, alto] of FORMATOS) {
    for (let equipos = 1; equipos <= 40; equipos += 1) {
      const g = geometria(formato, alto, equipos);
      assert.ok(g.renglon * g.franjas > alto * 0.55, `${formato} con ${equipos}`);
      // La end zone de arriba lleva el título: nunca se queda con más que la cancha.
      assert.ok(g.zonaArriba < g.renglon * g.franjas, `${formato} con ${equipos}`);
    }
  }
});

test('un renglón más alto va creciendo hasta su tope; lo que sobra es de las end zones', () => {
  // Con 19 equipos, la tabla más larga de hoy, las end zones se quedan en su mínimo.
  const larga = geometria('post', 1350, 19);
  assert.equal(larga.renglon, 54);
  assert.ok(larga.zonaArriba - 220 < 19, 'solo lo que no alcanza para otro pixel de renglón');

  // Con 6 equipos el renglón llega a su tope y las end zones crecen, las dos.
  const corta = geometria('story', 1920, 6);
  assert.equal(corta.renglon, 230);
  assert.ok(corta.zonaArriba > 330 && corta.zonaAbajo > 124);
});

test('el casco y el lugar crecen con el renglón, pero con tope', () => {
  assert.ok(geometria('post', 1350, 19).casco < geometria('post', 1350, 8).casco);
  assert.equal(geometria('story', 1920, 6).casco, 110);
  assert.equal(geometria('post', 1350, 30).casco, 40);
});

test('un nombre largo se parte en dos líneas parejas', () => {
  const mide = (texto) => texto.length;
  assert.deepEqual(splitName('PUMAS FES ACATLÁN UNAM', mide), ['PUMAS FES', 'ACATLÁN UNAM']);
  assert.deepEqual(splitName('POTROS SALVAJES UAEM', mide), ['POTROS', 'SALVAJES UAEM']);
  assert.deepEqual(splitName('LIEBRES ITCJ', mide), ['LIEBRES', 'ITCJ']);
  // Una sola palabra no se puede partir.
  assert.deepEqual(splitName('CAUDILLOS', mide), ['CAUDILLOS']);
});

test('lo que va pegado a la última línea cuenta al partir el nombre', () => {
  const mide = (texto) => texto.length;
  assert.deepEqual(splitName('BÚHOS GUINDA IPN', mide), ['BÚHOS', 'GUINDA IPN']);
  // Con la pill de comodín, la línea de abajo tiene que ser la corta.
  assert.deepEqual(splitName('BÚHOS GUINDA IPN', mide, 10), ['BÚHOS GUINDA', 'IPN']);
  // "LOBOS UADEC" solo se parte de una manera, y ahí no cabe: la pill va sola abajo.
  assert.deepEqual(splitName('LOBOS UADEC', mide, 10), ['LOBOS UADEC', '']);
  assert.deepEqual(splitName('CAUDILLOS', mide, 10), ['CAUDILLOS', '']);
});

test('el color capturado del equipo manda sobre el del logo, también en la imagen', async () => {
  const sinLogo = await pinturaDelLogo(null, '#08b0e7', 50);
  assert.equal(sinLogo.fondo, pinturaDeZona('#08b0e7').fondo);
  assert.equal(sinLogo.forma, 'disco');
});

test('sin logo ni color, el renglón se queda en el verde de la cancha', async () => {
  const pintura = await pinturaDelLogo(null, null, 50);
  assert.equal(pintura.fondo, PINTURA_NEUTRA.fondo);
  assert.equal(pintura.tinta, PINTURA_NEUTRA.tinta);
});
