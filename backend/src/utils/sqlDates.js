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

// El día en que se jugó un partido, también en México.
//
// `matches.match_date` es TEXT con un ISO completo en UTC
// ('2026-09-04T00:00:00.000Z'), y la diferencia no es cosmética: ese partido
// se juega el **3 de septiembre a las 6 pm** hora del centro. Cortar por la
// fecha en UTC lo mandaría al día siguiente, que es exactamente el desfase que
// ya se pagó en los dos libros de cobranza y en las altas del roster.
//
// Lo usa el pase de lista, para saber quién estaba en el roster ESE día. Toma
// un alias de tabla porque siempre se aplica sobre una fila de `matches`.
//
// Se usa América/México y no la zona del propio partido (`matches.timezone`)
// a propósito: una baja se fecha por día, no por hora, y el resto de las altas
// y bajas del roster ya se cortan en hora de México. Dos zonas distintas para
// los dos lados de la misma comparación sería la manera de reintroducir el
// desfase por la puerta de atrás.
export function fechaDelPartidoMx(alias = 'm') {
  return `((${alias}.match_date::timestamptz AT TIME ZONE 'America/Mexico_City')::date)`;
}
