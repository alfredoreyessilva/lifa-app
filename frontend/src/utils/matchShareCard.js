// La imagen de un partido para compartir: la misma portada de la página —la
// cancha de noche, las end zones pintadas del color de cada equipo y los cascos
// frente a frente— en publicación y en historia. README, "La página de un
// partido".
//
// Las dos llevan el acomodo que la página tiene en un teléfono: una imagen
// vertical es esa misma pantalla. Lo que dice sale de las mismas funciones que
// usa la portada (matchDisplay.js y matchCompare.js), y los colores, de la
// pintura que la página ya leyó del logo. Aquí solo se dibuja: todo corre en el
// navegador de quien la pide, con canvas 2D.
//
// Lo único repetido son los estilos de `.mh` en styles.css (end zones, pasto,
// marcador), que en canvas se escriben a mano: si cambian allá, cambian aquí.

import {
  FORMATS, readTheme, loadImage, loadImageWithin, ensureFonts, roundRect, drawBallIcon,
  drawImageContain, ellipsize, initials, wrapLines, BRAND_LOGO_SRC, BRAND_LOGO_RATIO,
} from './shareCardCommon.js';
import { imagenAjustada } from './imagenes.js';
import { filasCaraACara, lineaDelEquipo } from './matchCompare.js';
import {
  centroDelPartido, detalleDelPartido, rondaDelPartido, sedeDelPartido, torneoDelPartido,
} from './matchDisplay.js';

const LOGO_TIMEOUT_MS = 8000;

const NOCHE = '#0a1f13';
const CAL = '#f3f6f1';
const GRIS = '#aabdb0';
const LINEA = 'rgba(243, 246, 241, 0.14)';
const VIVO = '#c8202a';

// La end zone, sin su línea de gol, que va pintada aparte.
const ZONA = 116;
const GOL = 8;
const YARDAS = [10, 20, 30, 40, 50, 40, 30, 20, 10];
const ALTO_YARDAS = 92;
const PADDING_CANCHA = 24;
const HUECO_MAXIMO = 56;
// Un casco no llena su cuadro: el PNG trae vacío arriba y abajo, y sin esto ese
// vacío se sumaría al espacio entre los bloques.
const ALTO_DEL_CASCO = 0.9;
// Lo que la barra de Instagram tapa arriba de una historia.
const ARRIBA = { post: 30, story: 96 };

const ANCHO_BALON = 40;

const ALTO_PIE = 110;
const ALTO_MARCA = 88;
const MARGEN_PLACA = 64;
const ALTO_FILA = 46;
const ALTO_ENCABEZADO = 76;

const ICONO_MAPA = 'M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21zM14.5 9.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z';

function conAlfa(hex, alfa) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alfa})`;
}

// Una letra con su peso y su espaciado en `em`, como en styles.css.
const letra = (peso, size, familia, em = 0) => ({
  font: `${peso} ${size}px ${familia}`,
  espaciado: `${(size * em).toFixed(2)}px`,
});

function ponerLetra(ctx, l) {
  ctx.font = l.font;
  ctx.letterSpacing = l.espaciado;
}

function escribir(ctx, texto, x, y, l, color, align = 'center') {
  ponerLetra(ctx, l);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(texto, x, y);
}

function medir(ctx, texto, l) {
  ponerLetra(ctx, l);
  return ctx.measureText(texto).width;
}

// La letra más grande con la que todos los textos caben en `maxW`. El que ni a
// la mínima cabe se recorta al escribirlo.
function tallaQueCabe(ctx, textos, maxW, base, min, letraDe) {
  let size = base;
  while (size > min && textos.some((t) => medir(ctx, t, letraDe(size)) > maxW)) size -= 1;
  return size;
}

function dibujarIcono(ctx, d, x, y, size, color) {
  const escala = size / 24;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(escala, escala);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(d));
  ctx.restore();
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

function dibujarPasto(ctx, caja, pinturas, theme) {
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
  const numeros = letra(400, 54, theme.fontDisplay);
  YARDAS.forEach((yarda, i) => {
    escribir(ctx, String(yarda), x + franja * (i + 1), y + h - 26, numeros, 'rgba(255, 255, 255, 0.22)');
  });
}

function dibujarEndZone(ctx, caja, lado, pintura, nombre, theme) {
  const { x, y, w, h } = caja;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  ctx.fillStyle = pintura.fondo;
  ctx.fillRect(x, y, w, h);

  // Las franjas diagonales de la pintura.
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

  const sombraAlto = ctx.createLinearGradient(0, y, 0, y + h);
  sombraAlto.addColorStop(0, 'rgba(5, 15, 10, 0.5)');
  sombraAlto.addColorStop(0.34, 'rgba(5, 15, 10, 0)');
  sombraAlto.addColorStop(0.62, 'rgba(5, 15, 10, 0)');
  sombraAlto.addColorStop(1, 'rgba(5, 15, 10, 0.55)');
  ctx.fillStyle = sombraAlto;
  ctx.fillRect(x, y, w, h);

  const [desde, hasta] = lado === 'home' ? [x, x + w] : [x + w, x];
  const sombraLado = ctx.createLinearGradient(desde, 0, hasta, 0);
  sombraLado.addColorStop(0, 'rgba(5, 15, 10, 0.42)');
  sombraLado.addColorStop(0.75, 'rgba(5, 15, 10, 0)');
  ctx.fillStyle = sombraLado;
  ctx.fillRect(x, y, w, h);

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
// lo que trae fondo propio recortado en disco.
function dibujarCasco(ctx, img, nombre, forma, cx, cy, caja, theme) {
  if (!img) {
    const radio = caja * 0.35;
    ctx.beginPath();
    ctx.arc(cx, cy, radio, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(5, 15, 10, 0.5)';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = CAL;
    ctx.stroke();
    const iniciales = initials(nombre);
    const l = letra(400, 100, theme.fontDisplay);
    ponerLetra(ctx, l);
    const m = ctx.measureText(iniciales);
    escribir(ctx, iniciales, cx, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2, l, CAL);
    return;
  }

  if (forma === 'disco') {
    const radio = caja * 0.38;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 38;
    ctx.shadowOffsetY = 20;
    ctx.beginPath();
    ctx.arc(cx, cy, radio + 5, 0, Math.PI * 2);
    ctx.fillStyle = CAL;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radio, 0, Math.PI * 2);
    ctx.clip();
    const escala = Math.max((radio * 2) / img.width, (radio * 2) / img.height);
    const dw = img.width * escala;
    const dh = img.height * escala;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.restore();
    return;
  }

  const size = forma === 'placa' ? caja * 0.76 : caja;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 18;
  drawImageContain(ctx, img, cx - size / 2, cy - size / 2, size, size);
  ctx.restore();
}

// ── Los bloques de la portada ──
//
// Cada uno dice cuánto mide y sabe pintarse a partir de `y`. Se arma la lista,
// se reparte lo que sobra entre ellos y se pintan de arriba abajo: un partido
// sin sede no le aparta lugar.

// La liga y su torneo, con el logo de la liga de un lado y, del otro, el balón de
// CFBAMX: solo, porque sobre la cancha de noche el recuadro verde del favicon
// sería un parche, y discreto, del alto del texto: esta fila es de la liga.
function bloqueLiga(ctx, match, logo, ancho, theme) {
  const liga = match.league_name || 'CFBAMX';
  const torneo = torneoDelPartido(match) || match.category_name || '';
  const lado = 72;
  const hueco = 18;
  const diagonal = torneo ? ' / ' : '';
  const anchoLogo = logo ? lado + hueco : 0;
  const anchoBalon = ANCHO_BALON + hueco;
  const disponible = ancho - anchoLogo - anchoBalon;
  const letraDe = (size) => letra(500, size, theme.fontEyebrow, 0.05);
  const l = letraDe(tallaQueCabe(ctx, [`${liga}${diagonal}${torneo}`], disponible, 32, 22, letraDe));
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
      const base = y + 47;
      escribir(ctx, liga, x, base, l, color, 'left');
      escribir(ctx, diagonal, x + anchoLiga, base, l, 'rgba(255, 255, 255, 0.4)', 'left');
      escribir(ctx, finDelTorneo, x + anchoLiga + anchoDiagonal, base, l, color, 'left');

      // El balón ocupa dos tercios de su recuadro.
      const recuadro = ANCHO_BALON * 1.5;
      const centroBalon = x + texto + hueco + ANCHO_BALON / 2;
      ctx.save();
      ctx.globalAlpha = 0.8;
      drawBallIcon(ctx, centroBalon - recuadro / 2, y + (lado - recuadro) / 2, recuadro, theme, { recuadro: false });
      ctx.restore();
    },
  };
}

function bloqueRonda(ctx, match, ancho, theme) {
  const ronda = rondaDelPartido(match);
  const detalle = detalleDelPartido(match);
  if (!ronda && !detalle) return null;

  const colorRonda = match.phase_type === 'single_elimination' ? theme.flag : CAL;
  const letraDetalle = (size) => letra(500, size, theme.fontEyebrow, 0.04);
  const sizeDetalle = tallaQueCabe(ctx, [detalle], ancho, 29, 20, letraDetalle);
  const lDetalle = letraDetalle(sizeDetalle);
  const lRonda = letra(400, 58, theme.fontDisplay);
  const altoRonda = ronda ? 72 : 0;

  return {
    alto: altoRonda + (detalle ? 40 : 0),
    pintar(cx, y) {
      if (ronda) escribir(ctx, ronda, cx, y + 60, lRonda, colorRonda);
      if (detalle) {
        ponerLetra(ctx, lDetalle);
        escribir(ctx, ellipsize(ctx, detalle, ancho), cx, y + altoRonda + 31, lDetalle, 'rgba(255, 255, 255, 0.86)');
      }
    },
  };
}

function bloqueDuelo(ctx, match, logos, pinturas, contexto, ancho, theme) {
  const columna = (ancho - 8) / 2;
  const casco = columna;
  const nombres = [match.home_team, match.away_team];

  const letraNombre = (size) => letra(400, size, theme.fontDisplay, 0.01);
  const sizeNombre = tallaQueCabe(ctx, nombres, columna, 46, 34, letraNombre);
  const lNombre = letraNombre(sizeNombre);
  ponerLetra(ctx, lNombre);
  const renglones = nombres.map((n) => wrapLines(ctx, n, columna, 2));
  const altoRenglon = Math.round(sizeNombre * 1.14);
  const altoNombres = altoRenglon * Math.max(renglones[0].length, renglones[1].length);
  const altoCasco = casco * ALTO_DEL_CASCO;

  const lineas = [
    lineaDelEquipo(contexto?.home) || 'Local',
    lineaDelEquipo(contexto?.away) || 'Visitante',
  ];
  const letraLinea = (size) => letra(500, size, theme.fontEyebrow, 0.03);
  const lLinea = letraLinea(tallaQueCabe(ctx, lineas, columna, 29, 22, letraLinea));

  return {
    alto: altoCasco + 6 + altoNombres + 6 + 38,
    pintar(cx, y) {
      const xs = [cx - columna / 2 - 4, cx + columna / 2 + 4];
      const lados = ['home', 'away'];
      lados.forEach((lado, i) => {
        const x = xs[i];
        dibujarCasco(ctx, logos[lado], nombres[i], pinturas[lado].forma, x, y + altoCasco / 2, casco, theme);
        renglones[i].forEach((r, j) => {
          escribir(ctx, r, x, y + altoCasco + 6 + altoRenglon * (j + 1) - 6, lNombre, '#ffffff');
        });
        const yLinea = y + altoCasco + 6 + altoNombres + 6 + 30;
        ponerLetra(ctx, lLinea);
        escribir(ctx, ellipsize(ctx, lineas[i], columna), x, yLinea, lLinea, 'rgba(255, 255, 255, 0.84)');
      });
    },
  };
}

// La hora y el marcador llevan la misma sombra: es lo que los separa del pasto.
function conSombra(ctx, pintar) {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
  ctx.shadowBlur = 44;
  ctx.shadowOffsetY = 8;
  pintar();
  ctx.restore();
}

// "21 — 0", con el perdedor apagado solo si el partido ya terminó: en vivo, el
// que va abajo sigue jugando.
function renglonMarcador(ctx, match, terminado, theme) {
  const size = 168;
  const l = letra(400, size, theme.fontDisplay);
  const local = Number(match.home_score);
  const visita = Number(match.away_score);
  const apagado = 'rgba(255, 255, 255, 0.5)';
  const tiras = [String(local), String(visita)];
  const raya = size * 0.3;
  const hueco = size * 0.2;

  return {
    alto: Math.round(size * 1.04),
    pintar(cx, y) {
      const [a, b] = tiras.map((t) => medir(ctx, t, l));
      const total = a + b + raya + hueco * 2;
      const inicio = cx - total / 2;
      const base = y + size * 0.94;
      conSombra(ctx, () => {
        escribir(ctx, tiras[0], inicio, base, l, terminado && local < visita ? apagado : '#ffffff', 'left');
        escribir(ctx, tiras[1], inicio + a + hueco * 2 + raya, base, l, terminado && visita < local ? apagado : '#ffffff', 'left');
      });
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillRect(inicio + a + hueco, y + size * 0.485, raya, size * 0.07);
    },
  };
}

function renglonVs(ctx, theme) {
  const size = 112;
  return {
    alto: Math.round(size * 1.1),
    pintar(cx, y) {
      escribir(ctx, 'VS', cx, y + size * 0.97, letra(400, size, theme.fontDisplay), 'rgba(255, 255, 255, 0.9)');
    },
  };
}

function renglonTexto(ctx, texto, l, alto, base, color) {
  return { alto, pintar: (cx, y) => escribir(ctx, texto, cx, y + base, l, color) };
}

function pildoraEnVivo(ctx, theme) {
  const l = letra(600, 30, theme.fontEyebrow, 0.06);
  return {
    alto: 56,
    pintar(cx, y) {
      const texto = 'En vivo';
      const punto = 16;
      const hueco = 14;
      const pad = 26;
      const ancho = medir(ctx, texto, l) + punto + hueco + pad * 2;
      const x = cx - ancho / 2;
      roundRect(ctx, x, y, ancho, 48, 24);
      ctx.fillStyle = VIVO;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + pad + punto / 2, y + 24, punto / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      escribir(ctx, texto, x + pad + punto + hueco, y + 35, l, '#ffffff', 'left');
    },
  };
}

function renglonHora(ctx, cifra, sufijo, theme) {
  const size = 156;
  const lCifra = letra(400, size, theme.fontDisplay);
  const lSufijo = letra(600, size * 0.24, theme.fontEyebrow, 0.04);
  return {
    alto: Math.round(size * 1.04),
    pintar(cx, y) {
      const hueco = sufijo ? 16 : 0;
      const anchoCifra = medir(ctx, cifra, lCifra);
      const anchoSufijo = sufijo ? medir(ctx, sufijo, lSufijo) : 0;
      const x = cx - (anchoCifra + hueco + anchoSufijo) / 2;
      const base = y + size * 0.94;
      conSombra(ctx, () => {
        escribir(ctx, cifra, x, base, lCifra, '#ffffff', 'left');
        if (sufijo) escribir(ctx, sufijo, x + anchoCifra + hueco, base, lSufijo, '#ffffff', 'left');
      });
    },
  };
}

// La cuenta regresiva de la página no va: una imagen no corre, y "Faltan 2 días"
// sería mentira al día siguiente de publicarla.
function bloqueCentro(ctx, match, status, dateParts, theme) {
  const centro = centroDelPartido(match, status, dateParts);
  const lFecha = letra(500, 37, theme.fontEyebrow, 0.03);
  const fecha = renglonTexto(ctx, centro.fecha, lFecha, 50, 38, CAL);
  const lEstado = letra(600, 31, theme.fontEyebrow, 0.06);

  let renglones;
  if (centro.momento === 'live') {
    renglones = [
      pildoraEnVivo(ctx, theme),
      centro.hayMarcador ? renglonMarcador(ctx, match, false, theme) : renglonVs(ctx, theme),
      fecha,
    ];
  } else if (centro.momento === 'finished') {
    renglones = [
      renglonTexto(ctx, 'Finalizado', lEstado, 46, 34, 'rgba(255, 255, 255, 0.88)'),
      centro.hayMarcador
        ? renglonMarcador(ctx, match, true, theme)
        : renglonTexto(ctx, 'Marcador por capturar', letra(400, 50, theme.fontDisplay), 92, 66, 'rgba(255, 255, 255, 0.86)'),
      fecha,
    ];
  } else if (centro.momento === 'porDefinir') {
    renglones = [renglonVs(ctx, theme), fecha];
  } else {
    renglones = [
      fecha,
      renglonHora(ctx, centro.cifra, centro.sufijo, theme),
      renglonTexto(ctx, centro.zona, letra(400, 27, theme.fontBody), 36, 28, 'rgba(255, 255, 255, 0.76)'),
    ];
  }

  return {
    alto: renglones.reduce((suma, r) => suma + r.alto, 0),
    pintar(cx, y) {
      let actual = y;
      for (const r of renglones) {
        r.pintar(cx, actual);
        actual += r.alto;
      }
    },
  };
}

function bloqueSede(ctx, match, ancho, theme) {
  const sede = sedeDelPartido(match);
  if (!sede) return null;
  const icono = 34;
  const hueco = 10;
  const disponible = ancho - icono - hueco;
  const letraDe = (size) => letra(500, size, theme.fontBody);
  const l = letraDe(tallaQueCabe(ctx, [sede], disponible, 30, 22, letraDe));

  return {
    alto: 40,
    pintar(cx, y) {
      ponerLetra(ctx, l);
      const texto = ellipsize(ctx, sede, disponible);
      const total = icono + hueco + medir(ctx, texto, l);
      const x = cx - total / 2;
      dibujarIcono(ctx, ICONO_MAPA, x, y + 3, icono, 'rgba(255, 255, 255, 0.9)');
      escribir(ctx, texto, x + icono + hueco, y + 31, l, 'rgba(255, 255, 255, 0.9)', 'left');
    },
  };
}

function dibujarPortada(ctx, w, alto, arriba, datos, theme) {
  const { match, status, dateParts, pinturas, contexto, logos } = datos;
  const cancha = { x: ZONA + GOL, y: 0, w: w - (ZONA + GOL) * 2, h: alto };

  dibujarPasto(ctx, cancha, pinturas, theme);
  dibujarEndZone(ctx, { x: 0, y: 0, w: ZONA, h: alto }, 'home', pinturas.home, match.home_team, theme);
  dibujarEndZone(ctx, { x: w - ZONA, y: 0, w: ZONA, h: alto }, 'away', pinturas.away, match.away_team, theme);

  const ancho = cancha.w - PADDING_CANCHA * 2;
  const cx = w / 2;

  const bloques = [
    bloqueLiga(ctx, match, logos.league, ancho, theme),
    bloqueRonda(ctx, match, ancho, theme),
    bloqueDuelo(ctx, match, logos, pinturas, contexto, ancho, theme),
    bloqueCentro(ctx, match, status, dateParts, theme),
    bloqueSede(ctx, match, ancho, theme),
  ].filter(Boolean);

  const disponible = alto - ALTO_YARDAS - arriba;
  const sobra = Math.max(0, disponible - bloques.reduce((suma, b) => suma + b.alto, 0));
  const huecos = bloques.length - 1;
  const hueco = Math.min(HUECO_MAXIMO, sobra / huecos);
  let y = arriba + (sobra - hueco * huecos) / 2;
  for (const b of bloques) {
    b.pintar(cx, y);
    y += b.alto + hueco;
  }
}

// ── La placa ──

function altoCaraACara(filas) {
  return filas.length === 0 ? 0 : 24 + 64 + ALTO_ENCABEZADO + filas.length * ALTO_FILA + 6;
}

// Los dos nombres van a la misma letra, y con más ancho que la columna de los
// valores: el centro de este renglón va vacío.
function dibujarEquiposDeCaraACara(ctx, x, y, anchoTotal, datos, theme) {
  const { match, logos, pinturas } = datos;
  const ancho = anchoTotal * 0.46;
  const marca = 56;
  const hueco = 14;
  const disponible = ancho - marca - hueco;
  const letraDe = (size) => letra(600, size, theme.fontEyebrow, 0.02);
  const l = letraDe(tallaQueCabe(ctx, [match.home_team, match.away_team], disponible, 29, 20, letraDe));

  const lados = [
    { nombre: match.home_team, logo: logos.home, pintura: pinturas.home, izquierda: true },
    { nombre: match.away_team, logo: logos.away, pintura: pinturas.away, izquierda: false },
  ];
  for (const { nombre, logo, pintura, izquierda } of lados) {
    const inicio = izquierda ? x : x + anchoTotal - ancho;
    const xMarca = izquierda ? inicio : inicio + ancho - marca;
    if (logo) drawImageContain(ctx, logo, xMarca, y, marca, marca);
    else escribir(ctx, initials(nombre), xMarca + marca / 2, y + 40, letra(400, 24, theme.fontDisplay), GRIS);

    ponerLetra(ctx, l);
    const xNombre = izquierda ? inicio + marca + hueco : inicio + ancho - marca - hueco;
    escribir(ctx, ellipsize(ctx, nombre, disponible), xNombre, y + 38, l, CAL, izquierda ? 'left' : 'right');

    ctx.fillStyle = pintura.fondo;
    ctx.fillRect(inicio, y + marca + 12, ancho, 5);
  }
}

function dibujarCaraACara(ctx, filas, top, w, datos, theme) {
  const x = MARGEN_PLACA;
  const ancho = w - MARGEN_PLACA * 2;
  const columna = ancho * 0.31;

  let y = top + 24;
  escribir(ctx, 'Cara a cara', x, y + 44, letra(400, 46, theme.fontDisplay, 0.01), CAL, 'left');
  y += 64;

  dibujarEquiposDeCaraACara(ctx, x, y, ancho, datos, theme);
  y += ALTO_ENCABEZADO;

  const letraValor = (size) => letra(400, size, theme.fontDisplay);
  const lEtiqueta = letra(500, 22, theme.fontBody);
  const anchoEtiqueta = ancho - columna * 2 - 16;

  filas.forEach((fila, i) => {
    const yFila = y + i * ALTO_FILA;
    if (i > 0) {
      ctx.fillStyle = LINEA;
      ctx.fillRect(x, yFila, ancho, 2);
    }
    const base = yFila + 34;
    [['home', x, 'left'], ['away', x + ancho, 'right']].forEach(([lado, xValor, align]) => {
      const lValor = letraValor(tallaQueCabe(ctx, [fila[lado]], columna, 32, 22, letraValor));
      ponerLetra(ctx, lValor);
      escribir(ctx, ellipsize(ctx, fila[lado], columna), xValor, base, lValor, fila.lead === lado ? '#ffffff' : GRIS, align);
    });
    ponerLetra(ctx, lEtiqueta);
    escribir(ctx, ellipsize(ctx, fila.label, anchoEtiqueta), w / 2, base - 2, lEtiqueta, GRIS);
  });
}

// El logo de la marca: el JPG trae su verde, y se recorta con las esquinas
// redondeadas para que se lea como una placa y no como un recuadro pegado.
function dibujarMarca(ctx, img, cx, y, alto, theme) {
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

/**
 * Genera la imagen del partido.
 * @param {object} match - el objeto que devuelve api.getMatch (sin transformar)
 * @param {'post'|'story'} formatKey
 * @param {object} dateParts - de getMatchParts()
 * @param {'scheduled'|'live'|'finished'} status - de getMatchStatus(match)
 * @param {{home: object, away: object}} pinturas - de useTeamPaint(), los mismos colores de la página
 * @param {object|null} contexto - de api.getMatchContext; si no ha llegado, la imagen sale sin récord,
 *   igual que la portada
 * @returns {Promise<Blob>}
 */
export async function generateMatchCard(match, formatKey, dateParts, status, pinturas, contexto) {
  const format = FORMATS[formatKey] || FORMATS.post;
  const theme = readTheme();
  const { width: w, height: h } = format;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  await ensureFonts();
  const [home, away, league, marca] = await Promise.all([
    loadImageWithin(imagenAjustada(match.home_logo_url, 640), LOGO_TIMEOUT_MS),
    loadImageWithin(imagenAjustada(match.away_logo_url, 640), LOGO_TIMEOUT_MS),
    loadImageWithin(imagenAjustada(match.league_logo_url, 240), LOGO_TIMEOUT_MS),
    loadImage(BRAND_LOGO_SRC),
  ]);

  const datos = {
    match, status, dateParts, pinturas, contexto, logos: { home, away, league },
  };

  // La historia tiene lugar para "Cara a cara", en el mismo orden que la página.
  // La publicación es solo la portada: ahí cada renglón de la tabla se lo
  // quitaría a los cascos.
  const filas = formatKey === 'story' ? filasCaraACara(contexto?.home, contexto?.away) : [];
  const altoPlaca = altoCaraACara(filas) + ALTO_PIE;
  const altoPortada = h - altoPlaca;

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = NOCHE;
  ctx.fillRect(0, 0, w, h);
  dibujarPortada(ctx, w, altoPortada, ARRIBA[formatKey] ?? ARRIBA.post, datos, theme);
  if (filas.length > 0) dibujarCaraACara(ctx, filas, altoPortada, w, datos, theme);
  dibujarMarca(ctx, marca, w / 2, h - ALTO_PIE + (ALTO_PIE - ALTO_MARCA) / 2, ALTO_MARCA, theme);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
}

export const SHARE_CARD_FORMATS = FORMATS;
