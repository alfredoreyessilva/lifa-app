// Pruebas de utils/bracketFormat.js: qué va de cada lado del bracket en espejo
// y cómo se escribe cada cruce. Lo comparten la página y la imagen. README, "El
// bracket de los playoffs".

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mirrorColumns, roundShortName, gameStatus, seedOrigin, recordOf, bracketTitle,
  hasTiedSeeds, isSingleTable, publishNote, seedOf, finalLabel, unplacedNote, logoForSide,
} from '../../src/utils/bracketFormat.js';

const p = (seed, extra = {}) => ({ team_id: 100 + seed, seed, name: `EQUIPO ${seed}`, logo_url: null, ...extra });
const juego = (a, b, extra = {}) => ({ top: a, bottom: b, bye: false, match: null, corrected: false, winner_team_id: null, ...extra });

// El bracket de 8 de la Nacional antes de jugarse: así lo manda el backend.
const BRACKET_8 = {
  size: 8,
  title: 'NACIONAL',
  seeds: [1, 2, 3, 4, 5, 6, 7, 8].map((s) => ({
    seed: s, team_id: 100 + s, name: `EQUIPO ${s}`, wins: 9 - s, losses: s - 1, ties: 0,
    qualified_as: s > 6 ? 'wildcard' : 'direct', table_name: ['BAJÍO', 'NORTE', 'CENTRO'][(s - 1) % 3], table_rank: s > 6 ? 3 : Math.ceil(s / 3), tied: false,
  })),
  rounds: [
    { name: 'Cuartos de final', games: [juego(p(1), p(8)), juego(p(4), p(5)), juego(p(2), p(7)), juego(p(3), p(6))] },
    { name: 'Semifinales', games: [juego(null, null), juego(null, null)] },
    { name: 'Final', games: [juego(null, null)] },
  ],
  champion: null,
};

test('en espejo: la mitad del 1 a la izquierda, la del 2 a la derecha', () => {
  const { left, right, final } = mirrorColumns(BRACKET_8);
  assert.deepEqual(left.map((c) => c.round.name), ['Cuartos de final', 'Semifinales']);
  assert.deepEqual(left[0].games.map((g) => [g.top.seed, g.bottom.seed]), [[1, 8], [4, 5]]);
  assert.deepEqual(right[0].games.map((g) => [g.top.seed, g.bottom.seed]), [[2, 7], [3, 6]]);
  assert.equal(left[1].games.length, 1);
  assert.equal(right[1].games.length, 1);
  assert.equal(final.round.name, 'Final');
  assert.equal(final.left, null);
  assert.equal(final.right, null);
});

test('cada finalista se pinta del lado de donde viene, aunque sea el local', () => {
  // El 3 (local por siembra) ganó la semifinal del lado derecho y el 5 la del
  // izquierdo: el 3 va a la derecha.
  const b = {
    ...BRACKET_8,
    rounds: [
      BRACKET_8.rounds[0],
      { name: 'Semifinales', games: [juego(p(5, { from_game: 1 }), p(8, { from_game: 0 })), juego(p(3, { from_game: 3 }), p(7, { from_game: 2 }))] },
      { name: 'Final', games: [juego(p(3, { from_game: 1 }), p(5, { from_game: 0 }))] },
    ],
  };
  const { final } = mirrorColumns(b);
  assert.equal(final.left.seed, 5);
  assert.equal(final.right.seed, 3);

  // Sin saber de dónde viene (un cruce corregido por un partido capturado),
  // el local va a la izquierda.
  const sinOrigen = { ...b, rounds: [...b.rounds.slice(0, 2), { name: 'Final', games: [juego(p(3), p(5))] }] };
  assert.equal(mirrorColumns(sinOrigen).final.left.seed, 3);
});

test('un bracket de dos es solo la final', () => {
  const b = { size: 2, seeds: [], rounds: [{ name: 'Final', games: [juego(p(1), p(2))] }] };
  const { left, right, final } = mirrorColumns(b);
  assert.deepEqual([left.length, right.length], [0, 0]);
  assert.deepEqual([final.left.seed, final.right.seed], [1, 2]);
});

test('del lado derecho va el logo de visitante; sin él, el de siempre', () => {
  const conAmbos = p(2, { logo_url: 'https://x/casa.png', away_logo_url: 'https://x/visita.png' });
  assert.equal(logoForSide(conAmbos, 'right'), 'https://x/visita.png');
  assert.equal(logoForSide(conAmbos, 'left'), 'https://x/casa.png');
  // El campeón y la lista del teléfono no tienen lado.
  assert.equal(logoForSide(conAmbos, null), 'https://x/casa.png');

  // Sin logo de visitante —o con la cadena vacía que deja "Quitar"—, el de siempre.
  assert.equal(logoForSide(p(3, { logo_url: 'https://x/casa.png' }), 'right'), 'https://x/casa.png');
  assert.equal(logoForSide(p(3, { logo_url: 'https://x/casa.png', away_logo_url: '' }), 'right'), 'https://x/casa.png');
  // Sin ninguno, nada: se pintan las iniciales.
  assert.equal(logoForSide(p(4), 'right'), null);
  assert.equal(logoForSide(null, 'right'), null);
});

test('la cabeza de cada columna, como en la imagen de guía', () => {
  assert.equal(roundShortName('Cuartos de final'), 'Cuartos');
  assert.equal(roundShortName('Semifinales'), 'Semifinal');
  assert.equal(roundShortName('Octavos de final'), 'Octavos');
  assert.equal(roundShortName('Final'), 'Final');
  // Una fase con otro nombre se queda con el suyo.
  assert.equal(roundShortName('Tazón de Campeones'), 'Tazón de Campeones');
});

test('en qué va un cruce', () => {
  const ahora = Date.parse('2026-11-08T19:00:00.000Z');
  const partido = (extra) => ({
    id: 1, match_date: '2026-11-09T00:00:00.000Z', timezone: 'America/Mexico_City', status: 'scheduled',
    is_final: false, home_score: null, away_score: null, auto_status_enabled: true, auto_status_window_hours: 3, ...extra,
  });

  assert.equal(gameStatus(juego(null, null)).kind, 'pending');
  assert.equal(gameStatus(juego(p(1), null, { bye: true })).kind, 'bye');
  assert.deepEqual(gameStatus(juego(p(1), p(8))), { kind: 'unscheduled', label: 'vs' });

  // Programado: su fecha en la zona del partido (18:00 del 8 de noviembre en el centro).
  const programado = gameStatus(juego(p(1), p(8), { match: partido() }), ahora);
  assert.equal(programado.kind, 'scheduled');
  assert.match(programado.label, /^8 NOV · 6:00/);

  assert.deepEqual(gameStatus(juego(p(1), p(8), { match: partido({ match_date: null }) }), ahora), { kind: 'scheduled', label: 'Fecha por definir' });
  assert.equal(gameStatus(juego(p(1), p(8), { match: partido({ match_date: '2026-11-08T18:00:00.000Z' }) }), ahora).kind, 'live');
  assert.deepEqual(gameStatus(juego(p(1), p(8), { match: partido({ is_final: true, home_score: 35, away_score: 3 }) }), ahora), { kind: 'final', label: 'Final' });
  // Terminado por el reloj, sin marcador capturado: no se dice "Final".
  assert.deepEqual(gameStatus(juego(p(1), p(8), { match: partido({ match_date: '2026-11-08T10:00:00.000Z' }) }), ahora), { kind: 'scheduled', label: 'Sin marcador' });
});

test('lo que va bajo el campeón nunca es "vs" ni repite "Final"', () => {
  assert.equal(finalLabel({ kind: 'pending' }), 'Final por definir');
  assert.equal(finalLabel({ kind: 'unscheduled', label: 'vs' }), 'Final');
  assert.equal(finalLabel({ kind: 'scheduled', label: '22 NOV · 12:00 p.m.' }), 'Final · 22 NOV · 12:00 p.m.');
  assert.equal(finalLabel({ kind: 'live', label: 'En vivo' }), 'Final · En vivo');
  // Ya jugada: en la página liga a la final; en la imagen solo la nombra.
  assert.equal(finalLabel({ kind: 'final', label: 'Final' }, { link: true }), 'Ver la final');
  assert.equal(finalLabel({ kind: 'final', label: 'Final' }), 'Final');
});

test('de dónde viene cada sembrado', () => {
  const [s1, , , , , , s7] = BRACKET_8.seeds;
  assert.equal(seedOrigin(s1), '1.º de BAJÍO');
  assert.equal(seedOrigin(s7), 'Comodín · 3.º de BAJÍO');
  // Con una sola tabla (14 Grandes) basta el lugar.
  assert.equal(seedOrigin({ table_rank: 4, table_name: '14 GRANDES', qualified_as: 'direct' }, { singleTable: true }), '4.º');
  assert.equal(seedOrigin(null), '');
  assert.equal(recordOf(s1), '8-0');
  assert.equal(recordOf({ wins: 5, losses: 2, ties: 1 }), '5-2-1');
});

test('el nombre del bracket, las marcas y la nota de la vista previa', () => {
  assert.equal(bracketTitle(BRACKET_8), 'Conferencia NACIONAL');
  assert.equal(bracketTitle({ title: null }), '');
  assert.equal(hasTiedSeeds(BRACKET_8), false);
  assert.equal(hasTiedSeeds({ seeds: [{ tied: true }] }), true);
  assert.equal(isSingleTable(BRACKET_8), false);
  assert.equal(isSingleTable({ seeds: [{ table_name: '14 GRANDES' }, { table_name: '14 GRANDES' }] }), true);
  assert.equal(seedOf(BRACKET_8, p(4)).seed, 4);

  assert.equal(unplacedNote([]), '');
  assert.match(unplacedNote([{ id: 734 }]), /^Un partido .* no cabe en ningún cruce \(partido #734\)\. No sale en el bracket/);
  assert.match(unplacedNote([{ id: 1 }, { id: 2 }]), /^2 partidos .* no caben en ningún cruce \(partidos #1, #2\)\. No salen en el bracket/);

  assert.equal(publishNote({ ready: true }), '');
  assert.match(publishNote({ ready: false, regular_pending: 7 }), /faltan 7 partidos de temporada regular/);
  assert.match(publishNote({ ready: false, regular_pending: 1 }), /falta 1 partido de temporada regular/);
});
