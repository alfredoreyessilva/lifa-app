import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { initSchema } from './config/db.js';
import authRoutes          from './routes/auth.js';
import leagueRoutes        from './routes/leagues.js';
import manageRoutes        from './routes/manage.js';
import uploadRoutes        from './routes/upload.js';
import adminRoutes         from './routes/admin.js';
import notificationRoutes  from './routes/notifications.js';
import inviteRoutes        from './routes/invites.js';

// Orígenes permitidos para llamar a la API desde el navegador. Se definen en
// la variable de entorno ALLOWED_ORIGINS (separados por coma), por ejemplo:
//   ALLOWED_ORIGINS=https://tu-dominio.vercel.app,https://www.tu-dominio.mx
// En desarrollo local siempre se permiten los puertos típicos de Vite, aunque
// no estén en la variable de entorno, para no estorbar el flujo de `npm run dev`.
const devOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = [...devOrigins, ...configuredOrigins];

if (configuredOrigins.length === 0 && process.env.NODE_ENV === 'production') {
  // No tronamos el servidor por esto (a diferencia de DATABASE_URL/JWT_SECRET),
  // porque solo afecta qué webs pueden leer las respuestas del navegador, no
  // la seguridad de los datos en sí — pero sí avisamos fuerte en los logs.
  console.warn(
    'ADVERTENCIA: ALLOWED_ORIGINS no está definida en producción. ' +
    'Solo se permitirán peticiones desde localhost. Define ALLOWED_ORIGINS ' +
    'con tu dominio real (ej. https://tu-app.vercel.app) en las variables de entorno.'
  );
}

const app = express();
app.use(cors({
  origin(origin, callback) {
    // Sin header "Origin" = petición servidor-a-servidor, curl, el cronjob, etc.
    // (no viene de un navegador, así que CORS no aplica). Se deja pasar.
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
}));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth',          authRoutes);
app.use('/api/leagues',       leagueRoutes);
app.use('/api/manage',        manageRoutes);
app.use('/api/upload',        uploadRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/invites',       inviteRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = process.env.PORT || 4000;

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`API corriendo en http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('Error inicializando la base de datos:', err);
    process.exit(1);
  });