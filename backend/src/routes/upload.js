import express from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { authRequired } from '../middleware/auth.js';

// Guardamos el archivo en memoria (buffer) en vez de en disco: Render free
// borra el filesystem en cada reinicio/deploy, así que nunca debemos
// depender de archivos locales persistentes.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten archivos de imagen'));
  },
});

let configured = false;
function ensureCloudinaryConfigured() {
  // Evaluamos process.env aquí (en tiempo de petición), no en el top-level
  // del módulo, porque en ESM los imports se resuelven antes que
  // dotenv.config() corra en server.js — leer process.env al importar
  // este archivo podía capturar valores aún vacíos.
  if (configured) return Boolean(process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME);

  const hasUrl = Boolean(process.env.CLOUDINARY_URL);
  const hasSeparateVars = Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

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

function uploadBufferToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'lifa-app/logos',
        resource_type: 'image',
        // Logos pequeños y consistentes; evita que alguien suba un archivo gigante con dimensiones absurdas.
        transformation: [{ width: 800, height: 800, crop: 'limit' }],
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

const router = express.Router();

router.post('/', authRequired, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

  const isConfigured = ensureCloudinaryConfigured();
  if (!isConfigured) {
    return res.status(500).json({
      error: 'El almacenamiento de imágenes no está configurado en el servidor. Pega la URL de una imagen externa mientras tanto.',
    });
  }

  try {
    const result = await uploadBufferToCloudinary(req.file.buffer);
    res.status(201).json({ url: result.secure_url });
  } catch (err) {
    console.error('Error subiendo a Cloudinary:', err);
    res.status(502).json({ error: 'No se pudo subir la imagen al almacenamiento. Intenta de nuevo o usa una URL externa.' });
  }
});

export default router;