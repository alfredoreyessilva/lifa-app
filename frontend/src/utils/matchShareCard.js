// Genera la imagen "próximo partido" para compartir (GAME_PREVIEW).
//
// Principio de diseño (ver conversación de producto): los datos objetivos
// (nombres, fecha, hora, sede) SIEMPRE vienen del objeto `match` que ya
// devuelve la API — nada se inventa ni se decide con IA aquí. Este archivo
// solo es responsable de dibujar esos datos sobre un layout fijo.
//
// Todo corre en el navegador del usuario (canvas 2D). No toca el backend,
// no depende de ningún servicio de renderizado nuevo.
//
// Los helpers genéricos de dibujo (tema, imágenes, fuentes, ícono del
// balón, panel de texto) viven en shareCardCommon.js — se extrajeron ahí
// para reusarlos también en playerShareCard.js sin duplicar código.

import {
  FORMATS, readTheme, loadImage, ensureFonts, drawCircleBadge,
  fitText, drawBallIcon, drawBackground, drawTextPanel, drawFooter,
  roundRect,
} from './shareCardCommon.js';

// Pill de "JORNADA N" en la esquina superior derecha, en espejo con el
// ícono del balón (esquina superior izquierda). Solo se usa aquí — a
// diferencia de los demás helpers, no aplica a la tarjeta de jugador.
function drawJornadaPill(ctx, text, rightX, centerY, theme) {
  ctx.save();
  ctx.font = `700 26px ${theme.fontEyebrow}`;
  const padX = 22;
  const textWidth = ctx.measureText(text).width;
  const pillW = textWidth + padX * 2;
  const pillH = 48;
  const pillX = rightX - pillW;
  const pillY = centerY - pillH / 2;

  roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fillStyle = theme.flag;
  ctx.fill();

  ctx.fillStyle = theme.fieldDeep;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pillX + pillW / 2, pillY + pillH / 2 + 1);
  ctx.restore();
}

/**
 * Genera la imagen del partido.
 * @param {object} match - el objeto que devuelve api.getMatch (sin transformar)
 * @param {'post'|'story'} formatKey
 * @param {{day:string, month:string, time:string, tzLabel:string}} dateParts - de getMatchParts()
 * @param {'scheduled'|'live'|'finished'} [status] - de getMatchStatus(match). Si el partido ya
 *   finalizó y trae marcador, se dibuja el marcador en vez de "VS"; si está en vivo, se dibuja
 *   "EN VIVO". Mismo criterio que MatchPage.jsx/MatchCard.jsx.
 * @returns {Promise<Blob>}
 */
export async function generateMatchCard(match, formatKey, dateParts, status) {
  const format = FORMATS[formatKey] || FORMATS.post;
  const theme = readTheme();
  const { width: w, height: h } = format;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  await ensureFonts();
  const [homeImg, awayImg, leagueImg] = await Promise.all([
    loadImage(match.home_logo_url),
    loadImage(match.away_logo_url),
    loadImage(match.league_logo_url),
  ]);

  drawBackground(ctx, w, h, theme);

  const iconSize = w * 0.075;
  const iconMargin = w * 0.055;
  drawBallIcon(ctx, iconMargin, iconMargin, iconSize, theme);

  // Jornada, en espejo con el ícono del balón (misma altura, lado
  // contrario) — solo si el partido tiene week_label. Mismo criterio que
  // MatchCard.jsx/MatchPage.jsx: si es puramente numérico se antepone
  // "JORNADA", si no, se muestra el texto tal cual (ej. "FINAL").
  if (match.week_label) {
    const jornadaText = /^\d+$/.test(match.week_label)
      ? `JORNADA ${match.week_label}`
      : match.week_label.toUpperCase();
    drawJornadaPill(ctx, jornadaText, w - iconMargin, iconMargin + iconSize / 2, theme);
  }

  const cx = w / 2;
  let y = h * 0.10;

  // --- Encabezado: liga / torneo / categoría ---
  if (leagueImg) {
    const size = 110;
    ctx.drawImage(leagueImg, cx - size / 2, y, size, size);
    y += size + 20;
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = theme.flag;
  ctx.font = `600 30px ${theme.fontEyebrow}`;
  ctx.fillText((match.league_name || 'LIFA').toUpperCase(), cx, y);
  y += 42;

  // Nombre del torneo, justo debajo de la liga — mismo tratamiento visual
  // que el eyebrow de liga pero más pequeño y en tinta tenue, para que se
  // lea como un subtítulo y no compita con el nombre de la liga.
  if (match.tournament_name) {
    ctx.fillStyle = theme.inkDim;
    ctx.font = `600 24px ${theme.fontEyebrow}`;
    ctx.fillText(match.tournament_name.toUpperCase(), cx, y);
    y += 34;
  }

  const categoryLabel = [match.category_name, match.season, match.year].filter(Boolean).join(' · ');

  // --- Sección central: equipos ---
  const badgeY = h * 0.36;
  const badgeRadius = w * 0.16;
  const badgeOffsetX = w * 0.26;

  drawCircleBadge(ctx, homeImg, match.home_team, cx - badgeOffsetX, badgeY, badgeRadius, theme);
  drawCircleBadge(ctx, awayImg, match.away_team, cx + badgeOffsetX, badgeY, badgeRadius, theme);

  // "VS" al centro — salvo que el partido ya tenga marcador (finished) o
  // esté en curso (live), igual que se muestra en MatchPage.jsx/MatchCard.jsx.
  const hasScore = status === 'finished' && match.home_score != null && match.away_score != null;
  ctx.fillStyle = theme.flag;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (hasScore) {
    ctx.font = `600 22px ${theme.fontEyebrow}`;
    ctx.fillStyle = theme.inkDim;
    ctx.fillText('FINALIZADO', cx, badgeY - 56);

    ctx.fillStyle = theme.flag;
    ctx.font = `700 64px ${theme.fontDisplay}`;
    ctx.fillText(`${match.home_score} - ${match.away_score}`, cx, badgeY);
  } else if (status === 'live') {
    ctx.font = `700 30px ${theme.fontEyebrow}`;
    ctx.fillText('EN VIVO', cx, badgeY);
  } else {
    ctx.font = `700 64px ${theme.fontDisplay}`;
    ctx.fillText('VS', cx, badgeY);
  }

  // Nombres de equipo debajo de cada badge
  const namesY = badgeY + badgeRadius + 56;
  const maxNameWidth = w * 0.38;

  ctx.fillStyle = theme.ink;
  ctx.textBaseline = 'alphabetic';
  let size = fitText(ctx, match.home_team.toUpperCase(), maxNameWidth, 44, theme.fontDisplay);
  ctx.font = `700 ${size}px ${theme.fontDisplay}`;
  ctx.fillText(match.home_team.toUpperCase(), cx - badgeOffsetX, namesY);

  size = fitText(ctx, match.away_team.toUpperCase(), maxNameWidth, 44, theme.fontDisplay);
  ctx.font = `700 ${size}px ${theme.fontDisplay}`;
  ctx.fillText(match.away_team.toUpperCase(), cx + badgeOffsetX, namesY);

  // --- Panel de fecha / hora / categoría / sede — una sola "tarjeta" oscura ---
  const panelY = namesY + 70;
  const panelW = w * 0.82;

  const panelLines = [
    { text: `${dateParts.day} ${dateParts.month}`, font: `700 46px ${theme.fontDisplay}`, color: theme.flag, gapBefore: 0 },
    { text: `${dateParts.time} · ${dateParts.tzLabel}`, font: `600 32px ${theme.fontEyebrow}`, color: theme.ink, gapBefore: 54 },
  ];
  if (categoryLabel) {
    panelLines.push({ text: categoryLabel, font: `500 26px ${theme.fontBody}`, color: theme.inkDim, gapBefore: 44 });
  }
  if (match.venue_name) {
    panelLines.push({ text: match.venue_name, font: `500 28px ${theme.fontBody}`, color: theme.inkDim, gapBefore: 40 });
  }

  drawTextPanel(ctx, panelLines, cx, panelY, panelW, theme);

  // --- Footer: marca LIFA ---
  drawFooter(ctx, cx, h, theme);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
}

export const SHARE_CARD_FORMATS = FORMATS;
