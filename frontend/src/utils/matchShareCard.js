// Genera la imagen "próximo partido" para compartir (GAME_PREVIEW).
//
// Principio de diseño (ver conversación de producto): los datos objetivos
// (nombres, fecha, hora, sede) SIEMPRE vienen del objeto `match` que ya
// devuelve la API — nada se inventa ni se decide con IA aquí. Este archivo
// solo es responsable de dibujar esos datos sobre un layout fijo.
//
// Todo corre en el navegador del usuario (canvas 2D). No toca el backend,
// no depende de ningún servicio de renderizado nuevo.

const FORMATS = {
  post:  { width: 1080, height: 1350, label: 'Publicación' },
  story: { width: 1080, height: 1920, label: 'Historia' },
};

// Lee los colores/fuentes reales de styles.css (custom properties) para que
// la imagen generada nunca se desalinee del branding de la app si cambia.
function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
  return {
    field:     v('--field', '#3a8d3f'),
    fieldDeep: v('--field-deep', '#2f7a35'),
    flag:      v('--flag', '#ffd23f'),
    flagDeep:  v('--flag-deep', '#e0a800'),
    ink:       v('--ink', '#ffffff'),
    inkDim:    v('--ink-dim', '#d9f0db'),
    card:      v('--card', '#347e3a'),
    surface:   v('--surface', '#2a6e30'),
    fontDisplay: 'Anton',
    fontEyebrow: 'Oswald',
    fontBody:    'Inter',
  };
}

async function loadImage(url) {
  if (!url) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    // Si falla (CORS, 404, etc.) no rompemos la generación completa:
    // simplemente caemos al fallback de iniciales para ese equipo/liga.
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function ensureFonts() {
  const specs = [
    '700 10px Anton',
    '600 10px Oswald',
    '600 10px Inter',
  ];
  try {
    await Promise.all(specs.map((s) => document.fonts.load(s)));
    await document.fonts.ready;
  } catch {
    // Si la Font Loading API no está disponible, seguimos con la fuente
    // que el navegador resuelva por default; no es crítico para v1.
  }
}

function initials(name) {
  return (name || '')
    .split(' ')
    .filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚÑ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Dibuja el logo del equipo dentro de un círculo, o sus iniciales si no hay logo.
function drawTeamBadge(ctx, img, name, cx, cy, radius, theme) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = theme.field;
  ctx.fill();
  ctx.clip();

  if (img) {
    // "cover" dentro del círculo, respetando proporción de la imagen
    const scale = Math.max((radius * 2) / img.width, (radius * 2) / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  } else {
    ctx.fillStyle = theme.field;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.fillStyle = theme.ink;
    ctx.font = `700 ${Math.round(radius * 0.8)}px ${theme.fontDisplay}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials(name), cx, cy + radius * 0.05);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = theme.flag;
  ctx.stroke();
}

// Recorta texto largo para que no se salga del ancho disponible.
function fitText(ctx, text, maxWidth, baseSize, font, minSize = 28) {
  let size = baseSize;
  ctx.font = `700 ${size}px ${font}`;
  while (ctx.measureText(text).width > maxWidth && size > minSize) {
    size -= 2;
    ctx.font = `700 ${size}px ${font}`;
  }
  return size;
}

// Dibuja el ícono del balón amarillo, replicando public/favicon.svg,
// para no depender de cargar un archivo SVG externo dentro del canvas.
function drawBallIcon(ctx, x, y, size, theme) {
  ctx.save();
  ctx.translate(x, y);

  const r = size * 0.1875; // 12/64
  roundRect(ctx, 0, 0, size, size, r);
  ctx.fillStyle = theme.fieldDeep;
  ctx.fill();

  const cx = size / 2;
  const cy = size / 2;
  const rx = size * 0.34375; // 22/64
  const ry = size * 0.21875; // 14/64

  ctx.translate(cx, cy);
  ctx.rotate((-30 * Math.PI) / 180);

  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = theme.flag;
  ctx.fill();

  ctx.strokeStyle = theme.fieldDeep;
  ctx.lineWidth = Math.max(1, size * 0.03125);
  ctx.lineCap = 'round';
  const scale = size / 64;
  const lines = [
    [14, 32, 50, 32],
    [22, 27, 22, 37],
    [29, 25, 29, 39],
    [36, 25, 36, 39],
    [43, 27, 43, 37],
  ];
  for (const [x1, y1, x2, y2] of lines) {
    ctx.beginPath();
    ctx.moveTo((x1 - 32) * scale, (y1 - 32) * scale);
    ctx.lineTo((x2 - 32) * scale, (y2 - 32) * scale);
    ctx.stroke();
  }

  ctx.restore();
}

function drawBackground(ctx, w, h, theme) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, theme.field);
  grad.addColorStop(1, theme.fieldDeep);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Rayas horizontales tipo "yardas de cancha" (antes eran diagonales)
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 4;
  const stripeGap = 78;
  for (let y = 0; y < h; y += stripeGap) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

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

  drawTeamBadge(ctx, homeImg, match.home_team, cx - badgeOffsetX, badgeY, badgeRadius, theme);
  drawTeamBadge(ctx, awayImg, match.away_team, cx + badgeOffsetX, badgeY, badgeRadius, theme);

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
  const panelX = cx - panelW / 2;

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

  const panelPadTop    = 44;
  const panelPadBottom = 36;
  const panelH = panelPadTop + panelLines.reduce((sum, l) => sum + l.gapBefore, 0) + panelPadBottom;

  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  roundRect(ctx, panelX, panelY, panelW, panelH, 24);
  ctx.fill();

  ctx.textAlign = 'center';
  let panelTextY = panelY + panelPadTop;
  for (const line of panelLines) {
    panelTextY += line.gapBefore;
    ctx.fillStyle = line.color;
    ctx.font = line.font;
    ctx.fillText(line.text, cx, panelTextY);
  }

  // --- Footer: marca LIFA ---
  ctx.fillStyle = theme.ink;
  ctx.font = `700 34px ${theme.fontDisplay}`;
  ctx.fillText('CFBAMX', cx, h - 60);
  ctx.fillStyle = theme.inkDim;
  ctx.font = `500 22px ${theme.fontBody}`;
  ctx.fillText('Conectando al Football Americano de México', cx, h - 30);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
}

export const SHARE_CARD_FORMATS = FORMATS;
