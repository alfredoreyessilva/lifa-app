import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../config/db.js';
import { signToken, authRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { isValidEmail } from '../utils/validation.js';

const router = express.Router();

router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Faltan campos: nombre, email, contraseña' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Ese correo no tiene un formato válido' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Ese correo ya está registrado' });

  const hash = bcrypt.hashSync(password, 10);
  const result = await db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(name, email, hash, 'rep');

  const user = { id: result.lastInsertRowid, name, email, role: 'rep' };
  res.status(201).json({ token: signToken(user), user });
}));

router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Faltan email o contraseña' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.json({ token: signToken(safeUser), user: safeUser });
}));

router.get('/me', authRequired, asyncHandler(async (req, res) => {
  const user = await db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const leagues = await db.prepare('SELECT id, name, slug, logo_url, status FROM leagues WHERE owner_user_id = ?').all(user.id);
  const teams = await db.prepare(`
    SELECT t.*, l.name AS league_name, l.slug AS league_slug
    FROM teams t
    JOIN leagues l ON l.id = t.league_id
    WHERE t.owner_user_id = ?
  `).all(user.id);
  // Campo nuevo, aditivo: todas las organizaciones donde el usuario es
  // miembro activo (owner/admin/editor), vía organization_members. "leagues"
  // y "teams" arriba siguen calculándose igual que siempre (por
  // owner_user_id) — el frontend todavía los usa así. "organizations" es la
  // fuente que el panel va a adoptar en el siguiente paso, y a futuro es la
  // única que va a poder mostrar organizaciones con más de un miembro.
  const organizations = await db.prepare(`
    SELECT o.id, o.name, o.slug, o.type, o.logo_url, o.status, om.role AS member_role
    FROM organization_members om
    JOIN organizations o ON o.id = om.organization_id
    WHERE om.user_id = ? AND om.status = 'active'
    ORDER BY o.type, o.name
  `).all(user.id);
  res.json({ user, leagues, teams, organizations });
}));

export default router;