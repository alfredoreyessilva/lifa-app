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
  'sponsor_impression',
  'sponsor_click',
]);

// Eventos que van ligados a un patrocinador específico (sponsor_id
// obligatorio), para poder calcular impresiones/clics por patrocinador.
const SPONSOR_EVENTS = new Set(['sponsor_impression', 'sponsor_click']);

// POST /api/track — sin autenticación (lo llama cualquier visitante,
// incluso sin cuenta). Solo guarda que "algo pasó", sin datos personales.
router.post('/', trackLimiter, asyncHandler(async (req, res) => {
  const { event_type, sponsor_id, visitor_id } = req.body;
  if (!VALID_EVENTS.has(event_type)) {
    return res.status(400).json({ error: 'Tipo de evento no válido' });
  }

  if (SPONSOR_EVENTS.has(event_type) && !Number.isInteger(sponsor_id)) {
    return res.status(400).json({ error: 'sponsor_id es obligatorio para este evento' });
  }

  // visitor_id es un id al azar que genera el navegador (localStorage), no
  // un dato personal — se guarda tal cual si viene con una forma razonable,
  // y si no viene (localStorage bloqueado, navegación privada) el evento se
  // guarda igual, solo que no cuenta para "visitantes únicos".
  const visitorId = typeof visitor_id === 'string' && visitor_id.length > 0 && visitor_id.length <= 64
    ? visitor_id
    : null;

  await db.prepare('INSERT INTO page_views (event_type, sponsor_id, visitor_id) VALUES (?, ?, ?)')
    .run(event_type, SPONSOR_EVENTS.has(event_type) ? sponsor_id : null, visitorId);

  res.status(204).end();
}));

export default router;
