// Pruebas de cómo se dicen los avisos de "Mis notificaciones"
// (utils/misNotificaciones.js).
//
// Lo que importa: los avisos de lo que sigues no traen texto guardado, se
// arman al leer con los datos de HOY del partido. Si el marcador se corrige o
// la fecha se vuelve a mover, el aviso tiene que decir lo que vale ahora.

import test from 'node:test';
import assert from 'node:assert/strict';

import { etiquetaDelContador, textoDeSeguimiento, textoDePrediccion, nombreDeJornada } from '../../src/utils/misNotificaciones.js';

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

// ── Los avisos de tus predicciones ────────────────────────────────────────

test('resultado: acertaste, con los puntos y la fase final; y lo que casi nadie vio venir', () => {
  const conMarcador = { ...partido, home_score: 21, away_score: 14 };
  const acierto = textoDePrediccion({
    type: 'prediction_result', match: conMarcador,
    data: { pick: 'home', correct: true, points: 2, votes: 36, same_pct: 14 },
  });
  assert.equal(acierto.icon, '✅');
  assert.equal(acierto.title, 'Acertaste — HALCONES vs TIGRES');
  assert.equal(acierto.body, 'HALCONES 21 · TIGRES 14. +2 puntos (fase final). Solo el 14% lo vio venir.');

  const comun = textoDePrediccion({
    type: 'prediction_result', match: conMarcador,
    data: { pick: 'home', correct: true, points: 1, votes: 36, same_pct: 80 },
  });
  assert.equal(comun.body, 'HALCONES 21 · TIGRES 14. +1 punto. El 80% votó como tú.');
});

test('resultado: no se dio dice por quién ibas; sin otros votos no hay porcentaje', () => {
  const t = textoDePrediccion({
    type: 'prediction_result', match: { ...partido, home_score: 21, away_score: 14 },
    data: { pick: 'away', correct: false, points: 0, votes: 1, same_pct: 100 },
  });
  assert.equal(t.icon, '❌');
  assert.equal(t.title, 'No se dio — HALCONES vs TIGRES');
  assert.equal(t.body, 'HALCONES 21 · TIGRES 14. Tu voto: TIGRES.');
});

const cierre = (data) => textoDePrediccion({
  type: 'prediction_round', match: partido,
  data: {
    jornada: { week_label: '4', fecha: null }, voted: 14, graded: 14, correct: 9, points: 9,
    total_points: 41, position: 4, tied: 0, participants: 36, change: 2, milestone: null, pools: [], ...data,
  },
});

test('cierre de jornada: tu jornada, tu lugar y cuánto te moviste', () => {
  const t = cierre();
  assert.equal(t.title, 'Cerró la Jornada 4');
  assert.equal(t.body, 'Jornada 4: acertaste 9 de 14 · +9 puntos.\nVas 4.º de 36 · subiste 2 · 41 puntos en total.');
});

test('cierre de jornada: el hito es el título, y un 1.º compartido no presume', () => {
  assert.equal(cierre({ milestone: 'top3', position: 3 }).title, '¡Entraste al top 3 en el ranking!');
  assert.equal(cierre({ milestone: 'first', position: 1 }).title, '¡Vas 1.º en el ranking!');
  assert.equal(cierre({ milestone: 'first', position: 1, tied: 2 }).title, 'Compartes el 1.º lugar en el ranking');
  assert.equal(cierre({ milestone: 'lost_first', position: 2, change: -1 }).title, 'Te quitaron el 1.º lugar en el ranking');
  assert.match(cierre({ tied: 2 }).body, /Vas 4\.º de 36 \(empatado con 2 más\)/);
});

test('cierre de jornada: una línea por quiniela, y su hito si el del calendario no hay', () => {
  const t = cierre({
    pools: [{ name: 'Los del trabajo', position: 1, members: 8, change: 1, milestone: 'first', tied: 0 }],
  });
  assert.equal(t.title, '¡Vas 1.º en Los del trabajo!');
  assert.match(t.body, /\nEn Los del trabajo: 1\.º de 8 · subiste 1\.$/);
});

test('cierre de jornada: sin votar (te quitaron el 1.º igual) y sin week_label', () => {
  const t = cierre({ voted: 0, graded: 0, correct: 0, points: 0, milestone: 'lost_first', position: 2, change: -1 });
  assert.match(t.body, /^No votaste la Jornada 4\./);
  const porFecha = cierre({ jornada: { week_label: null, fecha: '2026-10-03' } });
  assert.equal(porFecha.title, 'Cerró los partidos del 3 OCT');
  assert.match(porFecha.body, /^Los partidos del 3 OCT: acertaste/);
});

test('te falta votar: cuántos y cuándo empieza el primero, en la zona del partido', () => {
  const varios = textoDePrediccion({ type: 'prediction_reminder', match: partido, data: { jornada: { week_label: '5' }, missing: 6 } });
  assert.equal(varios.title, 'Te falta votar — Jornada 5');
  assert.match(varios.body, /^Te faltan 6 partidos\. El primero empieza el 3 OCT/);
  const uno = textoDePrediccion({ type: 'prediction_reminder', match: partido, data: { jornada: { week_label: 'SEMIFINAL' }, missing: 1 } });
  assert.equal(uno.title, 'Te falta votar — SEMIFINAL');
  assert.match(uno.body, /^Te falta 1 partido: HALCONES vs TIGRES, el 3 OCT/);
  assert.equal(nombreDeJornada({ week_label: null, fecha: '2026-10-03' }), 'los partidos del 3 OCT');
});
