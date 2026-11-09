// Pruebas de lo que calcula Mi panel (utils/dashboard.js). Las listas tienen la
// forma de lo que contesta GET /auth/me, y los partidos la de GET /board: con
// `followed_directly`, `followed_team`, `predicted` y `myPick`.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOARD_FIRST, BOARD_STEP, accuracyFigure, boardReasons, firstName, organizationsOf, organizationsSummary,
  pendingFigure, splitBoard, upcomingFigure, votedFor,
} from '../../src/utils/dashboard.js';
import { fechaCorta } from '../../src/utils/matchDisplay.js';

const AHORA = Date.parse('2026-11-08T20:00:00Z');
const hace = (horas) => new Date(AHORA - horas * 3600 * 1000).toISOString();
const en = (horas) => new Date(AHORA + horas * 3600 * 1000).toISOString();

const partido = (id, extra = {}) => ({
  id, home_team: `Local ${id}`, away_team: `Visita ${id}`, status: 'scheduled', home_score: null,
  away_score: null, match_date: en(24), timezone: 'America/Mexico_City', auto_status_enabled: false,
  followed_directly: false, followed_team: null, predicted: false, myPick: null, ...extra,
});

test('el saludo usa el primer nombre, y sin nombre no saluda', () => {
  assert.equal(firstName('Alfredo Reyes Silva'), 'Alfredo');
  assert.equal(firstName('  Yayo  '), 'Yayo');
  assert.equal(firstName('   '), null);
  assert.equal(firstName(null), null);
});

test('las organizaciones van ligas, equipos y lo demás, por abecedario dentro de cada grupo', () => {
  const lista = organizationsOf({
    leagues: [
      { id: 2, name: 'ONEFA', logo_url: 'onefa.png', my_role_label: 'Dueño' },
      { id: 1, name: 'Liga de Futbol Americano Profesional', my_role_label: 'Editor de partidos (Visor)' },
    ],
    teams: [
      { id: 5, name: 'Zorros', league_id: null, my_role_label: 'Coach' },
      { id: 3, name: 'Águilas Blancas', league_id: 2, league_name: 'ONEFA', my_role_label: 'Dueño' },
      { id: 4, name: 'Borregos', league_id: 2, league_name: 'ONEFA' },
    ],
    organizations: [
      // Ligas y equipos ya vienen en su lista, con el id de su ruta.
      { id: 40, type: 'league', name: 'ONEFA' },
      { id: 41, type: 'team', name: 'Zorros' },
      { id: 9, type: 'media', name: 'Zona Roja', my_role_label: 'Dueño' },
      { id: 8, type: 'store', name: 'Al Campo' },
    ],
  });

  assert.deepEqual(lista.map((o) => o.name), [
    'Liga de Futbol Americano Profesional', 'ONEFA', 'Águilas Blancas', 'Borregos', 'Zorros', 'Al Campo', 'Zona Roja',
  ]);
  assert.deepEqual(lista.map((o) => o.href), [
    '/panel/liga/1/estructura', '/panel/liga/2/estructura', '/panel/equipo/3', '/panel/equipo/4', '/panel/equipo/5',
    // Desde el 2026-11-08 un medio también tiene su panel (README, "El panel de un medio").
    '/panel/tienda/8', '/panel/medio/9',
  ]);
  assert.deepEqual(lista.map((o) => o.what), [
    'Liga', 'Liga', 'Equipo · ONEFA', 'Equipo · ONEFA', 'Equipo independiente', 'Tienda / proveedor', 'Medio de comunicación',
  ]);
  assert.deepEqual(lista.map((o) => o.role), [
    'Editor de partidos (Visor)', 'Dueño', 'Dueño', null, 'Coach', null, 'Dueño',
  ]);
  assert.equal(lista[1].logo, 'onefa.png');
  assert.equal(lista[0].logo, null);
  assert.equal(new Set(lista.map((o) => o.key)).size, lista.length);
});

test('sin nada que administrar no hay fichas', () => {
  assert.deepEqual(organizationsOf({ leagues: [], teams: [], organizations: [] }), []);
  assert.deepEqual(organizationsOf(), []);
});

test('un equipo con liga pero sin su nombre no se presenta como independiente', () => {
  const [equipo] = organizationsOf({ teams: [{ id: 1, name: 'Osos', league_id: 7, league_name: null }] });
  assert.equal(equipo.what, 'Equipo');
});

test('el resumen cuenta cada cosa por lo que es', () => {
  const lista = organizationsOf({
    leagues: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
    teams: [{ id: 3, name: 'C', league_id: null }],
    organizations: [
      { id: 8, type: 'store', name: 'Al Campo' },
      { id: 9, type: 'media', name: 'Zona Roja' },
      { id: 10, type: 'nuevo-tipo', name: 'X' },
    ],
  });
  // En el orden de las fichas: "X" va antes que "Zona Roja". Entre la cifra y la
  // palabra va un espacio duro, para que una celda angosta no parta "1 / tienda".
  const duro = (texto) => texto.replace(/(\d) /g, '$1 ');
  assert.equal(organizationsSummary(lista), duro('2 ligas · 1 equipo · 1 tienda · 1 otra · 1 medio'));
  assert.equal(organizationsSummary(lista.slice(0, 1)), duro('1 liga'));
  assert.equal(organizationsSummary([]), '');
  assert.equal(organizationsSummary(lista).split(' ').length, 5 + 4);
});

test('la cartelera se parte en próximos y pasados, con los de fecha por definir al final', () => {
  const { upcoming, past } = splitBoard([
    partido(1, { match_date: en(48) }),
    partido(2, { match_date: null }),
    partido(3, { status: 'live', match_date: hace(1) }),
    partido(4, { match_date: en(2) }),
    partido(5, { status: 'finished', match_date: hace(200) }),
    partido(6, { status: 'finished', match_date: null }),
    partido(7, { status: 'finished', match_date: hace(20) }),
    // Con estado automático y la ventana vencida, ya se jugó aunque diga programado.
    partido(8, { auto_status_enabled: true, auto_status_window_hours: 3, match_date: hace(5) }),
  ], AHORA);

  assert.deepEqual(upcoming.map((m) => m.id), [3, 4, 1, 2]);
  assert.deepEqual(past.map((m) => m.id), [8, 7, 5, 6]);
  assert.deepEqual(splitBoard(null, AHORA), { upcoming: [], past: [] });
});

test('en próximos, lo que ya debió terminar sin que nadie lo cerrara va al final', () => {
  const { upcoming, past } = splitBoard([
    partido(1, { match_date: en(30) }),
    // Sin estado automático y del jueves: sigue programado, pero ya no es lo que sigue.
    partido(2, { match_date: hace(72) }),
    partido(3, { status: 'live', match_date: hace(1) }),
    partido(4, { match_date: null }),
    // Empezó hace una hora y nadie le dio "Iniciar": todavía es lo que sigue.
    partido(5, { match_date: hace(1) }),
    // Con marcador pero sin cerrar: tampoco se anuncia como próximo.
    partido(6, { match_date: hace(48), home_score: 7, away_score: 3 }),
  ], AHORA);
  assert.deepEqual(upcoming.map((m) => m.id), [3, 5, 1, 4, 6, 2]);
  assert.deepEqual(past, []);
});

test('"Por jugar" dice lo que está en vivo antes que lo que sigue', () => {
  const vivo = upcomingFigure([partido(1, { status: 'live', match_date: hace(1) }), partido(2)], AHORA);
  assert.deepEqual(vivo, { value: '2', sub: '1 en vivo' });

  const sabado = '2026-11-14T20:00:00Z';
  const proximo = upcomingFigure([partido(1, { match_date: sabado }), partido(2, { match_date: null })], AHORA);
  assert.equal(proximo.value, '2');
  assert.equal(proximo.sub, `Sigue el ${fechaCorta(sabado, 'America/Mexico_City')}`);
  assert.match(proximo.sub, /14 nov/);
});

test('un partido programado con la hora ya pasada no se anuncia como lo que sigue', () => {
  // Categoría sin estado automático: nadie lo cerró y se queda programado.
  const viejo = partido(1, { match_date: hace(72) });
  assert.deepEqual(upcomingFigure([viejo], AHORA), { value: '1', sub: null });
  assert.deepEqual(upcomingFigure([], AHORA), { value: '0', sub: null });
});

test('los aciertos dicen por qué una celda está vacía', () => {
  assert.deepEqual(accuracyFigure(null), { value: null, sub: null, loading: true });
  assert.deepEqual(accuracyFigure(false), { value: '—', sub: 'No se pudo cargar' });
  assert.deepEqual(
    accuracyFigure({ total: 0, graded: 0, correct: 0, pending: 0, accuracyPct: null }),
    { value: '—', sub: 'Todavía no votas' },
  );
  assert.deepEqual(
    accuracyFigure({ total: 3, graded: 0, correct: 0, pending: 3, accuracyPct: null }),
    { value: '—', sub: 'Ningún voto calificado todavía' },
  );
  assert.deepEqual(
    accuracyFigure({ total: 132, graded: 129, correct: 99, pending: 3, accuracyPct: 77 }),
    { value: '77%', sub: '99 de 129 calificados' },
  );
  assert.equal(accuracyFigure({ total: 1, graded: 1, correct: 1, pending: 0, accuracyPct: 100 }).sub, '1 de 1 calificado');
  assert.equal(accuracyFigure({ total: 1400, graded: 1200, correct: 1000, pending: 200, accuracyPct: 83 }).sub,
    '1,000 de 1,200 calificados');
});

test('"Por calificar" es lo que falta, y espera igual que los aciertos', () => {
  assert.deepEqual(pendingFigure(null), { value: null, loading: true });
  assert.deepEqual(pendingFigure(false), { value: '—' });
  assert.deepEqual(pendingFigure({ total: 132, graded: 129, pending: 3 }), { value: '3' });
});

test('el voto se dice con el nombre del equipo', () => {
  const m = partido(1, { home_team: 'Borregos', away_team: 'Pumas' });
  assert.equal(votedFor({ ...m, myPick: 'home' }), 'Votaste por Borregos');
  assert.equal(votedFor({ ...m, myPick: 'away' }), 'Votaste por Pumas');
  assert.equal(votedFor({ ...m, myPick: 'tie' }), 'Votaste por el empate');
  assert.equal(votedFor({ ...m, myPick: null }), null);
});

test('por qué está un partido en tu cartelera', () => {
  const jugado = { status: 'finished', match_date: hace(30), home_team: 'Borregos', away_team: 'Pumas' };

  assert.deepEqual(
    boardReasons(partido(1, { ...jugado, followed_directly: true, predicted: true, myPick: 'away' }), AHORA)
      .map((r) => r.text),
    ['Lo sigues', 'Votaste por Pumas'],
  );
  assert.equal(boardReasons(partido(1, { followed_directly: true }), AHORA)[0].unfollow, true);

  // Por su equipo: se deja desde la página del equipo, no desde aquí.
  const porEquipo = boardReasons(partido(2, { ...jugado, followed_team: 'BORREGOS' }), AHORA);
  assert.deepEqual(porEquipo, [{ key: 'equipo', text: 'Sigues a BORREGOS' }]);

  // Uno por jugar no repite el voto: lo dice el "¿Quién gana?" de la tarjeta.
  assert.deepEqual(boardReasons(partido(3, { predicted: true, myPick: 'home' }), AHORA), []);
  assert.deepEqual(
    boardReasons(partido(4, { status: 'live', match_date: hace(1), predicted: true, myPick: 'tie' }), AHORA)
      .map((r) => r.text),
    ['Votaste por el empate'],
  );
});

test('las listas se cortan en múltiplos de una, dos y tres columnas', () => {
  for (const columnas of [1, 2, 3]) {
    assert.equal(BOARD_FIRST % columnas, 0);
    assert.equal(BOARD_STEP % columnas, 0);
  }
});
