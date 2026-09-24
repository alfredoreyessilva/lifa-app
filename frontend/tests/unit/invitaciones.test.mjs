// Pruebas de cómo se dice cuánto le queda a un link (utils/invitaciones.js).
//
// El caso que importa es el primero: un link recién generado dura 7 días
// menos unos segundos, y truncar lo haría decir "6 días" desde el primer
// momento — que es justo lo que la persona que lo acaba de generar no espera.

import test from 'node:test';
import assert from 'node:assert/strict';

import { caducaEn, linkDeInvitacion, enlaceWhatsApp } from '../../src/utils/invitaciones.js';

const HORA = 3600;
const DIA = 86400;

test('un link recién generado dice 7 días, no 6', () => {
  assert.equal(caducaEn(7 * DIA - 5), 'caduca en 7 días');
});

test('los días se dicen en singular cuando es uno', () => {
  assert.equal(caducaEn(DIA), 'caduca en 1 día');
  assert.equal(caducaEn(3 * DIA), 'caduca en 3 días');
});

test('el último día se cuenta en horas, redondeando hacia arriba', () => {
  assert.equal(caducaEn(DIA - 1), 'caduca en 24 horas');
  assert.equal(caducaEn(5 * HORA - 10), 'caduca en 5 horas');
  assert.equal(caducaEn(HORA), 'caduca en 1 hora');
});

test('la última hora no se cuenta en minutos', () => {
  assert.equal(caducaEn(59 * 60), 'caduca en menos de una hora');
  assert.equal(caducaEn(1), 'caduca en menos de una hora');
});

test('cero o negativo es que ya caducó', () => {
  assert.equal(caducaEn(0), 'ya caducó');
  assert.equal(caducaEn(-50), 'ya caducó');
});

test('sin dato no se inventa nada', () => {
  assert.equal(caducaEn(undefined), '');
  assert.equal(caducaEn(null), '');
  assert.equal(caducaEn('abc'), '');
});

test('el link de la invitación y el de WhatsApp', () => {
  const link = linkDeInvitacion('abc123', 'https://cfbamx.test');
  assert.equal(link, 'https://cfbamx.test/invitaciones/abc123');
  const wa = enlaceWhatsApp('Te invito', link);
  assert.ok(wa.startsWith('https://wa.me/?text='));
  // El link completo, al final y en su propia línea.
  assert.equal(decodeURIComponent(wa.split('text=')[1]), `Te invito\n${link}`);
});
