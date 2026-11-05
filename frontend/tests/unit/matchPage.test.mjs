// La página de un partido: la pintura que sale del logo, cómo se escribe la
// fecha y la cuenta regresiva, y los renglones de "Cara a cara".

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PINTURA_NEUTRA, contraste, esHex, leerLogo, pinturaDeZona, tintaSobre,
} from '../../src/utils/teamPaint.js';
import {
  centroDelPartido, cuentaRegresiva, detalleDelPartido, fechaLarga, partirHora,
  plataformaDe, rondaDelPartido, sedeDelPartido, torneoDelPartido,
} from '../../src/utils/matchDisplay.js';
import { filasCaraACara, lineaDelEquipo, ordinal, rachaLabel } from '../../src/utils/matchCompare.js';

// Un cuadro de lado × lado con pixeles [r, g, b, a].
const cuadro = (lado, pixel) => {
  const datos = new Uint8ClampedArray(lado * lado * 4);
  for (let i = 0; i < lado * lado; i++) datos.set(pixel(i), i * 4);
  return datos;
};
const VACIO = [0, 0, 0, 0];

test('leerLogo: un casco tiene las esquinas vacías y deja ver el pasto', () => {
  const rojo = [200, 20, 30, 255];
  // Solo cuatro pixeles de color: las esquinas y las orillas quedan vacías.
  const datos = cuadro(4, (i) => ([5, 6, 9, 10].includes(i) ? rojo : VACIO));
  const { color, forma } = leerLogo(datos, 4);
  assert.equal(color, '#c8141e');
  assert.equal(forma, 'casco');
});

test('leerLogo: una placa de esquinas redondeadas va directo, pero no es un casco', () => {
  const azul = [40, 120, 190, 255];
  const lado = 8;
  const esquinas = [0, 7, 56, 63];
  const datos = cuadro(lado, (i) => (esquinas.includes(i) ? VACIO : azul));
  assert.equal(leerLogo(datos, lado).forma, 'placa');
});

test('leerLogo: un logo con fondo propio va en disco, aunque tenga color', () => {
  const datos = cuadro(4, () => [40, 120, 190, 255]);
  assert.equal(leerLogo(datos, 4).forma, 'disco');
});

test('leerLogo: el blanco, el negro y el gris del casco no son el color del equipo', () => {
  const pixeles = [[255, 255, 255, 255], [0, 0, 0, 255], [128, 128, 128, 255], [130, 126, 124, 255]];
  const datos = cuadro(2, (i) => pixeles[i]);
  assert.equal(leerLogo(datos, 2).color, null);
});

test('leerLogo: el rojo le gana al rosa del filo aunque el filo ocupe lo mismo', () => {
  const rojo = [205, 25, 35, 255];
  const rosa = [226, 170, 170, 255];
  const hex = leerLogo(cuadro(2, (i) => (i < 2 ? rojo : rosa)), 2).color;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  assert.ok(r > 190 && g < 80, `salió ${hex}`);
});

test('pinturaDeZona: lo oscuro lleva letra clara y lo amarillo, letra oscura', () => {
  assert.equal(pinturaDeZona('#0a2a6e').tinta, '#ffffff');
  assert.equal(pinturaDeZona('#b4930d').tinta, '#15120a');
});

test('pinturaDeZona: el nombre pintado siempre se lee', () => {
  for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffffff', '#000000', '#7f7f7f', '#d78078']) {
    const { fondo, tinta } = pinturaDeZona(hex);
    assert.ok(contraste(fondo, tinta) >= 4.5, `${hex} → ${fondo} con ${tinta}`);
  }
});

test('pinturaDeZona: un gris se queda gris, no sale rojo por el tono 0', () => {
  const { fondo } = pinturaDeZona('#808080');
  const [r, g, b] = [fondo.slice(1, 3), fondo.slice(3, 5), fondo.slice(5, 7)].map((h) => parseInt(h, 16));
  assert.equal(r, g);
  assert.equal(g, b);
});

test('tintaSobre y la pintura neutra', () => {
  assert.equal(tintaSobre('#000000'), '#ffffff');
  assert.equal(tintaSobre('#ffffff'), '#15120a');
  assert.ok(contraste(PINTURA_NEUTRA.fondo, PINTURA_NEUTRA.tinta) >= 4.5);
});

test('esHex: solo lo que el formulario del equipo puede guardar', () => {
  assert.equal(esHex('#08b0e7'), true);
  assert.equal(esHex('rojo'), false);
  assert.equal(esHex(''), false);
  assert.equal(esHex(null), false);
});

test('fechaLarga: en la zona del partido, no en la de quien mira', () => {
  const hoy = Date.parse('2026-11-04T12:00:00.000Z');
  // 02:00 UTC del sábado sigue siendo viernes en la Ciudad de México.
  assert.equal(fechaLarga('2026-11-07T02:00:00.000Z', 'America/Mexico_City', hoy), 'Viernes 6 de noviembre');
  assert.equal(fechaLarga(null, 'America/Mexico_City', hoy), '');
});

test('fechaLarga: el año solo se dice si no es el de hoy', () => {
  const hoy = Date.parse('2026-11-04T12:00:00.000Z');
  assert.equal(fechaLarga('2024-06-08T01:00:00.000Z', 'America/Mexico_City', hoy), 'Viernes 7 de junio de 2024');
});

test('rondaDelPartido: la jornada, o la fase cuando la etiqueta no dice nada', () => {
  assert.equal(rondaDelPartido({ week_label: '5', phase_name: 'Temporada regular', phase_type: 'groups' }), 'Jornada 5');
  assert.equal(rondaDelPartido({ week_label: 'PLAYOFF', phase_name: 'Cuartos de final', phase_type: 'single_elimination' }), 'Cuartos de final');
  assert.equal(rondaDelPartido({ week_label: 'FINAL', phase_name: 'Postemporada', phase_type: 'single_elimination' }), 'FINAL');
  assert.equal(rondaDelPartido({ week_label: 'PLAYOFF', phase_name: null, phase_type: 'single_elimination' }), 'PLAYOFF');
  assert.equal(rondaDelPartido({ week_label: null, phase_name: 'Repechaje', phase_type: 'round_robin' }), 'Repechaje');
  assert.equal(rondaDelPartido({ week_label: null, phase_name: null }), '');
});

test('partirHora: separa la cifra del "p.m.", con el espacio que venga', () => {
  assert.deepEqual(partirHora('6:00 p.m.'), { cifra: '6:00', sufijo: 'p.m.' });
  assert.deepEqual(partirHora('12:30 a.m.'), { cifra: '12:30', sufijo: 'a.m.' });
  assert.deepEqual(partirHora(''), { cifra: '', sufijo: '' });
});

test('cuentaRegresiva: reparte lo que falta y calla cuando ya pasó', () => {
  const ahora = Date.parse('2026-11-04T00:00:00.000Z');
  assert.deepEqual(cuentaRegresiva('2026-11-06T03:15:30.000Z', ahora), { dias: 2, horas: 3, minutos: 15, segundos: 30 });
  assert.equal(cuentaRegresiva('2026-11-03T00:00:00.000Z', ahora), null);
  assert.equal(cuentaRegresiva('2026-11-04T00:00:00.000Z', ahora), null);
  assert.equal(cuentaRegresiva(null, ahora), null);
});

test('plataformaDe: nombra las conocidas y deja el dominio de las demás', () => {
  assert.equal(plataformaDe('https://www.youtube.com/watch?v=x'), 'YouTube');
  assert.equal(plataformaDe('https://m.youtube.com/live/x'), 'YouTube');
  assert.equal(plataformaDe('https://youtu.be/x'), 'YouTube');
  assert.equal(plataformaDe('https://www.facebook.com/video'), 'Facebook');
  assert.equal(plataformaDe('https://www.eventbrite.com.mx/e/1'), 'Eventbrite');
  assert.equal(plataformaDe('https://live.tec.mx/x'), 'live.tec.mx');
  assert.equal(plataformaDe('no es un link'), 'link');
});

// Lo que sigue lo comparten la portada y la imagen para compartir.
test('detalleDelPartido: la conferencia, y la categoría con su rama', () => {
  const partido = { conference_name: '14 GRANDES', category_name: 'COLEGIAL UNIVERSITARIO', branch_name: 'Varonil' };
  assert.equal(detalleDelPartido(partido), '14 GRANDES, COLEGIAL UNIVERSITARIO Varonil');
  assert.equal(detalleDelPartido({ category_name: 'PROFESIONAL' }), 'PROFESIONAL');
  assert.equal(detalleDelPartido({}), '');
});

test('torneoDelPartido: el año solo si lo hay', () => {
  assert.equal(torneoDelPartido({ tournament_name: 'LIGA MAYOR', tournament_year: 2026 }), 'LIGA MAYOR 2026');
  assert.equal(torneoDelPartido({ tournament_name: 'TAZÓN' }), 'TAZÓN');
  assert.equal(torneoDelPartido({}), '');
});

test('sedeDelPartido: sin sede registrada, el texto libre del partido', () => {
  assert.equal(sedeDelPartido({ venue_name: 'WILFRIDO MASSIEU', venue_city: 'CDMX', venue: 'otra' }), 'WILFRIDO MASSIEU, CDMX');
  assert.equal(sedeDelPartido({ venue: 'ESTADIO OLÍMPICO UACH' }), 'ESTADIO OLÍMPICO UACH');
  assert.equal(sedeDelPartido({}), '');
});

const conFecha = {
  match_date: '2026-11-07T18:00:00.000Z',
  timezone: 'America/Mexico_City',
  home_score: null,
  away_score: null,
};
const partesConFecha = { time: '12:00 p.m.', tzLabel: 'Hora Centro MX', porDefinir: false };

test('centroDelPartido: antes de jugarse es la hora', () => {
  const centro = centroDelPartido(conFecha, 'scheduled', partesConFecha);
  assert.equal(centro.momento, 'hora');
  assert.equal(centro.cifra, '12:00');
  assert.equal(centro.sufijo, 'p.m.');
  assert.equal(centro.zona, 'Hora Centro MX');
  assert.match(centro.fecha, /^Sábado 7 de noviembre/);
});

test('centroDelPartido: sin fecha lo dice, en vez de una hora inventada', () => {
  const centro = centroDelPartido({ ...conFecha, match_date: null }, 'scheduled', { porDefinir: true });
  assert.deepEqual(centro, { momento: 'porDefinir', fecha: 'Fecha por definir' });
});

test('centroDelPartido: en vivo y al terminar dice si ya hay marcador, y un 0 es marcador', () => {
  assert.equal(centroDelPartido(conFecha, 'live', partesConFecha).hayMarcador, false);
  assert.equal(centroDelPartido(conFecha, 'finished', partesConFecha).hayMarcador, false);
  const terminado = centroDelPartido({ ...conFecha, home_score: 21, away_score: 0 }, 'finished', partesConFecha);
  assert.equal(terminado.momento, 'finished');
  assert.equal(terminado.hayMarcador, true);
});

const equipo = (extra = {}) => ({
  team_id: 1,
  wins: 6,
  losses: 2,
  ties: 0,
  played: 8,
  points_for: 240,
  points_against: 120,
  home_record: { wins: 4, losses: 0, ties: 0 },
  away_record: { wins: 2, losses: 2, ties: 0 },
  streak: 'G3',
  places: [{ level: 'conference', scope_name: 'NACIONAL', rank: 2, of: 19 }],
  recent: [],
  ...extra,
});

test('ordinal y racha', () => {
  assert.equal(ordinal(3), '3.º');
  assert.equal(rachaLabel('G3'), '3 ganados');
  assert.equal(rachaLabel('P1'), '1 perdido');
  assert.equal(rachaLabel('E1'), '1 empatado');
  assert.equal(rachaLabel(null), '—');
});

test('filasCaraACara: marca quién va mejor, con menos puntos permitidos como ventaja', () => {
  const filas = filasCaraACara(equipo(), equipo({
    wins: 3,
    losses: 5,
    points_for: 160,
    points_against: 200,
    places: [{ level: 'conference', scope_name: 'NACIONAL', rank: 11, of: 19 }],
  }));
  const de = (k) => filas.find((f) => f.key === k);
  assert.equal(de('record').home, '6-2');
  assert.equal(de('record').lead, 'home');
  assert.equal(de('lugar-conference').label, 'Lugar en NACIONAL');
  assert.equal(de('lugar-conference').lead, 'home');
  assert.equal(de('anotados').home, '30.0');
  assert.equal(de('permitidos').away, '25.0');
  assert.equal(de('permitidos').lead, 'home');
});

test('filasCaraACara: en tablas distintas no hay ventaja que marcar', () => {
  const filas = filasCaraACara(
    equipo({ places: [{ level: 'group', scope_name: 'BAJÍO', rank: 2, of: 6 }] }),
    equipo({ places: [{ level: 'group', scope_name: 'CENTRO', rank: 3, of: 7 }] }),
  );
  const lugar = filas.find((f) => f.key === 'lugar-group');
  assert.equal(lugar.home, '2.º en BAJÍO');
  assert.equal(lugar.lead, null);
});

test('filasCaraACara: un empate no marca a nadie, y sin juegos no hay sección', () => {
  const filas = filasCaraACara(equipo(), equipo());
  assert.equal(filas.find((f) => f.key === 'record').lead, null);
  const cero = equipo({ wins: 0, losses: 0, played: 0, points_for: 0, points_against: 0, places: [] });
  assert.deepEqual(filasCaraACara(cero, cero), []);
  assert.deepEqual(filasCaraACara(null, equipo()), []);
});

test('filasCaraACara: al que no ha jugado no se le inventa un promedio', () => {
  const cero = equipo({ wins: 0, losses: 0, played: 0, points_for: 0, points_against: 0, places: [] });
  const anotados = filasCaraACara(equipo(), cero).find((f) => f.key === 'anotados');
  assert.equal(anotados.away, '—');
  assert.equal(anotados.lead, null);
});

test('lineaDelEquipo: récord y el lugar de la tabla más específica', () => {
  const lado = equipo({
    places: [
      { level: 'conference', scope_name: 'NACIONAL', rank: 3, of: 19 },
      { level: 'group', scope_name: 'BAJÍO', rank: 1, of: 6 },
    ],
  });
  assert.equal(lineaDelEquipo(lado), '6-2, 1.º en BAJÍO');
  assert.equal(lineaDelEquipo(equipo({ places: [{ level: 'branch', scope_name: null, rank: 4, of: 7 }] })), '6-2, 4.º');
  assert.equal(lineaDelEquipo(equipo({ places: [] })), '6-2');
});

test('lineaDelEquipo: sin juegos no dice nada', () => {
  assert.equal(lineaDelEquipo(equipo({ played: 0, wins: 0, losses: 0 })), '');
  assert.equal(lineaDelEquipo(null), '');
});
