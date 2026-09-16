// Pruebas del estado "real" de un partido (utils/matchStatus.js).
//
// Esto decide si el calendario dice "programado", "EN VIVO" o "finalizado".
// Las dos reglas que no se pueden romper:
//   1. Si el organizador ya lo puso a mano, el reloj deja de opinar.
//   2. Si su categoría no activó el modo automático, nunca se activa solo.
// La segunda es la que evita que un partido se marque "EN VIVO" sin que
// nadie lo haya pedido — y marcar EN VIVO algo que no lo está manda a la
// afición a buscar una transmisión que no existe.

import test from 'node:test';
import assert from 'node:assert/strict';

import { getMatchStatus, isMatchPast, isMatchLiveOrPast } from '../../src/utils/matchStatus.js';

const HORA = 3600000;

// Construye un partido con la fecha desplazada respecto a AHORA, para que las
// pruebas no dependan de ninguna fecha fija del calendario.
const partido = (horasDesdeAhora, extra = {}) => ({
  match_date: new Date(Date.now() + horasDesdeAhora * HORA).toISOString(),
  status: 'scheduled',
  ...extra,
});

// ── Regla 1: el estado manual manda ──────────────────────────────────────

test('un estado puesto a mano se respeta aunque el reloj diga otra cosa', () => {
  // "live" en un partido que todavía no empieza: alguien le dio a Iniciar
  // antes de tiempo, y esa decisión gana.
  assert.equal(getMatchStatus(partido(5, { status: 'live' })), 'live');

  // "finished" en un partido de la próxima semana: se respeta igual.
  assert.equal(getMatchStatus(partido(168, { status: 'finished' })), 'finished');
});

test('el estado manual gana incluso con el automático encendido', () => {
  const yaPaso = partido(-10, {
    status: 'live',
    auto_status_enabled: true,
    auto_status_window_hours: 3,
  });
  // El automático lo habría dado por finalizado hace horas; sigue en vivo
  // porque alguien lo puso así y nadie lo ha cerrado.
  assert.equal(getMatchStatus(yaPaso), 'live');
});

// ── Regla 2: sin permiso de la categoría, no hay automático ──────────────

test('sin auto_status_enabled el partido se queda en programado para siempre', () => {
  // Aunque haya pasado un año.
  assert.equal(getMatchStatus(partido(-8760)), 'scheduled');
  assert.equal(getMatchStatus(partido(-1)), 'scheduled');
  assert.equal(getMatchStatus(partido(1)), 'scheduled');
});

test('si la categoría no mandó el dato, se asume apagado', () => {
  // "Nunca se activa solo un cálculo que nadie pidió": si el partido llega
  // sin los campos heredados de su categoría, el resguardo es no calcular.
  assert.equal(getMatchStatus({ match_date: new Date(Date.now() - HORA).toISOString(), status: 'scheduled' }), 'scheduled');
  assert.equal(getMatchStatus(partido(-1, { auto_status_enabled: false })), 'scheduled');
  assert.equal(getMatchStatus(partido(-1, { auto_status_enabled: null })), 'scheduled');
  assert.equal(getMatchStatus(partido(-1, { auto_status_enabled: undefined })), 'scheduled');
});

// ── El cálculo automático, cuando sí está encendido ──────────────────────

const auto = (horas, ventana = 3) => partido(horas, {
  auto_status_enabled: true,
  auto_status_window_hours: ventana,
});

test('automático: antes de la hora es programado', () => {
  assert.equal(getMatchStatus(auto(2)), 'scheduled');
  assert.equal(getMatchStatus(auto(0.5)), 'scheduled');
});

test('automático: dentro de la ventana es en vivo', () => {
  assert.equal(getMatchStatus(auto(-0.5)), 'live');
  assert.equal(getMatchStatus(auto(-2.9)), 'live');
});

test('automático: pasada la ventana es finalizado', () => {
  assert.equal(getMatchStatus(auto(-3.1)), 'finished');
  assert.equal(getMatchStatus(auto(-48)), 'finished');
});

test('automático: la ventana de la categoría se respeta, no se usa siempre 3h', () => {
  // Una liga de tochito con partidos de 1 hora y una con partidos largos no
  // pueden compartir ventana.
  assert.equal(getMatchStatus(auto(-2, 1)), 'finished'); // ventana de 1h, ya cerró
  assert.equal(getMatchStatus(auto(-2, 6)), 'live');     // ventana de 6h, sigue
});

test('automático: sin ventana definida usa 3 horas de resguardo', () => {
  assert.equal(getMatchStatus(auto(-2, undefined)), 'live');     // dentro de las 3h
  assert.equal(getMatchStatus(auto(-4, undefined)), 'finished'); // fuera
  assert.equal(getMatchStatus(auto(-2, 0)), 'live');             // 0 es falsy -> 3h
});

// ── isMatchPast / isMatchLiveOrPast ──────────────────────────────────────

test('isMatchPast solo mira el reloj, no el estado', () => {
  assert.equal(isMatchPast(partido(-1)), true);
  assert.equal(isMatchPast(partido(1)), false);
  // No le importa que el organizador lo haya marcado finalizado antes.
  assert.equal(isMatchPast(partido(1, { status: 'finished' })), false);
});

test('isMatchLiveOrPast incluye el instante exacto del inicio', () => {
  // La diferencia con isMatchPast es justo el ">=": un partido que empieza
  // en este segundo ya cuenta como empezado.
  const ahora = { match_date: new Date(Date.now()).toISOString(), status: 'scheduled' };
  assert.equal(isMatchLiveOrPast(ahora), true);
  assert.equal(isMatchLiveOrPast(partido(1)), false);
});
