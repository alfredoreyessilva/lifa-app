// Pruebas de lo que calcula el panel de un medio (utils/mediaPanel.js). Los
// partidos tienen la forma de PARTIDO_COLUMNAS (routes/broadcasts.js): el id del
// partido en `match_id`, los escudos ya resueltos y la ventana del estado
// automático de su categoría. Una transmisión trae además su `id` y su `url`; un
// partido de /upcoming, `broadcast_id` y `broadcast_url` si el medio ya está.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BROADCAST_FILTERS, annotate, broadcastGate, broadcastGroups, broadcastTotals, comingFigure, hasFollowLinks,
  hasLink, isMine, lacksLink, lastBroadcasts, linkPayload, matchContext, matchStage, mediaAttention, mediaHref, mediaProfileGaps,
  nextBroadcasts, pendingLinks, scheduleDays, scheduleFilters, scheduleOf, upcomingToJoin, validateLink,
} from '../../src/utils/mediaPanel.js';
import { countFilters } from '../../src/utils/adminPanel.js';
import { organizationHref, organizationsOf } from '../../src/utils/dashboard.js';

// Domingo 8 de noviembre de 2026, 2 p.m. en la Ciudad de México.
const AHORA = Date.parse('2026-11-08T20:00:00Z');
const HORA = 3600 * 1000;
const enHoras = (h) => new Date(AHORA + h * HORA).toISOString();

const partido = (matchId, extra = {}) => ({
  match_id: matchId, home_team: `LOCAL ${matchId}`, away_team: `VISITA ${matchId}`,
  home_team_id: matchId * 10, away_team_id: matchId * 10 + 1,
  match_date: enHoras(24), timezone: 'America/Mexico_City', status: 'scheduled',
  home_score: null, away_score: null, week_label: '5',
  category_name: 'COLEGIAL', auto_status_enabled: false, auto_status_window_hours: 3,
  league_id: 1, league_name: 'ONEFA', league_slug: 'onefa', league_timezone: 'America/Mexico_City',
  tournament_name: 'LIGA MAYOR', tournament_year: 2026,
  home_logo_url: 'https://img.test/l.png', away_logo_url: 'https://img.test/v.png',
  phase_name: null, phase_type: 'round_robin', ...extra,
});
const transmision = (id, extra = {}) => ({ id, url: `https://youtube.com/live/${id}`, ...partido(100 + id, extra), ...extra });

const medio = (extra = {}) => ({
  id: 106, type: 'media', name: 'ESPN Mx', logo_url: 'https://img.test/espn.png',
  description: 'Fútbol americano colegial', is_public: true, is_verified: true,
  facebook_url: null, instagram_url: null, youtube_url: 'https://youtube.com/@espnmx', tiktok_url: null,
  website_url: null, contact_phone: null, contact_email: null, cover_url: null, ...extra,
});

/* ---------- Si puede transmitir ---------- */

test('puede transmitir solo publicado Y verificado, como puedeTransmitir del backend', () => {
  assert.deepEqual(broadcastGate(medio()), { on: true, tone: 'on', label: 'Listo', sub: 'Publicado y verificado' });
  assert.equal(broadcastGate(medio({ is_public: false })).sub, 'Falta que CFBAMX te publique');
  assert.equal(broadcastGate(medio({ is_verified: false })).sub, 'Falta que CFBAMX te verifique');
  assert.equal(broadcastGate(medio({ is_public: false, is_verified: false })).sub, 'Falta que CFBAMX te publique y te verifique');
});

test('falla cerrado: sin los dos campos, o con algo que no es true, no puede', () => {
  assert.equal(broadcastGate({}).on, false);
  assert.equal(broadcastGate(null).on, false);
  assert.equal(broadcastGate(medio({ is_public: 'true' })).on, false);
  assert.equal(broadcastGate(medio()).tone, 'on');
  assert.equal(broadcastGate({}).tone, 'off', 'no va en amarillo: no es algo que el medio arregle');
});

/* ---------- Su ficha ---------- */

test('a su ficha le falta el logo, la descripción o dónde seguirlo', () => {
  assert.deepEqual(mediaProfileGaps(medio()), []);
  assert.deepEqual(
    mediaProfileGaps(medio({ logo_url: null, description: '  ', youtube_url: null })),
    ['el logo', 'la descripción', 'dónde seguirte'],
  );
});

test('dónde seguirlo es una red o su sitio; el teléfono y el correo no cuentan', () => {
  const soloContacto = medio({ youtube_url: null, contact_phone: '998 123 4567', contact_email: 'a@b.mx' });
  assert.equal(hasFollowLinks(soloContacto), false);
  assert.deepEqual(mediaProfileGaps(soloContacto), ['dónde seguirte']);
  assert.equal(hasFollowLinks(medio({ youtube_url: null, website_url: 'https://medio.mx' })), true);
  assert.equal(hasFollowLinks(medio({ youtube_url: null, tiktok_url: 'https://tiktok.com/@m' })), true);
  assert.deepEqual(mediaProfileGaps(null), []);
});

/* ---------- En qué va un partido ---------- */

test('en qué va un partido, con la cuenta del panel de una liga', () => {
  assert.equal(matchStage(partido(1), AHORA), 'upcoming');
  assert.equal(matchStage(partido(1, { status: 'live' }), AHORA), 'live');
  assert.equal(matchStage(partido(1, { status: 'finished' }), AHORA), 'past');
  assert.equal(matchStage(partido(1, { match_date: null }), AHORA), 'upcoming', 'sin fecha, todavía viene');
  // Sin estado automático: a las 2 h sigue "programado"; a las 5 h ya debió terminar.
  assert.equal(matchStage(partido(1, { match_date: enHoras(-2) }), AHORA), 'upcoming');
  assert.equal(matchStage(partido(1, { match_date: enHoras(-5) }), AHORA), 'past');
  // Con estado automático, la ventana de su categoría decide.
  const auto = { auto_status_enabled: true, auto_status_window_hours: 3 };
  assert.equal(matchStage(partido(1, { ...auto, match_date: enHoras(-1) }), AHORA), 'live');
  assert.equal(matchStage(partido(1, { ...auto, match_date: enHoras(-3.5) }), AHORA), 'past');
});

test('de dónde es un partido: liga, torneo y ronda, como los dice el calendario', () => {
  // En un teléfono el renglón se parte: el número va pegado a "Jornada", y cada punto a lo
  // que lo antecede, para que ninguno abra un renglón.
  const NBSP = String.fromCharCode(0xa0);
  const junta = (...partes) => partes.join(`${NBSP}· `);
  assert.equal(matchContext(partido(1)), junta('ONEFA', 'LIGA MAYOR 2026', `Jornada${NBSP}5`));
  assert.equal(matchContext(partido(1, { week_label: '12' })).endsWith(`Jornada${NBSP}12`), true);
  assert.equal(matchContext(partido(1, { week_label: 'PLAYOFF', phase_name: 'Cuartos de final', phase_type: 'single_elimination' })),
    junta('ONEFA', 'LIGA MAYOR 2026', 'PLAYOFFS'));
  assert.equal(matchContext(partido(1, { week_label: null, phase_name: 'Semifinales', phase_type: 'single_elimination' })),
    junta('ONEFA', 'LIGA MAYOR 2026', 'Semifinales'));
  assert.equal(matchContext(partido(1, { tournament_name: null, tournament_year: null, week_label: null })), 'ONEFA');
  assert.equal(/ ·/.test(matchContext(partido(1))), false, 'ningún punto queda después de un espacio que se parte');
});

/* ---------- Sus transmisiones ---------- */

test('"Sin link" cuenta solo lo que viene: a lo ya jugado ya no le urge', () => {
  const [conLink, sinLink, espacios, jugada] = annotate([
    transmision(1),
    transmision(2, { url: null }),
    transmision(3, { url: '   ' }),
    transmision(4, { url: null, status: 'finished', match_date: enHoras(-48) }),
  ], AHORA);
  assert.equal(hasLink(conLink), true);
  assert.equal(lacksLink(conLink), false);
  assert.equal(lacksLink(sinLink), true);
  assert.equal(lacksLink(espacios), true, 'un link de puros espacios no es link');
  assert.equal(lacksLink(jugada), false);
  assert.equal(hasLink(jugada), false, 'aunque la tabla sí dice que no tiene');
});

test('las celdas de Transmisiones filtran, y "En vivo" sale solo si hay', () => {
  const filas = annotate([
    transmision(1),
    transmision(2, { url: null }),
    transmision(3, { status: 'finished', match_date: enHoras(-48) }),
    transmision(4, { url: null, status: 'finished', match_date: enHoras(-72) }),
  ], AHORA);
  const celdas = countFilters(BROADCAST_FILTERS, filas, 'todas');
  assert.deepEqual(celdas.map((c) => [c.key, c.count]),
    [['todas', 4], ['proximas', 2], ['transmitidas', 2], ['sin-link', 1]]);
  const conVivo = annotate([...filas, transmision(5, { status: 'live', match_date: enHoras(-1) })], AHORA);
  assert.equal(countFilters(BROADCAST_FILTERS, conVivo).find((c) => c.key === 'en-vivo').count, 1);
});

test('la tabla va en tramos: en vivo, lo que viene (sin fecha al final) y lo transmitido, de lo reciente a lo viejo', () => {
  const filas = annotate([
    transmision(1, { match_date: enHoras(72) }),
    transmision(2, { match_date: null }),
    transmision(3, { match_date: enHoras(24) }),
    transmision(4, { status: 'finished', match_date: enHoras(-200) }),
    transmision(5, { status: 'live', match_date: enHoras(-1) }),
    transmision(6, { status: 'finished', match_date: enHoras(-30) }),
  ], AHORA);
  const tramos = broadcastGroups(filas);
  assert.deepEqual(tramos.map((t) => [t.key, t.rows.map((b) => b.id)]),
    [['live', [5]], ['upcoming', [3, 1, 2]], ['past', [6, 4]]]);
  assert.deepEqual(nextBroadcasts(filas, 3).map((b) => b.id), [5, 3, 1]);
  assert.deepEqual(lastBroadcasts(filas, 3).map((b) => b.id), [6, 4], 'lo último que transmitió, de lo reciente a lo viejo');
  assert.deepEqual(lastBroadcasts(annotate([transmision(1)], AHORA)), [], 'sin nada jugado, nada');
  assert.deepEqual(broadcastGroups([]), [], 'un tramo vacío no sale');
});

test('la celda "Próximas": lo que está en vivo manda, si no cuándo sigue', () => {
  const vivo = broadcastTotals(annotate([transmision(1, { status: 'live', match_date: enHoras(-1) }), transmision(2)], AHORA), AHORA);
  assert.deepEqual(comingFigure(vivo), { value: '2', sub: '1 en vivo' });

  // 15 de noviembre a las 11 a.m. de la Ciudad de México: un domingo.
  const proxima = broadcastTotals(annotate([transmision(1, { match_date: '2026-11-15T17:00:00Z' })], AHORA), AHORA);
  assert.deepEqual(comingFigure(proxima), { value: '1', sub: 'Sigue el Dom 15 nov' });

  const sinFecha = broadcastTotals(annotate([transmision(1, { match_date: null })], AHORA), AHORA);
  assert.deepEqual(comingFigure(sinFecha), { value: '1', sub: 'Con fecha por definir' });

  const nada = broadcastTotals(annotate([transmision(1, { status: 'finished', match_date: enHoras(-48) })], AHORA), AHORA);
  assert.deepEqual(comingFigure(nada), { value: '0', sub: null });
  assert.equal(nada.past, 1);
  assert.deepEqual(comingFigure(null), { value: null, sub: null }, 'mientras carga');
});

/* ---------- Lo que se juega ---------- */

test('lo que se juega quita al leer lo que ya terminó por el reloj de su categoría', () => {
  const llega = [
    partido(1, { match_date: enHoras(-5) }),
    partido(2, { match_date: enHoras(-1), auto_status_enabled: true }),
    partido(3, { match_date: enHoras(30) }),
    partido(4, { match_date: null }),
  ];
  assert.deepEqual(scheduleOf(llega, AHORA).map((m) => [m.match_id, m.stage]),
    [[2, 'live'], [3, 'upcoming'], [4, 'upcoming']]);
});

test('lo que se juega va por fecha aunque llegue desordenado, sin mover a los que empatan', () => {
  const llega = [
    partido(1, { match_date: null }),
    partido(2, { match_date: enHoras(50) }),
    partido(3, { match_date: enHoras(20), league_name: 'LFA' }),
    partido(4, { match_date: enHoras(20), league_name: 'ONEFA' }),
    partido(5, { match_date: null }),
  ];
  assert.deepEqual(scheduleOf(llega, AHORA).map((m) => m.match_id), [3, 4, 2, 1, 5]);
});

test('una celda por liga solo si hay más de una, por abecedario, y "Ya transmites" si ya está en alguno', () => {
  const unaLiga = scheduleFilters([partido(1), partido(2)]);
  assert.deepEqual(countFilters(unaLiga, [partido(1), partido(2)]).map((c) => c.key), ['todos']);

  const filas = [
    partido(1),
    partido(2, { league_id: 9, league_name: 'LFA' }),
    partido(3, { broadcast_id: 77, broadcast_url: null }),
  ];
  const celdas = countFilters(scheduleFilters(filas), filas);
  assert.deepEqual(celdas.map((c) => [c.label, c.count]),
    [['Partidos', 3], ['LFA', 1], ['ONEFA', 2], ['Ya transmites', 1]]);
  assert.equal(isMine(filas[2]), true);
  assert.deepEqual(upcomingToJoin(filas).map((m) => m.match_id), [1, 2], '"Se juega pronto" es lo que todavía no transmite');
});

test('por día, en la zona de cada partido, con lo que no tiene fecha al final', () => {
  const filas = [
    // 23:30 del sábado en la Ciudad de México, aunque en UTC ya sea domingo.
    partido(1, { match_date: '2026-11-15T05:30:00Z' }),
    partido(2, { match_date: '2026-11-15T17:00:00Z' }),
    partido(3, { match_date: '2026-11-15T20:00:00Z', timezone: 'America/Tijuana' }),
    partido(4, { match_date: null }),
    partido(5, { match_date: null }),
  ];
  const dias = scheduleDays(filas, AHORA);
  assert.deepEqual(dias.map((d) => [d.label, d.rows.map((m) => m.match_id), d.tbd]), [
    ['Sábado 14 de noviembre', [1], false],
    ['Domingo 15 de noviembre', [2, 3], false],
    ['Fecha por definir', [4, 5], true],
  ]);
});

/* ---------- Lo que le toca ---------- */

test('lo que le toca: lo que viene sin link, y lo que le falta a su ficha', () => {
  const filas = annotate([
    transmision(1, { url: null }),
    transmision(2, { url: null, match_date: null }),
    transmision(3),
    transmision(4, { url: null, status: 'finished', match_date: enHoras(-48) }),
  ], AHORA);
  const items = mediaAttention(medio({ description: null, youtube_url: null }), filas);
  assert.deepEqual(items.map((i) => [i.key, i.text, i.to]), [
    ['sin-link', '2 transmisiones por venir no tienen link', '/panel/medio/106?seccion=transmisiones&filtro=sin-link'],
    ['perfil', 'A tu ficha le falta la descripción y dónde seguirte', '/panel/medio/106?seccion=perfil'],
  ]);
  assert.equal(mediaAttention(medio(), annotate([transmision(1, { url: null })], AHORA))[0].text,
    '1 transmisión por venir no tiene link');
  assert.deepEqual(mediaAttention(medio(), annotate([transmision(3)], AHORA)), [], 'con todo en orden, nada');
  assert.equal(pendingLinks(medio(), filas), 2);
});

test('sin poder transmitir, lo que viene sin link no le toca: el backend no le deja ponerlo', () => {
  const filas = annotate([transmision(1, { url: null }), transmision(2, { url: null })], AHORA);
  const sinVerificar = medio({ is_verified: false });
  assert.equal(pendingLinks(sinVerificar, filas), 0);
  assert.equal(pendingLinks(medio({ is_public: false }), filas), 0);
  assert.deepEqual(mediaAttention(sinVerificar, filas).map((i) => i.key), [], 'ni en lo que te toca');
  assert.equal(broadcastTotals(filas, AHORA).noLink, 2, 'pero se siguen contando');
  assert.equal(pendingLinks(medio(), null), 0, 'mientras carga, cero');
});

test('la sección y el filtro viven en la dirección', () => {
  assert.equal(mediaHref(106), '/panel/medio/106');
  assert.equal(mediaHref(106, 'resumen'), '/panel/medio/106');
  assert.equal(mediaHref(106, 'partidos'), '/panel/medio/106?seccion=partidos');
  assert.equal(mediaHref(106, 'transmisiones', 'sin-link'), '/panel/medio/106?seccion=transmisiones&filtro=sin-link');
});

/* ---------- El link ---------- */

test('el link es opcional, y si va, con la regla del backend: http o https', () => {
  assert.equal(validateLink(''), null);
  assert.equal(validateLink('   '), null);
  assert.equal(validateLink(null), null);
  assert.equal(validateLink('https://youtube.com/live/abc'), null);
  assert.equal(validateLink('  https://fb.watch/x  '), null);
  assert.match(validateLink('youtube.com/live/abc'), /^El link no es una dirección web válida/);
  assert.match(validateLink('ftp://medio.mx/video'), /^El link debe ser una dirección web válida/);
  assert.equal(linkPayload('  https://fb.watch/x  '), 'https://fb.watch/x');
  assert.equal(linkPayload('   '), null, 'vacío se guarda sin link');
  assert.equal(linkPayload(undefined), null);
});

/* ---------- A dónde lleva cada organización ---------- */

test('una tienda y un medio abren su panel; una clínica o una marca, su formulario', () => {
  assert.equal(organizationHref({ id: 99, type: 'store' }), '/panel/tienda/99');
  assert.equal(organizationHref({ id: 106, type: 'media' }), '/panel/medio/106');
  assert.equal(organizationHref({ id: 7, type: 'clinic' }), '/panel/organizacion/7?edit=1');
  assert.equal(organizationHref({ id: 8, type: 'brand' }), '/panel/organizacion/8?edit=1');
  const fichas = organizationsOf({ organizations: [{ id: 106, type: 'media', name: 'ESPN Mx' }] });
  assert.equal(fichas[0].href, '/panel/medio/106', 'la ficha de Mi panel también');
});
