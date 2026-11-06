import { useEffect, useState } from 'react';
import { imagenAjustada } from './imagenes.js';
import { esHex, leerLogo, pinturaDeZona, PINTURA_NEUTRA } from './teamPaint.js';

// La parte con navegador de utils/teamPaint.js: baja el logo chico, lo pasa por
// un canvas y le entrega los pixeles a leerLogo().
//
// Es una imagen aparte de la que se ve. Pedirla con crossOrigin hace que un
// logo fuera de Cloudinary, sin los permisos para leerlo, simplemente no se
// lea; si se le pusiera a la imagen visible, ese logo no se vería.

const LADO = 48;
// Lo que no se pudo leer va en disco: recortado se ve bien tenga el fondo que
// tenga, y al revés no.
const SIN_LEER = Object.freeze({ color: null, forma: 'disco' });

// Al ir de un partido al siguiente los equipos se repiten: cada logo se lee una
// vez por sesión. Se guarda la promesa para que dos lecturas seguidas no bajen
// dos veces la misma imagen.
const leidos = new Map();
// Las lecturas que ya terminaron, para quien no quiere esperar ni un cuadro (ver
// `alInstante`, abajo): una promesa, aunque ya esté resuelta, contesta tarde.
const terminados = new Map();

function leer(url) {
  if (leidos.has(url)) return leidos.get(url);
  const promesa = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = LADO;
        canvas.height = LADO;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, LADO, LADO);
        resolve(leerLogo(ctx.getImageData(0, 0, LADO, LADO).data, LADO));
      } catch {
        resolve(SIN_LEER);
      }
    };
    img.onerror = () => resolve(SIN_LEER);
    img.src = imagenAjustada(url, 96);
  });
  leidos.set(url, promesa);
  promesa.then((leido) => terminados.set(url, leido));
  return promesa;
}

// De lo leído a la pintura: `teams.brand_color` manda sobre el color del logo.
function pintar(leido, brandColor) {
  const color = esHex(brandColor) ? brandColor.trim() : leido?.color;
  return {
    ...(color ? pinturaDeZona(color) : PINTURA_NEUTRA),
    forma: leido?.forma ?? 'disco',
    listo: leido !== null,
  };
}

// La misma pintura, sin React, para la imagen de la tabla: ahí son muchos equipos
// a la vez y dentro de una función. El logo que no llega en `ms` se queda en verde
// y en disco, igual que el que no se pudo leer: una imagen con un color de menos es
// mejor que un botón atorado en "Generando imagen…".
export function pinturaDelLogo(logoUrl, brandColor, ms) {
  const tarde = new Promise((resolve) => { setTimeout(() => resolve(SIN_LEER), ms); });
  return Promise.race([logoUrl ? leer(logoUrl) : SIN_LEER, tarde])
    .then((leido) => pintar(leido, brandColor));
}

// `listo` es para que el casco no salte de forma al terminar de leerse: se
// enseña hasta que se sabe cómo va.
//
// `alInstante` es para las listas: un logo ya leído se pinta desde el primer
// cuadro. Sin esto, cada cambio de filtro del calendario regresaría sus tarjetas
// al verde por un instante. La portada no lo usa: al pasar de un partido a otro
// quiere ese instante, porque es lo que le da su entrada a los cascos.
export function useTeamPaint(logoUrl, brandColor, { alInstante = false } = {}) {
  const inicial = () => {
    if (!logoUrl) return SIN_LEER;
    return alInstante ? terminados.get(logoUrl) ?? null : null;
  };
  const [leido, setLeido] = useState(inicial);

  useEffect(() => {
    let vigente = true;
    setLeido(inicial());
    if (!logoUrl) return undefined;
    leer(logoUrl).then((r) => { if (vigente) setLeido(r); });
    return () => { vigente = false; };
  }, [logoUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  return pintar(leido, brandColor);
}
