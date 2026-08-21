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
} from './shareCardCommon.js';

/**
 * Genera la imagen del partido.
 * @param {object} match - el objeto que devuelve api.getMatch (sin transformar)
 * @param {'post'|'story'} formatKey
 * @param {{day:string, month:string, time:string, tzLabel:string}} dateParts - de getMatchParts()
 * @returns {Promise<Blob>}
 */
export async function generateMatchCard(match, formatKey, dateParts) {
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

  const cx = w / 2;
  let y = h * 0.10;

  // --- Encabezado: liga / categoría ---
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

  const categoryLabel = [match.category_name, match.season, match.year].filter(Boolean).join(' · ');

  // --- Sección central: equipos ---
  const badgeY = h * 0.36;
  const badgeRadius = w * 0.16;
  const badgeOffsetX = w * 0.26;

  drawCircleBadge(ctx, homeImg, match.home_team, cx - badgeOffsetX, badgeY, badgeRadius, theme);
  drawCircleBadge(ctx, awayImg, match.away_team, cx + badgeOffsetX, badgeY, badgeRadius, theme);

  // "VS" al centro
  ctx.fillStyle = theme.flag;
  ctx.font = `700 64px ${theme.fontDisplay}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VS', cx, badgeY);

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
