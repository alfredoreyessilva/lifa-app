import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

// Middleware: solo admin
function adminRequired(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso restringido a administradores' });
  }
  next();
}

/* ===================== ESTADÍSTICAS ===================== */

router.get('/stats', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const [leagues, users, matches, teams] = await Promise.all([
    db.prepare('SELECT COUNT(*) as count FROM leagues').get(),
    db.prepare('SELECT COUNT(*) as count FROM users').get(),
    db.prepare('SELECT COUNT(*) as count FROM matches').get(),
    db.prepare('SELECT COUNT(*) as count FROM teams').get(),
  ]);
  res.json({
    leagues: leagues.count,
    users:   users.count,
    matches: matches.count,
    teams:   teams.count,
  });
}));

/* ===================== LIGAS ===================== */

router.get('/leagues', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const leagues = await db.prepare(`
    SELECT l.*, u.name as owner_name, u.email as owner_email
    FROM leagues l
    LEFT JOIN users u ON l.owner_user_id = u.id
    ORDER BY l.created_at DESC
  `).all();
  res.json(leagues);
}));

router.delete('/leagues/:id', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id);
  if (!league) return res.status(404).json({ error: 'Liga no encontrada' });
  await db.prepare('DELETE FROM leagues WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

/* ===================== USUARIOS ===================== */

router.get('/users', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const users = await db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.created_at,
      COUNT(l.id) as league_count
    FROM users u
    LEFT JOIN leagues l ON l.owner_user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();
  res.json(users);
}));

router.delete('/users/:id', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (user.role === 'admin') return res.status(400).json({ error: 'No puedes eliminar una cuenta de admin' });
  await db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

/* ===================== PATROCINADORES ===================== */

router.get('/sponsors', asyncHandler(async (req, res) => {
  const sponsors = await db.prepare('SELECT * FROM sponsors ORDER BY sort_order ASC').all();
  res.json(sponsors);
}));

router.post('/sponsors', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const { name, logo_url, link_url, sort_order } = req.body;
  if (!logo_url) return res.status(400).json({ error: 'El logo es obligatorio' });

  const count = await db.prepare('SELECT COUNT(*) as count FROM sponsors').get();
  if (count.count >= 4) return res.status(400).json({ error: 'Solo se permiten 4 patrocinadores' });

  const result = await db.prepare(`
    INSERT INTO sponsors (name, logo_url, link_url, sort_order)
    VALUES (?, ?, ?, ?)
  `).run(name || null, logo_url, link_url || null, sort_order || count.count + 1);

  res.status(201).json(await db.prepare('SELECT * FROM sponsors WHERE id = ?').get(result.lastInsertRowid));
}));

router.put('/sponsors/:id', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const { name, logo_url, link_url, sort_order } = req.body;
  const sponsor = await db.prepare('SELECT * FROM sponsors WHERE id = ?').get(req.params.id);
  if (!sponsor) return res.status(404).json({ error: 'Patrocinador no encontrado' });

  await db.prepare(`
    UPDATE sponsors SET
      name       = COALESCE(?, name),
      logo_url   = COALESCE(?, logo_url),
      link_url   = COALESCE(?, link_url),
      sort_order = COALESCE(?, sort_order)
    WHERE id = ?
  `).run(name ?? null, logo_url ?? null, link_url ?? null, sort_order ?? null, sponsor.id);

  res.json(await db.prepare('SELECT * FROM sponsors WHERE id = ?').get(sponsor.id));
}));

router.delete('/sponsors/:id', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const sponsor = await db.prepare('SELECT * FROM sponsors WHERE id = ?').get(req.params.id);
  if (!sponsor) return res.status(404).json({ error: 'Patrocinador no encontrado' });
  await db.prepare('DELETE FROM sponsors WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

export default router;
