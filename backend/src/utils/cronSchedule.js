import { HOY_MX } from './sqlDates.js';

// Cadencia del cron externo.
//
// `POST /api/notifications/trigger` hace dos trabajos con ritmos
// incompatibles. Los avisos de partido leen una ventana de una hora
// (`match_date BETWEEN NOW() - 3h AND NOW() + 1h`), así que necesitan correr
// cada pocos minutos o el partido se pierde por completo. La cobranza y la
// generación de mensualidades, en cambio, con una corrida al día sobran: más
// que eso es barrer los dos libros enteros decenas de veces sin nada nuevo
// que encontrar.
//
// El problema es que el cron es EXTERNO al repositorio y su frecuencia no
// está escrita en ningún archivo del proyecto (ver "Pendientes abiertos" del
// README). O sea: hoy una de las dos mitades está mal servida y no se sabe
// cuál. Si llama una vez al día, casi ningún partido cae dentro de su
// ventana; si llama cada 15 minutos, la cobranza corre 96 veces.
//
// Esto lo resuelve SIN tocar nada del lado del proveedor, que es la parte
// importante: no hace falta entrar a ese panel ni saber su frecuencia para
// que las dos mitades queden bien servidas. El endpoint sigue siendo uno solo
// y sigue siendo seguro llamarlo con la frecuencia que sea — las fases
// diarias reclaman el día y quien no gane la reclamación se las salta.
//
// ── Por qué la reclamación vive en la base ──
//
// Mismo criterio que `idx_club_ledger_auto_cycle` (ver utils/monthlyCharges.js):
// dos llamadas simultáneas del cron no pueden colarse las dos porque la
// segunda choca contra el UNIQUE (phase, ran_on) y su ON CONFLICT DO NOTHING
// la deja sin fila que devolver. Un `SELECT ... IF (ya corrió) return` en JS
// tendría ventana de carrera de verdad, y del otro lado de esa ventana está
// la generación de dinero.

// Una corrida que empezó hace más de esto y nunca terminó se da por muerta.
// Tiene que ser holgado frente a lo que tarda una corrida real (hoy, segundos)
// y corto frente al día, para que un reinicio a media corrida no deje la
// cobranza bloqueada hasta la medianoche.
const MINUTOS_PARA_DAR_POR_MUERTA = 15;

// Reclama el día para `phase`. Devuelve la fila de la bitácora si le tocó
// correr, o null si alguien más ya corrió (o está corriendo) hoy.
async function reclamarElDia(db, phase, forzar) {
  // Camino normal: el primero del día gana.
  const nueva = await db.prepare(`
    INSERT INTO cron_runs (phase, ran_on)
    VALUES (?, ${HOY_MX})
    ON CONFLICT (phase, ran_on) DO NOTHING
    RETURNING id
  `).get(phase);
  if (nueva) return nueva;

  // Ya hay fila de hoy. Se retoma en dos casos, y los dos son un UPDATE con
  // RETURNING —una sola sentencia— para que sigan siendo atómicos: si dos
  // llamadas llegan juntas, la segunda se bloquea en la fila, reevalúa el
  // WHERE contra la versión nueva y se va sin nada.
  const condicion = forzar
    // Forzado: se vuelve a correr pase lo que pase. Es la válvula de escape
    // para probar y para recuperar un día perdido a mano; va detrás del mismo
    // CRON_SECRET que el resto del endpoint.
    ? ''
    // Normal: solo si la corrida anterior se cayó sin soltar su reclamación.
    : `AND finished_at IS NULL
       AND started_at < NOW() - INTERVAL '${MINUTOS_PARA_DAR_POR_MUERTA} minutes'`;

  const retomada = await db.prepare(`
    UPDATE cron_runs
    SET started_at = NOW(), finished_at = NULL, result = NULL
    WHERE phase = ? AND ran_on = ${HOY_MX}
    ${condicion}
    RETURNING id
  `).get(phase);

  return retomada || null;
}

// Deja constancia de que el endpoint fue llamado, y devuelve cuántas van hoy.
//
// Esto es lo que contesta la pregunta abierta del README — "nadie sabe cada
// cuánto corre el cron" — sin depender del panel de nadie: con el conteo de un
// día completo, la frecuencia sale de una división. Y con `last_call_at`, la
// pregunta más importante, "¿sigue vivo?", se contesta con un SELECT.
//
// Una fila por día con un contador, no una fila por llamada: con el cron cada
// 15 minutos serían ~35 mil filas al año para responder lo mismo.
//
// No lanza nunca y su error no se propaga: es telemetría, y que la telemetría
// tumbe el trabajo que está midiendo sería el peor intercambio posible.
export async function registrarLlamada(db, phase = 'trigger') {
  try {
    const fila = await db.prepare(`
      INSERT INTO cron_runs (phase, ran_on, calls, last_call_at)
      VALUES (?, ${HOY_MX}, 1, NOW())
      ON CONFLICT (phase, ran_on) DO UPDATE
      SET calls = cron_runs.calls + 1, last_call_at = NOW()
      RETURNING calls
    `).get(phase);
    return fila?.calls ?? null;
  } catch (err) {
    console.error('[cron] no se pudo registrar la llamada:', err.message);
    return null;
  }
}

// La bitácora no crece sola para siempre. Se poda desde el bloque diario, así
// que corre una vez al día y no en cada llamada.
//
// 120 días es holgado de sobra para lo que sirve la tabla (ver cada cuánto
// corre, y si corrió hoy) y deja cuatro meses de historia para mirar hacia
// atrás cuando algo se vea raro.
const DIAS_DE_HISTORIA = 120;

export async function podarBitacora(db) {
  try {
    const r = await db.prepare(
      `DELETE FROM cron_runs WHERE ran_on < ${HOY_MX} - ${DIAS_DE_HISTORIA}`
    ).run();
    return r.changes ?? 0;
  } catch (err) {
    console.error('[cron] no se pudo podar la bitácora:', err.message);
    return 0;
  }
}

/**
 * Corre `tarea` como mucho una vez por día natural mexicano.
 *
 * Nunca se traga el error: si la tarea lanza, la reclamación se suelta (para
 * que la siguiente llamada del cron reintente hoy mismo, no mañana) y el
 * error sigue subiendo. Quien llama decide si eso tumba la respuesta.
 *
 * @param {object} db
 * @param {string} phase   nombre de la fase en la bitácora, p. ej. 'cobranza'
 * @param {() => Promise<any>} tarea
 * @param {{ force?: boolean }} opts
 * @returns {Promise<{corrio: boolean, motivo: string|null, resultado: any}>}
 */
export async function runOncePerDay(db, phase, tarea, { force = false } = {}) {
  const corrida = await reclamarElDia(db, phase, force);

  if (!corrida) {
    return { corrio: false, motivo: 'ya corrió hoy', resultado: null };
  }

  try {
    const resultado = await tarea();
    await db.prepare(`
      UPDATE cron_runs SET finished_at = NOW(), result = ?::jsonb WHERE id = ?
    `).run(JSON.stringify(resultado ?? {}), corrida.id);
    return { corrio: true, motivo: null, resultado };
  } catch (err) {
    // Se suelta la reclamación para no quemar el día por un fallo pasajero.
    // El `finished_at IS NULL` evita borrar una corrida buena si algo muy raro
    // pasara con los ids.
    await db.prepare('DELETE FROM cron_runs WHERE id = ? AND finished_at IS NULL')
      .run(corrida.id)
      .catch(() => {});
    throw err;
  }
}
