// Pruebas de la cola de captura sin señal (utils/offlineQueue.js).
//
// Lo que se fija aquí es lo que convierte esta cola en una pérdida de datos si
// se rompe, y son cuatro cosas:
//
//   1. Dos capturas del mismo pase de lista se FUSIONAN y gana la última. Si se
//      acumularan, subir la cola en orden dejaría el estado viejo encima.
//   2. Nada se descarta nunca. Ni por fallar, ni por rendirse: lo que deja de
//      reintentarse se queda visible para que alguien decida.
//   3. El reintento espera. Sin backoff, una cancha sin señal quema la batería
//      del visor en la primera media hora.
//   4. "Lleva pendiente desde" no se reinicia al recapturar: es lo que le dice
//      a la persona que algo vive solo en su teléfono.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_INTENTOS,
  clavePendiente,
  encolar,
  quitarDeCola,
  marcarFallo,
  pendientesListos,
  esperaDeIntento,
  resumenDeCola,
  textoDeCola,
} from '../../src/utils/offlineQueue.js';

const pase = (matchId, teamId, entries) => ({ kind: 'attendance', matchId, teamId, entries });

// ── 1. Lo mismo se fusiona, y gana la última captura ──────────────────────

test('dos pases de lista del mismo equipo en el mismo partido son UNO', () => {
  let cola = encolar([], pase(603, 21, [{ player_id: 7, status: 'present' }]), 1000);
  cola = encolar(cola, pase(603, 21, [{ player_id: 7, status: 'absent' }]), 2000);

  assert.equal(cola.length, 1, 'se acumularon dos: subirlas en orden dejaría el estado viejo encima');
  assert.deepEqual(cola[0].entries, [{ player_id: 7, status: 'absent' }], 'no ganó la última');
});

test('el otro equipo del mismo partido es OTRA captura', () => {
  let cola = encolar([], pase(603, 21, []), 1000);
  cola = encolar(cola, pase(603, 17, []), 2000);
  assert.equal(cola.length, 2);
});

test('el mismo equipo en otro partido es OTRA captura', () => {
  let cola = encolar([], pase(603, 21, []), 1000);
  cola = encolar(cola, pase(619, 21, []), 2000);
  assert.equal(cola.length, 2);
});

test('un tipo que este código no conoce no se fusiona con nada', () => {
  // Falla del lado de no perder datos: si mañana entran las jugadas y alguien
  // olvida darles llave, se encolan de a una en vez de pisarse entre ellas.
  let cola = encolar([], { kind: 'jugada', id: 'a' }, 1000);
  cola = encolar(cola, { kind: 'jugada', id: 'b' }, 2000);
  assert.equal(cola.length, 2);
});

test('sin tipo no se encola nada', () => {
  assert.deepEqual(encolar([], {}, 1000), []);
  assert.deepEqual(encolar([], null, 1000), []);
});

test('la llave distingue partido y equipo, y nada más', () => {
  assert.equal(clavePendiente(pase(603, 21, [])), 'attendance:603:21');
  assert.notEqual(clavePendiente(pase(603, 21, [])), clavePendiente(pase(603, 17, [])));
});

// ── 2. Nada se descarta ───────────────────────────────────────────────────

test('un fallo NO saca nada de la cola', () => {
  let cola = encolar([], pase(603, 21, []), 1000);
  cola = marcarFallo(cola, cola[0].id, 'sin internet', 2000);
  assert.equal(cola.length, 1);
  assert.equal(cola[0].intentos, 1);
  assert.equal(cola[0].ultimoError, 'sin internet');
});

test('lo que se rindió sigue en la cola, solo deja de reintentarse solo', () => {
  let cola = encolar([], pase(603, 21, []), 0);
  for (let i = 0; i < MAX_INTENTOS; i++) {
    cola = marcarFallo(cola, cola[0].id, 'sin internet', i * 1_000_000);
  }
  assert.equal(cola.length, 1, 'se descartó una captura');
  assert.equal(pendientesListos(cola, 9_000_000).length, 0, 'sigue insistiendo para siempre');
  assert.equal(resumenDeCola(cola).atorados, 1);
});

test('solo se sale de la cola cuando sube', () => {
  const cola = encolar([], pase(603, 21, []), 1000);
  assert.deepEqual(quitarDeCola(cola, cola[0].id), []);
});

test('recapturar después de fallar reinicia los intentos', () => {
  // El motivo por el que fallaba puede ya no aplicar: es otra captura.
  let cola = encolar([], pase(603, 21, []), 1000);
  cola = marcarFallo(cola, cola[0].id, 'sin internet', 2000);
  cola = encolar(cola, pase(603, 21, [{ player_id: 1, status: 'present' }]), 3000);
  assert.equal(cola[0].intentos, 0);
  assert.equal(cola[0].ultimoError, null);
});

// ── 3. El reintento espera ────────────────────────────────────────────────

test('la espera crece con cada fallo y se queda en cinco minutos', () => {
  assert.equal(esperaDeIntento(1), 5000, 'el primer reintento es a los 5 segundos');
  assert.ok(esperaDeIntento(2) > esperaDeIntento(1));
  assert.equal(esperaDeIntento(99), 300000, 'el tope no puede crecer sin límite');
});

test('lo recién capturado se intenta de inmediato', () => {
  const cola = encolar([], pase(603, 21, []), 1000);
  assert.equal(pendientesListos(cola, 1000).length, 1);
});

test('lo que acaba de fallar no se reintenta en el mismo segundo', () => {
  let cola = encolar([], pase(603, 21, []), 1000);
  cola = marcarFallo(cola, cola[0].id, 'sin internet', 2000);
  assert.equal(pendientesListos(cola, 3000).length, 0, 'reintentó antes de su espera');
  assert.equal(pendientesListos(cola, 2000 + esperaDeIntento(1)).length, 1);
});

// ── 4. Desde cuándo vive solo en este teléfono ────────────────────────────

test('recapturar no reinicia "lleva pendiente desde"', () => {
  let cola = encolar([], pase(603, 21, []), 1000);
  cola = encolar(cola, pase(603, 21, [{ player_id: 1, status: 'present' }]), 9000);
  assert.equal(cola[0].capturadoEn, 1000, 'el aviso mentiría sobre cuánto lleva sin subir');
  assert.equal(cola[0].actualizadoEn, 9000);
});

test('el resumen distingue lo que sigue intentándose de lo que se rindió', () => {
  let cola = encolar([], pase(603, 21, []), 1000);
  cola = encolar(cola, pase(603, 17, []), 2000);
  for (let i = 0; i < MAX_INTENTOS; i++) {
    cola = marcarFallo(cola, cola[1].id, 'error', i * 1_000_000);
  }
  assert.deepEqual(resumenDeCola(cola, 9_000_000), {
    total: 2, atorados: 1, reintentando: 1, desde: 1000,
  });
});

test('una cola vacía no enseña contador', () => {
  assert.equal(textoDeCola([]), null);
  assert.equal(textoDeCola(undefined), null);
  assert.deepEqual(resumenDeCola([]), { total: 0, atorados: 0, reintentando: 0, desde: null });
});

test('el contador se lee en español y en singular cuando toca', () => {
  const una = encolar([], pase(603, 21, []), 1000);
  assert.equal(textoDeCola(una), '1 captura sin subir');

  const dos = encolar(una, pase(603, 17, []), 1000);
  assert.equal(textoDeCola(dos), '2 capturas sin subir');

  let atorada = una;
  for (let i = 0; i < MAX_INTENTOS; i++) {
    atorada = marcarFallo(atorada, atorada[0].id, 'error', i * 1_000_000);
  }
  assert.equal(textoDeCola(atorada), '1 captura sin subir — 1 no ha podido subir');
});
