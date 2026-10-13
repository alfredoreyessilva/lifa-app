// Genera la imagen de UNA tabla de posiciones para compartir.
//
// Mismo principio que las otras tarjetas (partido, jugador, ranking): todo lo
// que dice la imagen viene tal cual de GET /leagues/branches/:id/standings. El
// orden, los récords y los desempates ya los resolvió el backend
// (utils/standings.js); aquí no se calcula nada, solo se dibuja, con canvas 2D
// en el navegador de quien la pide. No toca el backend.
//
// Qué columnas lleva y cómo se escribe cada cifra lo decide
// utils/standingsFormat.js, el mismo archivo que usa la tabla en pantalla.
// Lo que la tabla marca —quién clasifica, el empate que el reglamento no
// resolvió— la imagen también lo marca: una imagen que lo callara haría pasar
// por resuelto algo que no lo está, y esa imagen circula sin la página al lado.

import {
  FORMATS, readTheme, ensureFonts, loadImage, drawBallIcon, drawBackground,
  fitText, roundRect, drawImageContain, ellipsize, initials,
  BRAND_LOGO_SRC, BRAND_LOGO_RATIO,
} from './shareCardCommon.js';
import { imagenAjustada } from './imagenes.js';
import {
  imageColumns, cellText, scopeLabel, cutoffLabel, rowQualifies, tableMarks,
} from './standingsFormat.js';

// Un escudo que no llega en este tiempo sale con iniciales: una imagen con un
// logo de menos es mejor que un botón que se queda en "Generando imagen…".
const LOGO_TIMEOUT_MS = 8000;

const MAX_ROW_H = 92;
const HEAD_ROW_H = 46;
const RANK_W = 50;
const LOGO_MAX = 46;
const LOGO_GAP = 12;
const NAME_GAP = 12;

function loadImageWithin(url, ms) {
  if (!url) return Promise.resolve(null);
  return Promise.race([
    loadImage(url),
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Pill amarilla con el nombre de la tabla ("CONFERENCIA NACIONAL"), igual a
// la de "JORNADA N" de la tarjeta del partido. Devuelve su alto.
function drawPill(ctx, text, cx, top, maxWidth, theme) {
  ctx.save();
  ctx.font = `700 26px ${theme.fontEyebrow}`;
  ctx.letterSpacing = '2px';
  const padX = 26;
  const label = ellipsize(ctx, text, maxWidth - padX * 2);
  const pillW = ctx.measureText(label).width + padX * 2;
  const pillH = 48;
  roundRect(ctx, cx - pillW / 2, top, pillW, pillH, pillH / 2);
  ctx.fillStyle = theme.flag;
  ctx.fill();
  ctx.fillStyle = theme.fieldDeep;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, top + pillH / 2 + 1);
  ctx.restore();
  return pillH;
}

/**
 * El encabezado: el título fijo, el torneo resaltado, "categoría · rama" y,
 * si la tabla es de una conferencia o un grupo, cuál. Devuelve la `y` donde
 * empieza la tabla.
 */
function drawHeader(ctx, w, h, theme, header, table, cornerEdge) {
  const cx = w / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Título fijo, a la altura del balón y del logo de la liga — igual que el
  // ranking de predicciones, para que las dos imágenes se reconozcan juntas.
  let y = h * 0.038;
  ctx.fillStyle = theme.flag;
  ctx.font = `700 30px ${theme.fontEyebrow}`;
  ctx.letterSpacing = '3px';
  ctx.fillText('TABLA DE POSICIONES', cx, y);
  ctx.letterSpacing = '0px';
  y += 34 + 40;

  // El torneo es el título. Queda a la altura de las dos esquinas, así que no
  // puede ser más ancho que el hueco que dejan entre ellas.
  const hero = (header.tournament || 'CFBAMX').toUpperCase();
  const heroMax = w - 2 * (cornerEdge + 16);
  const heroSize = fitText(ctx, hero, heroMax, 62, theme.fontDisplay, 30);
  ctx.fillStyle = theme.ink;
  ctx.font = `700 ${heroSize}px ${theme.fontDisplay}`;
  ctx.fillText(ellipsize(ctx, hero, heroMax), cx, y);
  y += heroSize * 0.32 + 24;

  if (header.context) {
    ctx.fillStyle = theme.inkDim;
    ctx.font = `500 24px ${theme.fontBody}`;
    ctx.fillText(ellipsize(ctx, header.context, w * 0.86), cx, y);
    y += 34;
  }

  const scope = scopeLabel(table.level, table.scope_name).toUpperCase();
  if (scope) {
    y += 6;
    y += drawPill(ctx, scope, cx, y, w * 0.8, theme);
  }

  return y + 24;
}

// La letra más grande con la que caben TODOS los nombres, para que los
// renglones se vean parejos. Cada renglón descuenta solo lo que lleva junto al
// nombre (`extraW`): la pill del comodín de un equipo no le quita espacio al
// de arriba. Sin bajar de `minSize`, y el nombre que ni así cabe no cuenta —se
// va a recortar con "…" de todos modos— para que no arrastre a todos los
// demás a la letra mínima.
function nameFontSize(ctx, rows, maxWidth, extraW, baseSize, minSize, family) {
  const needs = (r, size) => {
    ctx.font = `600 ${size}px ${family}`;
    return ctx.measureText(r.name).width + extraW(r);
  };
  const sizable = rows.filter((r) => needs(r, minSize) <= maxWidth);
  let size = baseSize;
  while (size > minSize && sizable.some((r) => needs(r, size) > maxWidth)) size -= 1;
  return size;
}

// Escudo del equipo, o sus iniciales en un círculo si no tiene (o no llegó).
function drawTeamLogo(ctx, img, name, x, midY, size, theme) {
  if (img) {
    drawImageContain(ctx, img, x, midY - size / 2, size, size);
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, midY, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fill();
  ctx.fillStyle = theme.ink;
  ctx.font = `600 ${Math.round(size * 0.38)}px ${theme.fontEyebrow}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials(name), x + size / 2, midY + 1);
  ctx.restore();
}

// "Comodín": clasifica por lugar extra. Mismo aviso que la tabla en pantalla,
// porque sin él la barra de ese renglón se ve arbitraria.
function drawWildcardPill(ctx, x, midY, size, theme) {
  ctx.save();
  ctx.font = `600 ${size}px ${theme.fontEyebrow}`;
  ctx.letterSpacing = '1px';
  const text = 'COMODÍN';
  const padX = size * 0.6;
  const pillW = ctx.measureText(text).width + padX * 2;
  const pillH = size * 1.7;
  roundRect(ctx, x, midY - pillH / 2, pillW, pillH, pillH / 2);
  ctx.strokeStyle = theme.inkDim;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = theme.inkDim;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, midY + 1);
  ctx.restore();
  return pillW;
}

function wildcardPillWidth(ctx, size, theme) {
  ctx.save();
  ctx.font = `600 ${size}px ${theme.fontEyebrow}`;
  ctx.letterSpacing = '1px';
  const width = ctx.measureText('COMODÍN').width + size * 1.2;
  ctx.restore();
  return width;
}

// La leyenda bajo la tabla, centrada: la fecha de corte y, solo si aparecen,
// las dos marcas. Cada pieza puede llevar su marca dibujada antes del texto.
function drawLegend(ctx, items, cx, y, theme) {
  ctx.save();
  const font = `500 21px ${theme.fontBody}`;
  const sep = '  ·  ';
  ctx.font = font;
  const markW = { bar: 16, star: 18 };
  const widths = items.map((it) => (it.mark ? markW[it.mark] : 0) + ctx.measureText(it.text).width);
  const sepW = ctx.measureText(sep).width;
  const total = widths.reduce((a, b) => a + b, 0) + sepW * (items.length - 1);

  let x = cx - total / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  items.forEach((it, i) => {
    if (i > 0) {
      ctx.fillStyle = theme.inkDim;
      ctx.font = font;
      ctx.fillText(sep, x, y);
      x += sepW;
    }
    if (it.mark === 'bar') {
      ctx.fillStyle = theme.flag;
      ctx.fillRect(x, y - 11, 6, 22);
      x += markW.bar;
    } else if (it.mark === 'star') {
      ctx.fillStyle = theme.flag;
      ctx.font = `700 26px ${theme.fontEyebrow}`;
      ctx.fillText('*', x, y + 4);
      x += markW.star;
    }
    ctx.fillStyle = theme.inkDim;
    ctx.font = font;
    ctx.fillText(it.text, x, y);
    x += ctx.measureText(it.text).width;
  });
  ctx.restore();
}

/**
 * Genera la imagen de una tabla.
 * @param {object} table   una de `tables` de GET /leagues/branches/:id/standings
 * @param {'post'|'story'} formatKey
 * @param {{usesPoints?:boolean, header?:{tournament?:string, context?:string, leagueLogo?:string}, date?:Date}} options
 *   `usesPoints` sale de `branch.uses_points`; `date` es la fecha de corte que se imprime.
 * @returns {Promise<Blob>}
 */
export async function generateStandingsCard(table, formatKey, { usesPoints = false, header = {}, date = new Date() } = {}) {
  const format = FORMATS[formatKey] || FORMATS.post;
  const theme = readTheme();
  const { width: w, height: h } = format;
  const rows = table.rows || [];
  const qualifyingCount = table.qualifying_count || 0;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  await ensureFonts();
  // Los escudos se le piden a Cloudinary al tamaño en que se pintan: dieciocho
  // logos completos son megas que nadie va a ver.
  const [leagueImg, brandImg, ...logos] = await Promise.all([
    loadImageWithin(imagenAjustada(header.leagueLogo, 240), LOGO_TIMEOUT_MS),
    loadImage(BRAND_LOGO_SRC),
    ...rows.map((r) => loadImageWithin(imagenAjustada(r.logo_url, 128), LOGO_TIMEOUT_MS)),
  ]);

  drawBackground(ctx, w, h, theme);

  // Balón arriba a la izquierda y logo de la liga en la esquina de enfrente,
  // en las mismas posiciones que el ranking de predicciones.
  const cornerX = w * 0.055;
  const cornerY = h * 0.022;
  const cornerBox = w * 0.11;
  drawBallIcon(ctx, cornerX, cornerY, w * 0.075, theme);
  if (leagueImg) drawImageContain(ctx, leagueImg, w - cornerX - cornerBox, cornerY, cornerBox, cornerBox);

  const headerBottom = drawHeader(ctx, w, h, theme, header, table, cornerX + cornerBox);

  // Logo de la marca abajo al centro, más chico que en el ranking: aquí el
  // espacio es de la tabla.
  const brandW = w * 0.2;
  const brandH = brandW / BRAND_LOGO_RATIO;
  const brandY = h - h * 0.026 - brandH;

  // --- Geometría de la tabla ---
  // La leyenda va DENTRO del panel, en su pie: afuera caía sobre las rayas de
  // yarda del fondo y, según la altura, una raya la tachaba. Los márgenes son
  // los justos: con todas las columnas, cada pixel de los lados es del nombre.
  const panelX = 28;
  const panelW = w - panelX * 2;
  const padX = 16;
  const legendH = 58;
  const innerX = panelX + padX;
  const innerW = panelW - padX * 2;

  const available = brandY - 24 - headerBottom;
  const rowH = Math.min(MAX_ROW_H, (available - HEAD_ROW_H - legendH) / Math.max(rows.length, 1));
  const panelH = HEAD_ROW_H + rowH * rows.length + legendH;

  // Si la tabla es corta sobra cancha: el panel se centra entre el encabezado
  // y el logo en vez de quedarse pegado arriba.
  const panelY = headerBottom + Math.max(0, available - panelH) / 2;

  const columns = imageColumns(table, usesPoints);

  const numRight = innerX + innerW;
  let cursor = numRight;
  const colCenter = {};
  for (const col of [...columns].reverse()) {
    cursor -= col.width;
    colCenter[col.id] = cursor + col.width / 2;
  }

  const logoSize = Math.min(LOGO_MAX, Math.round(rowH * 0.72));
  const rankCenter = innerX + RANK_W / 2;
  const logoX = innerX + RANK_W;
  const nameX = logoX + logoSize + LOGO_GAP;
  const nameMax = cursor - NAME_GAP - nameX;

  // La letra crece con el renglón, pero con tope: en la historia, con
  // renglones de 70 px, las cifras sin tope llenaban su columna y DIF se
  // pegaba a la racha.
  const numSize = Math.round(clamp(rowH * 0.42, 16, 30));
  const baseNameSize = Math.round(clamp(rowH * 0.48, 16, 34));
  const headSize = Math.round(clamp(rowH * 0.3, 17, 20));

  // Lo que va junto al nombre le quita ancho: el asterisco del empate sin
  // resolver y la pill de comodín.
  const markSize = Math.round(clamp(rowH * 0.24, 12, 18));
  const pillW = wildcardPillWidth(ctx, markSize, theme);
  const extraW = (r) => (r.unresolved_tie ? 22 : 0) + (r.qualified_as === 'wildcard' ? pillW + 12 : 0);
  const nameSize = nameFontSize(
    ctx,
    rows,
    nameMax,
    extraW,
    baseNameSize,
    Math.max(16, Math.round(baseNameSize * 0.6)),
    theme.fontEyebrow,
  );

  // Panel oscuro y OPACO: translúcido, las rayas de yarda del fondo cruzaban
  // la tabla y se leían como separadores de renglón que no coincidían con
  // ningún renglón. Todo lo de adentro se recorta a sus esquinas redondeadas,
  // o la cebra del último renglón se asomaría por fuera.
  roundRect(ctx, panelX, panelY, panelW, panelH, 24);
  ctx.fillStyle = theme.fieldDeep;
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.24)';
  ctx.fill();
  ctx.save();
  roundRect(ctx, panelX, panelY, panelW, panelH, 24);
  ctx.clip();

  // Encabezado de columnas
  const headMid = panelY + HEAD_ROW_H / 2 + 2;
  ctx.fillStyle = theme.inkDim;
  ctx.font = `600 ${headSize}px ${theme.fontEyebrow}`;
  ctx.letterSpacing = '1px';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('#', rankCenter, headMid);
  ctx.textAlign = 'left';
  ctx.fillText('EQUIPO', logoX, headMid);
  ctx.textAlign = 'center';
  for (const col of columns) {
    ctx.fillStyle = col.highlight ? theme.flag : theme.inkDim;
    ctx.fillText(col.label, colCenter[col.id], headMid);
  }
  ctx.letterSpacing = '0px';
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(panelX, panelY + HEAD_ROW_H - 1, panelW, 2);

  rows.forEach((r, i) => {
    const rowY = panelY + HEAD_ROW_H + i * rowH;
    const midY = rowY + rowH / 2;

    if (i % 2 === 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(panelX, rowY, panelW, rowH);
    }

    // La barra amarilla de los que clasifican, como la tabla en pantalla.
    if (rowQualifies(r, qualifyingCount)) {
      ctx.fillStyle = theme.flag;
      ctx.fillRect(panelX + 6, rowY + 4, 6, rowH - 8);
    }

    // El que todavía no juega va atenuado, igual que en pantalla.
    ctx.globalAlpha = r.played === 0 ? 0.55 : 1;

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.ink;
    ctx.font = `700 ${numSize}px ${theme.fontEyebrow}`;
    ctx.fillText(String(r.rank), rankCenter, midY + 1);

    drawTeamLogo(ctx, logos[i], r.name, logoX, midY, logoSize, theme);

    ctx.textAlign = 'left';
    ctx.fillStyle = theme.ink;
    ctx.font = `600 ${nameSize}px ${theme.fontEyebrow}`;
    const name = ellipsize(ctx, r.name, nameMax - extraW(r));
    ctx.fillText(name, nameX, midY + 1);
    let markX = nameX + ctx.measureText(name).width + 6;

    if (r.unresolved_tie) {
      ctx.fillStyle = theme.flag;
      ctx.font = `700 ${Math.round(nameSize * 1.1)}px ${theme.fontEyebrow}`;
      ctx.fillText('*', markX, midY + 4);
      markX += 22;
    }
    if (r.qualified_as === 'wildcard') {
      drawWildcardPill(ctx, markX + 6, midY, markSize, theme);
    }

    ctx.textAlign = 'center';
    for (const col of columns) {
      ctx.fillStyle = col.highlight ? theme.flag : theme.ink;
      ctx.font = `${col.highlight ? 700 : 500} ${numSize}px ${theme.fontEyebrow}`;
      ctx.fillText(cellText(col.id, r), colCenter[col.id], midY + 1);
    }

    ctx.globalAlpha = 1;
  });

  // --- Pie del panel: la fecha de corte y, solo si aparecen, las marcas ---
  const legendTop = panelY + HEAD_ROW_H + rowH * rows.length;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(panelX, legendTop, panelW, 2);
  const marks = tableMarks(table);
  const legend = [{ text: cutoffLabel(date) }];
  if (marks.qualifies) legend.push({ mark: 'bar', text: 'Clasifica' });
  if (marks.unresolvedTie) legend.push({ mark: 'star', text: 'Empate sin resolver' });
  drawLegend(ctx, legend, w / 2, legendTop + legendH / 2 + 1, theme);

  ctx.restore();

  // --- Logo de la marca ---
  // El JPG trae fondo verde: se recorta con esquinas redondeadas para que el
  // borde no se note como un recuadro pegado sobre la cancha.
  if (brandImg) {
    const bx = (w - brandW) / 2;
    ctx.save();
    roundRect(ctx, bx, brandY, brandW, brandH, 16);
    ctx.clip();
    drawImageContain(ctx, brandImg, bx, brandY, brandW, brandH);
    ctx.restore();
  }

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
}

export const SHARE_CARD_FORMATS = FORMATS;
