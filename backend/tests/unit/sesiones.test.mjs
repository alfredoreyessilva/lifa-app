// Pruebas de la regla que decide si una sesión sigue abierta después de cambiar
// la contraseña (utils/sesiones.js).
//
// Las tres formas de romperla en silencio, y las tres se ven igual desde
// afuera —nada truena, alguien queda donde no debía—:
//
//   1. Que el cambio no cierre las sesiones de antes: quien cambió la
//      contraseña porque otra persona entró a su cuenta la sigue teniendo
//      dentro hasta siete días.
//   2. Que el token que se entrega AL cambiarla nazca revocado, porque se
//      comparó al milisegundo un `iat` que viene en segundos.
//   3. Que una cuenta que nunca ha cambiado su contraseña pierda la sesión por
//      la migración.

import test from 'node:test';
import assert from 'node:assert/strict';

import { segundoDelCambio, tokenSigueVigente } from '../../src/utils/sesiones.js';

// El cambio, a las 10:00:00.700 UTC.
const CAMBIO = new Date('2026-10-17T10:00:00.700Z');
const SEGUNDO = Math.floor(CAMBIO.getTime() / 1000);
// El `iat` que firmaría jsonwebtoken en un instante dado.
const iatDe = (iso) => Math.floor(new Date(iso).getTime() / 1000);

// ── 1. El cambio cierra lo de antes ───────────────────────────────────────

test('un token firmado antes del cambio ya no sirve', () => {
  assert.equal(tokenSigueVigente(iatDe('2026-10-17T09:59:59.999Z'), SEGUNDO), false);
  assert.equal(tokenSigueVigente(iatDe('2026-10-12T08:00:00Z'), SEGUNDO), false);
});

test('un token firmado después del cambio sí sirve', () => {
  assert.equal(tokenSigueVigente(iatDe('2026-10-17T10:00:01Z'), SEGUNDO), true);
  assert.equal(tokenSigueVigente(iatDe('2026-10-18T10:00:00Z'), SEGUNDO), true);
});

// ── 2. El token que se entrega al cambiarla no nace revocado ──────────────

test('el token firmado en el mismo segundo del cambio sí sirve, aunque sea milisegundos después', () => {
  assert.equal(tokenSigueVigente(iatDe('2026-10-17T10:00:00.900Z'), SEGUNDO), true);
  // Y el mismo segundo, comparado al milisegundo, lo habría rechazado: es la
  // trampa que esta regla existe para no pisar.
  assert.ok(iatDe('2026-10-17T10:00:00.900Z') * 1000 < CAMBIO.getTime());
});

test('el segundo del cambio se trunca, no se redondea', () => {
  assert.equal(segundoDelCambio(new Date('2026-10-17T10:00:00.999Z')), SEGUNDO);
  assert.equal(segundoDelCambio(new Date('2026-10-17T10:00:00.000Z')), SEGUNDO);
});

test('la hora del cambio se lee igual venga como Date o como texto ISO', () => {
  assert.equal(segundoDelCambio(CAMBIO), SEGUNDO);
  assert.equal(segundoDelCambio(CAMBIO.toISOString()), SEGUNDO);
});

// ── 3. Quien nunca la cambió no pierde nada ───────────────────────────────

test('sin cambio de contraseña, cualquier token sigue sirviendo', () => {
  assert.equal(segundoDelCambio(null), null);
  assert.equal(segundoDelCambio(undefined), null);
  assert.equal(tokenSigueVigente(iatDe('2026-01-01T00:00:00Z'), null), true);
  assert.equal(tokenSigueVigente(iatDe('2026-01-01T00:00:00Z'), segundoDelCambio(null)), true);
});

// ── Y lo que no se entiende no pasa ───────────────────────────────────────

test('falla cerrado: con un cambio de por medio, un token sin iat numérico no sirve', () => {
  for (const iat of [undefined, null, '1797500000', NaN, Infinity]) {
    assert.equal(tokenSigueVigente(iat, SEGUNDO), false, `iat = ${String(iat)}`);
  }
});

test('falla cerrado: una hora de cambio que no se pudo leer no deja pasar a nadie', () => {
  const ilegible = segundoDelCambio('no es una fecha');
  assert.ok(Number.isNaN(ilegible));
  assert.equal(tokenSigueVigente(iatDe('2026-10-18T10:00:00Z'), ilegible), false);
});
