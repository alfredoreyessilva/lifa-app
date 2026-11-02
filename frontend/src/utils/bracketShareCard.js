// Genera la imagen del bracket de los playoffs de una conferencia, para
// compartir. README, "El bracket de los playoffs".
//
// Mismo principio que la imagen de la tabla (standingsShareCard.js): todo lo
// que dice viene tal cual de GET /leagues/branches/:id/bracket —la siembra,
// los cruces reacomodados, los marcadores y el campeón ya los resolvió el
// backend—; aquí solo se dibuja, con canvas 2D en el navegador de quien la
// pide. El acomodo en espejo y cómo se escribe cada cruce salen de
// utils/bracketFormat.js, el mismo archivo que usa la página.
//
// La imagen de guía que pasó Alfredo lleva solo escudos. Esta lleva también los
// nombres: circula sin la página al lado, y no todos los equipos tienen escudo
// (los que no, salen con iniciales).

import {
  FORMATS, readTheme, ensureFonts, loadImage, drawBallIcon, drawBackground,
  fitText, roundRect, drawImageContain, ellipsize, initials,
  BRAND_LOGO_SRC, BRAND_LOGO_RATIO,
} from './shareCardCommon.js';
import { imagenAjustada } from './imagenes.js';
import { cutoffLabel } from './standingsFormat.js';
import { mirrorColumns, roundShortName, gameStatus, bracketTitle, hasTiedSeeds, finalLabel, logoForSide } from './bracketFormat.js';

const LOGO_TIMEOUT_MS = 8000;
const HEAD_H = 46;
const LEGEND_H = 58;
const MAX_BOX_H = 196;
const COL_GAP = 10;
const LIVE = '#ff5252';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function loadImageWithin(url, ms) {
  if (!url) return Promise.resolve(null);
  return Promise.race([
    loadImage(url),
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

// Pill amarilla con el nombre del bracket ("CONFERENCIA NACIONAL"), igual a la
// de la imagen de la tabla. Devuelve su alto.
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

function drawHeader(ctx, w, h, theme, header, bracket, cornerEdge) {
  const cx = w / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  let y = h * 0.038;
  ctx.fillStyle = theme.flag;
  ctx.font = `700 30px ${theme.fontEyebrow}`;
  ctx.letterSpacing = '3px';
  ctx.fillText('PLAYOFFS', cx, y);
  ctx.letterSpacing = '0px';
  y += 34 + 40;

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

  const scope = bracketTitle(bracket).toUpperCase();
  if (scope) {
    y += 6;
    y += drawPill(ctx, scope, cx, y, w * 0.8, theme);
  }
  return y + 24;
}

// Parte un nombre en a lo más `maxLines` renglones que quepan en `maxW`. El
// último se recorta con "…" si ni así cabe.
function wrapLines(ctx, text, maxW, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (let i = 0; i < words.length; i++) {
    const probe = current ? `${current} ${words[i]}` : words[i];
    if (ctx.measureText(probe).width <= maxW || !current) {
      current = probe;
    } else {
      lines.push(current);
      current = words[i];
      if (lines.length === maxLines - 1) {
        current = words.slice(i).join(' ');
        break;
      }
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines).map((l, i, arr) => (i === arr.length - 1 ? ellipsize(ctx, l, maxW) : l));
}

// La letra más grande con la que TODOS los nombres caben en dos renglones sin
// recortar, para que las cajas se vean parejas. El que ni a la mínima cabe no
// arrastra a los demás: se recorta.
function nameFontSize(ctx, names, maxW, base, min, family) {
  const cabe = (name, size) => {
    ctx.font = `600 ${size}px ${family}`;
    const lines = wrapLines(ctx, name, maxW, 2);
    return !lines.some((l) => l.endsWith('…'));
  };
  const medibles = names.filter((n) => cabe(n, min));
  let size = base;
  while (size > min && medibles.some((n) => !cabe(n, size))) size -= 1;
  return size;
}

function drawLogo(ctx, img, name, cx, cy, size, theme) {
  if (img) {
    drawImageContain(ctx, img, cx - size / 2, cy - size / 2, size, size);
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fill();
  ctx.fillStyle = theme.ink;
  ctx.font = `600 ${Math.round(size * 0.36)}px ${theme.fontEyebrow}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials(name), cx, cy + 1);
  ctx.restore();
}

// Una caja de equipo: siembra arriba a la izquierda, marcador arriba a la
// derecha, escudo al centro y el nombre abajo. El ganador lleva marco amarillo
// y el que perdió va atenuado, como en la página.
function drawTeamBox(ctx, p, box, opts) {
  const { x, y, w, h } = box;
  const { theme, logos, state, nameSize, tiedIds, placeholder, side = null } = opts;

  ctx.save();
  if (state === 'loser') ctx.globalAlpha = 0.45;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fill();
  ctx.lineWidth = state === 'winner' ? 4 : 2;
  ctx.strokeStyle = state === 'winner' ? theme.flag : 'rgba(255,255,255,0.18)';
  ctx.stroke();

  if (!p) {
    ctx.fillStyle = theme.inkDim;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = placeholder ? `600 ${Math.round(nameSize * 0.9)}px ${theme.fontEyebrow}` : `700 ${Math.round(h * 0.3)}px ${theme.fontEyebrow}`;
    ctx.fillText(placeholder ? placeholder.toUpperCase() : '?', x + w / 2, y + h / 2 + 2);
    ctx.restore();
    return;
  }

  const pad = Math.round(clamp(w * 0.07, 7, 12));
  const seedSize = Math.round(clamp(h * 0.14, 17, 26));
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.flag;
  ctx.font = `700 ${seedSize}px ${theme.fontEyebrow}`;
  ctx.fillText(`${p.seed ?? '–'}${tiedIds.has(p.team_id) ? '*' : ''}`, x + pad, y + pad - 2);

  if (p.score !== null && p.score !== undefined) {
    ctx.textAlign = 'right';
    ctx.fillStyle = theme.ink;
    ctx.font = `700 ${Math.round(seedSize * 1.35)}px ${theme.fontEyebrow}`;
    ctx.fillText(String(p.score), x + w - pad, y + pad - 4);
  }

  // Escudo y nombre, centrados en lo que queda debajo de la siembra.
  const nameLineH = Math.round(nameSize * 1.12);
  const nameBlock = nameLineH * 2;
  const top = y + pad + seedSize * 0.6;
  const bottom = y + h - pad;
  const logoSize = Math.max(24, Math.min(w * 0.5, bottom - top - nameBlock - 8));
  const logoCy = top + (bottom - top - nameBlock - 6) / 2;
  drawLogo(ctx, logos.get(logoForSide(p, side)), p.name, x + w / 2, logoCy, logoSize, theme);

  ctx.font = `600 ${nameSize}px ${theme.fontEyebrow}`;
  ctx.fillStyle = theme.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrapLines(ctx, p.name, w - pad * 2, 2);
  const firstY = bottom - nameBlock + nameLineH / 2 + (lines.length === 1 ? nameLineH / 2 : 0);
  lines.forEach((l, i) => ctx.fillText(l, x + w / 2, firstY + i * nameLineH));
  ctx.restore();
}

// "vs", la fecha, "EN VIVO" o "FINAL", entre las dos cajas de un cruce.
function drawStatusLine(ctx, game, cx, cy, maxW, theme, size) {
  const st = gameStatus(game);
  if (st.kind === 'bye') return;
  const text = st.kind === 'pending' || st.kind === 'unscheduled' ? 'VS' : st.label.toUpperCase();
  ctx.save();
  ctx.font = `600 ${size}px ${theme.fontEyebrow}`;
  ctx.letterSpacing = '1px';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = st.kind === 'live' ? LIVE : st.kind === 'final' || st.kind === 'pending' || st.kind === 'unscheduled' ? theme.flag : theme.inkDim;
  ctx.fillText(ellipsize(ctx, text, maxW), cx, cy);
  ctx.restore();
}

// Un trofeo sencillo, con figuras: un emoji en canvas depende de la fuente de
// cada sistema.
function drawTrophy(ctx, cx, top, size, theme) {
  ctx.save();
  ctx.fillStyle = theme.flag;
  ctx.strokeStyle = theme.flag;
  const cupW = size * 0.62;
  const cupH = size * 0.5;
  const cupTop = top;
  // Copa
  ctx.beginPath();
  ctx.moveTo(cx - cupW / 2, cupTop);
  ctx.lineTo(cx + cupW / 2, cupTop);
  ctx.quadraticCurveTo(cx + cupW / 2, cupTop + cupH, cx, cupTop + cupH);
  ctx.quadraticCurveTo(cx - cupW / 2, cupTop + cupH, cx - cupW / 2, cupTop);
  ctx.closePath();
  ctx.fill();
  // Asas
  ctx.lineWidth = Math.max(3, size * 0.06);
  ctx.beginPath();
  ctx.arc(cx - cupW / 2, cupTop + cupH * 0.3, cupW * 0.2, Math.PI * 0.5, Math.PI * 1.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + cupW / 2, cupTop + cupH * 0.3, cupW * 0.2, -Math.PI * 0.5, Math.PI * 0.5);
  ctx.stroke();
  // Pie y base
  ctx.fillRect(cx - size * 0.05, cupTop + cupH, size * 0.1, size * 0.2);
  roundRect(ctx, cx - size * 0.25, cupTop + cupH + size * 0.2, size * 0.5, size * 0.12, 4);
  ctx.fill();
  ctx.restore();
  return size * 0.82;
}

function drawLegend(ctx, items, cx, y, theme, maxW) {
  ctx.save();
  ctx.font = `500 20px ${theme.fontBody}`;
  ctx.fillStyle = theme.inkDim;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ellipsize(ctx, items.join('  ·  '), maxW), cx, y);
  ctx.restore();
}

/**
 * Genera la imagen de un bracket.
 * @param {object} bracket  uno de `brackets` de GET /leagues/branches/:id/bracket
 * @param {'post'|'story'} formatKey
 * @param {{header?:{tournament?:string, context?:string, leagueLogo?:string}, date?:Date}} options
 * @returns {Promise<Blob>}
 */
export async function generateBracketCard(bracket, formatKey, { header = {}, date = new Date() } = {}) {
  const format = FORMATS[formatKey] || FORMATS.post;
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
  for (const r of bracket.rounds || []) {
    for (const g of r.games) for (const p of [g.top, g.bottom]) if (p && !equipos.has(p.team_id)) equipos.set(p.team_id, p);
  }
  const ids = [...equipos.keys()];
  const cols = mirrorColumns(bracket);

  // Los escudos que se van a pintar, cada uno una vez: el de siempre de todos
  // (el campeón lo lleva aunque venga del lado derecho) y el de visitante de
  // los que salen del lado derecho, igual que en la página.
  const derecha = [
    ...cols.right.flatMap((c) => c.games.flatMap((g) => [g.top, g.bottom])),
    cols.final?.right,
  ];
  const urls = [...new Set([
    ...ids.map((id) => equipos.get(id).logo_url),
    ...derecha.map((p) => logoForSide(p, 'right')),
  ].filter(Boolean))];

  await ensureFonts();
  const [leagueImg, brandImg, ...imgs] = await Promise.all([
    loadImageWithin(imagenAjustada(header.leagueLogo, 240), LOGO_TIMEOUT_MS),
    loadImage(BRAND_LOGO_SRC),
    ...urls.map((u) => loadImageWithin(imagenAjustada(u, 200), LOGO_TIMEOUT_MS)),
  ]);
  const logos = new Map(urls.map((u, i) => [u, imgs[i]]));

  drawBackground(ctx, w, h, theme);

  const cornerX = w * 0.055;
  const cornerY = h * 0.022;
  const cornerBox = w * 0.11;
  drawBallIcon(ctx, cornerX, cornerY, w * 0.075, theme);
  if (leagueImg) drawImageContain(ctx, leagueImg, w - cornerX - cornerBox, cornerY, cornerBox, cornerBox);

  const headerBottom = drawHeader(ctx, w, h, theme, header, bracket, cornerX + cornerBox);

  const brandW = w * 0.2;
  const brandH = brandW / BRAND_LOGO_RATIO;
  const brandY = h - h * 0.026 - brandH;

  // --- Geometría ---
  const sideCols = cols.left.length;              // rondas antes de la final, por lado
  const slots = Math.max(1, (bracket.size || 2) / 2); // cajas de la primera ronda, por lado

  const panelX = 28;
  const panelW = w - panelX * 2;
  const padX = 14;
  const innerX = panelX + padX;
  const innerW = panelW - padX * 2;

  // El centro (trofeo y campeón) es un poco más ancho que una columna.
  const CENTER_UNITS = 1.35;
  const units = sideCols * 2 + 2 + CENTER_UNITS;
  const gaps = sideCols * 2 + 2;
  const colW = (innerW - COL_GAP * gaps) / units;
  const centerW = colW * CENTER_UNITS;

  const available = brandY - 24 - headerBottom;
  const treeMax = available - HEAD_H - LEGEND_H;
  // Cada caja de la primera ronda tiene su renglón; entre las dos de un cruce
  // va la línea del estado.
  const slotH = treeMax / slots;
  const boxH = Math.min(MAX_BOX_H, slotH * 0.8);
  const treeH = Math.min(treeMax, (boxH / 0.8) * slots);
  const panelH = HEAD_H + treeH + LEGEND_H;
  const panelY = headerBottom + Math.max(0, available - panelH) / 2;
  const treeY = panelY + HEAD_H;

  const nameSize = nameFontSize(
    ctx,
    ids.map((id) => equipos.get(id).name || ''),
    colW - 2 * clamp(colW * 0.07, 7, 12),
    Math.round(clamp(boxH * 0.12, 15, 22)),
    13,
    theme.fontEyebrow,
  );
  const statusSize = Math.round(clamp(boxH * 0.1, 14, 19));
  const tiedIds = new Set((bracket.seeds || []).filter((s) => s.tied).map((s) => s.team_id));

  // Panel opaco, como el de la tabla: translúcido, las rayas de la cancha
  // cruzarían las cajas.
  roundRect(ctx, panelX, panelY, panelW, panelH, 24);
  ctx.fillStyle = theme.fieldDeep;
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.24)';
  ctx.fill();

  // Columnas de izquierda a derecha: rondas del lado izquierdo, final
  // izquierda, centro, final derecha, rondas del lado derecho (al revés).
  const columnas = [
    ...cols.left.map((c) => ({ kind: 'round', col: c, side: 'left' })),
    { kind: 'final', side: 'left' },
    { kind: 'center' },
    { kind: 'final', side: 'right' },
    ...[...cols.right].reverse().map((c) => ({ kind: 'round', col: c, side: 'right' })),
  ];

  let x = innerX;
  const boxOpts = (p, g, side = null) => ({
    theme, logos, nameSize, tiedIds, side,
    state: !p || !g?.winner_team_id ? '' : p.team_id === g.winner_team_id ? 'winner' : 'loser',
  });

  for (const c of columnas) {
    const cw = c.kind === 'center' ? centerW : colW;
    const cx = x + cw / 2;

    // Cabeza de la columna
    ctx.save();
    ctx.fillStyle = theme.flag;
    ctx.font = `700 19px ${theme.fontEyebrow}`;
    ctx.letterSpacing = '2px';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const head = c.kind === 'round' ? roundShortName(c.col.round.name) : c.kind === 'final' ? 'Final' : '';
    if (head) ctx.fillText(ellipsize(ctx, head.toUpperCase(), cw), cx, panelY + HEAD_H / 2 + 2);
    ctx.restore();

    if (c.kind === 'round') {
      const games = c.col.games;
      const gameH = treeH / games.length;
      games.forEach((g, i) => {
        const gy = treeY + i * gameH;
        const topCy = gy + gameH * 0.25;
        const botCy = gy + gameH * 0.75;
        drawTeamBox(ctx, g.top, { x, y: topCy - boxH / 2, w: cw, h: boxH }, boxOpts(g.top, g, c.side));
        drawTeamBox(ctx, g.bottom, { x, y: botCy - boxH / 2, w: cw, h: boxH }, { ...boxOpts(g.bottom, g, c.side), placeholder: g.bye ? 'Descansa' : null });
        drawStatusLine(ctx, g, cx, gy + gameH / 2, cw, theme, statusSize);
      });
    } else if (c.kind === 'final' && cols.final) {
      const p = c.side === 'left' ? cols.final.left : cols.final.right;
      drawTeamBox(ctx, p, { x, y: treeY + treeH / 2 - boxH / 2, w: cw, h: boxH }, boxOpts(p, cols.final.game, c.side));
    } else if (c.kind === 'center' && cols.final) {
      const trophySize = Math.min(cw * 0.55, treeH * 0.16);
      let y = treeY + treeH * 0.5 - boxH * 0.5 - trophySize * 0.9 - 30;
      y += drawTrophy(ctx, cx, Math.max(treeY + 8, y), trophySize, theme) + 14;

      ctx.save();
      ctx.fillStyle = theme.flag;
      ctx.font = `700 20px ${theme.fontEyebrow}`;
      ctx.letterSpacing = '2px';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('CAMPEÓN', cx, treeY + treeH / 2 - boxH / 2 - 18);
      ctx.restore();

      const champ = bracket.champion;
      drawTeamBox(ctx, champ ? { ...champ, score: null } : null, { x: x + 4, y: treeY + treeH / 2 - boxH / 2, w: cw - 8, h: boxH }, { ...boxOpts(null, null), state: champ ? 'winner' : '' });

      // Bajo el campeón, en qué va la final: la misma frase que en la página.
      const st = gameStatus(cols.final.game);
      ctx.save();
      ctx.font = `600 ${statusSize}px ${theme.fontEyebrow}`;
      ctx.letterSpacing = '1px';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = st.kind === 'live' ? LIVE : theme.flag;
      ctx.fillText(ellipsize(ctx, finalLabel(st).toUpperCase(), cw), cx, treeY + treeH / 2 + boxH / 2 + 26);
      ctx.restore();
    }

    x += cw + COL_GAP;
  }

  // --- Pie del panel ---
  const legendTop = panelY + HEAD_H + treeH;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(panelX, legendTop, panelW, 2);
  const legend = [cutoffLabel(date), 'El mejor sembrado es local', 'Se reacomodan cada ronda'];
  if (hasTiedSeeds(bracket)) legend.push('* sin decidir');
  drawLegend(ctx, legend, w / 2, legendTop + LEGEND_H / 2 + 1, theme, panelW - 32);

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
