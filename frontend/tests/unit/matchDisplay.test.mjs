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
  jornadaLabel,
  groupByJornada,
  jornadaDateRange,
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

// ── Jornadas del calendario ──────────────────────────────────────────────

const partido = (id, week_label, match_date, timezone = 'America/Mexico_City') =>
  ({ id, week_label, match_date, timezone });

test('jornadaLabel: numérica lleva "Jornada", con nombre va tal cual, vacía dice que no tiene', () => {
  assert.equal(jornadaLabel('3'), 'Jornada 3');
  assert.equal(jornadaLabel('0'), 'Jornada 0');
  assert.equal(jornadaLabel('SEMIFINAL'), 'SEMIFINAL');
  assert.equal(jornadaLabel(null), 'Sin jornada');
  assert.equal(jornadaLabel(''), 'Sin jornada');
});

test('groupByJornada corta donde cambia la jornada, sin perder ni mover partidos', () => {
  // El caso de ONEFA: 15 partidos en la 1 y 14 en la 2. En una sola
  // cuadrícula de dos columnas, el 15 de la 1 quedaba junto al 1 de la 2.
  const lista = [
    partido(1, '1', '2026-09-05T20:00:00Z'),
    partido(2, '1', '2026-09-06T20:00:00Z'),
    partido(3, '1', '2026-09-06T23:00:00Z'),
    partido(4, '2', '2026-09-12T20:00:00Z'),
    partido(5, '2', '2026-09-13T20:00:00Z'),
  ];
  const grupos = groupByJornada(lista);
  assert.deepEqual(grupos.map((g) => g.label), ['Jornada 1', 'Jornada 2']);
  assert.deepEqual(grupos.map((g) => g.matches.map((m) => m.id)), [[1, 2, 3], [4, 5]]);
});

test('groupByJornada no reordena: un reprogramado forma su propio tramo en su fecha', () => {
  // Se respeta el orden de fecha, que es el que usa la afición para ver qué
  // sigue. Reagrupar mandaría el partido del día 20 a la jornada 1, arriba de
  // partidos que se juegan antes que él.
  const lista = [
    partido(1, '1', '2026-09-05T20:00:00Z'),
    partido(2, '2', '2026-09-12T20:00:00Z'),
    partido(3, '1', '2026-09-20T20:00:00Z'),
    partido(4, '3', '2026-09-20T23:00:00Z'),
  ];
  const grupos = groupByJornada(lista);
  assert.deepEqual(grupos.map((g) => g.label), ['Jornada 1', 'Jornada 2', 'Jornada 1', 'Jornada 3']);
  // Las llaves no se repiten aunque la jornada sí: son las `key` de React.
  assert.equal(new Set(grupos.map((g) => g.key)).size, grupos.length);
});

test('groupByJornada: un empate de hora no parte la jornada, venga en el orden que venga', () => {
  // Lo que pasó en ONEFA: TECOS vs LOBOS (Jornada 2) y un scrimmage a la
  // misma hora exacta. El backend ordena solo por fecha, así que el empate
  // llega en cualquier orden — y en uno de ellos la Jornada 2 salía partida.
  const antes = [
    partido(630, '2', '2026-09-12T19:00:00Z'),
  ];
  const despues = [
    partido(632, '3', '2026-09-19T18:00:00Z'),
  ];
  const j2 = partido(631, '2', '2026-09-13T00:00:00Z');
  const scrimmage = partido(774, 'SCRIMMAGE', '2026-09-13T00:00:00Z');
  const j3 = partido(700, '3', '2026-09-13T00:00:00Z');
  // Con un partido de la Jornada 3 también en el empate, ese se va al final,
  // pegado a la jornada que abre.
  for (const empate of [[j2, scrimmage], [scrimmage, j2], [j3, scrimmage, j2], [scrimmage, j3, j2]]) {
    const lista = [...antes, ...empate, ...despues];
    const grupos = groupByJornada(lista);
    assert.deepEqual(grupos.map((g) => g.label), ['Jornada 2', 'SCRIMMAGE', 'Jornada 3'], `orden: ${empate.map((m) => m.id)}`);
    assert.equal(grupos.flatMap((g) => g.matches).length, lista.length);
  }
});

test('groupByJornada: un calendario sin jornadas capturadas es un solo tramo', () => {
  // 20 categorías de producción no tienen jornada en ningún partido. Un solo
  // tramo = el visor lo pinta como siempre, sin encabezados.
  const lista = [
    partido(1, null, '2026-09-05T20:00:00Z'),
    partido(2, '', '2026-09-06T20:00:00Z'),
  ];
  const grupos = groupByJornada(lista);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].week, null);
  assert.deepEqual(groupByJornada([]), []);
});

test('jornadaDateRange: un día, varios días del mes, o dos meses', () => {
  assert.equal(jornadaDateRange([
    partido(1, '1', '2026-09-12T17:00:00Z'),
    partido(2, '1', '2026-09-12T23:00:00Z'),
  ]), '12 SEP');
  assert.equal(jornadaDateRange([
    partido(1, '1', '2026-09-12T17:00:00Z'),
    partido(2, '1', '2026-09-14T17:00:00Z'),
  ]), '12–14 SEP');
  assert.equal(jornadaDateRange([
    partido(1, '1', '2026-08-30T17:00:00Z'),
    partido(2, '1', '2026-09-02T17:00:00Z'),
  ]), '30 AGO – 2 SEP');
  assert.equal(jornadaDateRange([]), '');
});

test('jornadaDateRange lee cada partido en su zona y toma los extremos aunque vengan desordenados', () => {
  // 01:00Z del 13 es el 12 en la noche en CDMX: la jornada es "12–14", no "13–14".
  assert.equal(jornadaDateRange([
    partido(2, '1', '2026-09-14T17:00:00Z'),
    partido(1, '1', '2026-09-13T01:00:00Z'),
  ]), '12–14 SEP');
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
