// Pruebas del lado del navegador de las estadísticas por jugada
// (`src/utils/plays.js`).
//
// Este archivo existe sobre todo por UNA prueba: la del final, que cruza la
// derivación del down con la del backend. Las dos copias existen porque el
// visor captura sin señal y la pantalla tiene que poder decir "2 y 6" en una
// cancha sin internet, donde no hay a quién preguntarle. No hay forma de
// compartir un módulo entre los dos paquetes, así que en vez de fingir que sí
// se cruzan aquí — es el mismo trato que tienen las zonas horarias en
// `matchDisplay.test.mjs`.
//
// Si alguien toca una y no la otra, esto falla. Sin esto, la pantalla diría un
// down y el box score guardaría otro, y nadie se enteraría hasta que una liga
// reclamara una serie mal contada.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NIVELES_DE_CAPTURA, NIVELES,
  TIPOS_DE_JUGADA, TIPOS,
  ROLES_DE_PARTICIPANTE, ROLES,
  PAPELES_POR_TIPO,
  faltaParaGuardar,
  derivarDowns,
  derivarDownsDelPartido,
  siguienteDown,
  textoDeDown,
  nuevaLlaveDeJugada,
} from '../../src/utils/plays.js';

// Cruce con el backend. Es a propósito: ver el comentario de arriba.
import * as back from '../../../backend/src/utils/plays.js';

// ── El vocabulario, completo y en español ─────────────────────────────────

test('todo tipo de jugada que el backend acepta tiene nombre en español', () => {
  // Al revés que con las zonas: aquí un tipo sin etiqueta sí se nota, porque
  // la pantalla pinta el botón vacío. Pero se fija igual, porque el que se
  // agrega es siempre el que nadie prueba.
  for (const tipo of back.TIPOS_DE_JUGADA) {
    assert.ok(TIPOS[tipo], `el tipo "${tipo}" no tiene nombre en el frontend`);
  }
});

test('todo papel que el backend acepta tiene nombre en español', () => {
  for (const rol of back.ROLES_DE_PARTICIPANTE) {
    assert.ok(ROLES[rol], `el papel "${rol}" no tiene nombre en el frontend`);
  }
});

test('y no sobra ninguno del lado del navegador', () => {
  // Lo contrario: un tipo que se quitó del backend y quedó como botón muerto,
  // o un typo en la llave.
  for (const tipo of Object.keys(TIPOS)) {
    assert.ok(back.TIPOS_DE_JUGADA.includes(tipo), `"${tipo}" no existe en el backend`);
  }
  for (const rol of Object.keys(ROLES)) {
    assert.ok(back.ROLES_DE_PARTICIPANTE.includes(rol), `"${rol}" no existe en el backend`);
  }
  for (const nivel of Object.keys(NIVELES)) {
    assert.ok(back.NIVELES_DE_CAPTURA.includes(nivel), `"${nivel}" no existe en el backend`);
  }
});

test('las tres listas son exactamente las mismas, en el mismo orden', () => {
  assert.deepEqual(TIPOS_DE_JUGADA, back.TIPOS_DE_JUGADA);
  assert.deepEqual(ROLES_DE_PARTICIPANTE, back.ROLES_DE_PARTICIPANTE);
  assert.deepEqual(NIVELES_DE_CAPTURA, back.NIVELES_DE_CAPTURA);
});

test('cada tipo de jugada sabe qué papeles preguntar', () => {
  for (const tipo of TIPOS_DE_JUGADA) {
    assert.ok(Array.isArray(PAPELES_POR_TIPO[tipo]), `"${tipo}" no dice qué papeles pide`);
    for (const rol of PAPELES_POR_TIPO[tipo]) {
      assert.ok(ROLES[rol], `"${tipo}" pide un papel que no existe: ${rol}`);
    }
  }
});

// ── Lo que falta para guardar ─────────────────────────────────────────────

test('el botón dice QUÉ falta, no solo que algo falta', () => {
  assert.match(faltaParaGuardar({}), /qué pasó/);
  assert.match(faltaParaGuardar({ play_type: 'rush', participants: [] }), /quién llevó el balón/);
  assert.match(
    faltaParaGuardar({ play_type: 'rush', participants: [{ player_id: 1, role: 'rusher' }] }),
    /yardas/,
  );
  assert.equal(
    faltaParaGuardar({ play_type: 'rush', participants: [{ player_id: 1, role: 'rusher' }], yards_gained: 4 }),
    null,
  );
});

test('cero yardas alcanza para guardar: es un valor, no un hueco', () => {
  // El pase incompleto es el caso, y es la mitad de los pases de un partido.
  assert.equal(
    faltaParaGuardar({ play_type: 'pass', participants: [{ player_id: 1, role: 'passer' }], yards_gained: 0 }),
    null,
  );
});

test('una anotación tiene que decir de quién fue', () => {
  const base = { play_type: 'rush', participants: [{ player_id: 1, role: 'rusher' }], yards_gained: 3 };
  assert.match(faltaParaGuardar({ ...base, points: 6 }), /qué equipo anotó/);
  assert.equal(faltaParaGuardar({ ...base, points: 6, scoring_team_id: 10 }), null);
});

test('un castigo no necesita a nadie: nadie tocó el balón', () => {
  assert.equal(faltaParaGuardar({ play_type: 'penalty', participants: [], yards_gained: -5 }), null);
});

// ── Lo que la pantalla enseña arriba ──────────────────────────────────────

test('siguienteDown dice dónde va a estar la jugada que se está capturando', () => {
  const serie = [
    { client_play_id: 'a', sequence: 1, play_type: 'rush', yards_gained: 4, yard_line: 75, down: null, distance: null },
  ];
  assert.deepEqual(
    [siguienteDown(serie).down, siguienteDown(serie).distance],
    [2, 6],
    'ganó 4 desde 1 y 10 → la siguiente es 2 y 6',
  );

  // Una serie vacía todavía no sabe nada, y lo dice en vez de inventar un 1 y 10
  // que puede ser mentira.
  assert.equal(siguienteDown([]).down, null);
});

test('el down se lee en español, y "1 y gol" sale solo', () => {
  assert.equal(textoDeDown({ down: 2, distance: 6, yard_line: 40 }), '2º y 6');
  assert.equal(textoDeDown({ down: 1, distance: 6, yard_line: 6 }), '1º y gol');
  assert.equal(textoDeDown({ down: 1, distance: 10, yard_line: 8 }), '1º y gol');
});

test('no saber el down todavía y haberlo perdido se dicen distinto', () => {
  // Una serie recién abierta no sabe nada porque nadie ha capturado nada, y
  // eso es normal. Decirle "algo no se capturó" al visor que acaba de abrir la
  // pantalla es una falsa alarma en el peor momento — salió viéndolo en el
  // navegador, con la serie vacía gritando en amarillo.
  assert.equal(textoDeDown({ down: null }), 'Empieza la serie');
  assert.equal(textoDeDown(), 'Empieza la serie');
  // Perder la cadena a media serie sí es un aviso: pide que alguien corrija.
  assert.match(textoDeDown({ down: 3, cadena_rota: true }), /desconocido/);
  assert.match(textoDeDown({ down: null, cadena_rota: true }), /desconocido/);
});

test('la llave de una jugada nace en el teléfono y no se repite', () => {
  const llaves = new Set(Array.from({ length: 200 }, () => nuevaLlaveDeJugada()));
  assert.equal(llaves.size, 200);
});

// ── LA PRUEBA DE CRUCE ────────────────────────────────────────────────────

test('la derivación del down del navegador y la del backend dan lo MISMO', () => {
  // Las series de abajo son los cinco casos que separan una implementación de
  // la otra: el reinicio en primero y diez, el primero y gol, el quinto down
  // que no existe, la corrección que rearranca la cadena, y el castigo que
  // mueve el balón sin consumir down.
  const series = [
    [
      { client_play_id: 'a', sequence: 1, drive_number: 1, play_type: 'rush', yards_gained: 4, yard_line: 75, down: null, distance: null },
      { client_play_id: 'b', sequence: 2, drive_number: 1, play_type: 'pass', yards_gained: 6, down: null, distance: null },
      { client_play_id: 'c', sequence: 3, drive_number: 1, play_type: 'rush', yards_gained: 1, down: null, distance: null },
    ],
    [
      { client_play_id: 'd', sequence: 1, drive_number: 2, play_type: 'rush', yards_gained: 0, yard_line: 6, down: null, distance: null },
      { client_play_id: 'e', sequence: 2, drive_number: 2, play_type: 'pass', yards_gained: 6, points: 6, down: null, distance: null },
      { client_play_id: 'f', sequence: 3, drive_number: 2, play_type: 'extra_point', yards_gained: 0, points: 1, down: null, distance: null },
    ],
    [
      { client_play_id: 'g', sequence: 1, drive_number: 3, play_type: 'rush', yards_gained: 1, yard_line: 50, down: null, distance: null },
      { client_play_id: 'h', sequence: 2, drive_number: 3, play_type: 'rush', yards_gained: 1, down: null, distance: null },
      { client_play_id: 'i', sequence: 3, drive_number: 3, play_type: 'rush', yards_gained: 1, down: null, distance: null },
      { client_play_id: 'j', sequence: 4, drive_number: 3, play_type: 'rush', yards_gained: 1, down: null, distance: null },
      { client_play_id: 'k', sequence: 5, drive_number: 3, play_type: 'rush', yards_gained: 1, down: null, distance: null },
    ],
    [
      { client_play_id: 'l', sequence: 1, drive_number: 4, play_type: 'rush', yards_gained: 2, yard_line: 40, down: null, distance: null },
      { client_play_id: 'm', sequence: 2, drive_number: 4, play_type: 'rush', yards_gained: 2, down: 1, distance: 10 },
      { client_play_id: 'n', sequence: 3, drive_number: 4, play_type: 'penalty', yards_gained: -5, down: null, distance: null },
      { client_play_id: 'o', sequence: 4, drive_number: 4, play_type: 'rush', yards_gained: 3, down: null, distance: null },
    ],
  ];

  for (const serie of series) {
    assert.deepEqual(
      derivarDowns(serie),
      back.derivarDowns(serie),
      `la serie ${serie[0].client_play_id} se deriva distinto en los dos lados`,
    );
  }

  // Y el partido completo, desordenado, que es como llega de una captura sin
  // señal: todas las jugadas con el mismo `created_at`.
  const revuelto = series.flat().reverse();
  assert.deepEqual(
    [...derivarDownsDelPartido(revuelto).entries()].sort(),
    [...back.derivarDownsDelPartido(revuelto).entries()].sort(),
  );
});
