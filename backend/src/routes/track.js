import express from 'express';
import db from '../config/db.js';
import { trackLimiter } from '../middleware/rateLimit.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

// Lista fija de eventos que se pueden registrar. Es a propósito una lista
// cerrada (en vez de aceptar cualquier texto que mande el navegador): así
// nadie puede llenar la tabla con basura, y cada vez que agreguemos una
// estadística nueva (ej. clic en patrocinador, vista de calendario) basta
// con sumar el nombre aquí.
const VALID_EVENTS = new Set([
  'home_view',
]);

// POST /api/track — sin autenticación (lo llama cualquier visitante,
// incluso sin cuenta). Solo guarda que "algo pasó", sin datos personales.
router.post('/', trackLimiter, asyncHandler(async (req, res) => {
  const { event_type } = req.body;
  if (!VALID_EVENTS.has(event_type)) {
    return res.status(400).json({ error: 'Tipo de evento no válido' });
  }
  await db.prepare('INSERT INTO page_views (event_type) VALUES (?)').run(event_type);
  res.status(204).end();
}));

export default router;
