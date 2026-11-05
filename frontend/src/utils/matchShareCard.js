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
// La cancha, las end zones y los cascos viven en shareCardField.js, porque la
// imagen de la tabla de posiciones se dibuja sobre la misma cancha.

import {
  FORMATS, readTheme, loadImage, loadImageWithin, ensureFonts, roundRect,
  drawImageContain, ellipsize, initials, wrapLines, BRAND_LOGO_SRC,
} from './shareCardCommon.js';
import {
  NOCHE, CAL, GRIS, LINEA, GOL, letra, ponerLetra, escribir, medir, tallaQueCabe,
  dibujarPasto, dibujarEndZone, dibujarCasco, bloqueLiga, dibujarMarca,
} from './shareCardField.js';
import { imagenAjustada } from './imagenes.js';
import { filasCaraACara, lineaDelEquipo } from './matchCompare.js';
import {
  centroDelPartido, detalleDelPartido, rondaDelPartido, sedeDelPartido, torneoDelPartido,
} from './matchDisplay.js';

const LOGO_TIMEOUT_MS = 8000;

const VIVO = '#c8202a';

// La end zone, sin su línea de gol.
const ZONA = 116;
const ALTO_YARDAS = 92;
const PADDING_CANCHA = 24;
const HUECO_MAXIMO = 56;
// Un casco no llena su cuadro: el PNG trae vacío arriba y abajo, y sin esto ese
// vacío se sumaría al espacio entre los bloques.
const ALTO_DEL_CASCO = 0.9;
// Lo que la barra de Instagram tapa arriba de una historia.
const ARRIBA = { post: 30, story: 96 };

const ALTO_PIE = 110;
const ALTO_MARCA = 88;
const MARGEN_PLACA = 64;
const ALTO_FILA = 46;
const ALTO_ENCABEZADO = 76;

const ICONO_MAPA = 'M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21zM14.5 9.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z';

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

// ── Los bloques de la portada ──
//
// Cada uno dice cuánto mide y sabe pintarse a partir de `y`. Se arma la lista,
// se reparte lo que sobra entre ellos y se pintan de arriba abajo: un partido
// sin sede no le aparta lugar.

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
    bloqueLiga(ctx, match.league_name || 'CFBAMX', torneoDelPartido(match) || match.category_name || '', logos.league, ancho, theme),
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
