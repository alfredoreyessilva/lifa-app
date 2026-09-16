// Pruebas de los validadores de formulario del frontend (utils/validation.js).
//
// Contrato de este módulo: cada función devuelve el MENSAJE de error (string)
// si algo está mal, o null si está bien. Es al revés de lo que sugiere el
// nombre — `required(x)` no devuelve "es requerido: sí/no", devuelve el error.
// Invertir eso por accidente haría que todos los formularios aceptaran todo,
// silenciosamente, y es justo lo que estas pruebas fijan.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  required,
  minLength,
  maxLength,
  validEmail,
  validUrl,
  validGoogleMapsUrl,
  notPastDate,
  differentFrom,
  minValue,
  runValidations,
} from '../../src/utils/validation.js';

// ── El contrato: null = válido ───────────────────────────────────────────

test('null significa válido, string significa error', () => {
  assert.equal(required('Borregos', 'El nombre'), null);
  assert.equal(typeof required('', 'El nombre'), 'string');
});

// ── required ─────────────────────────────────────────────────────────────

test('required rechaza vacío, espacios, null y undefined', () => {
  assert.equal(required('', 'El nombre'), 'El nombre es obligatorio');
  assert.equal(required('   ', 'El nombre'), 'El nombre es obligatorio');
  assert.equal(required(null, 'El nombre'), 'El nombre es obligatorio');
  assert.equal(required(undefined, 'El nombre'), 'El nombre es obligatorio');
});

test('required acepta el número 0', () => {
  // 0 es falsy pero es un valor legítimo (un marcador de 0 puntos, un monto
  // de 0). Una revisión ingenua con `if (!value)` lo rechazaría.
  assert.equal(required(0, 'El marcador'), null);
});

// ── minLength / maxLength ────────────────────────────────────────────────

test('minLength y maxLength miden sin contar espacios de los extremos', () => {
  assert.equal(minLength('  ab  ', 3, 'El nombre'), 'El nombre debe tener al menos 3 caracteres');
  assert.equal(minLength('abc', 3, 'El nombre'), null);
  assert.equal(maxLength('abcde', 3, 'El nombre'), 'El nombre no puede tener más de 3 caracteres');
  assert.equal(maxLength('abc', 3, 'El nombre'), null);
});

test('minLength no opina sobre un campo vacío — de eso se encarga required', () => {
  // Cada validador hace una sola cosa; se encadenan con runValidations.
  assert.equal(minLength('', 5, 'El nombre'), null);
  assert.equal(minLength(null, 5, 'El nombre'), null);
});

// ── validEmail / validUrl ────────────────────────────────────────────────

test('validEmail coincide con el criterio del backend', () => {
  assert.equal(validEmail('alguien@ejemplo.com'), null);
  assert.equal(validEmail('  alguien@ejemplo.com  '), null);
  assert.equal(typeof validEmail('alguien@ejemplo'), 'string');
  assert.equal(typeof validEmail('@ejemplo.com'), 'string');
  assert.equal(validEmail(''), null); // opcional, igual que en el backend
});

test('validUrl rechaza javascript: y protocolos que no son web', () => {
  assert.equal(validUrl('https://ejemplo.com'), null);
  assert.equal(validUrl('http://ejemplo.com'), null);
  assert.equal(typeof validUrl('javascript:alert(1)'), 'string');
  assert.equal(typeof validUrl('ftp://ejemplo.com'), 'string');
  assert.equal(typeof validUrl('ejemplo.com'), 'string'); // sin protocolo
  assert.equal(validUrl(''), null);
  assert.equal(validUrl('   '), null); // aquí sí se recorta antes, a diferencia del backend
});

test('validUrl usa la etiqueta que le pasan en el mensaje', () => {
  const error = validUrl('basura', 'El link de transmisión');
  assert.match(error, /El link de transmisión/);
});

// ── validGoogleMapsUrl ───────────────────────────────────────────────────

test('validGoogleMapsUrl acepta lo mismo que su gemelo del backend', () => {
  assert.equal(validGoogleMapsUrl('https://www.google.com/maps/place/Estadio'), null);
  assert.equal(validGoogleMapsUrl('https://maps.app.goo.gl/abc123'), null);
  assert.equal(validGoogleMapsUrl('https://goo.gl/maps/xyz'), null);
});

test('validGoogleMapsUrl rechaza dominios parecidos y links que no son de mapas', () => {
  assert.equal(typeof validGoogleMapsUrl('https://evil-google.com/maps'), 'string');
  assert.equal(typeof validGoogleMapsUrl('https://google.com.attacker.net/maps'), 'string');
  assert.equal(typeof validGoogleMapsUrl('https://www.google.com/search?q=estadio'), 'string');
  assert.equal(typeof validGoogleMapsUrl('javascript:alert(1)'), 'string');
  assert.equal(validGoogleMapsUrl(''), null);
});

// ── notPastDate / differentFrom / minValue ───────────────────────────────

test('notPastDate rechaza fechas que ya pasaron', () => {
  const ayer   = new Date(Date.now() - 86400000).toISOString();
  const mañana = new Date(Date.now() + 86400000).toISOString();
  assert.equal(typeof notPastDate(ayer, 'La fecha del partido'), 'string');
  assert.equal(notPastDate(mañana, 'La fecha del partido'), null);
  assert.equal(notPastDate('', 'La fecha del partido'), null); // opcional
});

test('differentFrom compara como texto, para que 5 y "5" cuenten como iguales', () => {
  // El caso real: no dejar que el equipo local y el visitante sean el mismo.
  // Los <select> entregan strings y el estado a veces guarda números.
  assert.equal(differentFrom(5, '5', 'No pueden ser el mismo equipo'), 'No pueden ser el mismo equipo');
  assert.equal(differentFrom(5, 6, 'No pueden ser el mismo equipo'), null);
  assert.equal(differentFrom(null, null, 'msg'), null); // dos vacíos no es un choque
});

test('minValue deja pasar el campo vacío pero no un número menor al mínimo', () => {
  assert.equal(minValue('', 0, 'El monto'), null);
  assert.equal(minValue(null, 0, 'El monto'), null);
  assert.equal(minValue(0, 0, 'El monto'), null);
  assert.equal(minValue(-1, 0, 'El monto'), 'El monto no puede ser menor a 0');
  assert.equal(minValue('-1', 0, 'El monto'), 'El monto no puede ser menor a 0'); // string del input
});

// ── runValidations ───────────────────────────────────────────────────────

test('runValidations devuelve el PRIMER error y no sigue evaluando', () => {
  const llamadas = [];
  const error = runValidations([
    () => { llamadas.push('a'); return null; },
    () => { llamadas.push('b'); return 'el segundo falló'; },
    () => { llamadas.push('c'); return 'el tercero también'; },
  ]);

  assert.equal(error, 'el segundo falló');
  // El tercero no debe haberse evaluado: "primer-error-gana".
  assert.deepEqual(llamadas, ['a', 'b']);
});

test('runValidations devuelve null si todas pasan', () => {
  assert.equal(runValidations([() => null, () => null]), null);
  assert.equal(runValidations([]), null);
});
