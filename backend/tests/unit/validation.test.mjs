// Pruebas de los validadores del backend (utils/validation.js).
//
// Estos validadores son la segunda línea, no la primera: el frontend ya
// revisa lo mismo antes de enviar. Existen porque cualquiera puede llamar a
// la API directamente sin pasar por la UI, así que lo que de verdad importa
// probar aquí son los casos que un atacante mandaría a mano, no los que un
// usuario normal escribiría mal.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidEmail,
  isValidUrl,
  isValidGoogleMapsUrl,
  isNonEmptyString,
} from '../../src/utils/validation.js';

// ── isValidEmail ─────────────────────────────────────────────────────────

test('isValidEmail acepta correos normales y recorta espacios', () => {
  assert.equal(isValidEmail('alguien@ejemplo.com'), true);
  assert.equal(isValidEmail('  alguien@ejemplo.com  '), true);
  assert.equal(isValidEmail('nombre.apellido+liga@sub.dominio.mx'), true);
});

test('isValidEmail rechaza lo que no tiene forma de correo', () => {
  assert.equal(isValidEmail('alguien@ejemplo'), false); // sin punto en el dominio
  assert.equal(isValidEmail('@ejemplo.com'), false);
  assert.equal(isValidEmail('alguien@'), false);
  assert.equal(isValidEmail('con espacio@ejemplo.com'), false);
});

test('isValidEmail trata el campo vacío como válido (es opcional por diseño)', () => {
  // Contrato del proyecto: los campos de email son opcionales, y quien
  // necesite exigirlos usa una verificación de "requerido" aparte. Si esto
  // se invierte alguna vez, rompe formularios que hoy guardan sin correo.
  assert.equal(isValidEmail(''), true);
  assert.equal(isValidEmail(null), true);
  assert.equal(isValidEmail(undefined), true);
});

// ── isValidUrl ───────────────────────────────────────────────────────────

test('isValidUrl acepta solo http y https', () => {
  assert.equal(isValidUrl('https://ejemplo.com'), true);
  assert.equal(isValidUrl('http://ejemplo.com/ruta?x=1'), true);
  assert.equal(isValidUrl('ftp://ejemplo.com'), false);
  assert.equal(isValidUrl('file:///etc/passwd'), false);
});

test('isValidUrl rechaza javascript: — este es el caso que importa', () => {
  // Estos links se guardan y luego se pintan como <a href> en la ficha del
  // partido (transmisiones, boletos). Un javascript: guardado ahí es un XSS
  // servido a toda la afición que abra ese partido.
  assert.equal(isValidUrl('javascript:alert(1)'), false);
  assert.equal(isValidUrl('JavaScript:alert(1)'), false);
  assert.equal(isValidUrl('data:text/html,<script>alert(1)</script>'), false);
});

test('isValidUrl rechaza texto que no es una dirección completa', () => {
  assert.equal(isValidUrl('ejemplo.com'), false); // sin protocolo
  assert.equal(isValidUrl('no soy una url'), false);
});

test('isValidUrl: vacío pasa (opcional), pero puros espacios no', () => {
  // Comportamiento documentado, no ideal: '' se considera "campo no llenado"
  // y pasa, mientras que '   ' entra a validarse y falla. En la práctica da
  // el resultado correcto (ninguno de los dos guarda un link), pero si algún
  // día se unifica, que sea a propósito.
  assert.equal(isValidUrl(''), true);
  assert.equal(isValidUrl(null), true);
  assert.equal(isValidUrl('   '), false);
});

// ── isValidGoogleMapsUrl ─────────────────────────────────────────────────

test('isValidGoogleMapsUrl acepta los formatos que la gente sí pega', () => {
  assert.equal(isValidGoogleMapsUrl('https://www.google.com/maps/place/Estadio'), true);
  assert.equal(isValidGoogleMapsUrl('http://www.google.com/maps/x'), true);
  assert.equal(isValidGoogleMapsUrl('https://maps.app.goo.gl/abc123'), true); // el del botón "Compartir"
  assert.equal(isValidGoogleMapsUrl('https://goo.gl/maps/xyz'), true);        // el corto de antes
});

test('isValidGoogleMapsUrl no se deja engañar por dominios parecidos', () => {
  // El punto de este validador no es la usabilidad, es que el campo "ubicación"
  // de una sede no se pueda usar para mandar a la afición a cualquier sitio.
  assert.equal(isValidGoogleMapsUrl('https://evil-google.com/maps'), false);
  assert.equal(isValidGoogleMapsUrl('https://google.com.attacker.net/maps'), false);
  assert.equal(isValidGoogleMapsUrl('https://waze.com/ul'), false);
  assert.equal(isValidGoogleMapsUrl('javascript:alert(1)'), false);
  assert.equal(isValidGoogleMapsUrl('no soy url'), false);
});

test('isValidGoogleMapsUrl exige la ruta /maps en dominios de google', () => {
  // Un link de google.com que no sea de Maps no cuenta como ubicación.
  assert.equal(isValidGoogleMapsUrl('https://www.google.com/search?q=estadio'), false);
});

test('limitación conocida: maps.google.com/?q=… se rechaza', () => {
  // Es un link legítimo de Google Maps, pero su ruta es "/" y no "/maps", así
  // que el validador lo tumba. Se deja documentado en vez de "arreglado"
  // porque ampliar la regla es justo por donde se debilita: hoy la forma que
  // la gente usa es el botón "Compartir", que da maps.app.goo.gl.
  assert.equal(isValidGoogleMapsUrl('https://maps.google.com/?q=19.4,-99.1'), false);
});

test('isValidGoogleMapsUrl trata el campo vacío como válido (es opcional)', () => {
  assert.equal(isValidGoogleMapsUrl(''), true);
  assert.equal(isValidGoogleMapsUrl(null), true);
  assert.equal(isValidGoogleMapsUrl(undefined), true);
});

// ── isNonEmptyString ─────────────────────────────────────────────────────

test('isNonEmptyString exige string con contenido real', () => {
  assert.equal(isNonEmptyString('Borregos'), true);
  assert.equal(isNonEmptyString('   '), false);
  assert.equal(isNonEmptyString(''), false);
  assert.equal(isNonEmptyString(null), false);
  assert.equal(isNonEmptyString(undefined), false);
});

test('isNonEmptyString rechaza números, aunque no estén vacíos', () => {
  // Importa porque un JSON mandado a mano puede traer 0 o 42 donde se
  // esperaba un nombre, y "0" es falsy: sin la revisión de tipo, una
  // comprobación ingenua lo dejaría pasar como si fuera texto.
  assert.equal(isNonEmptyString(0), false);
  assert.equal(isNonEmptyString(42), false);
  assert.equal(isNonEmptyString([]), false);
  assert.equal(isNonEmptyString({}), false);
});
