import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../config/db.js';
import { signToken, authRequired } from '../middleware/auth.js';

const router = express.Router();

// Registro de representante de liga
router.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Faltan campos: nombre, email, contraseña' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Ese correo ya está registrado' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(name, email, hash, 'rep');

  const user = { id: result.lastInsertRowid, name, email, role: 'rep' };
  res.status(201).json({ token: signToken(user), user });
});

// Login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Faltan email o contraseña' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.json({ token: signToken(safeUser), user: safeUser });
});

// Obtener perfil actual
router.get('/me', authRequired, (req, res) => {
  const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const leagues = db.prepare('SELECT id, name, slug, logo_url, status FROM leagues WHERE owner_user_id = ?').all(user.id);
  res.json({ user, leagues });
});

export default router;
