// Genera la imagen de tarjeta del jugador para compartir, mismo principio
// que matchShareCard.js: los datos objetivos vienen de lo que ya devuelve
// GET /players/:id/card — nada se inventa aquí, este archivo solo dibuja.

import {
  FORMATS, readTheme, loadImage, ensureFonts, drawCircleBadge,
  fitText, drawBallIcon, drawBackground, drawTextPanel, drawFooter,
} from './shareCardCommon.js';

// Mismo orden que STAT_GROUPS en PlayerCardPage.jsx: se muestra el primer
// grupo que tenga datos, como "estadística destacada" de la imagen.
// Duplicado a propósito con etiquetas más cortas — están pensadas para
// caber en el panel de la imagen, no en la pantalla.
const HEADLINE_GROUPS = [
  { label: 'PASE', check: (s) => s.passAttempts > 0, line: (s) => `${s.passCompletions}/${s.passAttempts} · ${s.passYards} YDS · ${s.passTd} TD` },
  { label: 'CARRERA', check: (s) => s.rushAttempts > 0, line: (s) => `${s.rushYards} YDS · ${s.rushTd} TD` },
  { label: 'RECEPCIÓN', check: (s) => s.receptions > 0, line: (s) => `${s.receptions} REC · ${s.receivingYards} YDS · ${s.receivingTd} TD` },
  { label: 'DEFENSA', check: (s) => s.tackles > 0 || s.sacks > 0 || s.interceptionsDef > 0, line: (s) => `${s.tackles} TKL · ${s.sacks} SACK · ${s.interceptionsDef} INT` },
  { label: 'ESPECIALES', check: (s) => s.fieldGoalsMade > 0 || s.extraPointsMade > 0, line: (s) => `${s.fieldGoalsMade} FG · ${s.extraPointsMade} PAT` },
];

function pickHeadline(stats) {
  return HEADLINE_GROUPS.find((g) => g.check(stats)) || null;
}

/**
 * Genera la imagen de la tarjeta del jugador.
 * @param {object} player - player de GET /players/:id/card
 * @param {object|null} currentTeam - elemento de trajectory sin end_date (o null)
 * @param {object} stats - stats de GET /players/:id/card (camelCase)
 * @param {'post'|'story'} formatKey
 * @returns {Promise<Blob>}
 */
export async function generatePlayerCard(player, currentTeam, stats, formatKey) {
  const format = FORMATS[formatKey] || FORMATS.post;
  const theme = readTheme();
  const { width: w, height: h } = format;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  await ensureFonts();
  const [photoImg, teamImg] = await Promise.all([
    loadImage(player.photo_url),
    loadImage(currentTeam?.team_logo_url),
  ]);

  drawBackground(ctx, w, h, theme);

  const iconSize = w * 0.075;
  const iconMargin = w * 0.055;
  drawBallIcon(ctx, iconMargin, iconMargin, iconSize, theme);

  const cx = w / 2;
  let y = h * 0.09;

  ctx.textAlign = 'center';
  ctx.fillStyle = theme.flag;
  ctx.font = `600 28px ${theme.fontEyebrow}`;
  ctx.fillText('TARJETA DE JUGADOR', cx, y);
  y += 50;

  // --- Foto del jugador ---
  const photoRadius = w * 0.22;
  const photoY = y + photoRadius;
  drawCircleBadge(ctx, photoImg, `${player.first_name} ${player.last_name}`, cx, photoY, photoRadius, theme);
  y = photoY + photoRadius + 60;

  // --- Nombre ---
  const fullName = `${player.first_name} ${player.last_name}`.toUpperCase();
  const maxNameWidth = w * 0.82;
  ctx.fillStyle = theme.ink;
  ctx.textBaseline = 'alphabetic';
  let size = fitText(ctx, fullName, maxNameWidth, 60, theme.fontDisplay);
  ctx.font = `700 ${size}px ${theme.fontDisplay}`;
  ctx.fillText(fullName, cx, y);
  y += 44;

  // --- Posición / número ---
  const eyebrowParts = [];
  if (player.jersey_number != null) eyebrowParts.push(`#${player.jersey_number}`);
  if (player.position) eyebrowParts.push(player.position);
  if (eyebrowParts.length) {
    ctx.fillStyle = theme.flag;
    ctx.font = `600 30px ${theme.fontEyebrow}`;
    ctx.fillText(eyebrowParts.join(' · '), cx, y);
    y += 40;
  }

  // --- Equipo actual ---
  if (currentTeam) {
    const teamY = y + 30;
    const badgeR = 26;
    if (teamImg) {
      drawCircleBadge(ctx, teamImg, currentTeam.team_name, cx - 90, teamY, badgeR, theme);
    }
    ctx.fillStyle = theme.inkDim;
    ctx.font = `500 28px ${theme.fontBody}`;
    ctx.textAlign = 'left';
    ctx.fillText(currentTeam.team_name, cx - 90 + badgeR + 14, teamY + 10);
    ctx.textAlign = 'center';
    y = teamY + badgeR + 40;
  } else {
    y += 20;
  }

  // --- Panel de estadística destacada ---
  const panelY = y + 20;
  const panelW = w * 0.82;
  const headline = pickHeadline(stats);

  const panelLines = [];
  if (headline) {
    panelLines.push({ text: headline.label, font: `600 28px ${theme.fontEyebrow}`, color: theme.flag, gapBefore: 0 });
    panelLines.push({ text: headline.line(stats), font: `700 40px ${theme.fontDisplay}`, color: theme.ink, gapBefore: 50 });
  } else {
    panelLines.push({ text: 'SIN ESTADÍSTICAS TODAVÍA', font: `600 28px ${theme.fontEyebrow}`, color: theme.inkDim, gapBefore: 0 });
  }
  panelLines.push({
    text: `${stats.gamesPlayed} partido${stats.gamesPlayed === 1 ? '' : 's'} jugado${stats.gamesPlayed === 1 ? '' : 's'}`,
    font: `500 26px ${theme.fontBody}`,
    color: theme.inkDim,
    gapBefore: 44,
  });

  drawTextPanel(ctx, panelLines, cx, panelY, panelW, theme);

  // --- Footer: marca LIFA ---
  drawFooter(ctx, cx, h, theme);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
}

export const SHARE_CARD_FORMATS = FORMATS;
