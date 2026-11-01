// Pruebas de los partidos con fecha por definir (utils/fechaPorDefinir.js,
// README "Partidos con fecha por definir").
//
// Lo que no se puede romper: una fila del Excel sin fecha entra como partido
// sin fecha (antes se saltaba con un error de Postgres), y una fecha que no se
// entiende entra igual pero CON aviso — perderla en silencio es lo que esta
// suite existe para impedir.

import test from 'node:test';
import assert from 'node:assert/strict';

import { fechaDeFilaDelExcel, diceSinFecha, sigueSinJugarse } from '../../src/utils/fechaPorDefinir.js';

const CDMX = 'America/Mexico_City';
const fila = (fechaRaw, horaRaw = '', celdaFecha = null) =>
  fechaDeFilaDelExcel({ fechaRaw, horaRaw, celdaFecha, timezone: CDMX });

// ── La celda de Fecha ────────────────────────────────────────────────────

test('celda vacía: fecha por definir, sin aviso', () => {
  assert.deepEqual(fila(''), { matchDate: null, aviso: null });
});

test('"por definir" y sus primos: fecha por definir, sin aviso, sin importar mayúsculas, acentos ni puntos', () => {
  for (const texto of ['por definir', 'POR DEFINIR', 'Por Definir.', 'pendiente', 'TBD', 'T.B.D.', 'por confirmar', 'Sin fecha']) {
    assert.deepEqual(fila(texto), { matchDate: null, aviso: null }, texto);
  }
  assert.equal(diceSinFecha('  por   definir '), true);
  assert.equal(diceSinFecha('15/09/2025'), false);
});

test('dd/mm/aaaa y aaaa-mm-dd con hora, en la zona de la fila', () => {
  // 18:00 en la Ciudad de México es medianoche UTC del día siguiente.
  assert.deepEqual(fila('15/09/2025', '18:00'), { matchDate: '2025-09-16T00:00:00.000Z', aviso: null });
  assert.deepEqual(fila('2025-09-15', '18:00'), { matchDate: '2025-09-16T00:00:00.000Z', aviso: null });
  // Sin hora, a las 00:00 locales: como antes de este cambio.
  assert.deepEqual(fila('15.09.2025'), { matchDate: '2025-09-15T06:00:00.000Z', aviso: null });
});

test('una celda que Excel guardó como fecha se lee por sus componentes', () => {
  // Construida con componentes locales: la prueba no depende de la zona de la máquina.
  const celda = new Date(2025, 8, 15);
  assert.deepEqual(fila(String(celda), '18:00', celda), { matchDate: '2025-09-16T00:00:00.000Z', aviso: null });
});

test('un texto que no es fecha: se importa sin fecha, y el aviso dice cuál', () => {
  const { matchDate, aviso } = fila('sábado 15');
  assert.equal(matchDate, null);
  assert.match(aviso, /"sábado 15" no se entendió/);
  assert.match(aviso, /fecha por definir/);
});

test('una fecha que no existe ya no se corre al mes siguiente: se avisa', () => {
  const { matchDate, aviso } = fila('31/02/2026', '18:00');
  assert.equal(matchDate, null, 'antes se guardaba como 3 de marzo');
  assert.match(aviso, /"31\/02\/2026" no existe/);
});

test('una hora sin fecha se descarta, con aviso; "por definir" en la hora no avisa', () => {
  const { matchDate, aviso } = fila('por definir', '18:00');
  assert.equal(matchDate, null);
  assert.match(aviso, /no se guarda la hora "18:00"/);
  assert.deepEqual(fila('', 'por definir'), { matchDate: null, aviso: null });
});

// ── ¿Todavía no se juega? ────────────────────────────────────────────────

test('con fecha lo dice la fecha; sin fecha, lo dice el estado', () => {
  const ahora = Date.parse('2026-11-01T12:00:00.000Z');
  assert.equal(sigueSinJugarse({ match_date: '2026-11-02T00:00:00.000Z', status: 'scheduled' }, ahora), true);
  assert.equal(sigueSinJugarse({ match_date: '2026-10-31T00:00:00.000Z', status: 'scheduled' }, ahora), false);

  assert.equal(sigueSinJugarse({ match_date: null, status: 'scheduled' }, ahora), true, 'sin fecha y programado: pendiente');
  assert.equal(sigueSinJugarse({ match_date: null, status: 'live' }, ahora), false);
  assert.equal(sigueSinJugarse({ match_date: null, status: 'finished' }, ahora), false);
  assert.equal(sigueSinJugarse(null, ahora), false);
});
