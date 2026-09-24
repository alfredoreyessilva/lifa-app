// Pruebas de "Mis notificaciones" (utils/bandeja.js). README, "Notificaciones:
// la bandeja y el push".
//
// Lo que se fija aquí son las dos cosas que se rompen en silencio:
//
//   1. Quién lee cada aviso de una organización. La bandeja vieja se leía con
//      una sola guarda y el coach terminó leyendo cuotas vencidas con nombres
//      del padrón. Si alguien "simplifica" la tabla, estas pruebas lo dicen.
//   2. Qué avisos de seguimiento salen y cuándo. "Próximo" y "en vivo" no se
//      guardan en ningún lado: se calculan con la hora del partido, así que la
//      única red que tienen es esta.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PERMISO_POR_AVISO,
  permisoDeAviso,
  puedeLeerAviso,
  filtrosDeBandeja,
  cubre,
  avisosDeSeguimiento,
  esNuevo,
  contarNuevos,
  juntarBandeja,
} from '../../src/utils/bandeja.js';
import { PERMISOS } from '../../src/utils/orgRoles.js';

const DINERO = Object.keys(PERMISO_POR_AVISO).filter((t) =>
  ['cobranza_liga', 'cuotas_club'].includes(PERMISO_POR_AVISO[t]));

// ── 1. Quién lee qué ──────────────────────────────────────────────────────

test('todo aviso clasificado pide un permiso que existe (o nadie lo leería)', () => {
  for (const [tipo, permiso] of Object.entries(PERMISO_POR_AVISO)) {
    assert.ok(PERMISOS.includes(permiso), `"${tipo}" pide "${permiso}", que no está en PERMISOS`);
  }
});

test('el coach y el editor de roster no leen ningún aviso de dinero', () => {
  assert.ok(DINERO.length >= 9, 'la lista de avisos de dinero se quedó corta');
  for (const rol of ['coach', 'roster_editor']) {
    for (const tipo of DINERO) {
      assert.equal(puedeLeerAviso('team', rol, tipo), false, `${rol} lee ${tipo}`);
    }
  }
});

test('el tesorero del equipo lee los dos libros, y no quién entró al equipo', () => {
  assert.ok(puedeLeerAviso('team', 'treasurer', 'billing_charge_new'));
  assert.ok(puedeLeerAviso('team', 'treasurer', 'player_payment_reported'));
  assert.ok(puedeLeerAviso('team', 'treasurer', 'player_billing_overdue'));
  assert.equal(puedeLeerAviso('team', 'treasurer', 'org_admin_claimed'), false);
});

test('el tesorero de la liga lee el pago que le toca confirmar (antes no lo veía)', () => {
  assert.ok(puedeLeerAviso('league', 'treasurer', 'team_payment_reported'));
  assert.equal(puedeLeerAviso('league', 'treasurer', 'score_reminder'), false);
});

test('el editor de partidos lee los recordatorios de captura, y nada de dinero', () => {
  assert.ok(puedeLeerAviso('league', 'editor', 'score_reminder'));
  assert.ok(puedeLeerAviso('league', 'editor', 'match_not_started'));
  assert.equal(puedeLeerAviso('league', 'editor', 'team_payment_reported'), false);
  assert.equal(puedeLeerAviso('league', 'editor', 'league_approved'), false);
});

test('un aviso sin clasificar lo leen solo los dueños: falla cerrado, pero no invisible', () => {
  assert.equal(permisoDeAviso('algo_que_nadie_agrego'), 'duenos');
  assert.ok(puedeLeerAviso('team', 'owner', 'algo_que_nadie_agrego'));
  assert.ok(puedeLeerAviso('league', 'owner', 'algo_que_nadie_agrego'));
  assert.equal(puedeLeerAviso('team', 'admin', 'algo_que_nadie_agrego'), false);
  assert.equal(puedeLeerAviso('league', 'admin', 'algo_que_nadie_agrego'), false);
});

test('un rol desconocido no lee nada', () => {
  for (const tipo of Object.keys(PERMISO_POR_AVISO)) {
    assert.equal(puedeLeerAviso('team', 'rol_inventado', tipo), false);
  }
});

test('filtrosDeBandeja: el dueño lee todo, el coach queda fuera, y se agrupa por rol', () => {
  const grupos = filtrosDeBandeja([
    { tipo: 'team', id: 1, rol: 'owner' },
    { tipo: 'team', id: 2, rol: 'owner' },
    { tipo: 'team', id: 3, rol: 'coach' },
    { tipo: 'team', id: 4, rol: 'treasurer' },
    { tipo: 'league', id: 9, rol: 'owner' },
  ]);
  const dueñosEquipo = grupos.find((g) => g.tipo === 'team' && g.avisos === null);
  assert.deepEqual(dueñosEquipo.ids, [1, 2], 'los dos equipos del dueño van en un solo grupo');
  assert.ok(!grupos.some((g) => g.ids.includes(3)), 'el coach no tiene ningún aviso que leer');
  const tesorero = grupos.find((g) => g.ids.includes(4));
  assert.ok(tesorero.avisos.includes('player_billing_overdue'));
  assert.ok(!tesorero.avisos.includes('org_admin_claimed'));
  assert.ok(grupos.some((g) => g.tipo === 'league' && g.ids.includes(9) && g.avisos === null));
});

// ── 2. Los avisos de lo que sigues ────────────────────────────────────────

const HORA = 60 * 60 * 1000;
const AHORA = new Date('2026-10-03T20:00:00.000Z');
const antes = (h) => new Date(AHORA.getTime() - h * HORA);
const despues = (h) => new Date(AHORA.getTime() + h * HORA);

const partido = (id, inicio, extra = {}) => ({
  id, match_date: inicio.toISOString(), league_id: 7,
  home_team: 'HALCONES', away_team: 'TIGRES', ...extra,
});
const siguePartido = (match_id, desde = antes(24 * 5), prefs = {}) => ({
  match_id, team_name: null, league_id: null, desde, ...prefs,
});
const sigueEquipo = (team_name, league_id, desde = antes(24 * 5), prefs = {}) => ({
  match_id: null, team_name, league_id, desde, ...prefs,
});
const tipos = (avisos) => avisos.map((a) => a.type).sort();

test('"próximo" sale una hora antes y "en vivo" a la hora del partido, ni un minuto antes', () => {
  const empiezaEn30 = partido(1, despues(0.5));
  let avisos = avisosDeSeguimiento({ seguimientos: [siguePartido(1)], partidos: [empiezaEn30], eventos: [], ahora: AHORA });
  assert.deepEqual(tipos(avisos), ['upcoming'], 'a media hora: ya hay "próximo", todavía no "en vivo"');

  const empiezaEn2h = partido(2, despues(2));
  avisos = avisosDeSeguimiento({ seguimientos: [siguePartido(2)], partidos: [empiezaEn2h], eventos: [], ahora: AHORA });
  assert.deepEqual(avisos, [], 'a dos horas no hay nada');

  const empezoHace1h = partido(3, antes(1));
  avisos = avisosDeSeguimiento({ seguimientos: [siguePartido(3)], partidos: [empezoHace1h], eventos: [], ahora: AHORA });
  assert.deepEqual(tipos(avisos), ['live', 'upcoming']);
  assert.equal(avisos.find((a) => a.type === 'live').at.getTime(), antes(1).getTime());
});

test('no enseña lo que pasó antes de que empezaras a seguir', () => {
  const p = partido(1, antes(1));
  // Empezó a seguirlo hace 90 minutos: el "próximo" (hace 2 h) ya había pasado.
  const avisos = avisosDeSeguimiento({ seguimientos: [siguePartido(1, antes(1.5))], partidos: [p], eventos: [], ahora: AHORA });
  assert.deepEqual(tipos(avisos), ['live']);
});

test('respeta las casillas; una casilla en NULL cuenta como marcada', () => {
  const p = partido(1, antes(1));
  let avisos = avisosDeSeguimiento({
    seguimientos: [siguePartido(1, undefined, { notify_upcoming: false, notify_live: null })],
    partidos: [p], eventos: [], ahora: AHORA,
  });
  assert.deepEqual(tipos(avisos), ['live']);

  avisos = avisosDeSeguimiento({
    seguimientos: [siguePartido(1, undefined, { notify_upcoming: false, notify_live: false })],
    partidos: [p], eventos: [], ahora: AHORA,
  });
  assert.deepEqual(avisos, []);
});

test('un partido que sigues directo Y por su equipo avisa una sola vez', () => {
  const p = partido(1, antes(1));
  const avisos = avisosDeSeguimiento({
    seguimientos: [siguePartido(1), sigueEquipo('Halcones', 7)],
    partidos: [p], eventos: [], ahora: AHORA,
  });
  assert.deepEqual(tipos(avisos), ['live', 'upcoming']);
});

test('basta con que UNO de los seguimientos que cubren el partido pida el aviso', () => {
  const p = partido(1, antes(1));
  const avisos = avisosDeSeguimiento({
    seguimientos: [
      siguePartido(1, undefined, { notify_live: false }),
      sigueEquipo('HALCONES', 7),
    ],
    partidos: [p], eventos: [], ahora: AHORA,
  });
  assert.ok(avisos.some((a) => a.type === 'live'));
});

test('seguir a un equipo: sin distinguir mayúsculas, dentro de su liga, o en cualquiera si no dice', () => {
  const p = partido(1, antes(1), { league_id: 7 });
  assert.equal(cubre(sigueEquipo('halcones', 7), p), true);
  assert.equal(cubre(sigueEquipo('HALCONES', 8), p), false, 'el mismo nombre en otra liga no es el mismo equipo');
  assert.equal(cubre(sigueEquipo('HALCONES', null), p), true, 'sin liga: un independiente que juega en varias');
  assert.equal(cubre(sigueEquipo('AGUILAS', 7), p), false);
  assert.equal(cubre({ match_id: null, team_name: null, league_id: 7 }, p), true, 'seguir la liga entera');
});

test('de los cambios de fecha o sede solo el último de cada partido', () => {
  const p = partido(1, despues(24 * 3));
  const eventos = [
    { id: 10, match_id: 1, type: 'schedule_change', at: antes(5), data: { date_changed: true } },
    { id: 11, match_id: 1, type: 'schedule_change', at: antes(2), data: { venue_changed: true } },
  ];
  const avisos = avisosDeSeguimiento({ seguimientos: [siguePartido(1)], partidos: [p], eventos, ahora: AHORA });
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].key, 'schedule_change-11');
  assert.deepEqual(avisos[0].data, { venue_changed: true });
});

test('el marcador final sale con su hora de captura y respeta su casilla', () => {
  const p = partido(1, antes(24 * 2));
  const eventos = [{ id: 20, match_id: 1, type: 'final_score', at: antes(3), data: null }];
  let avisos = avisosDeSeguimiento({ seguimientos: [siguePartido(1)], partidos: [p], eventos, ahora: AHORA });
  const final = avisos.find((a) => a.type === 'final_score');
  assert.equal(final.at.getTime(), antes(3).getTime(), 'la hora es la de captura, no la del partido');

  avisos = avisosDeSeguimiento({
    seguimientos: [siguePartido(1, undefined, { notify_final: false })], partidos: [p], eventos, ahora: AHORA,
  });
  assert.ok(!avisos.some((a) => a.type === 'final_score'));
});

test('nada de hace más de 30 días, y nada de un partido que no sigues', () => {
  const viejo = partido(1, antes(24 * 31));
  const ajeno = partido(2, antes(1));
  const avisos = avisosDeSeguimiento({
    seguimientos: [siguePartido(1, antes(24 * 60))], partidos: [viejo, ajeno], eventos: [], ahora: AHORA,
  });
  assert.deepEqual(avisos, []);
});

// ── 3. Lo nuevo ───────────────────────────────────────────────────────────

test('nuevo es después de lo visto y nunca en el futuro', () => {
  const visto = antes(2);
  assert.equal(esNuevo(antes(1), visto, AHORA), true);
  assert.equal(esNuevo(antes(2), visto, AHORA), false, 'justo en la marca ya se vio');
  assert.equal(esNuevo(antes(3), visto, AHORA), false);
  assert.equal(esNuevo(despues(1), visto, AHORA), false);
  assert.equal(contarNuevos([{ at: antes(1) }, { at: antes(3) }, { at: antes(0.5) }], visto, AHORA), 2);
});

test('juntarBandeja: lo más nuevo arriba, con tope', () => {
  const lista = juntarBandeja([[{ key: 'a', at: antes(3) }, { key: 'b', at: antes(1) }], [{ key: 'c', at: antes(2) }]], 2);
  assert.deepEqual(lista.map((a) => a.key), ['b', 'c']);
});
