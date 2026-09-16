// Pruebas de la conversión hora local <-> UTC (utils/timezones.js).
//
// Por qué esta es la suite más importante del proyecto: un error de zona
// horaria NO truena. No hay excepción, no hay 500, no hay nada en Sentry —
// simplemente el partido aparece a la hora equivocada en el calendario, y
// nadie se entera hasta que la afición llega tarde. Es exactamente el tipo de
// fallo que solo una prueba automática detecta.
//
// Todas las aserciones de aquí son independientes de la zona horaria de la
// máquina que las corre (tu laptop en México, el runner de GitHub en UTC):
// las funciones bajo prueba reciben la zona de forma EXPLÍCITA, que es
// justamente la razón por la que existen. Si alguna prueba de este archivo
// empieza a depender del reloj ambiente, está mal escrita.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AMERICA_TIMEZONES,
  isValidTimezone,
  zonedTimeToUtcISO,
  parseLocalDateTimeString,
  localDateTimeStringToUtcISO,
  getLocalPartsInZone,
} from '../../src/utils/timezones.js';

// ── isValidTimezone ──────────────────────────────────────────────────────

test('isValidTimezone acepta solo zonas de la lista', () => {
  assert.equal(isValidTimezone('America/Mexico_City'), true);
  assert.equal(isValidTimezone('America/Tijuana'), true);

  // Zonas IANA reales pero fuera de América: no se aceptan a propósito.
  assert.equal(isValidTimezone('Europe/Madrid'), false);
  assert.equal(isValidTimezone('UTC'), false);

  // Basura que podría llegar de un cliente que no pasa por la UI.
  assert.equal(isValidTimezone('no soy una zona'), false);
  assert.equal(isValidTimezone(''), false);
  assert.equal(isValidTimezone(null), false);
  assert.equal(isValidTimezone(undefined), false);
});

test('la lista de zonas no tiene duplicados', () => {
  assert.equal(new Set(AMERICA_TIMEZONES).size, AMERICA_TIMEZONES.length);
});

test('todas las zonas de la lista son reconocidas por Intl', () => {
  // Si alguien agrega una zona mal escrita a la lista, isValidTimezone la
  // daría por buena y el error saldría hasta el momento de formatear una
  // fecha con ella. Esto lo caza aquí.
  for (const tz of AMERICA_TIMEZONES) {
    assert.doesNotThrow(
      () => new Intl.DateTimeFormat('en-US', { timeZone: tz }),
      `zona inválida en AMERICA_TIMEZONES: ${tz}`
    );
  }
});

// ── zonedTimeToUtcISO ────────────────────────────────────────────────────

test('convierte hora del centro de México a UTC', () => {
  // Un partido a las 7 de la tarde en CDMX. CDMX es UTC-6.
  assert.equal(
    zonedTimeToUtcISO(2026, 9, 16, 19, 0, 'America/Mexico_City'),
    '2026-09-17T01:00:00.000Z'
  );
});

test('México ya NO tiene horario de verano: enero y septiembre dan el mismo desfase', () => {
  // Regresión del cambio de 2022 (se abolió el horario de verano en casi todo
  // el país). Si alguna vez se "arregla" esta función con una tabla de DST
  // genérica para México, esta prueba lo detiene: las dos deben ser UTC-6.
  const septiembre = zonedTimeToUtcISO(2026, 9, 16, 19, 0, 'America/Mexico_City');
  const enero      = zonedTimeToUtcISO(2026, 1, 15, 19, 0, 'America/Mexico_City');

  assert.equal(septiembre, '2026-09-17T01:00:00.000Z'); // UTC-6
  assert.equal(enero,      '2026-01-16T01:00:00.000Z'); // UTC-6, el mismo
});

test('Tijuana SÍ tiene horario de verano, a diferencia del resto de México', () => {
  // Esta es la trampa real del proyecto: es la única zona mexicana de la lista
  // que sigue cambiando de hora (se alinea con California). Una liga de Baja
  // California y una de CDMX capturando el mismo día NO están en el mismo
  // desfase, y en verano ni siquiera es el mismo desfase que en invierno.
  assert.equal(
    zonedTimeToUtcISO(2026, 7, 4, 18, 30, 'America/Tijuana'),
    '2026-07-05T01:30:00.000Z' // PDT, UTC-7
  );
  assert.equal(
    zonedTimeToUtcISO(2026, 12, 4, 18, 30, 'America/Tijuana'),
    '2026-12-05T02:30:00.000Z' // PST, UTC-8
  );
});

test('Hermosillo se queda en UTC-7 todo el año', () => {
  // Sonora nunca aplicó horario de verano. En julio coincide con Tijuana en
  // PDT, pero por una razón distinta — y en diciembre ya no coinciden.
  assert.equal(
    zonedTimeToUtcISO(2026, 7, 4, 18, 30, 'America/Hermosillo'),
    '2026-07-05T01:30:00.000Z'
  );
  assert.equal(
    zonedTimeToUtcISO(2026, 12, 4, 18, 30, 'America/Hermosillo'),
    '2026-12-05T01:30:00.000Z'
  );
});

test('la medianoche local cae en el día correcto en UTC', () => {
  // Caso clásico de error por uno: un partido a las 00:00 del 16 en CDMX es
  // el 16 a las 06:00 UTC, NO el 15. Si esto se rompe, el partido se va de
  // día en el calendario.
  assert.equal(
    zonedTimeToUtcISO(2026, 9, 16, 0, 0, 'America/Mexico_City'),
    '2026-09-16T06:00:00.000Z'
  );
});

test('convierte zonas de Estados Unidos respetando su horario de verano', () => {
  assert.equal(
    zonedTimeToUtcISO(2026, 7, 4, 20, 0, 'America/New_York'),
    '2026-07-05T00:00:00.000Z' // EDT, UTC-4
  );
  assert.equal(
    zonedTimeToUtcISO(2026, 1, 4, 20, 0, 'America/New_York'),
    '2026-01-05T01:00:00.000Z' // EST, UTC-5
  );
});

test('una hora que no existe (salto de horario de verano) no truena', () => {
  // El 8 de marzo de 2026 en Nueva York el reloj salta de 01:59 a 03:00: las
  // 02:30 nunca ocurren. Esto NO es una aserción de "lo correcto" — es de
  // comportamiento documentado: la función resuelve el hueco hacia adelante
  // en vez de devolver null o lanzar. Se fija aquí para que, si alguien
  // cambia el algoritmo, sea una decisión consciente y no un accidente.
  assert.equal(
    zonedTimeToUtcISO(2026, 3, 8, 2, 30, 'America/New_York'),
    '2026-03-08T07:30:00.000Z'
  );
});

// ── parseLocalDateTimeString ─────────────────────────────────────────────

test('parsea el string crudo de un input datetime-local', () => {
  assert.deepEqual(
    parseLocalDateTimeString('2026-09-16T19:00'),
    { year: 2026, month: 9, day: 16, hour: 19, minute: 0 }
  );
  // Algunos navegadores incluyen los segundos.
  assert.deepEqual(
    parseLocalDateTimeString('2026-09-16T19:00:30'),
    { year: 2026, month: 9, day: 16, hour: 19, minute: 0 }
  );
});

test('parseLocalDateTimeString devuelve null ante cualquier cosa que no sea ese formato', () => {
  assert.equal(parseLocalDateTimeString('16/09/2026 19:00'), null);
  assert.equal(parseLocalDateTimeString('2026-09-16'), null); // sin hora
  assert.equal(parseLocalDateTimeString('no soy fecha'), null);
  assert.equal(parseLocalDateTimeString(''), null);
  assert.equal(parseLocalDateTimeString(null), null);
  assert.equal(parseLocalDateTimeString(undefined), null);
});

test('localDateTimeStringToUtcISO devuelve null si el string es inválido', () => {
  // Importa que sea null y no una fecha inventada: quien llama decide qué
  // hacer con un formulario mal llenado, y "null" es lo único que no
  // guarda un partido en una fecha equivocada sin avisar.
  assert.equal(localDateTimeStringToUtcISO('basura', 'America/Mexico_City'), null);
  assert.equal(
    localDateTimeStringToUtcISO('2026-09-16T19:00', 'America/Mexico_City'),
    '2026-09-17T01:00:00.000Z'
  );
});

// ── getLocalPartsInZone y el viaje redondo ───────────────────────────────

test('getLocalPartsInZone regresa la hora de pared de esa zona', () => {
  assert.deepEqual(
    getLocalPartsInZone('2026-09-17T01:00:00.000Z', 'America/Mexico_City'),
    { year: 2026, month: 9, day: 16, hour: 19, minute: 0 }
  );
});

test('getLocalPartsInZone convierte la medianoche a hora 0, no a 24', () => {
  // Intl con hour12:false puede devolver "24" para la medianoche según la
  // versión de ICU; la función lo normaliza a 0. Sin eso, el precargado del
  // formulario al editar un partido mostraría una hora inexistente.
  const parts = getLocalPartsInZone('2026-09-16T06:00:00.000Z', 'America/Mexico_City');
  assert.deepEqual(parts, { year: 2026, month: 9, day: 16, hour: 0, minute: 0 });
});

test('ida y vuelta: local -> UTC -> local devuelve lo mismo, en cada zona de la lista', () => {
  // Esta es la prueba que cubre las 36 zonas de golpe. Cualquier zona nueva
  // que se agregue a AMERICA_TIMEZONES queda cubierta automáticamente.
  //
  // Se usa el 16 de septiembre a las 19:00: una fecha lejos de cualquier
  // cambio de horario de verano en todo el continente, para que el viaje
  // redondo sea inequívoco (en las horas del salto, por definición, no lo es).
  const local = { year: 2026, month: 9, day: 16, hour: 19, minute: 0 };

  for (const tz of AMERICA_TIMEZONES) {
    const utc = zonedTimeToUtcISO(local.year, local.month, local.day, local.hour, local.minute, tz);
    assert.deepEqual(getLocalPartsInZone(utc, tz), local, `no cerró el viaje redondo en ${tz}`);
  }
});
