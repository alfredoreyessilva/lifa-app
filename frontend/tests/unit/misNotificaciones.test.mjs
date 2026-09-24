// Pruebas de cómo se dicen los avisos de "Mis notificaciones"
// (utils/misNotificaciones.js).
//
// Lo que importa: los avisos de lo que sigues no traen texto guardado, se
// arman al leer con los datos de HOY del partido. Si el marcador se corrige o
// la fecha se vuelve a mover, el aviso tiene que decir lo que vale ahora.

import test from 'node:test';
import assert from 'node:assert/strict';

import { etiquetaDelContador, textoDeSeguimiento } from '../../src/utils/misNotificaciones.js';

const partido = {
  home_team: 'HALCONES', away_team: 'TIGRES',
  // 4 de octubre, 01:00 UTC = 3 de octubre, 7 pm en el centro de México.
  match_date: '2026-10-04T01:00:00.000Z', timezone: 'America/Mexico_City',
  home_score: null, away_score: null,
};

test('el balón: nada en cero, el número hasta 9, y "9+" de ahí para arriba', () => {
  assert.equal(etiquetaDelContador(0), '');
  assert.equal(etiquetaDelContador(undefined), '');
  assert.equal(etiquetaDelContador(-3), '');
  assert.equal(etiquetaDelContador(1), '1');
  assert.equal(etiquetaDelContador(9), '9');
  assert.equal(etiquetaDelContador(10), '9+');
  assert.equal(etiquetaDelContador(250), '9+');
});

test('"próximo" dice la hora en la zona del partido, no en UTC', () => {
  const { title, body } = textoDeSeguimiento({ type: 'upcoming', match: partido });
  assert.equal(title, 'Próximo — HALCONES vs TIGRES');
  assert.match(body, /^Empieza el 3 OCT/);
  assert.match(body, /Hora Centro MX/);
});

test('el marcador final dice el marcador de hoy', () => {
  const conMarcador = { ...partido, home_score: 21, away_score: 14 };
  assert.equal(
    textoDeSeguimiento({ type: 'final_score', match: conMarcador }).body,
    'HALCONES 21 · TIGRES 14',
  );
  // Si después le quitaron el marcador, no se inventa uno.
  assert.equal(
    textoDeSeguimiento({ type: 'final_score', match: partido }).body,
    'Mira el resultado en la página del partido.',
  );
});

test('el cambio de programación dice qué cambió y cómo quedó', () => {
  const soloSede = textoDeSeguimiento({ type: 'schedule_change', match: partido, data: { venue_changed: true } });
  assert.match(soloSede.body, /^Cambió la sede\. Ahora: 3 OCT/);
  const lasDos = textoDeSeguimiento({ type: 'schedule_change', match: partido, data: { date_changed: true, venue_changed: true } });
  assert.match(lasDos.body, /^Cambiaron la fecha y la sede\./);
  const sinDatos = textoDeSeguimiento({ type: 'schedule_change', match: partido, data: null });
  assert.match(sinDatos.body, /^Cambió la fecha u hora\./);
});

test('"en vivo" no promete nada que no sepa', () => {
  assert.deepEqual(textoDeSeguimiento({ type: 'live', match: partido }), {
    title: 'En vivo — HALCONES vs TIGRES',
    body: 'El partido ya comenzó.',
  });
});
