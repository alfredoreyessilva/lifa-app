// La imagen del bracket de los playoffs de una conferencia: un bracket clásico sobre la
// misma cancha de pie de la imagen de la tabla. README, "La imagen del bracket".
//
// Cada partido es una caja de dos renglones, con los marcadores uno encima del otro,
// que es lo que se viene a leer. Sigue en espejo: la mitad del 1 a la izquierda, la del
// 2 a la derecha y la final al centro, sobre la yarda 50. Cinco columnas de cajas no
// caben en una imagen vertical con un nombre legible, pero los cruces de una mitad
// tampoco comparten altura: van en una sola columna ancha, y cada ronda queda en el
// recodo del corchete que une a la anterior.
//
// Mismo principio que las otras tarjetas: todo lo que dice viene tal cual de GET
// /leagues/branches/:id/bracket —la siembra, los cruces reacomodados, los marcadores
// y el campeón ya los resolvió el backend—; aquí solo se dibuja, con canvas 2D en el
// navegador de quien la pide. El acomodo en espejo y cómo se escribe cada cruce salen
// de utils/bracketFormat.js, el mismo archivo que usa la página.

import {
  FORMATS, readTheme, ensureFonts, loadImage, loadImageWithin, ellipsize,
  BRAND_LOGO_SRC,
} from './shareCardCommon.js';
import {
  NOCHE, CAL, GRIS, GOL, letra, ponerLetra, escribir, medir, tallaQueCabe, altoDeLetra,
  dibujarCasco, dibujarMarca, dibujarFranjas, dibujarEndZones, dibujarLineasDeYarda, dibujarBandas, dibujarCabecera,
  ARRIBA, ZONA_ABAJO, ALTO_MARCA, MARGEN, BANDA, ORILLA, PADDING_ZONA, CASCO_DE_PORTADA,
} from './shareCardField.js';
import { imagenAjustada } from './imagenes.js';
import { pinturaDelLogo } from './useTeamPaint.js';
import { cutoffLabel, splitName, tableDetail } from './standingsFormat.js';
import {
  mirrorColumns, roundShortName, gameStatus, playedDay, hasTiedSeeds, logoForSide,
} from './bracketFormat.js';

// Un escudo que no llega en este tiempo sale con iniciales: una imagen con un
// logo de menos es mejor que un botón que se queda en "Generando imagen…".
const LOGO_TIMEOUT_MS = 8000;

// El alto mínimo de la end zone de arriba, la del título.
const ZONA_ARRIBA = { post: 214, story: 310 };
// Una franja no pasa de esto: el ancho no crece en una historia, así que más alto ya
// no lleva nada más grande sino aire. Lo que sobra es de las end zones.
const FRANJA_MAXIMA = 160;
const FRANJAS_MINIMAS = 8;

// Lo que separa a las cajas de las líneas de gol y entre ellas, como mínimo.
const AIRE_CANCHA = 24;
const HUECO_MINIMO = 12;
// La tira de arriba de una caja, con la ronda y la fecha, y el renglón de cada equipo.
const ALTO_TIRA = { post: 34, story: 38 };
const RENGLON_MAXIMO = { post: 100, story: 118 };
// Lo que hay entre dos columnas: ahí corre el corchete.
const HUECO_COLUMNAS = 22;
const CENTRO_SOLO = 420;

const LINEA = 3;
const BORDE = 2;
const DIVISION = 2;
const PADDING_CAJA = 7;
const SEPARACION_CASCO = 6;
const BARRA_GANADOR = 6;
// La copa y lo que la separa de la final.
const COPA_MAXIMA = 136;
const AIRE_COPA = 18;

const YARDA_DE_FONDO = 'rgba(255, 255, 255, 0.11)';
const PLACA = 'rgba(8, 28, 17, 0.92)';
const PLACA_VACIA = 'rgba(8, 28, 17, 0.5)';
const CELDA_MARCADOR = 'rgba(255, 255, 255, 0.07)';
const DIVISOR = 'rgba(243, 246, 241, 0.24)';
const LINEA_VACIA = 'rgba(243, 246, 241, 0.6)';
const LIVE = '#ff5252';
const LIVE_EN_TIRA = '#c62828';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// ── Las medidas ──

// La cancha llena lo que dejan las end zones; si una franja llega a su tope, lo que
// sobra se lo quedan las dos. Franjas y end zones suman exactamente el alto. `rondas`
// son las que hay antes de la final, y `filas`, cuántas cajas van una debajo de otra
// en cada mitad.
export function geometria(formatKey, h, rondas) {
  const tira = ALTO_TIRA[formatKey];
  const franjas = Math.max(FRANJAS_MINIMAS, 2 ** (rondas + 1));
  const cancha = h - ZONA_ARRIBA[formatKey] - ZONA_ABAJO[formatKey];
  const franja = Math.floor(Math.min((FRANJA_MAXIMA * FRANJAS_MINIMAS) / franjas, cancha / franjas));
  const alto = franja * franjas;
  const zonaAbajo = ZONA_ABAJO[formatKey] + Math.floor((cancha - alto) * 0.4);
  const zonaArriba = h - zonaAbajo - alto;

  const filas = Math.max(1, 2 ** rondas - 1);
  const porCaja = (alto - AIRE_CANCHA * 2 - HUECO_MINIMO * (filas - 1)) / filas;
  const renglon = Math.floor(Math.min(RENGLON_MAXIMO[formatKey], (porCaja - tira) / 2));
  return {
    arriba: ARRIBA[formatKey],
    cabeza: 0,
    tira, franjas, franja, alto, zonaArriba, zonaAbajo, filas, renglon,
    caja: tira + renglon * 2,
  };
}

// Tres columnas iguales: una por mitad y la final. Con más rondas el hueco crece, porque
// por ahí corre un corchete por cada una.
export function columnas(w, rondas) {
  if (!rondas) {
    const xCentro = (w - CENTRO_SOLO) / 2;
    return { ancho: CENTRO_SOLO, hueco: 0, xIzquierda: xCentro, xDerecha: xCentro, xCentro };
  }
  const hueco = HUECO_COLUMNAS + Math.max(0, rondas - 2) * 12;
  const ancho = Math.floor((w - ORILLA * 2 - hueco * 2) / 3);
  return { ancho, hueco, xIzquierda: ORILLA, xDerecha: w - ORILLA - ancho, xCentro: Math.round((w - ancho) / 2) };
}

// El centro de un cruce. Las rondas de una mitad se intercalan en una sola columna, como
// en el árbol de un bracket: cada cruce a media altura de los dos que lo alimentan, y
// la última ronda en la yarda 50, a la altura de la final.
export function centroDe(g, rondas, c, j) {
  if (g.filas === 1) return g.zonaArriba + g.alto / 2;
  const paso = (g.alto - AIRE_CANCHA * 2 - g.caja) / (g.filas - 1);
  return g.zonaArriba + AIRE_CANCHA + g.caja / 2 + ((2 * j + 1) * 2 ** c - 1) * paso;
}

// ── Las letras ──

// El nombre va en una línea si cabe; si no, en dos parejas: "PUMAS FES / ACATLÁN UNAM".
function lineasDeNombre(ctx, nombre, l, maxW) {
  if (medir(ctx, nombre, l) <= maxW) return [nombre];
  return splitName(nombre, (t) => medir(ctx, t, l));
}

// La letra más grande con la que caben TODOS los nombres, para que las cajas se vean
// parejas. El que ni a la mínima cabe no arrastra a los demás: se recorta.
function tallaDeNombres(ctx, nombres, maxW, base, min, letraDe) {
  const ocupa = (n, l) => Math.max(...lineasDeNombre(ctx, n, l, maxW).map((t) => medir(ctx, t, l)));
  const medibles = nombres.filter((n) => ocupa(n, letraDe(min)) <= maxW);
  let size = base;
  while (size > min && medibles.some((n) => ocupa(n, letraDe(size)) > maxW)) size -= 1;
  return size;
}

// Las letras de una caja. La siembra es chica y gris, y el marcador es lo más grande: son
// las dos cifras del renglón y no se pueden confundir. Las celdas miden lo que ocupa su
// cifra más ancha, igual que las columnas de la tabla, y el nombre se queda con el resto.
function piezaDe(ctx, cifras, ancho, renglon, theme) {
  const { nombres, siembras, marcadores } = cifras;
  const siembra = letra(600, Math.round(clamp(renglon * 0.22, 15, 22)), theme.fontEyebrow);
  const marcador = letra(400, Math.round(clamp(renglon * 0.46, 24, 46)), theme.fontDisplay);
  const anchoDe = (textos, l) => Math.ceil(Math.max(0, ...textos.map((t) => medir(ctx, t, l))));
  const anchoSiembra = anchoDe(siembras, siembra) + 8;
  const anchoMarcador = anchoDe(['00', ...marcadores], marcador) + 10 + BARRA_GANADOR;
  const casco = Math.round(Math.min(renglon - 14, ancho * 0.185));
  const anchoNombre = ancho - PADDING_CAJA * 2 - anchoSiembra - casco - SEPARACION_CASCO * 2 - anchoMarcador;

  const letraNombre = (size) => letra(400, size, theme.fontDisplay, 0.01);
  const talla = tallaDeNombres(ctx, nombres, anchoNombre, Math.round(clamp(renglon * 0.34, 16, 34)), 14, letraNombre);
  const nombre = letraNombre(talla);
  const altoNombre = altoDeLetra(ctx, nombre);
  return {
    nombre, siembra, marcador, casco, anchoSiembra, anchoMarcador, anchoNombre, altoNombre,
    interlinea: altoNombre + Math.round(talla * 0.24),
    altoSiembra: altoDeLetra(ctx, siembra),
    altoMarcador: altoDeLetra(ctx, marcador),
  };
}

// ── Un partido ──

const siembraDe = (p, tiedIds) => `${p.seed ?? '–'}${tiedIds.has(p.team_id) ? '*' : ''}`;
const llevaMarcador = (p) => Boolean(p) && p.score !== null && p.score !== undefined;

function estadoDe(p, game) {
  if (!p || !game?.winner_team_id) return '';
  return p.team_id === game.winner_team_id ? 'ganador' : 'perdedor';
}

// Lo que va en la tira de un cruce: "6 NOV · 3:00 P.M.", "EN VIVO", y el día en que se
// jugó: con el marcador a la vista, "FINAL" en cada caja solo estorba.
function fechaDelCruce(game) {
  const st = gameStatus(game);
  if (st.kind === 'bye' || st.kind === 'pending') return '';
  if (st.kind === 'unscheduled') return 'POR CONFIRMAR';
  return (st.kind === 'final' ? playedDay(game) || st.label : st.label).toUpperCase();
}

// Un cruce que todavía no se arma es una caja punteada con el nombre de su ronda. La
// final se llena de una en una, y esa ya no llega aquí: es una caja con un lugar vacío.
function dibujarCajaVacia(ctx, caja, { g, theme }) {
  const { x, y, w, ronda } = caja;
  const alto = g.caja;
  ctx.fillStyle = PLACA_VACIA;
  ctx.fillRect(x, y, w, alto);
  ctx.save();
  ctx.setLineDash([9, 8]);
  ctx.lineWidth = BORDE;
  ctx.strokeStyle = LINEA_VACIA;
  ctx.strokeRect(x + BORDE / 2, y + BORDE / 2, w - BORDE, alto - BORDE);
  ctx.restore();
  const l = letra(500, Math.round(clamp(g.renglon * 0.28, 16, 26)), theme.fontEyebrow, 0.06);
  escribir(ctx, ronda, x + w / 2, y + alto / 2 + altoDeLetra(ctx, l) / 2, l, GRIS);
}

// Un renglón: la siembra en la orilla, el casco, el nombre y el marcador en su celda,
// del lado por donde sigue el bracket. La mitad derecha es el espejo de la izquierda.
function dibujarRenglon(ctx, p, r, opts) {
  const { x, y, w, h, lado } = r;
  const { d, theme, estado, pieza, placeholder } = opts;
  const espejo = lado === 'right';
  const midY = y + h / 2;
  // Las cosas se miden desde la orilla: `dentro` lo lleva hacia el otro lado.
  const orilla = espejo ? x + w : x;
  const dentro = (dx) => (espejo ? orilla - dx : orilla + dx);
  const alinear = espejo ? 'right' : 'left';

  // La celda del marcador va siempre: es el lugar donde cae el resultado.
  const xCelda = espejo ? x : x + w - pieza.anchoMarcador;
  ctx.fillStyle = CELDA_MARCADOR;
  ctx.fillRect(xCelda, y, pieza.anchoMarcador, h);
  ctx.fillStyle = DIVISOR;
  ctx.fillRect(espejo ? x + pieza.anchoMarcador - DIVISION : xCelda, y, DIVISION, h);

  if (estado === 'ganador') {
    ctx.fillStyle = theme.flag;
    ctx.fillRect(espejo ? x : x + w - BARRA_GANADOR, y, BARRA_GANADOR, h);
  }

  if (!p) {
    if (!placeholder) return;
    const l = letra(500, 22, theme.fontEyebrow, 0.04);
    const xTexto = dentro(PADDING_CAJA + pieza.anchoSiembra + pieza.casco + SEPARACION_CASCO * 2);
    escribir(ctx, placeholder.toUpperCase(), xTexto, midY + altoDeLetra(ctx, l) / 2, l, GRIS, alinear);
    return;
  }

  ctx.save();
  if (estado === 'perdedor') ctx.globalAlpha = 0.5;

  const seed = siembraDe(p, d.tiedIds);
  escribir(ctx, seed, dentro(PADDING_CAJA), midY + pieza.altoSiembra / 2, pieza.siembra, GRIS, alinear);

  const cx = dentro(PADDING_CAJA + pieza.anchoSiembra + SEPARACION_CASCO + pieza.casco / 2);
  const url = logoForSide(p, lado);
  dibujarCasco(ctx, d.logos.get(url), p.name, d.formas.get(url) || 'disco', cx, midY, pieza.casco, theme, (pieza.casco / CASCO_DE_PORTADA) * 2);

  const xNombre = dentro(PADDING_CAJA + pieza.anchoSiembra + pieza.casco + SEPARACION_CASCO * 2);
  const lineas = lineasDeNombre(ctx, p.name, pieza.nombre, pieza.anchoNombre);
  const primera = midY + pieza.altoNombre / 2 - (pieza.interlinea * (lineas.length - 1)) / 2;
  lineas.forEach((texto, i) => {
    ponerLetra(ctx, pieza.nombre);
    escribir(ctx, ellipsize(ctx, texto, pieza.anchoNombre), xNombre, primera + i * pieza.interlinea, pieza.nombre, '#ffffff', alinear);
  });

  if (llevaMarcador(p)) {
    const color = estado === 'ganador' ? theme.flag : CAL;
    // Se centra en lo que deja la barra del ganador, gane o no: las cifras de una caja
    // quedan una encima de la otra.
    const xMarcador = xCelda + pieza.anchoMarcador / 2 + (espejo ? BARRA_GANADOR / 2 : -BARRA_GANADOR / 2);
    escribir(ctx, String(p.score), xMarcador, midY + pieza.altoMarcador / 2, pieza.marcador, color);
  }
  ctx.restore();
}

function dibujarCruce(ctx, game, caja, opts) {
  const { x, y, w, lado, ronda, pieza, lTira } = caja;
  const { g, theme } = opts;
  if (!game?.top && !game?.bottom) {
    dibujarCajaVacia(ctx, caja, opts);
    return;
  }

  ctx.fillStyle = PLACA;
  ctx.fillRect(x, y, w, g.caja);

  // La tira: la ronda hacia la orilla y la fecha hacia adentro.
  const st = gameStatus(game);
  const espejo = lado === 'right';
  const base = y + g.tira / 2 + altoDeLetra(ctx, lTira.ronda) / 2;
  ctx.fillStyle = CAL;
  ctx.fillRect(x, y, w, g.tira);
  escribir(ctx, ronda, espejo ? x + w - PADDING_CAJA : x + PADDING_CAJA, base, lTira.ronda, NOCHE, espejo ? 'right' : 'left');
  escribir(ctx, fechaDelCruce(game), espejo ? x + PADDING_CAJA : x + w - PADDING_CAJA, base, lTira.fecha, st.kind === 'live' ? LIVE_EN_TIRA : NOCHE, espejo ? 'left' : 'right');

  const yRenglon = y + g.tira;
  const base2 = { d: opts.d, theme, pieza };
  dibujarRenglon(ctx, game.top, { x, y: yRenglon, w, h: g.renglon, lado }, { ...base2, estado: estadoDe(game.top, game), placeholder: 'Por definir' });
  dibujarRenglon(ctx, game.bottom, { x, y: yRenglon + g.renglon, w, h: g.renglon, lado }, { ...base2, estado: estadoDe(game.bottom, game), placeholder: game.bye ? 'Descansa' : 'Por definir' });
  ctx.fillStyle = DIVISOR;
  ctx.fillRect(x, yRenglon + g.renglon - DIVISION / 2, w, DIVISION);

  ctx.lineWidth = BORDE;
  ctx.strokeStyle = CAL;
  ctx.strokeRect(x + BORDE / 2, y + BORDE / 2, w - BORDE, g.caja - BORDE);
}

// ── Las líneas ──

function lineaH(ctx, x1, x2, y) {
  ctx.fillRect(Math.min(x1, x2), Math.round(y - LINEA / 2), Math.abs(x2 - x1), LINEA);
}
function lineaV(ctx, x, y1, y2) {
  ctx.fillRect(Math.round(x - LINEA / 2), Math.min(y1, y2), LINEA, Math.abs(y2 - y1));
}

// El corchete que une dos cruces, con el que sigue en el recodo; la última ronda sale
// derecho a la final.
function dibujarConexiones(ctx, { g, d }) {
  const { cols, medidas, rondas } = d;
  ctx.fillStyle = CAL;
  for (const lado of ['left', 'right']) {
    const izquierda = lado === 'left';
    const hacia = izquierda ? 1 : -1;
    const borde = izquierda ? medidas.xIzquierda + medidas.ancho : medidas.xDerecha;
    const finalista = izquierda ? medidas.xCentro : medidas.xCentro + medidas.ancho;
    const columna = izquierda ? cols.left : cols.right;
    columna.forEach((col, c) => {
      if (c === rondas - 1) {
        lineaH(ctx, borde, finalista, centroDe(g, rondas, c, 0));
        return;
      }
      const riel = borde + hacia * Math.round((medidas.hueco * (c + 1)) / rondas);
      col.games.forEach((_, j) => {
        if (j % 2) return;
        const cyA = centroDe(g, rondas, c, j);
        const cyB = centroDe(g, rondas, c, j + 1);
        lineaH(ctx, borde, riel, cyA);
        lineaH(ctx, borde, riel, cyB);
        lineaV(ctx, riel, cyA - LINEA / 2, cyB + LINEA / 2);
      });
    });
  }
}

// ── El campeón ──

// La copa con cal: el contorno, sin relleno, como todo lo que está pintado en la cancha.
function dibujarCopa(ctx, cx, top, alto, color) {
  const anchoCopa = alto * 0.56;
  const altoCopa = alto * 0.5;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, alto * 0.035);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - anchoCopa / 2, top);
  ctx.lineTo(cx + anchoCopa / 2, top);
  ctx.bezierCurveTo(cx + anchoCopa / 2, top + altoCopa * 0.72, cx + anchoCopa * 0.22, top + altoCopa, cx, top + altoCopa);
  ctx.bezierCurveTo(cx - anchoCopa * 0.22, top + altoCopa, cx - anchoCopa / 2, top + altoCopa * 0.72, cx - anchoCopa / 2, top);
  ctx.closePath();
  ctx.stroke();

  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * anchoCopa * 0.5, top + altoCopa * 0.12);
    ctx.bezierCurveTo(cx + s * anchoCopa * 0.86, top + altoCopa * 0.1, cx + s * anchoCopa * 0.82, top + altoCopa * 0.62, cx + s * anchoCopa * 0.36, top + altoCopa * 0.74);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(cx, top + altoCopa);
  ctx.lineTo(cx, top + alto * 0.76);
  ctx.moveTo(cx - alto * 0.17, top + alto * 0.76);
  ctx.lineTo(cx + alto * 0.17, top + alto * 0.76);
  ctx.lineTo(cx + alto * 0.24, top + alto * 0.9);
  ctx.lineTo(cx - alto * 0.24, top + alto * 0.9);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

// La copa va encima de la final, y se encoge con lo que le quede hasta la línea de gol.
function dibujarCampeon(ctx, w, techo, campeon, { g, d, theme }) {
  const cx = w / 2;
  const letraCampeon = (size) => letra(400, size, theme.fontDisplay, 0.01);
  const lNombre = campeon?.name ? letraCampeon(tallaQueCabe(ctx, [campeon.name], d.medidas.ancho, 38, 22, letraCampeon)) : null;
  const leyenda = 46;
  const nombre = lNombre ? 54 : 0;
  const alto = clamp(techo - g.zonaArriba - AIRE_CANCHA - AIRE_COPA - leyenda - nombre, 50, COPA_MAXIMA);
  const arriba = techo - AIRE_COPA - nombre - leyenda - alto;
  dibujarCopa(ctx, cx, arriba, alto, theme.flag);
  escribir(ctx, 'CAMPEÓN', cx, arriba + alto + 40, letra(500, 30, theme.fontEyebrow, 0.08), theme.flag);
  if (lNombre) {
    ponerLetra(ctx, lNombre);
    escribir(ctx, ellipsize(ctx, campeon.name, d.medidas.ancho), cx, arriba + alto + 94, lNombre, '#ffffff');
  }
}

// ── La end zone de abajo ──

// El pie: la fecha de corte, la marca y lo que hace falta para leer el bracket. Solo lo
// que aparece: sin rondas que reacomodar, explicarlo es ruido.
function dibujarPie(ctx, w, h, g, formatKey, d, theme) {
  const { bracket, date, marca, rondas } = d;
  const top = h - g.zonaAbajo + GOL;
  const alto = g.zonaAbajo - GOL - MARGEN - BANDA;
  const midY = top + alto / 2;
  const orilla = MARGEN + BANDA + PADDING_ZONA;
  const l = letra(500, formatKey === 'story' ? 22 : 20, theme.fontBody);
  const alturaDe = (renglones, i) => midY + altoDeLetra(ctx, l) / 2 + (i - (renglones.length - 1) / 2) * 28;

  dibujarMarca(ctx, marca, w / 2, top + (alto - ALTO_MARCA[formatKey]) / 2, ALTO_MARCA[formatKey], theme);

  const izquierda = [cutoffLabel(date)];
  if (hasTiedSeeds(bracket)) izquierda.push('* Siembra sin decidir');
  izquierda.forEach((t, i) => escribir(ctx, t, orilla, alturaDe(izquierda, i), l, GRIS, 'left'));

  const derecha = ['El mejor sembrado es local'];
  if (rondas > 1) derecha.push('Se reacomodan cada ronda');
  derecha.forEach((t, i) => escribir(ctx, t, w - orilla, alturaDe(derecha, i), l, GRIS, 'right'));
}

/**
 * Genera la imagen de un bracket.
 * @param {object} bracket  uno de `brackets` de GET /leagues/branches/:id/bracket
 * @param {'post'|'story'} formatKey
 * @param {{header?:{league?:string, tournament?:string, year?:number, context?:string, leagueLogo?:string}, date?:Date}} options
 * @returns {Promise<Blob>}
 */
export async function generateBracketCard(bracket, formatKey, { header = {}, date = new Date() } = {}) {
  const format = FORMATS[formatKey] || FORMATS.post;
  const clave = FORMATS[formatKey] ? formatKey : 'post';
  const theme = readTheme();
  const { width: w, height: h } = format;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // Todos los equipos que pueden salir: la siembra y cualquiera que haya
  // entrado por un partido capturado.
  const equipos = new Map();
  for (const s of bracket.seeds || []) equipos.set(s.team_id, s);
  const participantes = (bracket.rounds || []).flatMap((r) => r.games.flatMap((game) => [game.top, game.bottom])).filter(Boolean);
  for (const p of participantes) if (!equipos.has(p.team_id)) equipos.set(p.team_id, p);

  const cols = mirrorColumns(bracket);
  const rondas = cols.left.length;
  const g = geometria(clave, h, rondas);
  const medidas = columnas(w, rondas);

  // Los escudos que se van a pintar, cada uno una vez: el de siempre de todos y el de
  // visitante de los que salen de la mitad derecha, igual que en la página.
  const derecha = cols.right.flatMap((c) => c.games.flatMap((game) => [game.top, game.bottom]));
  const urls = [...new Set([
    ...[...equipos.values()].map((p) => p.logo_url),
    ...derecha.map((p) => logoForSide(p, 'right')),
  ].filter(Boolean))];

  await ensureFonts();
  const [logoLiga, marca, ...resto] = await Promise.all([
    loadImageWithin(imagenAjustada(header.leagueLogo, 240), LOGO_TIMEOUT_MS),
    loadImage(BRAND_LOGO_SRC),
    ...urls.map((u) => loadImageWithin(imagenAjustada(u, 200), LOGO_TIMEOUT_MS)),
    // De la lectura del logo solo importa cómo se pone sobre el pasto.
    ...urls.map((u) => pinturaDelLogo(u, null, LOGO_TIMEOUT_MS)),
  ]);
  const logos = new Map(urls.map((u, i) => [u, resto[i]]));
  const formas = new Map(urls.map((u, i) => [u, resto[urls.length + i].forma]));

  const tiedIds = new Set((bracket.seeds || []).filter((s) => s.tied).map((s) => s.team_id));
  const pieza = piezaDe(ctx, {
    nombres: [...equipos.values()].map((p) => p.name || ''),
    siembras: [...equipos.values()].map((p) => siembraDe(p, tiedIds)),
    marcadores: participantes.filter(llevaMarcador).map((p) => String(p.score)),
  }, medidas.ancho, g.renglon, theme);

  // Todas las tiras van con la misma letra, la que hace caber a la fecha más larga.
  const nombreDeRonda = (ronda) => roundShortName(ronda?.name).toUpperCase();
  const cruces = [...cols.left, ...cols.right].flatMap((c) => c.games);
  if (cols.final?.game) cruces.push({ ...cols.final.game, top: cols.final.left, bottom: cols.final.right });
  const nombres = [...cols.left.map((c) => nombreDeRonda(c.round)), ...(cols.final ? [nombreDeRonda(cols.final.round)] : [])];
  const letraTira = (peso) => (size) => letra(peso, size, theme.fontEyebrow, 0.03);
  const fechas = cruces.map(fechaDelCruce).filter(Boolean);
  const lRonda = letraTira(600)(Math.round(clamp(g.tira * 0.6, 15, 22)));
  const paraFecha = medidas.ancho - PADDING_CAJA * 2 - 14 - Math.max(0, ...nombres.map((n) => medir(ctx, n, lRonda)));
  const lTira = { ronda: lRonda, fecha: letraTira(500)(tallaQueCabe(ctx, fechas, paraFecha, Math.round(clamp(g.tira * 0.62, 15, 23)), 12, letraTira(500))) };

  const datos = { bracket, date, marca, cols, medidas, rondas, logos, formas, tiedIds };
  const opts = { g, d: datos, theme };

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = NOCHE;
  ctx.fillRect(0, 0, w, h);
  dibujarFranjas(ctx, w, g);
  dibujarEndZones(ctx, w, h, g);
  dibujarLineasDeYarda(ctx, w, g, YARDA_DE_FONDO);
  dibujarBandas(ctx, w, h);

  dibujarConexiones(ctx, opts);
  for (const lado of ['left', 'right']) {
    const columna = lado === 'left' ? cols.left : cols.right;
    const x = lado === 'left' ? medidas.xIzquierda : medidas.xDerecha;
    columna.forEach((col, c) => col.games.forEach((game, j) => {
      const y = Math.round(centroDe(g, rondas, c, j) - g.caja / 2);
      dibujarCruce(ctx, game, { x, y, w: medidas.ancho, lado, ronda: nombreDeRonda(col.round), pieza, lTira }, opts);
    }));
  }
  if (cols.final) {
    // Los finalistas van en la misma caja, sin lado: el de la mitad izquierda arriba.
    const y = Math.round(g.zonaArriba + g.alto / 2 - g.caja / 2);
    const game = { ...cols.final.game, top: cols.final.left, bottom: cols.final.right };
    dibujarCruce(ctx, game, { x: medidas.xCentro, y, w: medidas.ancho, lado: null, ronda: nombreDeRonda(cols.final.round), pieza, lTira }, opts);
    dibujarCampeon(ctx, w, y, bracket.champion, opts);
  }

  dibujarCabecera(ctx, w, g, {
    header,
    logo: logoLiga,
    titulo: 'PLAYOFFS',
    detalle: tableDetail({ level: 'conference', scope_name: bracket.title }, header.context),
  }, theme);
  dibujarPie(ctx, w, h, g, clave, datos, theme);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
}

export const SHARE_CARD_FORMATS = FORMATS;
