import { v2 as cloudinary } from 'cloudinary';

// Configuración y subida a Cloudinary, compartidas por routes/upload.js (la
// subida con sesión: logos, portadas, fotos de jugador), por el endpoint
// público de comprobantes en routes/playerBilling.js, donde el papá sube su
// captura del SPEI sin tener cuenta y el share_token hace de credencial, y por
// el playbook del equipo (routes/playbook.js).
//
// Vivía en línea dentro de routes/upload.js; se saca aquí en cuanto hubo un
// segundo llamador, en vez de copiar la misma configuración en dos lugares.

let configured = false;

// Se evalúa process.env en tiempo de petición, no en el top-level del módulo:
// en ESM los imports se resuelven antes que dotenv.config() corra en
// server.js, así que leerlo al importar podía capturar valores aún vacíos.
export function ensureCloudinaryConfigured() {
  if (configured) return Boolean(process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME);

  const hasUrl = Boolean(process.env.CLOUDINARY_URL);
  const hasSeparateVars = Boolean(
    process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET
  );

  if (hasSeparateVars) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }
  // Si solo viene CLOUDINARY_URL, el SDK la lee automáticamente de process.env
  // sin necesidad de llamar a cloudinary.config().

  configured = true;
  return hasUrl || hasSeparateVars;
}

// Borra un archivo de Cloudinary. Hoy solo lo usa el playbook del equipo
// (routes/playbook.js): ahí borrar una imagen es quitar una jugada, y una URL
// sin firma seguiría abriéndola. `invalidate` vacía también la copia del CDN,
// que si no la seguiría sirviendo un rato.
//
// Devuelve lo que contesta Cloudinary ('ok' o 'not found') y no lanza por un
// archivo que ya no existe: borrar dos veces es lo mismo que borrar una.
export async function destroyFromCloudinary(publicId) {
  const { result } = await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
  return result;
}

// `transformation` se puede pasar vacío: un comprobante de transferencia suele
// ser una captura alta y angosta, y encajarla en el cuadro de 800x800 que usan
// los logos la dejaría ilegible justo donde está el monto.
export function uploadBufferToCloudinary(buffer, { folder, transformation } = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: folder || 'lifa-app/logos',
        resource_type: 'image',
        ...(transformation ? { transformation } : {}),
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}
