// Pedirle a Cloudinary una imagen al tamaño en que se va a ver.
//
// El playbook guarda cada jugada hasta de 2000 px, que es lo que pide la
// pantalla completa, y la cuadrícula la pinta a unos 300. Sin esto, abrir un
// playbook de treinta jugadas en la cancha bajaría treinta fotos completas con
// los datos del celular. Cloudinary transforma por URL: basta con meter el
// tamaño después de `/image/upload/`, y guarda la versión chica la primera vez
// que alguien la pide.
//
//   c_limit  nunca agranda una imagen que ya es más chica que `ancho`
//   q_auto   la calidad más baja que no se nota
//   f_auto   a cada navegador, un formato que sabe pintar (una foto HEIC de
//            iPhone incluida, que Chrome no abre)
//
// Lo que no es una URL de Cloudinary, o ya trae una transformación, se
// devuelve tal cual: una imagen pesada es mejor que una rota.
const CLOUDINARY = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/;

// El primer tramo después de `/upload/` es una transformación cuando se ve
// como "c_limit,w_640/": letras, guion bajo, y algo más antes de la diagonal.
// Una versión ("v1696…/") o una carpeta ("lifa-app/") no.
const YA_TRANSFORMADA = /^[a-z]{1,3}_[^/]*\//;

export function imagenAjustada(url, ancho) {
  const partes = typeof url === 'string' && Number(ancho) > 0 ? url.match(CLOUDINARY) : null;
  if (!partes) return url;
  const [, base, resto] = partes;
  if (YA_TRANSFORMADA.test(resto)) return url;
  return `${base}c_limit,w_${Math.round(Number(ancho))},q_auto,f_auto/${resto}`;
}
