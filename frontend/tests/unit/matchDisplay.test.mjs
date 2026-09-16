// Pruebas de cómo se presenta un partido (utils/matchDisplay.js): la fecha
// que se ve en el calendario, las iniciales del escudo y el texto que se
// copia al compartir.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MESES,
  DEFAULT_TZ,
  TZ_LABELS,
  getMatchParts,
  initials,
  buildMatchShareText,
} from '../../src/utils/matchDisplay.js';

// Cruce con el backend: este archivo es el único del frontend que importa
// código del backend, y es a propósito (ver la prueba del final).
import { AMERICA_TIMEZONES } from '../../../backend/src/utils/timezones.js';

// ── El contrato entre las dos puntas ─────────────────────────────────────

test('toda zona que el backend acepta tiene etiqueta en el frontend', () => {
  // Este es el bug que la prueba existe para atrapar: las dos listas viven
  // en archivos distintos, en carpetas distintas, mantenidas a mano. Agregar
  // una zona al backend sin agregar su etiqueta no truena nada — getMatchParts
  // cae a `|| zone` y el calendario le muestra a la afición "America/Bogota"
  // en crudo donde debería decir "Hora Colombia".
  const sinEtiqueta = AMERICA_TIMEZONES.filter((tz) => !TZ_LABELS[tz]);
  assert.deepEqual(sinEtiqueta, [], `zonas sin etiqueta: ${sinEtiqueta.join(', ')}`);
});

test('toda etiqueta del frontend corresponde a una zona que el backend acepta', () => {
  // La dirección contraria: una etiqueta sobrante es una zona que se quitó
  // del backend y quedó código muerto, o un typo en la llave.
  const sinZona = Object.keys(TZ_LABELS).filter((tz) => !AMERICA_TIMEZONES.includes(tz));
  assert.deepEqual(sinZona, [], `etiquetas huérfanas: ${sinZona.join(', ')}`);
});

test('la zona por defecto es una zona real y con etiqueta', () => {
  assert.ok(AMERICA_TIMEZONES.includes(DEFAULT_TZ));
  assert.ok(TZ_LABELS[DEFAULT_TZ]);
});

test('MESES tiene los doce meses', () => {
  assert.equal(MESES.length, 12);
  assert.equal(MESES[0], 'ENE');
  assert.equal(MESES[8], 'SEP');
  assert.equal(MESES[11], 'DIC');
});

// ── getMatchParts ────────────────────────────────────────────────────────

test('getMatchParts descompone el instante UTC en la hora local de la sede', () => {
  // El mismo partido guardado en UTC: 01:00Z del 17 de septiembre.
  const parts = getMatchParts('2026-09-17T01:00:00.000Z', 'America/Mexico_City');
  assert.equal(parts.day, '16');           // el 16 en CDMX, no el 17
  assert.equal(parts.month, 'SEP');
  assert.equal(parts.tzLabel, 'Hora Centro MX');
  assert.match(parts.time, /7[:.]00/);     // 7 de la tarde
});

test('getMatchParts muestra el MISMO instante distinto según la zona', () => {
  // Un partido en Tijuana y uno en CDMX al mismo instante real se anuncian a
  // horas distintas, y esa es justo la razón de que cada sede traiga su zona.
  const iso = '2026-09-17T01:00:00.000Z';
  const cdmx    = getMatchParts(iso, 'America/Mexico_City');
  const tijuana = getMatchParts(iso, 'America/Tijuana');

  assert.equal(cdmx.day, '16');
  assert.equal(tijuana.day, '16');
  assert.notEqual(cdmx.time, tijuana.time);
  assert.equal(tijuana.tzLabel, 'Hora Pacífico MX');
});

test('getMatchParts cae a la zona del centro si no le dan ninguna', () => {
  const sinZona = getMatchParts('2026-09-17T01:00:00.000Z', null);
  const conDefault = getMatchParts('2026-09-17T01:00:00.000Z', DEFAULT_TZ);
  assert.deepEqual(sinZona, conDefault);
});

test('getMatchParts con una zona desconocida muestra la zona en crudo', () => {
  // Comportamiento de resguardo documentado: no truena, pero se ve feo — que
  // es exactamente lo que la prueba del cruce de listas evita que pase.
  const parts = getMatchParts('2026-09-17T01:00:00.000Z', 'America/Bogota');
  assert.ok(parts.tzLabel);
});

// ── initials ─────────────────────────────────────────────────────────────

test('initials toma la primera letra de hasta dos palabras', () => {
  assert.equal(initials('Borregos Salvajes'), 'BS');
  assert.equal(initials('Pumas'), 'P');
  assert.equal(initials('Águilas Blancas'), 'ÁB');
});

test('initials ignora palabras cortas en minúscula (de, la, los)', () => {
  // "Osos de Puebla" -> OP, no "OD": las preposiciones no son parte del
  // escudo. La regla real es "palabras de más de 2 letras, o que empiecen
  // con mayúscula".
  assert.equal(initials('Osos de Puebla'), 'OP');
  assert.equal(initials('Toros de la Laguna'), 'TL');
});

test('initials nunca devuelve más de dos letras', () => {
  assert.equal(initials('Club Deportivo Universidad Nacional'), 'CD');
});

test('initials aguanta vacío, null y undefined sin tronar', () => {
  // Se pinta en el escudo de la tarjeta de equipo: si esto lanza, se cae la
  // lista completa de equipos, no solo una tarjeta.
  assert.equal(initials(''), '');
  assert.equal(initials(null), '');
  assert.equal(initials(undefined), '');
  assert.equal(initials('   '), '');
});

// ── buildMatchShareText ──────────────────────────────────────────────────

// Esta función lee window.location.origin, así que necesita un navegador
// simulado. Se pone uno mínimo en vez de arrastrar jsdom por tres líneas.
const conVentana = (fn) => {
  const previo = globalThis.window;
  globalThis.window = { location: { origin: 'https://cfbamx.com' } };
  try { return fn(); } finally {
    if (previo === undefined) delete globalThis.window;
    else globalThis.window = previo;
  }
};

const dateParts = { day: '16', month: 'SEP', time: '7:00 p.m.', tzLabel: 'Hora Centro MX' };

const partidoBase = {
  id: 42,
  home_team: 'Borregos',
  away_team: 'Pumas',
};

test('el texto al compartir siempre lleva equipos, fecha y link', () => {
  const texto = conVentana(() => buildMatchShareText(partidoBase, dateParts, 'scheduled'));
  assert.match(texto, /Borregos vs Pumas — CFBAMX/);
  assert.match(texto, /16 SEP · 7:00 p\.m\. \(Hora Centro MX\)/);
  assert.match(texto, /https:\/\/cfbamx\.com\/partidos\/42/);
});

test('no inventa nada: lo que el partido no tenga, no aparece', () => {
  // Regla de contenido del proyecto. Un partido pelón no debe producir
  // "undefined" ni renglones vacíos con emoji.
  const texto = conVentana(() => buildMatchShareText(partidoBase, dateParts, 'scheduled'));
  assert.doesNotMatch(texto, /undefined|null/);
  assert.doesNotMatch(texto, /🏈/);        // no hay liga, torneo, jornada ni sede
  assert.doesNotMatch(texto, /Resultado/); // no ha terminado
  assert.doesNotMatch(texto, /📺/);        // no hay transmisiones
});

test('el marcador solo sale si el partido finalizó Y tiene marcador', () => {
  const conMarcador = { ...partidoBase, home_score: 21, away_score: 14 };

  const finalizado = conVentana(() => buildMatchShareText(conMarcador, dateParts, 'finished'));
  assert.match(finalizado, /Resultado final: Borregos 21 - 14 Pumas/);

  // En vivo con marcador parcial: NO se anuncia como resultado final.
  const enVivo = conVentana(() => buildMatchShareText(conMarcador, dateParts, 'live'));
  assert.doesNotMatch(enVivo, /Resultado final/);

  // Finalizado pero sin marcador capturado: tampoco.
  const sinMarcador = conVentana(() => buildMatchShareText(partidoBase, dateParts, 'finished'));
  assert.doesNotMatch(sinMarcador, /Resultado final/);
});

test('un marcador de 0-0 sí se muestra', () => {
  // 0 es falsy: con `if (match.home_score)` en vez de `!= null`, un empate a
  // cero desaparecería del texto.
  const cero = { ...partidoBase, home_score: 0, away_score: 0 };
  const texto = conVentana(() => buildMatchShareText(cero, dateParts, 'finished'));
  assert.match(texto, /Resultado final: Borregos 0 - 0 Pumas/);
});

test('el encabezado de las transmisiones cambia según el estado', () => {
  const conStream = { ...partidoBase, stream_links: ['https://youtube.com/x'] };

  assert.match(conVentana(() => buildMatchShareText(conStream, dateParts, 'scheduled')), /Míralo aquí/);
  assert.match(conVentana(() => buildMatchShareText(conStream, dateParts, 'live')),      /En vivo ahora/);
  assert.match(conVentana(() => buildMatchShareText(conStream, dateParts, 'finished')),  /Repetición/);
});

test('se listan TODAS las transmisiones, no solo la primera', () => {
  const varias = { ...partidoBase, stream_links: ['https://a.com/1', 'https://b.com/2', 'https://c.com/3'] };
  const texto = conVentana(() => buildMatchShareText(varias, dateParts, 'live'));
  assert.match(texto, /https:\/\/a\.com\/1/);
  assert.match(texto, /https:\/\/b\.com\/2/);
  assert.match(texto, /https:\/\/c\.com\/3/);
});

test('una jornada numérica se escribe "Jornada 5"; una con nombre va tal cual', () => {
  const numerica = { ...partidoBase, week_label: '5' };
  assert.match(conVentana(() => buildMatchShareText(numerica, dateParts, 'scheduled')), /Jornada 5/);

  const nombrada = { ...partidoBase, week_label: 'Semifinal' };
  const texto = conVentana(() => buildMatchShareText(nombrada, dateParts, 'scheduled'));
  assert.match(texto, /Semifinal/);
  assert.doesNotMatch(texto, /Jornada Semifinal/);
});

test('liga, torneo, jornada y sede se juntan en un solo renglón', () => {
  const completo = {
    ...partidoBase,
    league_name: 'ONEFA',
    tournament_name: 'Temporada 2026',
    week_label: '3',
    venue_name: 'Estadio Azul',
  };
  const texto = conVentana(() => buildMatchShareText(completo, dateParts, 'scheduled'));
  assert.match(texto, /🏈 ONEFA · Temporada 2026 · Jornada 3 · Estadio Azul/);
});
