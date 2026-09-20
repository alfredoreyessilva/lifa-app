// La DECISIÓN del candado que impide escribir en producción desde local.
// Función pura y en utils/ a propósito: es lo único de este proyecto que el
// CI puede probar sin Postgres, y aquí hace falta de verdad.
//
// Lo que se está protegiendo tiene dos lados con costos MUY distintos:
//
//   · Si falla hacia el lado permisivo, se pierde una sesión local y se
//     escriben unas filas de más en la base real. Molesto.
//   · Si falla hacia el lado estricto, el backend de Render se niega a
//     arrancar y la API se cae para todos. Caro.
//
// Por eso la regla es "bloquear solo con evidencia POSITIVA de arranque
// local", y por eso el caso de Render está fijado con pruebas: es el que no
// se puede romper nunca, ni por accidente dentro de seis meses.
//
// El porqué de cada señal está en config/db.js, que es quien la usa.

// Devuelve qué hacer, sin hacerlo:
//   { accion: 'pasar' }                       seguir sin decir nada
//   { accion: 'avisar', host }                conectar, pero advirtiendo
//   { accion: 'bloquear', host, hoyMx }       negarse a conectar
export function decidirCandadoProduccion({
  databaseUrl,
  npmLifecycleEvent,
  nodeEnv,
  prodHost,
  allowProdDb,
  hoyMx,
}) {
  // Evidencia POSITIVA de arranque local. Nunca "no dice production".
  const esLocal = npmLifecycleEvent === 'dev' || nodeEnv === 'development';
  if (!esLocal) return { accion: 'pasar' };

  // `new URL` entiende postgresql:// y devuelve solo el host, sin usuario ni
  // contraseña: lo que salga de aquí se puede imprimir sin filtrar nada.
  let host = null;
  try { host = new URL(databaseUrl).hostname; } catch { /* cadena ilegible */ }

  const esperado = (prodHost || '').trim();
  // Sin host de producción configurado el candado no puede opinar. Avisa en
  // vez de callarse: un candado silencioso que no protege es peor que no
  // tenerlo, porque se siente protegido.
  if (!esperado) return { accion: 'avisar', host };

  if (host !== esperado) return { accion: 'pasar' };

  // La salida de emergencia es la FECHA DE HOY, no un "1": un "1" olvidado en
  // el .env deja el candado muerto para siempre sin que nadie se entere.
  if ((allowProdDb || '').trim() === hoyMx) return { accion: 'avisar', host, autorizado: true };

  return { accion: 'bloquear', host, hoyMx };
}

// La fecha de hoy en México (YYYY-MM-DD). Misma zona que HOY_MX de
// sqlDates.js, pero calculada en JS porque aquí todavía no hay conexión a
// Postgres a la cual preguntarle.
export function hoyEnMexico(ahora = new Date()) {
  return ahora.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}
