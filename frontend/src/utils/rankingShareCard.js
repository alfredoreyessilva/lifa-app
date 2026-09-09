// Genera la imagen del "Top 10" del ranking de predicciones para compartir.
//
// Mismo principio que matchShareCard.js / playerShareCard.js: los datos
// objetivos (nombres, puntos, aciertos) vienen tal cual del endpoint
// GET /predictions/ranking (o /pools/:code/ranking) — nada se inventa ni se
// decide con IA aquí. Este archivo solo dibuja esos datos sobre un layout
// fijo, con canvas 2D en el navegador del usuario. No toca el backend.
//
// Los helpers genéricos (tema, fuentes, fondo, ícono del balón) viven en
// shareCardCommon.js, iguales a las otras tarjetas.

import {
  FORMATS, readTheme, ensureFonts, loadImage, drawBallIcon, drawBackground,
  fitText, roundRect,
} from './shareCardCommon.js';

const MAX_ROWS = 10;

// Logo de la marca (mismo archivo que el footer del sitio en App.jsx).
// El JPG ya trae el fondo verde de la cancha, así que se integra sin
// recuadro. Relación de aspecto real del archivo (1376 x 768).
const BRAND_LOGO_SRC = '/cfbamx.jpg';
const BRAND_LOGO_RATIO = 1376 / 768;

// Dibuja una imagen "contain" (respeta proporción, centrada) dentro de un
// recuadro. Si no hay imagen, no hace nada.
function drawImageContain(ctx, img, boxX, boxY, boxW, boxH) {
  if (!img) return;
  const scale = Math.min(boxW / img.width, boxH / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, boxX + (boxW - dw) / 2, boxY + (boxH - dh) / 2, dw, dh);
}

// Recorta un texto con "…" para que quepa en maxWidth con la fuente que
// ya esté puesta en el contexto.
function ellipsize(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t.trimEnd()}…`;
}

// Línea de detalle bajo cada nombre — mismo criterio que CalendarRanking.jsx.
function detailLine(r) {
  if (r.graded > 0) {
    const pct = r.accuracyPct === null ? '' : ` · ${r.accuracyPct}%`;
    return `${r.correct}/${r.graded} aciertos${pct}`;
  }
  const n = r.total === 1 ? 'predicción' : 'predicciones';
  return `${r.total} ${n} · sin calificar`;
}

/**
 * Dibuja el encabezado (la "zona de anotación" arriba de la tarjeta):
 *   RANKING DE PREDICCIONES  (fijo, eyebrow)
 *   [QUINIELA · nombre]      (solo quinielas)
 *   NOMBRE DEL TORNEO        (resaltado — es el título de la imagen)
 *   categoría · rama         (info complementaria)
 * El logo de la liga va en la esquina superior derecha (fuera de esta
 * función, ver generateRankingCard). Devuelve la `y` donde empieza la lista.
 */
function drawHeader(ctx, w, h, theme, header, rowCount, totalParticipants) {
  const cx = w / 2;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Eyebrow fijo — pegado arriba, a la altura del ícono del balón (la
  // "zona de anotación" de la cancha).
  let y = h * 0.038;
  ctx.fillStyle = theme.flag;
  ctx.font = `700 30px ${theme.fontEyebrow}`;
  ctx.letterSpacing = '3px';
  ctx.fillText('RANKING DE PREDICCIONES', cx, y);
  ctx.letterSpacing = '0px';
  y += 34;

  // Quiniela (opcional)
  if (header.poolName) {
    ctx.fillStyle = theme.inkDim;
    ctx.font = `600 22px ${theme.fontEyebrow}`;
    ctx.fillText(`QUINIELA · ${header.poolName.toUpperCase()}`, cx, y);
    y += 34;
  }

  // Respiro claro entre el eyebrow y el título.
  y += 40;

  // Torneo — es el título de la imagen, en blanco
  const hero = (header.tournament || header.title || 'LIFA').toUpperCase();
  const heroSize = fitText(ctx, hero, w * 0.86, 62, theme.fontDisplay);
  ctx.fillStyle = theme.ink;
  ctx.font = `700 ${heroSize}px ${theme.fontDisplay}`;
  ctx.fillText(hero, cx, y);
  y += heroSize * 0.32 + 24;

  // Categoría · rama — info complementaria
  if (header.context) {
    ctx.fillStyle = theme.inkDim;
    ctx.font = `500 24px ${theme.fontBody}`;
    ctx.fillText(header.context, cx, y);
    y += 34;
  }

  y += 10;

  // Nota de puntuación + participantes
  const countLabel = totalParticipants === 1 ? '1 participante' : `${totalParticipants} participantes`;
  ctx.fillStyle = theme.inkDim;
  ctx.font = `500 20px ${theme.fontBody}`;
  ctx.fillText(`Top ${rowCount} · ${countLabel} · 1 pt acierto · 2 pts fase final`, cx, y);
  y += 34;

  return y;
}

/**
 * Genera la imagen del Top 10 del ranking.
 * @param {Array<{userId:number,name:string,total:number,graded:number,correct:number,points:number,accuracyPct:number|null}>} ranking
 *   la lista COMPLETA que devuelve la API (ya ordenada); aquí se recortan las primeras 10.
 * @param {'post'|'story'} formatKey
 * @param {{title?:string, tournament?:string, context?:string, poolName?:string, leagueLogo?:string}} header
 *   `tournament` (o `title` como respaldo) es el texto resaltado; `context` es "categoría · rama";
 *   `leagueLogo` es la URL del logo de la liga (esquina superior derecha).
 * @returns {Promise<Blob>}
 */
export async function generateRankingCard(ranking, formatKey, header = {}) {
  const format = FORMATS[formatKey] || FORMATS.post;
  const theme = readTheme();
  const { width: w, height: h } = format;

  const rows = (ranking || []).slice(0, MAX_ROWS);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  await ensureFonts();
  const [leagueImg, brandImg] = await Promise.all([
    loadImage(header.leagueLogo),
    loadImage(BRAND_LOGO_SRC),
  ]);

  drawBackground(ctx, w, h, theme);

  // Ícono del balón arriba a la izquierda, a la altura del eyebrow
  // "RANKING DE PREDICCIONES" para que lean como una sola banda superior.
  const iconSize = w * 0.075;
  drawBallIcon(ctx, w * 0.055, h * 0.022, iconSize, theme);

  // Logo de la liga en la esquina superior derecha (espejo del balón).
  if (leagueImg) {
    const box = w * 0.11;
    drawImageContain(ctx, leagueImg, w - w * 0.055 - box, h * 0.022, box, box);
  }

  // Reserva para el logo de la marca abajo al centro (se dibuja al final,
  // encima de todo). Reemplaza al texto "CFBAMX" + slogan del footer viejo.
  const brandW = w * 0.27;
  const brandH = brandW / BRAND_LOGO_RATIO;
  const brandMargin = h * 0.03;

  const y = drawHeader(ctx, w, h, theme, header, rows.length, (ranking || []).length);

  // --- Lista Top 10 ---
  const listX = w * 0.07;
  const listW = w - listX * 2;
  const listTop = y;
  const listBottom = h - brandH - brandMargin * 2; // deja aire para el logo
  const rowH = rows.length > 0
    ? Math.min(110, (listBottom - listTop) / rows.length)
    : 0;

  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  roundRect(ctx, listX, listTop, listW, rowH * rows.length + 24, 24);
  ctx.fill();

  const padX = 32;
  const badgeR = Math.min(26, rowH * 0.28);
  const nameX = listX + padX + badgeR * 2 + 22;
  const pointsX = listX + listW - padX;
  const nameMaxW = pointsX - nameX - 120;

  rows.forEach((r, i) => {
    const rowY = listTop + 12 + i * rowH;
    const midY = rowY + rowH / 2;

    // separador entre filas
    if (i > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(listX + padX, rowY);
      ctx.lineTo(listX + listW - padX, rowY);
      ctx.stroke();
    }

    // badge de posición — top 3 en amarillo, el resto en tinta tenue
    const isPodium = i < 3;
    ctx.beginPath();
    ctx.arc(listX + padX + badgeR, midY, badgeR, 0, Math.PI * 2);
    ctx.fillStyle = isPodium ? theme.flag : 'rgba(255,255,255,0.12)';
    ctx.fill();
    ctx.fillStyle = isPodium ? theme.fieldDeep : theme.ink;
    ctx.font = `700 ${Math.round(badgeR * 1.05)}px ${theme.fontDisplay}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), listX + padX + badgeR, midY + 1);

    // nombre + detalle
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.ink;
    ctx.font = `700 30px ${theme.fontEyebrow}`;
    ctx.fillText(ellipsize(ctx, r.name, nameMaxW), nameX, midY - 6);

    ctx.fillStyle = theme.inkDim;
    ctx.font = `500 20px ${theme.fontBody}`;
    ctx.fillText(ellipsize(ctx, detailLine(r), nameMaxW + 90), nameX, midY + 22);

    // puntos
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = theme.flag;
    ctx.font = `700 40px ${theme.fontDisplay}`;
    const ptsText = String(r.points ?? 0);
    ctx.fillText(ptsText, pointsX, midY + 6);
    const ptsW = ctx.measureText(ptsText).width;
    ctx.fillStyle = theme.inkDim;
    ctx.font = `600 18px ${theme.fontEyebrow}`;
    ctx.fillText('PTS', pointsX - ptsW - 8, midY + 6);

    ctx.textBaseline = 'alphabetic';
  });

  // --- Logo de la marca, abajo al centro ---
  // El JPG trae fondo verde: se recorta con esquinas redondeadas para que
  // el borde no se note como un recuadro pegado sobre la cancha.
  if (brandImg) {
    const bx = (w - brandW) / 2;
    const by = h - brandMargin - brandH;
    ctx.save();
    roundRect(ctx, bx, by, brandW, brandH, 18);
    ctx.clip();
    drawImageContain(ctx, brandImg, bx, by, brandW, brandH);
    ctx.restore();
  }

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
}

export const SHARE_CARD_FORMATS = FORMATS;
