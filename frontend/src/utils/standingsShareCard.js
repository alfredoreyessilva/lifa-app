// La imagen de UNA tabla de posiciones para compartir: la misma cancha de noche de
// la imagen de un partido, con la tabla como parte de la cancha. README, "Tabla de
// posiciones".
//
// Mismo principio que las otras tarjetas (partido, jugador, ranking): todo lo que
// dice la imagen viene tal cual de GET /leagues/branches/:id/standings. El orden,
// los récords y los desempates ya los resolvió el backend (utils/standings.js);
// aquí no se calcula nada, solo se dibuja, con canvas 2D en el navegador de quien
// la pide. No toca el backend.
//
// Qué columnas lleva y cómo se escribe cada cifra lo decide
// utils/standingsFormat.js, el mismo archivo que usa la tabla en pantalla.
// Lo que la tabla marca —quién clasifica, el empate que el reglamento no
// resolvió— la imagen también lo marca: una imagen que lo callara haría pasar
// por resuelto algo que no lo está, y esa imagen circula sin la página al lado.

import {
  FORMATS, readTheme, ensureFonts, loadImage, loadImageWithin, ellipsize, roundRect,
  BRAND_LOGO_SRC,
} from './shareCardCommon.js';
import {
  NOCHE, CAL, GRIS, LINEA, GOL, letra, ponerLetra, escribir, medir, tallaQueCabe,
  dibujarPasto, dibujarEndZone, dibujarCasco, franjasDeEndZone, sombraDeEndZone,
  bloqueLiga, dibujarMarca,
} from './shareCardField.js';
import { imagenAjustada } from './imagenes.js';
import { pinturaDelLogo } from './useTeamPaint.js';
import { lineaDelEquipo } from './matchCompare.js';
import {
  imageColumns, cellText, cutoffLabel, rowQualifies, tableMarks, tableLeader, tableDetail,
  splitName,
} from './standingsFormat.js';

// Un escudo que no llega en este tiempo sale con iniciales: una imagen con un
// logo de menos es mejor que un botón que se queda en "Generando imagen…".
const LOGO_TIMEOUT_MS = 8000;

// Lo que la barra de Instagram tapa arriba de una historia.
const ARRIBA = { post: 26, story: 96 };
const ALTO_PIE = { post: 92, story: 110 };
const ALTO_MARCA = { post: 72, story: 88 };
const ALTO_CABEZA = { post: 42, story: 48 };
// El alto que le toca a cada renglón: se reparte este presupuesto entre los equipos,
// entre un mínimo y un máximo. No se usa todo lo que hay: el ancho es el mismo en
// los dos formatos, así que un renglón más alto no lleva letra más grande sino aire.
// Ese aire es mejor cancha.
const PRESUPUESTO_TABLA = { post: 840, story: 1040 };
const RENGLON = { post: [50, 80], story: [56, 104] };
// Desde este alto un nombre largo puede ir en dos líneas.
const RENGLON_DOBLE = 66;
// La portada nunca baja de esto, sin contar `ARRIBA`: lo justo para la liga, el
// título, el detalle y las yardas. Lo demás es de los renglones.
const PORTADA_MINIMA = { post: 240, story: 330 };

const ZONA_MINIMA = 108;
const HUECO_MAXIMO = 56;
const HUECO_MINIMO = 10;
const PADDING_CANCHA = 24;
const ALTO_YARDAS = 92;
// El casco de la portada de un partido, para el que están medidas las sombras.
const CASCO_DE_PORTADA = 388;
const CASCO_MINIMO_LIDER = 150;
// Un casco no llena su cuadro: el PNG trae vacío arriba y abajo.
const ALTO_DEL_CASCO = 0.9;
const ALTO_NOMBRE_LIDER = 62;
const ALTO_LINEA_LIDER = 40;

const SEPARACION_MINIMA = 14;
// La letra de nombre desde la que las cifras dejan de ceder.
const NOMBRE_LEGIBLE = 26;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// La altura de las mayúsculas de una letra: con ella un texto se centra de verdad
// en su renglón, y no el cuadro de la fuente.
function altoDeLetra(ctx, l) {
  ponerLetra(ctx, l);
  return ctx.measureText('H').actualBoundingBoxAscent;
}

// ── La portada ──

function bloqueTitulo(ctx, detalle, ancho, escala, theme) {
  const letraTitulo = (size) => letra(400, size, theme.fontDisplay, 0.005);
  const lTitulo = letraTitulo(tallaQueCabe(ctx, ['Tabla de posiciones'], ancho, Math.round(100 * escala), 44, letraTitulo));
  const letraDetalle = (size) => letra(500, size, theme.fontEyebrow, 0.04);
  const lDetalle = letraDetalle(tallaQueCabe(ctx, [detalle], ancho, Math.round(31 * escala), 20, letraDetalle));
  const altoTitulo = altoDeLetra(ctx, lTitulo);
  const altoDetalle = detalle ? altoDeLetra(ctx, lDetalle) + 18 : 0;

  return {
    alto: altoTitulo + altoDetalle,
    pintar(cx, y) {
      escribir(ctx, 'Tabla de posiciones', cx, y + altoTitulo, lTitulo, '#ffffff');
      if (detalle) {
        ponerLetra(ctx, lDetalle);
        escribir(ctx, ellipsize(ctx, detalle, ancho), cx, y + altoTitulo + altoDetalle, lDetalle, 'rgba(255, 255, 255, 0.86)');
      }
    },
  };
}

// El líder, parado a media cancha como los cascos de un partido.
function bloqueLider(ctx, lider, pintura, logo, casco, linea, ancho, theme) {
  const altoCasco = casco * ALTO_DEL_CASCO;
  const letraNombre = (size) => letra(400, size, theme.fontDisplay, 0.01);
  const lNombre = letraNombre(tallaQueCabe(ctx, [lider.name], ancho, 52, 30, letraNombre));
  const letraLinea = (size) => letra(500, size, theme.fontEyebrow, 0.03);
  const lLinea = letraLinea(tallaQueCabe(ctx, [linea], ancho, 29, 20, letraLinea));

  return {
    alto: altoCasco + ALTO_NOMBRE_LIDER + ALTO_LINEA_LIDER,
    pintar(cx, y) {
      dibujarCasco(ctx, logo, lider.name, pintura.forma, cx, y + altoCasco / 2, casco, theme, casco / CASCO_DE_PORTADA);
      ponerLetra(ctx, lNombre);
      const base = y + altoCasco + ALTO_NOMBRE_LIDER - 6;
      escribir(ctx, ellipsize(ctx, lider.name, ancho), cx, base, lNombre, '#ffffff');
      ponerLetra(ctx, lLinea);
      escribir(ctx, ellipsize(ctx, linea, ancho), cx, base + ALTO_LINEA_LIDER - 4, lLinea, 'rgba(255, 255, 255, 0.84)');
    },
  };
}

// Sin líder todavía, a media cancha va lo que pinta ahí un estadio: el logo de la
// liga. Si no, sería una cancha enorme y vacía, justo en la tabla que menos dice.
function bloqueLogoDeLiga(ctx, logo, nombre, forma, casco, theme) {
  const alto = casco * ALTO_DEL_CASCO;
  return {
    alto,
    pintar(cx, y) {
      dibujarCasco(ctx, logo, nombre, forma, cx, y + alto / 2, casco, theme, casco / CASCO_DE_PORTADA);
    },
  };
}

// La cancha de arriba. Es del líder, como un estadio se pinta con el nombre de su
// equipo en las dos end zones; sin líder todavía, es de la liga.
function dibujarPortada(ctx, w, g, d, theme) {
  const { header, table, lider, pinturaCancha, nombreCancha, logos } = d;
  const { alto, arriba, zona } = g;
  const cancha = { x: zona + GOL, y: 0, w: w - (zona + GOL) * 2, h: alto };
  const escala = clamp((alto - arriba) / 420, 0.72, 1);
  const altoYardas = ALTO_YARDAS * escala;

  dibujarPasto(ctx, cancha, { home: pinturaCancha, away: pinturaCancha }, theme, Math.round(54 * escala));
  dibujarEndZone(ctx, { x: 0, y: 0, w: zona, h: alto }, 'home', pinturaCancha, nombreCancha, theme);
  dibujarEndZone(ctx, { x: w - zona, y: 0, w: zona, h: alto }, 'away', pinturaCancha, nombreCancha, theme);

  const ancho = cancha.w - PADDING_CANCHA * 2;
  const liga = header.league || 'CFBAMX';
  const torneo = [header.tournament, header.year].filter(Boolean).join(' ');
  const titulo = bloqueTitulo(ctx, tableDetail(table, header.context), ancho, escala, theme);
  const conLiga = (logo) => bloqueLiga(ctx, liga, torneo, logo, ancho, theme, escala);

  // Lo que sobra de cancha es de lo que va a media cancha, si le alcanza para verse.
  const disponible = alto - arriba - altoYardas;
  const textos = lider ? ALTO_NOMBRE_LIDER + ALTO_LINEA_LIDER : 0;
  const libre = disponible - conLiga(logos.league).alto - titulo.alto - HUECO_MINIMO * 3 - textos;
  const casco = Math.min(CASCO_DE_PORTADA, libre / ALTO_DEL_CASCO);
  const cabe = casco >= CASCO_MINIMO_LIDER;

  let bloques;
  if (cabe && lider) {
    const linea = lineaDelEquipo({ ...lider, places: [{ rank: lider.rank, scope_name: table.scope_name }] });
    bloques = [conLiga(logos.league), titulo, bloqueLider(ctx, lider, d.pinturas[0], logos.lider, casco, linea, ancho, theme)];
  } else if (cabe && logos.league) {
    // El logo ya va grande: en la fila de arriba sería repetirlo.
    bloques = [conLiga(null), titulo, bloqueLogoDeLiga(ctx, logos.league, liga, pinturaCancha.forma, casco, theme)];
  } else {
    bloques = [conLiga(logos.league), titulo];
  }

  const sobra = Math.max(0, disponible - bloques.reduce((suma, b) => suma + b.alto, 0));
  const huecos = bloques.length - 1;
  const hueco = Math.min(HUECO_MAXIMO, sobra / huecos);
  let y = arriba + (sobra - hueco * huecos) / 2;
  for (const b of bloques) {
    b.pintar(w / 2, y);
    y += b.alto + hueco;
  }
}

// ── La tabla ──

// El ancho de cada columna sale de lo que trae: la cifra más ancha con la letra con
// que se va a escribir, o el encabezado si es más ancho que sus cifras.
function medirColumnas(ctx, columns, rows, letras) {
  return columns.map((col) => {
    const cifra = col.highlight ? letras.destacada : letras.cifra;
    const celdas = rows.map((r) => medir(ctx, cellText(col.id, r), cifra));
    return { ...col, ancho: Math.ceil(Math.max(medir(ctx, col.label, letras.cabeza), ...celdas)) };
  });
}

// Lo que ocupa un nombre ya acomodado: lo que va junto a él cuenta solo en su última
// línea.
function anchoDeLineas(lineas, mide, extra) {
  return Math.max(...lineas.map((t, i) => mide(t) + (i === lineas.length - 1 ? extra : 0)));
}

// La letra más grande con la que caben TODOS los nombres, para que los renglones
// se vean parejos: en una línea o, si el renglón da para eso y conviene, en dos. Lo
// que va junto al nombre (`extra`) le quita ancho solo a su renglón: la pill del
// comodín de un equipo no le quita espacio al de arriba. El nombre que ni a la
// mínima cabe no cuenta —se va a recortar con "…" de todos modos— para que no
// arrastre a todos los demás.
function acomodarNombres(ctx, rows, maxW, extra, renglon, letraDe) {
  const min = 22;
  const anchoEnUna = (r, l) => medir(ctx, r.name, l) + extra(r);
  const anchoEnDos = (r, l) => anchoDeLineas(splitName(r.name, (t) => medir(ctx, t, l), extra(r)), (t) => medir(ctx, t, l), extra(r));
  const talla = (base, anchoDe) => {
    const medibles = rows.filter((r) => anchoDe(r, letraDe(min)) <= maxW);
    let size = base;
    while (size > min && medibles.some((r) => anchoDe(r, letraDe(size)) > maxW)) size -= 1;
    return size;
  };

  const enUna = talla(Math.round(clamp(renglon * 0.58, 24, 40)), anchoEnUna);
  if (renglon < RENGLON_DOBLE) return { talla: enUna, dosLineas: false };
  const enDos = talla(Math.round(clamp(renglon * 0.38, 24, 40)), anchoEnDos);
  return enDos > enUna ? { talla: enDos, dosLineas: true } : { talla: enUna, dosLineas: false };
}

// "Comodín": clasifica por lugar extra. Mismo aviso que la tabla en pantalla,
// porque sin él la línea de ese renglón se ve arbitraria.
function pildoraComodin(ctx, x, midY, l, alto, theme) {
  const pad = alto * 0.42;
  const ancho = medir(ctx, 'COMODÍN', l) + pad * 2;
  roundRect(ctx, x, midY - alto / 2, ancho, alto, alto / 2);
  ctx.strokeStyle = theme.flag;
  ctx.lineWidth = 2;
  ctx.stroke();
  escribir(ctx, 'COMODÍN', x + pad, midY + altoDeLetra(ctx, l) / 2, l, theme.flag, 'left');
}

// La end zone de la izquierda baja por toda la tabla, partida en el color de cada
// equipo, con su lugar y su casco. Las franjas y la sombra se pintan una sola vez,
// sobre todos los colores, para que se lea como una sola end zone. La línea de gol
// sigue de corrido, y de amarillo en los renglones de los que clasifican.
function dibujarColumnaDeEquipos(ctx, g, d, theme) {
  const { rows, pinturas, logos, qualifyingCount } = d;
  const { top, renglon, zona, tallaLugar, cascoFila } = g;
  const alto = renglon * rows.length;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, zona, alto);
  ctx.clip();
  rows.forEach((r, i) => {
    ctx.fillStyle = pinturas[i].fondo;
    ctx.fillRect(0, top + i * renglon, zona, renglon);
  });
  franjasDeEndZone(ctx, 0, top, zona, alto);
  sombraDeEndZone(ctx, 0, top, zona, alto, 'home');
  rows.forEach((r, i) => {
    const y = top + i * renglon;
    // El que todavía no juega va atenuado, igual que en pantalla.
    if (r.played === 0) {
      ctx.fillStyle = 'rgba(10, 31, 19, 0.5)';
      ctx.fillRect(0, y, zona, renglon);
    }
    if (i > 0) {
      ctx.fillStyle = 'rgba(5, 15, 10, 0.6)';
      ctx.fillRect(0, y - 1, zona, 2);
    }
  });
  ctx.restore();

  const lLugar = letra(400, tallaLugar, theme.fontDisplay);
  const altoLugar = altoDeLetra(ctx, lLugar);
  const centroLugar = 10 + tallaLugar * 0.54;
  const centroCasco = zona - 5 - cascoFila / 2;
  rows.forEach((r, i) => {
    const y = top + i * renglon;
    const midY = y + renglon / 2;
    ctx.fillStyle = rowQualifies(r, qualifyingCount) ? theme.flag : CAL;
    ctx.fillRect(zona, y, GOL, renglon);

    ctx.save();
    ctx.globalAlpha = r.played === 0 ? 0.55 : 1;
    escribir(ctx, String(r.rank), centroLugar, midY + altoLugar / 2, lLugar, pinturas[i].tinta);
    // Con el doble de sombra de lo que le tocaría: sin ella, un casco del mismo
    // color que su pintura se pierde.
    dibujarCasco(ctx, logos.equipos[i], r.name, pinturas[i].forma, centroCasco, midY, cascoFila, theme, (cascoFila / CASCO_DE_PORTADA) * 2);
    ctx.restore();
  });
}

function dibujarTabla(ctx, w, g, d, theme) {
  const { rows, columns, qualifyingCount } = d;
  const { top, cabeza, renglon, zona } = g;
  const cuerpo = top + cabeza;
  const xTexto = zona + GOL + 16;
  const xFin = w - 22;
  const n = rows.length;

  const letraNombre = (size) => letra(400, size, theme.fontDisplay, 0.01);
  const lCabeza = letra(500, Math.round(clamp(renglon * 0.4, 18, 22)), theme.fontEyebrow, 0.06);
  const tallaMarca = Math.round(clamp(renglon * 0.3, 14, 20));
  const lMarca = letra(600, tallaMarca, theme.fontEyebrow, 0.05);
  const altoPildora = tallaMarca * 1.5;
  const anchoPildora = medir(ctx, 'COMODÍN', lMarca) + altoPildora * 0.84;
  const extra = (r) => (r.unresolved_tie ? 20 : 0) + (r.qualified_as === 'wildcard' ? anchoPildora + 14 : 0);

  // Las cifras ceden antes que el nombre: bajan de letra hasta que el nombre más
  // largo se lee bien. Lo que ocupa cada columna se mide en cada intento.
  let letras;
  let medidas;
  let libre;
  let nombres;
  for (let cifra = Math.round(clamp(renglon * 0.5, 22, 34)); cifra >= 22; cifra -= 1) {
    letras = {
      cabeza: lCabeza,
      cifra: letra(500, cifra, theme.fontEyebrow),
      destacada: letra(600, cifra, theme.fontEyebrow),
    };
    medidas = medirColumnas(ctx, columns, rows, letras);
    libre = xFin - xTexto - medidas.reduce((suma, col) => suma + col.ancho, 0);
    nombres = acomodarNombres(ctx, rows, libre - SEPARACION_MINIMA * medidas.length, extra, renglon, letraNombre);
    if (nombres.talla >= NOMBRE_LEGIBLE) break;
  }

  const lNombre = letraNombre(nombres.talla);
  const mideNombre = (t) => medir(ctx, t, lNombre);
  const lineasDe = (r) => {
    if (!nombres.dosLineas || mideNombre(r.name) + extra(r) <= libre - SEPARACION_MINIMA * medidas.length) return [r.name];
    return splitName(r.name, mideNombre, extra(r));
  };

  // Lo que sobra a lo ancho se reparte entre las columnas, con tope: en una tabla
  // de nombres cortos no deben quedar las cifras regadas por toda la imagen.
  const nombreReal = Math.max(0, ...rows.map((r) => anchoDeLineas(lineasDe(r), mideNombre, extra(r))));
  const separacion = clamp((libre - nombreReal) / Math.max(medidas.length, 1), SEPARACION_MINIMA, Math.max(26, renglon * 0.6));
  const nombreMax = libre - separacion * medidas.length;

  let x = xFin;
  const posiciones = [...medidas].reverse().map((col) => {
    const pos = { ...col, fin: x, centro: x - col.ancho / 2 };
    x -= col.ancho + separacion;
    return pos;
  }).reverse();

  // La columna que ordena la tabla lleva su propia franja, de arriba abajo.
  for (const col of posiciones.filter((c) => c.highlight)) {
    ctx.fillStyle = 'rgba(255, 210, 63, 0.08)';
    ctx.fillRect(col.fin - col.ancho - separacion / 2, top, col.ancho + separacion, cabeza + renglon * n);
  }

  const baseCabeza = top + cabeza / 2 + altoDeLetra(ctx, letras.cabeza) / 2;
  escribir(ctx, 'Equipo', xTexto, baseCabeza, letras.cabeza, GRIS, 'left');
  for (const col of posiciones) {
    const color = col.highlight ? theme.flag : GRIS;
    if (col.id === 'scope' || col.id === 'streak') escribir(ctx, col.label, col.centro, baseCabeza, letras.cabeza, color);
    else escribir(ctx, col.label, col.fin, baseCabeza, letras.cabeza, color, 'right');
  }

  const altoNombre = altoDeLetra(ctx, lNombre);
  const altoCifra = altoDeLetra(ctx, letras.cifra);
  rows.forEach((r, i) => {
    const y = cuerpo + i * renglon;
    const midY = y + renglon / 2;
    ctx.fillStyle = LINEA;
    ctx.fillRect(zona + GOL, y - 1, w - zona - GOL, 2);

    ctx.save();
    ctx.globalAlpha = r.played === 0 ? 0.55 : 1;
    const lineas = lineasDe(r);
    const interlinea = altoNombre + Math.round(nombres.talla * 0.24);
    const primera = midY + altoNombre / 2 - (interlinea * (lineas.length - 1)) / 2;
    let xMarca = xTexto;
    let yMarca = primera;
    lineas.forEach((texto, j) => {
      const ultima = j === lineas.length - 1;
      ponerLetra(ctx, lNombre);
      const linea = ellipsize(ctx, texto, nombreMax - (ultima ? extra(r) : 0));
      yMarca = primera + j * interlinea;
      escribir(ctx, linea, xTexto, yMarca, lNombre, '#ffffff', 'left');
      // Una última línea vacía quiere decir que la pill va sola, al ras del nombre.
      xMarca = linea ? xTexto + ctx.measureText(linea).width + 14 : xTexto;
    });
    if (r.unresolved_tie) {
      escribir(ctx, '*', xMarca - 6, yMarca, lNombre, theme.flag, 'left');
      xMarca += 20;
    }
    if (r.qualified_as === 'wildcard') pildoraComodin(ctx, xMarca, yMarca - altoNombre / 2, lMarca, altoPildora, theme);

    const baseCifra = midY + altoCifra / 2;
    for (const col of posiciones) {
      const texto = cellText(col.id, r);
      const l = col.highlight ? letras.destacada : letras.cifra;
      const color = col.highlight ? theme.flag : CAL;
      if (col.id === 'scope' || col.id === 'streak') escribir(ctx, texto, col.centro, baseCifra, l, color);
      else escribir(ctx, texto, col.fin, baseCifra, l, color, 'right');
    }
    ctx.restore();
  });

  // El corte: la línea amarilla que en la tele marca hasta dónde hay que llegar.
  if (qualifyingCount > 0 && qualifyingCount < n) {
    ctx.fillStyle = theme.flag;
    ctx.fillRect(zona + GOL, cuerpo + qualifyingCount * renglon - 2, w - zona - GOL, 4);
  }
}

// ── El pie ──

function dibujarPie(ctx, w, h, formatKey, d, theme) {
  const { table, date, marca } = d;
  const alto = ALTO_PIE[formatKey];
  const top = h - alto;
  const midY = top + alto / 2;
  const l = letra(500, formatKey === 'story' ? 24 : 22, theme.fontBody);
  const base = midY + altoDeLetra(ctx, l) / 2;

  dibujarMarca(ctx, marca, w / 2, top + (alto - ALTO_MARCA[formatKey]) / 2, ALTO_MARCA[formatKey], theme);
  escribir(ctx, cutoffLabel(date), 28, base, l, GRIS, 'left');

  // Del lado derecho, solo lo que la tabla trae: una leyenda de cosas ausentes es
  // ruido.
  const marcas = tableMarks(table);
  let x = w - 28;
  if (marcas.unresolvedTie) {
    escribir(ctx, 'Empate sin resolver', x, base, l, GRIS, 'right');
    x -= medir(ctx, 'Empate sin resolver', l) + 8;
    escribir(ctx, '*', x, base + 4, letra(600, 30, theme.fontEyebrow), theme.flag, 'right');
    x -= 34;
  }
  if (marcas.qualifies) {
    escribir(ctx, 'Clasifica', x, base, l, GRIS, 'right');
    x -= medir(ctx, 'Clasifica', l) + 12;
    ctx.fillStyle = theme.flag;
    ctx.fillRect(x - GOL, midY - 13, GOL, 26);
  }
}

// ── Las medidas ──

// Todo sale de cuántos renglones hay. La tabla se queda con lo que necesita y la
// portada con el resto, nunca menos de su mínimo.
function geometria(formatKey, h, n) {
  const arriba = ARRIBA[formatKey];
  const cabeza = ALTO_CABEZA[formatKey];
  const paraRenglones = h - ALTO_PIE[formatKey] - cabeza - arriba - PORTADA_MINIMA[formatKey];
  const [minimo, maximo] = RENGLON[formatKey];
  const equipos = Math.max(n, 1);
  const deseado = clamp(PRESUPUESTO_TABLA[formatKey] / equipos, minimo, maximo);
  const renglon = Math.floor(Math.min(deseado, paraRenglones / equipos));
  const alto = h - ALTO_PIE[formatKey] - cabeza - renglon * n;
  const tallaLugar = Math.round(clamp(renglon * 0.62, 28, 46));
  const cascoFila = Math.round(renglon * 1.08);
  const zona = Math.max(ZONA_MINIMA, Math.round(10 + tallaLugar * 1.08 + 2 + cascoFila + 5));
  return { arriba, alto, top: alto, cabeza, renglon, tallaLugar, cascoFila, zona };
}

/**
 * Genera la imagen de una tabla.
 * @param {object} table   una de `tables` de GET /leagues/branches/:id/standings
 * @param {'post'|'story'} formatKey
 * @param {{usesPoints?:boolean, header?:{league?:string, tournament?:string, year?:number, context?:string, leagueLogo?:string}, date?:Date}} options
 *   `usesPoints` sale de `branch.uses_points`; `date` es la fecha de corte que se imprime.
 * @returns {Promise<Blob>}
 */
export async function generateStandingsCard(table, formatKey, { usesPoints = false, header = {}, date = new Date() } = {}) {
  const format = FORMATS[formatKey] || FORMATS.post;
  const clave = FORMATS[formatKey] ? formatKey : 'post';
  const theme = readTheme();
  const { width: w, height: h } = format;
  const rows = table.rows || [];
  const lider = tableLeader(table);
  const g = geometria(clave, h, rows.length);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  await ensureFonts();
  // Los escudos se le piden a Cloudinary al tamaño en que se pintan: dieciocho
  // logos completos son megas que nadie va a ver.
  const ladoEscudo = g.cascoFila > 64 ? 240 : 128;
  const [league, marca, logoLider, pinturaLiga, ...restantes] = await Promise.all([
    loadImageWithin(imagenAjustada(header.leagueLogo, lider ? 240 : 640), LOGO_TIMEOUT_MS),
    loadImage(BRAND_LOGO_SRC),
    lider ? loadImageWithin(imagenAjustada(lider.logo_url, 640), LOGO_TIMEOUT_MS) : null,
    pinturaDelLogo(header.leagueLogo, null, LOGO_TIMEOUT_MS),
    ...rows.map((r) => loadImageWithin(imagenAjustada(r.logo_url, ladoEscudo), LOGO_TIMEOUT_MS)),
    ...rows.map((r) => pinturaDelLogo(r.logo_url, r.brand_color, LOGO_TIMEOUT_MS)),
  ]);
  const logosEquipos = restantes.slice(0, rows.length);
  const pinturas = restantes.slice(rows.length);

  const datos = {
    table,
    header,
    date,
    marca,
    rows,
    lider,
    pinturas,
    columns: imageColumns(table, usesPoints),
    qualifyingCount: table.qualifying_count || 0,
    pinturaCancha: lider ? pinturas[0] : pinturaLiga,
    nombreCancha: lider ? lider.name : (header.league || 'CFBAMX'),
    logos: { league, lider: logoLider, equipos: logosEquipos },
  };

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = NOCHE;
  ctx.fillRect(0, 0, w, h);
  dibujarPortada(ctx, w, g, datos, theme);
  dibujarTabla(ctx, w, g, datos, theme);
  dibujarColumnaDeEquipos(ctx, { ...g, top: g.top + g.cabeza }, datos, theme);
  dibujarPie(ctx, w, h, clave, datos, theme);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
}

export const SHARE_CARD_FORMATS = FORMATS;
