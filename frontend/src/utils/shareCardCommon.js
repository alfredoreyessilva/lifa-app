// Helpers de canvas compartidos entre las distintas "tarjetas para
// compartir" de la app (partido, jugador, y las que sigan). Extraído de
// matchShareCard.js para no duplicar ~150 líneas al agregar la del
// jugador — un solo lugar que mantener si el branding cambia.

export const FORMATS = {
  post:  { width: 1080, height: 1350, label: 'Publicación' },
  story: { width: 1080, height: 1920, label: 'Historia' },
};

// Lee los colores/fuentes reales de styles.css (custom properties) para que
// la imagen generada nunca se desalinee del branding de la app si cambia.
export function readTheme() {
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

export async function loadImage(url) {
  if (!url) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    // Si falla (CORS, 404, etc.) no rompemos la generación completa:
    // simplemente caemos al fallback de iniciales.
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export async function ensureFonts() {
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

export function initials(name) {
  return (name || '')
    .split(' ')
    .filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚÑ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Dibuja una foto/logo dentro de un círculo, o iniciales si no hay imagen.
// Antes se llamaba drawTeamBadge (solo para equipos) — se generalizó porque
// la tarjeta del jugador necesita el mismo dibujo para la FOTO del jugador,
// no solo para logos de equipo.
export function drawCircleBadge(ctx, img, name, cx, cy, radius, theme) {
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
export function fitText(ctx, text, maxWidth, baseSize, font, minSize = 28) {
  let size = baseSize;
  ctx.font = `700 ${size}px ${font}`;
  while (ctx.measureText(text).width > maxWidth && size > minSize) {
    size -= 2;
    ctx.font = `700 ${size}px ${font}`;
  }
  return size;
}

// Dibuja el ícono del balón amarillo, replicando public/favicon.svg, para
// no depender de cargar un archivo SVG externo dentro del canvas.
export function drawBallIcon(ctx, x, y, size, theme) {
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

export function drawBackground(ctx, w, h, theme) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, theme.field);
  grad.addColorStop(1, theme.fieldDeep);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Rayas horizontales tipo "yardas de cancha"
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

// Panel oscuro redondeado con líneas de texto apiladas — mismo patrón que
// usa la tarjeta de partido para fecha/hora/sede, generalizado para que la
// tarjeta de jugador lo reuse con sus propias líneas (estadísticas).
export function drawTextPanel(ctx, lines, cx, panelY, panelW, theme) {
  const panelX = cx - panelW / 2;
  const panelPadTop = 44;
  const panelPadBottom = 36;
  const panelH = panelPadTop + lines.reduce((sum, l) => sum + l.gapBefore, 0) + panelPadBottom;

  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  roundRect(ctx, panelX, panelY, panelW, panelH, 24);
  ctx.fill();

  ctx.textAlign = 'center';
  let textY = panelY + panelPadTop;
  for (const line of lines) {
    textY += line.gapBefore;
    ctx.fillStyle = line.color;
    ctx.font = line.font;
    ctx.fillText(line.text, cx, textY);
  }

  return panelH;
}

export function drawFooter(ctx, cx, h, theme) {
  ctx.textAlign = 'center';
  ctx.fillStyle = theme.ink;
  ctx.font = `700 34px ${theme.fontDisplay}`;
  ctx.fillText('CFBAMX', cx, h - 60);
  ctx.fillStyle = theme.inkDim;
  ctx.font = `500 22px ${theme.fontBody}`;
  ctx.fillText('Conectando al Football Americano de México', cx, h - 30);
}
