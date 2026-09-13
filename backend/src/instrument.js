// Tiene que ser el primer import de server.js (antes que express y todo lo
// demás) para que Sentry pueda instrumentar automáticamente las librerías
// que se importen después. Por eso también carga dotenv aquí mismo: para
// tener SENTRY_DSN disponible sin depender del orden de otros archivos.
import dotenv from 'dotenv';
dotenv.config();

import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
});
