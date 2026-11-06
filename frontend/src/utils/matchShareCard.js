// La imagen de un partido para compartir: la misma portada de la página —la
// cancha de noche, las end zones pintadas del color de cada equipo y los cascos
// frente a frente— en publicación, en historia y en horizontal. README, "La
// página de un partido".
//
// Las dos verticales llevan el acomodo que la página tiene en un teléfono: una
// imagen vertical es esa misma pantalla. La horizontal lleva el de la computadora
// y es la cancha completa, en su proporción real. Lo que dicen sale de las mismas
// funciones que usa la portada (matchDisplay.js y matchCompare.js), y los colores,
// de la pintura que la página ya leyó del logo. Aquí solo se dibuja: todo corre en
// el navegador de quien la pide, con canvas 2D.
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

// La horizontal es solo de un partido: va aquí y no en FORMATS, porque las demás
// imágenes pintan un botón por cada formato de esa lista y no saben dibujarla.
// 2160×960 es la cancha: 120 yardas de largo por 53⅓ de ancho.
export const SHARE_CARD_FORMATS = {
  ...FORMATS,
  landscape: { width: 2160, height: 960, label: 'Horizontal' },
};

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

// La horizontal: su end zone mide lo que mide en la cancha, 10 de las 120 yardas.
const YARDAS_DE_END_ZONE = 10 / 120;
const PADDING_HORIZONTAL = 56;
const ARRIBA_HORIZONTAL = 34;
const HUECO_MINIMO = 14;
// El centro entre los cascos, lo que le deja libre a sus textos para que no los
// toquen, y lo que crecen la hora, el marcador y las sombras de los cascos contra
// los de las verticales.
const ANCHO_CENTRO = 600;
const AIRE_DEL_CENTRO = 40;
const ESCALA_HORIZONTAL = 1.25;

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

const colorDeRonda = (match, theme) => (match.phase_type === 'single_elimination' ? theme.flag : CAL);
const letraDeDetalle = (theme) => (size) => letra(500, size, theme.fontEyebrow, 0.04);

function bloqueRonda(ctx, match, ancho, theme) {
  const ronda = rondaDelPartido(match);
  const detalle = detalleDelPartido(match);
  if (!ronda && !detalle) return null;

  const colorRonda = colorDeRonda(match, theme);
  const letraDetalle = letraDeDetalle(theme);
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

// `medidas` dice dónde cae cada equipo: `separacion` va de un centro al otro, y
// un casco crece hasta `columna` o hasta `altoMaximo`, lo que llegue antes.
function bloqueDuelo(ctx, match, logos, pinturas, contexto, medidas, theme) {
  const {
    columna, separacion, tallaNombre = 46, tallaMinima = 34, altoMaximo = Infinity, escala = 1,
  } = medidas;
  const nombres = [match.home_team, match.away_team];

  const letraNombre = (size) => letra(400, size, theme.fontDisplay, 0.01);
  const sizeNombre = tallaQueCabe(ctx, nombres, columna, tallaNombre, tallaMinima, letraNombre);
  const lNombre = letraNombre(sizeNombre);
  ponerLetra(ctx, lNombre);
  const renglones = nombres.map((n) => wrapLines(ctx, n, columna, 2));
  const altoRenglon = Math.round(sizeNombre * 1.14);
  const altoNombres = altoRenglon * Math.max(renglones[0].length, renglones[1].length);
  const altoTextos = 6 + altoNombres + 6 + 38 * escala;
  const casco = Math.min(columna, (altoMaximo - altoTextos) / ALTO_DEL_CASCO);
  const altoCasco = casco * ALTO_DEL_CASCO;

  const lineas = [
    lineaDelEquipo(contexto?.home) || 'Local',
    lineaDelEquipo(contexto?.away) || 'Visitante',
  ];
  const letraLinea = (size) => letra(500, size, theme.fontEyebrow, 0.03);
  const lLinea = letraLinea(tallaQueCabe(ctx, lineas, columna, 29 * escala, 22 * escala, letraLinea));

  return {
    alto: altoCasco + altoTextos,
    pintar(cx, y) {
      const xs = [cx - separacion / 2, cx + separacion / 2];
      const lados = ['home', 'away'];
      lados.forEach((lado, i) => {
        const x = xs[i];
        dibujarCasco(ctx, logos[lado], nombres[i], pinturas[lado].forma, x, y + altoCasco / 2, casco, theme, escala);
        renglones[i].forEach((r, j) => {
          escribir(ctx, r, x, y + altoCasco + 6 + altoRenglon * (j + 1) - 6, lNombre, '#ffffff');
        });
        const yLinea = y + altoCasco + 6 + altoNombres + 6 + 30 * escala;
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
function renglonMarcador(ctx, match, terminado, ancho, theme) {
  const local = Number(match.home_score);
  const visita = Number(match.away_score);
  const apagado = 'rgba(255, 255, 255, 0.5)';
  const tiras = [String(local), String(visita)];
  // Todo el renglón crece con la letra: la raya y sus huecos miden 0.7 de ella.
  const anchoA100 = medir(ctx, tiras.join(''), letra(400, 100, theme.fontDisplay)) + 70;
  const size = Math.min(168, Math.floor((ancho * 100) / anchoA100));
  const l = letra(400, size, theme.fontDisplay);
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
function bloqueCentro(ctx, match, status, dateParts, ancho, theme) {
  const centro = centroDelPartido(match, status, dateParts);
  const letraFecha = (size) => letra(500, size, theme.fontEyebrow, 0.03);
  const lFecha = letraFecha(tallaQueCabe(ctx, [centro.fecha], ancho, 37, 24, letraFecha));
  const fecha = renglonTexto(ctx, centro.fecha, lFecha, 50, 38, CAL);
  const lEstado = letra(600, 31, theme.fontEyebrow, 0.06);
  const pendiente = 'Marcador por capturar';
  const letraPendiente = (size) => letra(400, size, theme.fontDisplay);
  const lPendiente = letraPendiente(tallaQueCabe(ctx, [pendiente], ancho, 50, 30, letraPendiente));

  let renglones;
  if (centro.momento === 'live') {
    renglones = [
      pildoraEnVivo(ctx, theme),
      centro.hayMarcador ? renglonMarcador(ctx, match, false, ancho, theme) : renglonVs(ctx, theme),
      fecha,
    ];
  } else if (centro.momento === 'finished') {
    renglones = [
      renglonTexto(ctx, 'Finalizado', lEstado, 46, 34, 'rgba(255, 255, 255, 0.88)'),
      centro.hayMarcador
        ? renglonMarcador(ctx, match, true, ancho, theme)
        : renglonTexto(ctx, pendiente, lPendiente, 92, 66, 'rgba(255, 255, 255, 0.86)'),
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

// El pasto y las dos end zones. Devuelve la caja del pasto.
function dibujarCancha(ctx, w, alto, zona, match, pinturas, theme) {
  const cancha = { x: zona + GOL, y: 0, w: w - (zona + GOL) * 2, h: alto };
  dibujarPasto(ctx, cancha, pinturas, theme);
  dibujarEndZone(ctx, { x: 0, y: 0, w: zona, h: alto }, 'home', pinturas.home, match.home_team, theme);
  dibujarEndZone(ctx, { x: w - zona, y: 0, w: zona, h: alto }, 'away', pinturas.away, match.away_team, theme);
  return cancha;
}

const bloqueDeLiga = (ctx, match, logos, ancho, theme) => bloqueLiga(
  ctx, match.league_name || 'CFBAMX', torneoDelPartido(match) || match.category_name || '', logos.league, ancho, theme,
);

function repartir(bloques, cx, arriba, disponible) {
  const sobra = Math.max(0, disponible - bloques.reduce((suma, b) => suma + b.alto, 0));
  const huecos = bloques.length - 1;
  const hueco = Math.min(HUECO_MAXIMO, sobra / huecos);
  let y = arriba + (sobra - hueco * huecos) / 2;
  for (const b of bloques) {
    b.pintar(cx, y);
    y += b.alto + hueco;
  }
}

function dibujarPortada(ctx, w, alto, arriba, datos, theme) {
  const { match, status, dateParts, pinturas, contexto, logos } = datos;
  const cancha = dibujarCancha(ctx, w, alto, ZONA, match, pinturas, theme);

  const ancho = cancha.w - PADDING_CANCHA * 2;
  const columna = (ancho - 8) / 2;

  repartir([
    bloqueDeLiga(ctx, match, logos, ancho, theme),
    bloqueRonda(ctx, match, ancho, theme),
    bloqueDuelo(ctx, match, logos, pinturas, contexto, { columna, separacion: columna + 8 }, theme),
    bloqueCentro(ctx, match, status, dateParts, ancho, theme),
    bloqueSede(ctx, match, ancho, theme),
  ].filter(Boolean), w / 2, arriba, alto - ALTO_YARDAS - arriba);
}

// ── La horizontal ──

// La jornada y su detalle en un solo renglón, como en la portada de la computadora.
function rondaEnLinea(ctx, match, ancho, theme) {
  const ronda = rondaDelPartido(match);
  const detalle = detalleDelPartido(match);
  if (!ronda && !detalle) return null;

  const lRonda = letra(400, 58, theme.fontDisplay);
  const anchoRonda = ronda ? medir(ctx, ronda, lRonda) + (detalle ? 28 : 0) : 0;
  const disponible = ancho - anchoRonda;
  const letraDetalle = letraDeDetalle(theme);
  const lDetalle = letraDetalle(tallaQueCabe(ctx, [detalle], disponible, 29, 20, letraDetalle));

  return {
    alto: 72,
    pintar(cx, y) {
      ponerLetra(ctx, lDetalle);
      const texto = ellipsize(ctx, detalle, disponible);
      const x = cx - (anchoRonda + medir(ctx, texto, lDetalle)) / 2;
      if (ronda) escribir(ctx, ronda, x, y + 60, lRonda, colorDeRonda(match, theme), 'left');
      if (detalle) escribir(ctx, texto, x + anchoRonda, y + 60, lDetalle, 'rgba(255, 255, 255, 0.86)', 'left');
    },
  };
}

// La hora o el marcador entre los dos cascos, como en la computadora.
function dueloConCentro(ctx, duelo, centro) {
  return {
    alto: duelo.alto,
    pintar(cx, y) {
      duelo.pintar(cx, y);
      ctx.save();
      ctx.translate(cx, y + (duelo.alto - centro.alto * ESCALA_HORIZONTAL) / 2);
      ctx.scale(ESCALA_HORIZONTAL, ESCALA_HORIZONTAL);
      centro.pintar(0, 0);
      ctx.restore();
    },
  };
}

function dibujarHorizontal(ctx, w, alto, datos, theme) {
  const { match, status, dateParts, pinturas, contexto, logos } = datos;
  const cancha = dibujarCancha(ctx, w, alto, Math.round(w * YARDAS_DE_END_ZONE), match, pinturas, theme);

  const ancho = cancha.w - PADDING_HORIZONTAL * 2;
  const disponible = alto - ALTO_YARDAS - ARRIBA_HORIZONTAL;

  const liga = bloqueDeLiga(ctx, match, logos, ancho, theme);
  const ronda = rondaEnLinea(ctx, match, ancho, theme);
  const sede = bloqueSede(ctx, match, ancho, theme);
  const fijos = [liga, ronda, sede].filter(Boolean);

  const columna = (ancho - ANCHO_CENTRO) / 2;
  const duelo = bloqueDuelo(ctx, match, logos, pinturas, contexto, {
    columna,
    separacion: columna + ANCHO_CENTRO,
    tallaNombre: 58,
    tallaMinima: 40,
    altoMaximo: disponible - fijos.reduce((suma, b) => suma + b.alto, 0) - fijos.length * HUECO_MINIMO,
    escala: ESCALA_HORIZONTAL,
  }, theme);
  const anchoTextos = (ANCHO_CENTRO - AIRE_DEL_CENTRO) / ESCALA_HORIZONTAL;
  const centro = bloqueCentro(ctx, match, status, dateParts, anchoTextos, theme);

  repartir(
    [liga, ronda, dueloConCentro(ctx, duelo, centro), sede].filter(Boolean),
    w / 2, ARRIBA_HORIZONTAL, disponible,
  );
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
 * @param {'post'|'story'|'landscape'} formatKey
 * @param {object} dateParts - de getMatchParts()
 * @param {'scheduled'|'live'|'finished'} status - de getMatchStatus(match)
 * @param {{home: object, away: object}} pinturas - de useTeamPaint(), los mismos colores de la página
 * @param {object|null} contexto - de api.getMatchContext; si no ha llegado, la imagen sale sin récord,
 *   igual que la portada
 * @returns {Promise<Blob>}
 */
export async function generateMatchCard(match, formatKey, dateParts, status, pinturas, contexto) {
  const format = SHARE_CARD_FORMATS[formatKey] || FORMATS.post;
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

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = NOCHE;
  ctx.fillRect(0, 0, w, h);

  if (formatKey === 'landscape') {
    dibujarHorizontal(ctx, w, h, datos, theme);
  } else {
    // La historia tiene lugar para "Cara a cara", en el mismo orden que la página.
    // La publicación es solo la portada: ahí cada renglón de la tabla se lo
    // quitaría a los cascos.
    const filas = formatKey === 'story' ? filasCaraACara(contexto?.home, contexto?.away) : [];
    const altoPlaca = altoCaraACara(filas) + ALTO_PIE;
    const altoPortada = h - altoPlaca;

    dibujarPortada(ctx, w, altoPortada, ARRIBA[formatKey] ?? ARRIBA.post, datos, theme);
    if (filas.length > 0) dibujarCaraACara(ctx, filas, altoPortada, w, datos, theme);
    dibujarMarca(ctx, marca, w / 2, h - ALTO_PIE + (ALTO_PIE - ALTO_MARCA) / 2, ALTO_MARCA, theme);
  }

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
}
