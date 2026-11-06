// La imagen de UNA tabla de posiciones para compartir: una cancha vista desde
// arriba y parada, con una end zone arriba y otra abajo, y la tabla es la cancha:
// cada equipo es una franja de pasto y lo que separa a un equipo del siguiente es
// una línea de yarda. README, "Tabla de posiciones".
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
  NOCHE, CAL, GRIS, GOL, letra, ponerLetra, escribir, medir, altoDeLetra,
  dibujarCasco, dibujarMarca, dibujarFranjas, dibujarEndZones, dibujarLineasDeYarda, dibujarBandas, dibujarCabecera,
  ARRIBA, ZONA_ABAJO, ALTO_MARCA, ALTO_CABEZA, MARGEN, BANDA, ORILLA, PADDING_ZONA, CASCO_DE_PORTADA,
} from './shareCardField.js';
import { imagenAjustada } from './imagenes.js';
import { pinturaDelLogo } from './useTeamPaint.js';
import {
  imageColumns, cellText, cutoffLabel, rowQualifies, tableMarks, tableDetail, splitName,
} from './standingsFormat.js';

// Un escudo que no llega en este tiempo sale con iniciales: una imagen con un
// logo de menos es mejor que un botón que se queda en "Generando imagen…".
const LOGO_TIMEOUT_MS = 8000;

// El alto mínimo de la end zone de arriba, la del título y las etiquetas de las
// columnas: lo justo para lo que lleva escrito.
const ZONA_ARRIBA = { post: 220, story: 330 };
// Un renglón no pasa de esto: el ancho de la imagen no crece con él, así que más
// alto ya no lleva letra más grande sino aire. Lo que sobra es de las end zones,
// salvo en una tabla de muy pocos equipos: la cancha nunca se queda con menos de
// esta parte de lo que hay entre las dos, para que el título no se coma la imagen.
const RENGLON_MAXIMO = { post: 170, story: 230 };
const CANCHA_MINIMA = 0.75;
// Desde este alto un nombre largo puede ir en dos líneas.
const RENGLON_DOBLE = 66;

const SEPARACION_MINIMA = 14;
const CIFRA_MINIMA = 22;
const CIFRA_MAXIMA = 44;
// La letra de nombre desde la que las cifras dejan de ceder, y lo que mide un nombre
// junto a sus cifras, para que en un renglón alto no se vea chico.
const NOMBRE_LEGIBLE = 26;
const NOMBRE_JUNTO_A_CIFRA = 0.9;

const LINEA_DE_YARDA = 'rgba(255, 255, 255, 0.55)';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Los renglones de los que clasifican llevan la banda izquierda en amarillo.
function marcarClasificados(ctx, g, d, theme) {
  const { zonaArriba: cuerpo, renglon } = g;
  ctx.fillStyle = theme.flag;
  d.rows.forEach((r, i) => {
    if (rowQualifies(r, d.qualifyingCount)) ctx.fillRect(MARGEN, cuerpo + i * renglon, BANDA, renglon);
  });
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

  const acomodo = (base, anchoDe, dosLineas) => {
    const size = talla(base, anchoDe);
    return { talla: size, dosLineas, recortados: rows.filter((r) => anchoDe(r, letraDe(size)) > maxW).length };
  };

  const enUna = acomodo(Math.round(clamp(renglon * 0.58, 24, 44)), anchoEnUna, false);
  if (renglon < RENGLON_DOBLE) return enUna;
  const enDos = acomodo(Math.round(clamp(renglon * 0.38, 24, 44)), anchoEnDos, true);
  if (enDos.recortados !== enUna.recortados) return enDos.recortados < enUna.recortados ? enDos : enUna;
  return enDos.talla > enUna.talla ? enDos : enUna;
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

function dibujarTabla(ctx, w, g, d, theme) {
  const { rows, columns, logos, pinturas, qualifyingCount } = d;
  const { zonaArriba: cuerpo, cabeza, renglon, tallaLugar, casco } = g;
  const n = rows.length;
  const xCampo = MARGEN + BANDA;
  const xFin = w - ORILLA;

  // El lugar va pintado sobre el pasto, donde una cancha lleva sus números.
  const lLugar = letra(400, tallaLugar, theme.fontDisplay);
  const altoLugar = altoDeLetra(ctx, lLugar);
  const anchoLugar = Math.ceil(Math.max(0, ...rows.map((r) => medir(ctx, String(r.rank), lLugar))));
  const xLugar = ORILLA + anchoLugar / 2;
  const xCasco = ORILLA + anchoLugar + 6 + casco / 2;
  const xTexto = xCasco + casco / 2 + 10;

  const letraNombre = (size) => letra(400, size, theme.fontDisplay, 0.01);
  const lCabeza = letra(500, Math.round(clamp(renglon * 0.4, 18, 24)), theme.fontEyebrow, 0.06);
  const tallaMarca = Math.round(clamp(renglon * 0.3, 14, 20));
  const lMarca = letra(600, tallaMarca, theme.fontEyebrow, 0.05);
  const altoPildora = tallaMarca * 1.5;
  const anchoPildora = medir(ctx, 'COMODÍN', lMarca) + altoPildora * 0.84;
  const extra = (r) => (r.unresolved_tie ? 20 : 0) + (r.qualified_as === 'wildcard' ? anchoPildora + 14 : 0);

  // Lo que ocupa cada columna se mide con cada letra que se prueba.
  const conCifra = (cifra) => {
    const letrasDe = {
      cabeza: lCabeza,
      cifra: letra(500, cifra, theme.fontEyebrow),
      destacada: letra(600, cifra, theme.fontEyebrow),
    };
    const columnas = medirColumnas(ctx, columns, rows, letrasDe);
    const sobra = xFin - xTexto - columnas.reduce((suma, col) => suma + col.ancho, 0);
    return {
      letras: letrasDe,
      medidas: columnas,
      libre: sobra,
      nombres: acomodarNombres(ctx, rows, sobra - SEPARACION_MINIMA * columnas.length, extra, renglon, letraNombre),
    };
  };

  // Las cifras son lo primero que se lee, pero ceden ante el nombre: bajan de letra
  // hasta que los nombres caben sin recortarse y no se ven chicos junto a ellas. Solo
  // el que ni con la letra más chica cabe se queda sin contar: no arrastra a los demás.
  const alMinimo = conCifra(CIFRA_MINIMA);
  let acomodo = alMinimo;
  for (let cifra = Math.round(clamp(renglon * 0.52, CIFRA_MINIMA, CIFRA_MAXIMA)); cifra > CIFRA_MINIMA; cifra -= 1) {
    const prueba = conCifra(cifra);
    const legible = prueba.nombres.talla >= Math.max(NOMBRE_LEGIBLE, cifra * NOMBRE_JUNTO_A_CIFRA);
    if (legible && prueba.nombres.recortados <= alMinimo.nombres.recortados) {
      acomodo = prueba;
      break;
    }
  }
  const { letras, medidas, libre, nombres } = acomodo;

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

  // La columna que ordena la tabla lleva su propia franja, de arriba abajo. Va debajo
  // de las líneas, que siguen de corrido.
  const yCabeza = cuerpo - GOL - cabeza;
  for (const col of posiciones.filter((c) => c.highlight)) {
    ctx.fillStyle = 'rgba(255, 210, 63, 0.1)';
    ctx.fillRect(col.fin - col.ancho - separacion / 2, yCabeza, col.ancho + separacion, cabeza + GOL + renglon * n);
  }
  dibujarLineasDeYarda(ctx, w, { ...g, franja: g.renglon }, LINEA_DE_YARDA);

  const baseCabeza = yCabeza + cabeza / 2 + altoDeLetra(ctx, letras.cabeza) / 2;
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

    ctx.save();
    ctx.globalAlpha = r.played === 0 ? 0.55 : 1;
    escribir(ctx, String(r.rank), xLugar, midY + altoLugar / 2, lLugar, '#ffffff');
    // Con el doble de sombra de lo que le tocaría por tamaño, para que se despegue del
    // pasto.
    dibujarCasco(ctx, logos.equipos[i], r.name, pinturas[i].forma, xCasco, midY, casco, theme, (casco / CASCO_DE_PORTADA) * 2);

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
    ctx.fillRect(xCampo, cuerpo + qualifyingCount * renglon - 3, w - xCampo * 2, 6);
  }
}

// ── La end zone de abajo ──

function dibujarPie(ctx, w, h, g, formatKey, d, theme) {
  const { table, date, marca } = d;
  const top = h - g.zonaAbajo + GOL;
  const alto = g.zonaAbajo - GOL - MARGEN - BANDA;
  const midY = top + alto / 2;
  const orilla = MARGEN + BANDA + PADDING_ZONA;
  const l = letra(500, formatKey === 'story' ? 24 : 22, theme.fontBody);
  const base = midY + altoDeLetra(ctx, l) / 2;

  dibujarMarca(ctx, marca, w / 2, top + (alto - ALTO_MARCA[formatKey]) / 2, ALTO_MARCA[formatKey], theme);
  escribir(ctx, cutoffLabel(date), orilla, base, l, GRIS, 'left');

  // Del lado derecho, solo lo que la tabla trae: una leyenda de cosas ausentes es
  // ruido.
  const marcas = tableMarks(table);
  let x = w - orilla;
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
    ctx.fillRect(x - BANDA, midY - 13, BANDA, 26);
  }
}

// ── Las medidas ──

// Todo sale de cuántos renglones hay: la cancha llena lo que dejan las end zones, de
// una línea de gol a la otra, y si un renglón llega a su tope, lo que sobra se lo
// quedan las dos end zones. Renglones y end zones suman exactamente el alto.
export function geometria(formatKey, h, n) {
  const arriba = ARRIBA[formatKey];
  const cabeza = ALTO_CABEZA[formatKey];
  const franjas = Math.max(n, 1);
  const cancha = h - ZONA_ARRIBA[formatKey] - ZONA_ABAJO[formatKey];
  const tope = Math.max(RENGLON_MAXIMO[formatKey], (cancha * CANCHA_MINIMA) / franjas);
  const renglon = Math.floor(Math.min(tope, cancha / franjas));
  const sobra = cancha - renglon * franjas;
  const zonaAbajo = ZONA_ABAJO[formatKey] + Math.floor(sobra * 0.4);
  const zonaArriba = h - zonaAbajo - renglon * franjas;
  const tallaLugar = Math.round(clamp(renglon * 0.58, 26, 56));
  const casco = Math.round(clamp(renglon * 1.04, 40, 110));
  return { arriba, cabeza, franjas, renglon, zonaArriba, zonaAbajo, tallaLugar, casco };
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
  const g = geometria(clave, h, rows.length);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  await ensureFonts();
  // Los escudos se le piden a Cloudinary al tamaño en que se pintan: dieciocho
  // logos completos son megas que nadie va a ver.
  const ladoEscudo = g.casco > 64 ? 240 : 128;
  const [league, marca, ...restantes] = await Promise.all([
    loadImageWithin(imagenAjustada(header.leagueLogo, 240), LOGO_TIMEOUT_MS),
    loadImage(BRAND_LOGO_SRC),
    ...rows.map((r) => loadImageWithin(imagenAjustada(r.logo_url, ladoEscudo), LOGO_TIMEOUT_MS)),
    // De la lectura del logo solo importa cómo se pone sobre el pasto: la cancha es
    // la misma para todos.
    ...rows.map((r) => pinturaDelLogo(r.logo_url, null, LOGO_TIMEOUT_MS)),
  ]);
  const logosEquipos = restantes.slice(0, rows.length);
  const pinturas = restantes.slice(rows.length);

  const datos = {
    table,
    header,
    date,
    marca,
    rows,
    pinturas,
    columns: imageColumns(table, usesPoints),
    qualifyingCount: table.qualifying_count || 0,
    logos: { league, equipos: logosEquipos },
  };

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = NOCHE;
  ctx.fillRect(0, 0, w, h);
  dibujarFranjas(ctx, w, { ...g, franja: g.renglon });
  dibujarEndZones(ctx, w, h, g);
  dibujarTabla(ctx, w, g, datos, theme);
  dibujarBandas(ctx, w, h);
  marcarClasificados(ctx, g, datos, theme);
  dibujarCabecera(ctx, w, g, {
    header,
    logo: datos.logos.league,
    titulo: 'TABLA DE POSICIONES',
    detalle: tableDetail(table, header.context),
  }, theme);
  dibujarPie(ctx, w, h, g, clave, datos, theme);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
}

export const SHARE_CARD_FORMATS = FORMATS;
