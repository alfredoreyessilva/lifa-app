// La cancha de noche de las imágenes para compartir: el pasto, las end zones, los
// cascos y la letra con que se escriben. La usan la imagen de un partido
// (matchShareCard.js) y la de la tabla de posiciones (standingsShareCard.js), para
// que las dos se reconozcan como la misma pieza.
//
// Lo único repetido son los estilos de `.mh` en styles.css (end zones, pasto,
// marcador), que en canvas se escriben a mano: si cambian allá, cambian aquí.

import { drawBallIcon, drawImageContain, ellipsize, initials, roundRect, BRAND_LOGO_RATIO } from './shareCardCommon.js';

export const NOCHE = '#0a1f13';
export const CAL = '#f3f6f1';
export const GRIS = '#aabdb0';
export const LINEA = 'rgba(243, 246, 241, 0.14)';

// La línea de gol, que va pintada aparte de la end zone.
export const GOL = 8;

const YARDAS = [10, 20, 30, 40, 50, 40, 30, 20, 10];
const ANCHO_BALON = 40;

function conAlfa(hex, alfa) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alfa})`;
}

// Una letra con su peso y su espaciado en `em`, como en styles.css.
export const letra = (peso, size, familia, em = 0) => ({
  font: `${peso} ${size}px ${familia}`,
  espaciado: `${(size * em).toFixed(2)}px`,
});

export function ponerLetra(ctx, l) {
  ctx.font = l.font;
  ctx.letterSpacing = l.espaciado;
}

export function escribir(ctx, texto, x, y, l, color, align = 'center') {
  ponerLetra(ctx, l);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(texto, x, y);
}

export function medir(ctx, texto, l) {
  ponerLetra(ctx, l);
  return ctx.measureText(texto).width;
}

// La letra más grande con la que todos los textos caben en `maxW`. El que ni a
// la mínima cabe se recorta al escribirlo.
export function tallaQueCabe(ctx, textos, maxW, base, min, letraDe) {
  let size = base;
  while (size > min && textos.some((t) => medir(ctx, t, letraDe(size)) > maxW)) size -= 1;
  return size;
}

// ── La cancha ──

// Un `radial-gradient` de CSS en forma de elipse. En canvas el color se apaga
// hacia su propio transparente: hacia `transparent`, que es negro sin alfa, el
// resplandor se ensuciaría a medio camino.
function resplandor(ctx, caja, cx, cy, rx, ry, rgba, fin) {
  const ox = caja.x + caja.w * cx;
  const oy = caja.y + caja.h * cy;
  const ex = caja.w * rx;
  const ey = caja.h * ry;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(ex, ey);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, rgba(1));
  g.addColorStop(fin, rgba(0));
  ctx.fillStyle = g;
  ctx.fillRect((caja.x - ox) / ex, (caja.y - oy) / ey, caja.w / ex, caja.h / ey);
  ctx.restore();
}

export function dibujarPasto(ctx, caja, pinturas, theme, tallaYardas = 54) {
  const { x, y, w, h } = caja;
  const franja = w / 10;

  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 ? '#125432' : '#17653c';
    ctx.fillRect(x + i * franja, y, franja + 1, h);
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  for (let i = 1; i < 10; i++) ctx.fillRect(x + i * franja - 3, y, 3, h);

  const noche = ctx.createLinearGradient(0, y, 0, y + h);
  noche.addColorStop(0, 'rgba(6, 22, 13, 0.3)');
  noche.addColorStop(1, 'rgba(6, 22, 13, 0.74)');
  ctx.fillStyle = noche;
  ctx.fillRect(x, y, w, h);

  // El reflejo de cada end zone y, encima, la luz de las torres.
  resplandor(ctx, caja, 0.92, 0.46, 0.4, 0.56, (a) => conAlfa(pinturas.away.fondo, a * 0.3), 0.78);
  resplandor(ctx, caja, 0.08, 0.46, 0.4, 0.56, (a) => conAlfa(pinturas.home.fondo, a * 0.3), 0.78);
  resplandor(ctx, caja, 0.5, -0.08, 0.64, 0.54, (a) => `rgba(233, 255, 226, ${a * 0.3})`, 0.74);

  // Yardas de 10 en 10, de una end zone a la otra.
  const numeros = letra(400, tallaYardas, theme.fontDisplay);
  YARDAS.forEach((yarda, i) => {
    escribir(ctx, String(yarda), x + franja * (i + 1), y + h - (tallaYardas * 26) / 54, numeros, 'rgba(255, 255, 255, 0.22)');
  });
}

// Las franjas diagonales de la pintura.
export function franjasDeEndZone(ctx, x, y, w, h) {
  const banda = 28;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  for (let c = -h; c < w; c += banda * 2) {
    ctx.beginPath();
    ctx.moveTo(x + c, y + h);
    ctx.lineTo(x + c + banda, y + h);
    ctx.lineTo(x + c + banda + h, y);
    ctx.lineTo(x + c + h, y);
    ctx.closePath();
    ctx.fill();
  }
}

// La sombra que hunde a la end zone contra el borde de la imagen.
export function sombraDeEndZone(ctx, x, y, w, h, lado) {
  const [desde, hasta] = lado === 'home' ? [x, x + w] : [x + w, x];
  const sombraLado = ctx.createLinearGradient(desde, 0, hasta, 0);
  sombraLado.addColorStop(0, 'rgba(5, 15, 10, 0.42)');
  sombraLado.addColorStop(0.75, 'rgba(5, 15, 10, 0)');
  ctx.fillStyle = sombraLado;
  ctx.fillRect(x, y, w, h);
}

export function dibujarEndZone(ctx, caja, lado, pintura, nombre, theme) {
  const { x, y, w, h } = caja;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  ctx.fillStyle = pintura.fondo;
  ctx.fillRect(x, y, w, h);

  franjasDeEndZone(ctx, x, y, w, h);

  const sombraAlto = ctx.createLinearGradient(0, y, 0, y + h);
  sombraAlto.addColorStop(0, 'rgba(5, 15, 10, 0.5)');
  sombraAlto.addColorStop(0.34, 'rgba(5, 15, 10, 0)');
  sombraAlto.addColorStop(0.62, 'rgba(5, 15, 10, 0)');
  sombraAlto.addColorStop(1, 'rgba(5, 15, 10, 0.55)');
  ctx.fillStyle = sombraAlto;
  ctx.fillRect(x, y, w, h);

  sombraDeEndZone(ctx, x, y, w, h, lado);

  // El nombre rotulado llena la end zone sin salirse, sea "OSOS" o "AUTÉNTICOS
  // TIGRES UANL": se mide a 100 px y se escala.
  const anchoA100 = medir(ctx, nombre, letra(400, 100, theme.fontDisplay, 0.03));
  const size = Math.min((h * 0.92 * 100) / anchoA100, w * 0.74);
  const rotulo = letra(400, size, theme.fontDisplay, 0.03);
  ponerLetra(ctx, rotulo);
  const m = ctx.measureText(nombre);
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(lado === 'home' ? -Math.PI / 2 : Math.PI / 2);
  escribir(ctx, nombre, 0, (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2, rotulo, pintura.tinta);
  ctx.restore();

  ctx.fillStyle = CAL;
  ctx.fillRect(lado === 'home' ? x + w : x - GOL, y, GOL, h);
}

// ── Los cascos ──

// Las tres formas de poner un logo, las mismas de `.mh-helmet` (README, "El
// color sale del logo"): el casco directo sobre el pasto, la placa más chica y
// lo que trae fondo propio recortado en disco. Las sombras y el filo están
// medidos para el casco de la portada de un partido: `escala` los lleva a otro
// tamaño.
export function dibujarCasco(ctx, img, nombre, forma, cx, cy, caja, theme, escala = 1) {
  if (!img) {
    const radio = caja * 0.35;
    ctx.beginPath();
    ctx.arc(cx, cy, radio, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(5, 15, 10, 0.5)';
    ctx.fill();
    ctx.lineWidth = 5 * escala;
    ctx.strokeStyle = CAL;
    ctx.stroke();
    const iniciales = initials(nombre);
    const l = letra(400, 100 * escala, theme.fontDisplay);
    ponerLetra(ctx, l);
    const m = ctx.measureText(iniciales);
    escribir(ctx, iniciales, cx, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2, l, CAL);
    return;
  }

  if (forma === 'disco') {
    const radio = caja * 0.38;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 38 * escala;
    ctx.shadowOffsetY = 20 * escala;
    ctx.beginPath();
    ctx.arc(cx, cy, radio + 5 * escala, 0, Math.PI * 2);
    ctx.fillStyle = CAL;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radio, 0, Math.PI * 2);
    ctx.clip();
    const proporcion = Math.max((radio * 2) / img.width, (radio * 2) / img.height);
    const dw = img.width * proporcion;
    const dh = img.height * proporcion;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.restore();
    return;
  }

  const size = forma === 'placa' ? caja * 0.76 : caja;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 30 * escala;
  ctx.shadowOffsetY = 18 * escala;
  drawImageContain(ctx, img, cx - size / 2, cy - size / 2, size, size);
  ctx.restore();
}

// ── Lo que va arriba y abajo de toda imagen ──

// La liga y su torneo, con el logo de la liga de un lado y, del otro, el balón de
// CFBAMX: solo, porque sobre la cancha de noche el recuadro verde del favicon
// sería un parche, y discreto, del alto del texto: esta fila es de la liga.
export function bloqueLiga(ctx, liga, torneo, logo, ancho, theme, escala = 1) {
  const lado = 72 * escala;
  const hueco = 18 * escala;
  const balon = ANCHO_BALON * escala;
  const diagonal = torneo ? ' / ' : '';
  const anchoLogo = logo ? lado + hueco : 0;
  const anchoBalon = balon + hueco;
  const disponible = ancho - anchoLogo - anchoBalon;
  const letraDe = (size) => letra(500, size, theme.fontEyebrow, 0.05);
  const l = letraDe(tallaQueCabe(ctx, [`${liga}${diagonal}${torneo}`], disponible, Math.round(32 * escala), 22, letraDe));
  const color = 'rgba(255, 255, 255, 0.86)';

  return {
    alto: lado,
    pintar(cx, y) {
      ponerLetra(ctx, l);
      const anchoLiga = ctx.measureText(liga).width;
      const anchoDiagonal = ctx.measureText(diagonal).width;
      const finDelTorneo = ellipsize(ctx, torneo, Math.max(0, disponible - anchoLiga - anchoDiagonal));
      const texto = anchoLiga + anchoDiagonal + ctx.measureText(finDelTorneo).width;
      let x = cx - (anchoLogo + texto + anchoBalon) / 2;
      if (logo) drawImageContain(ctx, logo, x, y, lado, lado);
      x += anchoLogo;
      const base = y + 47 * escala;
      escribir(ctx, liga, x, base, l, color, 'left');
      escribir(ctx, diagonal, x + anchoLiga, base, l, 'rgba(255, 255, 255, 0.4)', 'left');
      escribir(ctx, finDelTorneo, x + anchoLiga + anchoDiagonal, base, l, color, 'left');

      // El balón ocupa dos tercios de su recuadro.
      const recuadro = balon * 1.5;
      const centroBalon = x + texto + hueco + balon / 2;
      ctx.save();
      ctx.globalAlpha = 0.8;
      drawBallIcon(ctx, centroBalon - recuadro / 2, y + (lado - recuadro) / 2, recuadro, theme, { recuadro: false });
      ctx.restore();
    },
  };
}

// El logo de la marca: el JPG trae su verde, y se recorta con las esquinas
// redondeadas para que se lea como una placa y no como un recuadro pegado.
export function dibujarMarca(ctx, img, cx, y, alto, theme) {
  if (!img) {
    escribir(ctx, 'CFBAMX', cx, y + alto * 0.7, letra(400, 44, theme.fontDisplay), CAL);
    return;
  }
  const ancho = alto * BRAND_LOGO_RATIO;
  const x = cx - ancho / 2;
  ctx.save();
  roundRect(ctx, x, y, ancho, alto, 12);
  ctx.clip();
  drawImageContain(ctx, img, x, y, ancho, alto);
  ctx.restore();
}
