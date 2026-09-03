import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isOrgMember } from '../utils/orgMembers.js';
import { isValidUrl } from '../utils/validation.js';

const router = express.Router();

// Público, sin authRequired — la ficha de un partido debe poder mostrar
// quién lo transmite sin necesitar sesión, igual que la tarjeta del jugador.
router.get('/match/:matchId', asyncHandler(async (req, res) => {
  const broadcasts = await db.prepare(`
    SELECT b.id, b.url, o.id AS organization_id, o.name, o.slug, o.logo_url
    FROM match_broadcasts b
    JOIN organizations o ON o.id = b.organization_id
    WHERE b.match_id = ?
    ORDER BY o.name
  `).all(req.params.matchId);
  res.json({ broadcasts });
}));

// Lo que UN medio está transmitiendo — para su propio panel (paso 4).
router.get('/organization/:organizationId', authRequired, asyncHandler(async (req, res) => {
  const organizationId = Number(req.params.organizationId);
  const isMember = await isOrgMember(req.user.id, organizationId);
  if (req.user.role !== 'admin' && !isMember) {
    return res.status(403).json({ error: 'No tienes permiso sobre esta organización' });
  }
  const broadcasts = await db.prepare(`
    SELECT b.id, b.url, b.match_id, m.home_team, m.away_team, m.match_date, m.status,
           l.name AS league_name
    FROM match_broadcasts b
    JOIN matches m ON m.id = b.match_id
    JOIN categories c ON c.id = m.category_id
    JOIN leagues l ON l.id = c.league_id
    WHERE b.organization_id = ?
    ORDER BY m.match_date DESC
  `).all(organizationId);
  res.json({ broadcasts });
}));

// Autoasignación: el medio se agrega solo a un partido, sin que la liga
// intervenga. Requiere: (a) ser miembro de esa organización, y (b) que la
// organización sea de tipo 'media' y esté verificada — la verificación
// certifica QUIÉN es el medio, no que tenga derechos sobre ESTE partido en
// particular (decisión consciente, ver comentario en db.js).
router.post('/', authRequired, asyncHandler(async (req, res) => {
  const { match_id, organization_id, url } = req.body;
  if (!match_id || !organization_id) {
    return res.status(400).json({ error: 'match_id y organization_id son obligatorios' });
  }
  if (url && !isValidUrl(url)) return res.status(400).json({ error: 'El link no es una dirección web válida' });

  const org = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(organization_id);
  if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
  if (org.type !== 'media') return res.status(400).json({ error: 'Solo organizaciones de tipo medio pueden transmitir partidos' });
  if (!org.is_verified) return res.status(403).json({ error: 'Este medio todavía no está verificado' });

  const match = await db.prepare('SELECT id FROM matches WHERE id = ?').get(match_id);
  if (!match) return res.status(404).json({ error: 'Partido no encontrado' });

  const isMember = await isOrgMember(req.user.id, organization_id);
  if (req.user.role !== 'admin' && !isMember) {
    return res.status(403).json({ error: 'No tienes permiso sobre este medio' });
  }

  // Si el medio ya estaba en este partido, esto es solo una edición del link:
  // se actualiza la URL pero NO se vuelve a avisar a la liga.
  const existing = await db.prepare(
    'SELECT id FROM match_broadcasts WHERE match_id = ? AND organization_id = ?'
  ).get(match_id, organization_id);

  const broadcast = await db.prepare(`
    INSERT INTO match_broadcasts (match_id, organization_id, url)
    VALUES (?, ?, ?)
    ON CONFLICT (match_id, organization_id) DO UPDATE SET url = EXCLUDED.url
    RETURNING *
  `).get(match_id, organization_id, url || null);

  // Aviso a la bandeja de la liga (solo in-app, sin push) la primera vez que
  // este medio se suma al partido.
  if (!existing) {
    const matchDetails = await db.prepare(`
      SELECT m.id, m.home_team, m.away_team, c.league_id
      FROM matches m
      JOIN categories c ON c.id = m.category_id
      WHERE m.id = ?
    `).get(match_id);

    if (matchDetails) {
      await db.prepare(`
        INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
        VALUES ('league', ?, 'broadcast_added', ?, ?, ?)
      `).run(
        matchDetails.league_id,
        'Nuevo medio transmitiendo tu partido 🎥',
        `El medio "${org.name}" agregó un enlace de transmisión para el partido ${matchDetails.home_team} vs ${matchDetails.away_team}.`,
        JSON.stringify({
          match_id: matchDetails.id,
          league_id: matchDetails.league_id,
          media_name: org.name,
          url: `/partidos/${matchDetails.id}`,
        })
      );
    }
  }

  res.status(201).json(broadcast);
}));

router.delete('/:id', authRequired, asyncHandler(async (req, res) => {
  const broadcast = await db.prepare('SELECT * FROM match_broadcasts WHERE id = ?').get(req.params.id);
  if (!broadcast) return res.status(404).json({ error: 'No encontrado' });

  const isMember = await isOrgMember(req.user.id, broadcast.organization_id);
  if (req.user.role !== 'admin' && !isMember) {
    return res.status(403).json({ error: 'No tienes permiso sobre este medio' });
  }

  await db.prepare('DELETE FROM match_broadcasts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

export default router;
