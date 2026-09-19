// SQL de fechas compartido por los dos libros de cobranza, el generador de
// mensualidades y el candado diario del cron (utils/cronSchedule.js). Vive
// aparte porque los cuatro lo necesitan y tener cuatro copias de la misma
// expresión es como nacen los desajustes de un día.
//
// Y no es hipotético: pasó. El libro equipo→jugadores se pasó a esta expresión
// y el de liga→equipo se quedó en CURRENT_DATE, así que durante un tiempo los
// dos libros no estaban de acuerdo en qué día era. Se corrigió el 2026-09-19.

// La fecha de HOY en México, no en UTC.
//
// CURRENT_DATE se evalúa en la zona del servidor de Postgres, y Neon corre en
// UTC: seis horas adelante. Consecuencia real: un cargo que vence hoy se
// marcaba vencido desde las 18:00 hora de México del mismo día en que vencía,
// y el papá que pagaba a las 7 pm veía "vencido" en su estado de cuenta.
//
// Va en la EXPRESIÓN y no en la sesión (SET TIME ZONE) a propósito: del otro
// lado hay un pooler en modo transacción, donde "sesión" no significa una
// conexión propia — es el mismo motivo por el que pg_advisory_lock() se tuvo
// que cambiar por su versión de transacción (ver config/db.js).
//
// Se usa el nombre de la zona y no un desfase fijo: México abolió el horario
// de verano en 2022, pero el nombre sobrevive a que lo reinstauren.
export const HOY_MX = `((NOW() AT TIME ZONE 'America/Mexico_City')::date)`;
