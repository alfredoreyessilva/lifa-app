// El pase de lista: qué estados existen, quién aparece en la lista y cómo se
// cuenta el acumulado. El porqué de cada decisión está en el README, "Roster
// público y pase de lista" (2026-09-20).
//
// Vive en un archivo propio y puro —sin importar `db`— por la misma razón que
// `orgRoles.js` y `rosterVisibility.js`: de la asistencia cuelga una decisión
// de la liga sobre una persona, así que la regla que la arma tiene que poder
// probarse sin Postgres, que es lo único que el CI alcanza a correr.

import { fechaDelPartidoMx } from './sqlDates.js';

// ── Dos estados, y un tercero que no se guarda ────────────────────────────
//
// `present` y `absent` son los únicos valores que existen en la base. **Sin
// pasar lista** es la AUSENCIA de fila, y esa diferencia es de la que cuelga
// todo: si el visor no llegó, nadie faltó.
//
// La lista sale de aquí y `config/db.js` la importa para construir el CHECK
// del esquema, igual que hace con los roles: es un valor que viaja por la API,
// y la regla 6 dice que se cambia en los tres lados o en ninguno. Así la base
// no puede aceptar un estado que el código no conozca, ni al revés.
export const ESTADOS_ASISTENCIA = ['present', 'absent'];

export function esEstadoValido(estado) {
  return ESTADOS_ASISTENCIA.includes(estado);
}

// ── Lo que llega del `PUT`, ya limpio ─────────────────────────────────────
//
// El pase de lista se manda COMPLETO: la lista es el estado entero de ese
// equipo en ese partido, no un parche. Quien no viene en ella queda **sin
// pasar lista**, que es como se desmarca a alguien — y por eso una lista vacía
// es válida y significa "borra todo lo que había".
//
// Recibirla entera es lo que lo vuelve idempotente de nacimiento, que es lo
// que pide la cola de "Capturar sin señal": el pase de lista ocurre en la
// cancha, y mandar cuarenta llamadas sueltas deja la mitad capturada cuando se
// cae el internet del campo.
//
// Falla cerrado y explícito: un estado que no existe **rompe** la petición en
// vez de guardarse como "ausente". Aquí no hay un default inofensivo — los dos
// valores posibles dicen cosas opuestas sobre una persona.
export function normalizarPaseDeLista(entries) {
  if (entries === undefined || entries === null) {
    return { error: 'Falta la lista de jugadores (entries)' };
  }
  if (!Array.isArray(entries)) {
    return { error: 'entries tiene que ser una lista' };
  }

  // El último gana si el mismo jugador viene dos veces. Pasa de verdad con la
  // cola sin señal, que puede reintentar juntando dos capturas de la misma
  // pantalla; tirar la petición entera por eso sería perder un pase de lista
  // completo por un duplicado que ya sabemos resolver.
  const porJugador = new Map();
  for (const entry of entries) {
    const playerId = Number(entry?.player_id);
    if (!Number.isInteger(playerId) || playerId <= 0) {
      return { error: 'Cada renglón necesita un player_id válido' };
    }
    if (!esEstadoValido(entry?.status)) {
      return { error: `"${entry?.status}" no es un estado de asistencia (present o absent)` };
    }
    porJugador.set(playerId, entry.status);
  }

  return {
    playerIds: [...porJugador.keys()],
    statuses: [...porJugador.values()],
  };
}

// ── El acumulado se suma, no se guarda ────────────────────────────────────
//
// Las tres cifras van SEPARADAS y sin porcentaje a propósito (regla 10): la
// plataforma entrega el conteo y la liga aplica su criterio, que cambia de liga
// en liga y de temporada en temporada. Un porcentaje ya es una interpretación —
// obliga a decidir si "sin marcar" cuenta como falta, y esa decisión no nos
// toca.
//
// `convocables` es contra cuántos partidos se mide a esta persona: los de su
// equipo en esa rama en los que ya estaba en el roster. No es el total de
// partidos del equipo, o quien llegó a media temporada arrastraría faltas de
// partidos que se jugaron antes de que existiera.
export function resumenDeAsistencia({ convocables = 0, presentes = 0, ausentes = 0 } = {}) {
  const presente = Math.max(0, Number(presentes) || 0);
  const ausente = Math.max(0, Number(ausentes) || 0);
  const total = Math.max(0, Number(convocables) || 0);
  return {
    convocables: total,
    presentes: presente,
    ausentes: ausente,
    // Nunca negativo: una fila de asistencia puede sobrevivir a que a alguien
    // lo saquen del roster, y entonces marcadas > convocables. La cifra que se
    // dobla es esta, que es la menos afirmativa de las tres.
    sin_marcar: Math.max(0, total - presente - ausente),
  };
}

// ── Quién aparece en la lista ─────────────────────────────────────────────
//
// El roster de ese equipo en esa rama **vigente a la fecha del partido**, no el
// de hoy: un jugador dado de baja en octubre sí estaba en el partido de
// septiembre, y su fila de asistencia se queda donde está.
//
// **Pero solo se filtra por `end_date`, y la asimetría es deliberada.** Las dos
// fechas de `player_team_memberships` no significan lo mismo:
//
//   · `end_date` es un ACTO. Alguien entró a la pantalla y dio de baja a esa
//     persona ese día (routes/players.js lo escribe con HOY_MX). Es un hecho
//     sobre la temporada y se respeta.
//   · `start_date` es CUÁNDO SE CAPTURÓ LA FILA. Nace con DEFAULT ${HOY_MX} y
//     ninguna pantalla la pregunta nunca. Filtrar por ella sería tratar "el día
//     que lo tecleamos" como "el día que llegó al equipo".
//
// Y no es teórico: en este mundo el roster se captura tarde, con el torneo ya
// empezado. Con el filtro de arriba, una liga que sube su roster en noviembre
// vería la lista VACÍA en todos los partidos anteriores y no podría pasar lista
// en ninguno — la pantalla diría "no hay jugadores", que es justo la lectura
// que este modelo existe para no producir. Dejar fuera a un jugador que llegó
// después solo cuesta un renglón de más marcado "sin pasar lista", que no es
// "faltó". Los dos errores no cuestan lo mismo.
//
// El día que `start_date` sea un dato que alguien declare —y no el reloj del
// servidor— este filtro se aprieta sin migrar nada (regla 4: se resuelve al
// leer).
//
// Se incluye además a quien YA TENGA fila de asistencia en ese partido, pase lo
// que pase con su membresía. Sin eso, dar de baja a alguien borraría de la
// pantalla una marca que sigue existiendo en la base: el dato quedaría vivo e
// invisible, que es la peor de las dos opciones.
// Devuelve la consulta COMPLETA y no un pedazo para pegar: la fecha del partido
// se usa en tres lugares de la misma consulta, y armarla por fragmentos es como
// se desincronizan.
//
// **Es la MISMA lista para el público y para el pase de lista**, y eso es el
// diseño, no un ahorro: "no son dos pantallas ni dos botones; es la misma
// lista, y lo que cambia es si se puede marcar". Dos consultas parecidas
// acabarían enseñando dos listas distintas el día que una se toque y la otra
// no. Lo único que cambia son las columnas que se dejan salir:
//
//   conFoto        la foto, que pide su propio permiso (utils/rosterVisibility)
//   conAsistencia  el estado de cada quien, que NUNCA es público — son faltas de
//                  gente que en buena parte es menor de edad
//
// Parámetros, en orden: `matchId`, `teamId`, `branchId`.
export function rosterDelPartidoSql({ conFoto = false, conAsistencia = false } = {}) {
  return `
    WITH partido AS (
      SELECT m.id, ${fechaDelPartidoMx('m')} AS fecha
      FROM matches m WHERE m.id = ?
    ),
    plantel AS (
      -- Un jugador dado de baja y vuelto a dar de alta tiene DOS membresías en
      -- el mismo equipo y la misma rama. Aparece una vez, con la vigente.
      SELECT DISTINCT ON (ptm.player_id)
             ptm.player_id, ptm.jersey_number,
             COALESCE(ptm.position, p.position) AS position,
             p.first_name, p.last_name, p.photo_url
      FROM player_team_memberships ptm
      JOIN players p ON p.id = ptm.player_id
      CROSS JOIN partido
      WHERE ptm.team_id = ? AND ptm.branch_id = ?
        AND (
          ptm.end_date IS NULL
          OR ptm.end_date >= partido.fecha
          OR EXISTS (
            SELECT 1 FROM match_attendance a
            WHERE a.match_id = partido.id AND a.player_id = ptm.player_id
          )
        )
      ORDER BY ptm.player_id, (ptm.end_date IS NULL) DESC, ptm.start_date DESC
    )
    SELECT pl.player_id AS id, pl.first_name, pl.last_name,
           pl.jersey_number, pl.position${conFoto ? ',\n           pl.photo_url' : ''}${conAsistencia ? ',\n           a.status, a.marked_at, u.name AS marked_by' : ''}
    FROM plantel pl
    CROSS JOIN partido${conAsistencia ? `
    LEFT JOIN match_attendance a ON a.match_id = partido.id AND a.player_id = pl.player_id
    LEFT JOIN users u            ON u.id = a.marked_by_user_id` : ''}
    ORDER BY pl.jersey_number NULLS LAST, pl.last_name
  `;
}
