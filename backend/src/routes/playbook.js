import express from 'express';
import multer from 'multer';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { teamPlaybookRequired } from '../middleware/ownership.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ensureCloudinaryConfigured, uploadBufferToCloudinary, destroyFromCloudinary } from '../utils/cloudinary.js';
import { limpiarTitulo } from '../utils/playbook.js';

// El playbook del equipo: las imágenes de jugadas que sube su cuerpo técnico
// (README, "Playbook del equipo"). Una sola guarda para las cuatro rutas, y es
// a propósito: quien puede ver el playbook puede subir, renombrar y borrar, y
// borrar incluye lo que subió otro. Quién pasa lo decide `teamPlaybookRequired`
// —dueño, administrador y coach del equipo; la liga no—.
//
//   GET    /api/playbook/teams/:teamId                    las imágenes, la más nueva primero
//   POST   /api/playbook/teams/:teamId                    multipart: `file` y `title` (opcional)
//   PATCH  /api/playbook/teams/:teamId/images/:imageId    { title }
//   DELETE /api/playbook/teams/:teamId/images/:imageId

const router = express.Router();

// Una foto de pizarrón tomada con el celular pesa más que un logo, y a
// diferencia de un logo hay que poder leerla en pantalla completa. 8 MB deja
// pasar casi cualquier foto y queda abajo del tope de Cloudinary (10 MB).
const MAX_MB = 8;

const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se pueden subir imágenes'));
  },
});

// Multer avisa sus errores con next(err), y el manejador global los vuelve un
// 500 genérico. Aquí se contestan como lo que son —una imagen demasiado pesada
// o un archivo que no es imagen— con un mensaje que se pueda leer.
//
// Va DESPUÉS de la guarda en cada ruta: a quien no tiene permiso se le contesta
// 403 antes de leer el archivo, y nada suyo llega a Cloudinary.
function recibirImagen(req, res, next) {
  subida.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `La imagen pesa más de ${MAX_MB} MB. Prueba con una captura de pantalla o una foto más ligera.` });
    }
    return res.status(400).json({ error: err.message || 'No se pudo leer el archivo' });
  });
}

// Las columnas que viajan, nombradas una por una: `public_id` es la llave del
// archivo en Cloudinary y a la pantalla no le sirve de nada.
const COLUMNAS = `
  p.id, p.team_id, p.image_url, p.title, p.uploaded_by, p.created_at, p.updated_at,
  u.name AS uploaded_by_name
`;

// Un id que no es número no es "esa imagen no existe en este equipo" por
// accidente: sin esto, Postgres revienta al convertirlo y contesta 500.
function idDeImagen(req) {
  const id = Number(req.params.imageId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const NO_ESTA = 'Esa imagen ya no está en el playbook';

router.get('/teams/:teamId', authRequired, teamPlaybookRequired, asyncHandler(async (req, res) => {
  const images = await db.prepare(`
    SELECT ${COLUMNAS}
    FROM team_playbook_images p
    LEFT JOIN users u ON u.id = p.uploaded_by
    WHERE p.team_id = ?
    ORDER BY p.created_at DESC, p.id DESC
  `).all(req.team.id);
  res.json({ images });
}));

router.post('/teams/:teamId', authRequired, teamPlaybookRequired, recibirImagen, asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });
  if (!ensureCloudinaryConfigured()) {
    return res.status(500).json({ error: 'El almacenamiento de imágenes no está configurado en el servidor.' });
  }

  // Sin recorte cuadrado, a diferencia de los logos: una jugada se lee
  // completa o no sirve. Solo un techo de 2000 px, que alcanza para pantalla
  // completa y evita guardar los 4000 px de una foto de celular.
  let archivo;
  try {
    archivo = await uploadBufferToCloudinary(req.file.buffer, {
      folder: 'lifa-app/playbook',
      transformation: [{ width: 2000, height: 2000, crop: 'limit' }],
    });
  } catch (err) {
    console.error('Error subiendo una imagen del playbook a Cloudinary:', err);
    return res.status(502).json({ error: 'No se pudo subir la imagen. Intenta de nuevo.' });
  }

  // Una sola sentencia: la fila nueva sale ya con el nombre de quien la subió,
  // igual que en la lista.
  let image;
  try {
    image = await db.prepare(`
      WITH nueva AS (
        INSERT INTO team_playbook_images (team_id, image_url, public_id, title, uploaded_by)
        VALUES (?, ?, ?, ?, ?)
        RETURNING *
      )
      SELECT ${COLUMNAS}
      FROM nueva p
      LEFT JOIN users u ON u.id = p.uploaded_by
    `).get(req.team.id, archivo.secure_url, archivo.public_id, limpiarTitulo(req.body?.title), req.user.id);
  } catch (err) {
    // El archivo ya está en Cloudinary y la fila no se escribió: se borra para
    // no dejar una imagen que ninguna pantalla enseña.
    destroyFromCloudinary(archivo.public_id).catch(() => {});
    throw err;
  }

  res.status(201).json({ image });
}));

router.patch('/teams/:teamId/images/:imageId', authRequired, teamPlaybookRequired, asyncHandler(async (req, res) => {
  const imageId = idDeImagen(req);
  if (!imageId) return res.status(404).json({ error: NO_ESTA });
  // Mandar el título vacío lo quita; no mandarlo es un error. Un PATCH sin
  // cuerpo que borrara el título en silencio sería una sorpresa.
  if (!req.body || !('title' in req.body)) {
    return res.status(400).json({ error: 'Falta el título' });
  }

  // `team_id` en el WHERE es la frontera: el permiso se revisó sobre el equipo
  // de la URL, así que la imagen tiene que ser de ese equipo y no de otro.
  const image = await db.prepare(`
    WITH editada AS (
      UPDATE team_playbook_images
      SET title = ?, updated_at = NOW()
      WHERE id = ? AND team_id = ?
      RETURNING *
    )
    SELECT ${COLUMNAS}
    FROM editada p
    LEFT JOIN users u ON u.id = p.uploaded_by
  `).get(limpiarTitulo(req.body.title), imageId, req.team.id);
  if (!image) return res.status(404).json({ error: NO_ESTA });
  res.json({ image });
}));

router.delete('/teams/:teamId/images/:imageId', authRequired, teamPlaybookRequired, asyncHandler(async (req, res) => {
  const imageId = idDeImagen(req);
  if (!imageId) return res.status(404).json({ error: NO_ESTA });

  const borrada = await db.prepare(`
    DELETE FROM team_playbook_images
    WHERE id = ? AND team_id = ?
    RETURNING public_id
  `).get(imageId, req.team.id);
  if (!borrada) return res.status(404).json({ error: NO_ESTA });

  // La fila ya no existe: para el equipo, la imagen está borrada. Lo de
  // Cloudinary es el segundo paso y no se le reporta a quien borró si falla —
  // ya no hay nada que pueda hacer al respecto—, pero queda en los logs: un
  // archivo huérfano lo sigue abriendo quien haya guardado su link.
  if (borrada.public_id && ensureCloudinaryConfigured()) {
    try {
      await destroyFromCloudinary(borrada.public_id);
    } catch (err) {
      console.error('No se pudo borrar de Cloudinary la imagen del playbook', borrada.public_id, err);
    }
  }
  res.json({ ok: true });
}));

export default router;
