import express from 'express';
import multer from 'multer';
import { authRequired } from '../middleware/auth.js';
import { ensureCloudinaryConfigured, uploadBufferToCloudinary } from '../utils/cloudinary.js';

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
    // Logos pequeños y consistentes; evita que alguien suba un archivo gigante
    // con dimensiones absurdas.
    const result = await uploadBufferToCloudinary(req.file.buffer, {
      folder: 'lifa-app/logos',
      transformation: [{ width: 800, height: 800, crop: 'limit' }],
    });
    res.status(201).json({ url: result.secure_url });
  } catch (err) {
    console.error('Error subiendo a Cloudinary:', err);
    res.status(502).json({ error: 'No se pudo subir la imagen al almacenamiento. Intenta de nuevo o usa una URL externa.' });
  }
});

export default router;
