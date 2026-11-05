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
  return promesa;
}

// `listo` es para que el casco no salte de forma al terminar de leerse: se
// enseña hasta que se sabe cómo va.
export function useTeamPaint(logoUrl, brandColor) {
  const [leido, setLeido] = useState(null);

  useEffect(() => {
    let vigente = true;
    setLeido(null);
    if (!logoUrl) {
      setLeido(SIN_LEER);
      return undefined;
    }
    leer(logoUrl).then((r) => { if (vigente) setLeido(r); });
    return () => { vigente = false; };
  }, [logoUrl]);

  const color = esHex(brandColor) ? brandColor.trim() : leido?.color;
  return {
    ...(color ? pinturaDeZona(color) : PINTURA_NEUTRA),
    forma: leido?.forma ?? 'disco',
    listo: leido !== null,
  };
}
