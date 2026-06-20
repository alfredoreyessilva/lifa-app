import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import leagueRoutes from './routes/leagues.js';
import manageRoutes from './routes/manage.js';
import uploadRoutes from './routes/upload.js';

const app = express();
app.use(cors());
app.use(express.json());
// Los logos ahora se sirven desde Cloudinary (URLs absolutas), ya no
// necesitamos exponer una carpeta /uploads del filesystem local.

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/leagues', leagueRoutes);
app.use('/api/manage', manageRoutes);
app.use('/api/upload', uploadRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API corriendo en http://localhost:${PORT}`));