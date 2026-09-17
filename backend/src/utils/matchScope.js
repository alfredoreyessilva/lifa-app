// De dónde sale la conferencia (y el grupo) de un partido.
//
// Regla: NO se captura partido por partido. El dato estable es "este equipo
// juega en esta conferencia" —se registra una sola vez al inscribirlo en la
// rama (branch_teams)— y la pertenencia del partido se deduce de qué equipos
// lo juegan. Antes era al revés: el mismo dato se volvía a elegir en cada
// juego, con el costo y los errores de dedo que eso implica.
//
// Orden de precedencia, del más fuerte al más débil:
//
//   1. matches.conference_override_id — la excepción explícita ("este partido
//      va aquí aunque sus equipos digan otra cosa"). Casi siempre NULL.
//   2. La conferencia de los equipos, vía branch_teams (directa, o la de su
//      grupo si se inscribió a nivel grupo).
//   3. La conferencia del grupo que el partido tenga asignado a mano.
//   4. matches.conference_id — lo que se capturó a mano antes de este cambio.
//      Se conserva intacto en la base, pero queda como último recurso: si los
//      equipos ya dicen a qué conferencia pertenecen, ellos mandan. Eso es lo
//      que hace que un partido mal capturado se corrija solo en vez de tener
//      que editarlo a mano.
//
// Interconferencia: cuando local y visitante son de conferencias distintas, el
// partido pertenece a LAS DOS (conference_id + conference_id_2) y aparece al
// filtrar por cualquiera de ellas. Es el mismo patrón que ya existía para
// grupos con group_id/group_id_2, ahora también para conferencias.
//
// Ojo con el alcance: la derivación cuelga de m.home_team_id/m.away_team_id.
// Un partido sin esas llaves (solo con el nombre en texto) no deriva nada y
// cae al punto 4 — por eso el importador de Excel ahora sí las guarda.

// Los JOIN que la derivación necesita. El prefijo `sc_` es para no chocar con
// los alias que ya usa cada consulta. Asume que la tabla de partidos es `m`.
export const MATCH_SCOPE_JOINS = `
  LEFT JOIN branch_teams sc_bth ON sc_bth.branch_id = m.branch_id AND sc_bth.team_id = m.home_team_id
  LEFT JOIN branch_teams sc_bta ON sc_bta.branch_id = m.branch_id AND sc_bta.team_id = m.away_team_id
  LEFT JOIN groups      sc_gh   ON sc_gh.id   = sc_bth.group_id
  LEFT JOIN groups      sc_ga   ON sc_ga.id   = sc_bta.group_id
  LEFT JOIN groups      sc_gm   ON sc_gm.id   = m.group_id
  LEFT JOIN groups      sc_gm2  ON sc_gm2.id  = m.group_id_2
  LEFT JOIN conferences sc_cfh  ON sc_cfh.id  = COALESCE(sc_bth.conference_id, sc_gh.conference_id)
  LEFT JOIN conferences sc_cfa  ON sc_cfa.id  = COALESCE(sc_bta.conference_id, sc_ga.conference_id)
  LEFT JOIN conferences sc_cfo  ON sc_cfo.id  = m.conference_override_id
  LEFT JOIN conferences sc_cfg  ON sc_cfg.id  = sc_gm.conference_id
  LEFT JOIN conferences sc_cfd  ON sc_cfd.id  = m.conference_id
`;

// Las columnas resueltas. Van DESPUÉS de `m.*` en el SELECT: repiten los
// nombres group_id / group_id_2 / conference_id a propósito, para pisar los
// valores crudos de la fila. Postgres permite columnas repetidas y el driver
// se queda con la última, así que quien consume la API ve siempre el valor ya
// resuelto y no necesita saber nada de esta lógica. (Es el mismo truco que ya
// usaban las consultas públicas para conference_id.)
// Se deriva SOLO cuando los DOS equipos tienen conferencia, nunca con uno.
// No es un detalle: con un solo equipo bastaría, un amistoso contra un
// invitado de fuera (que no está en ninguna conferencia) se colaría al
// calendario de la conferencia del rival, como si fuera juego oficial. Si
// falta la de alguno, no se inventa nada y se cae al valor de respaldo.
// El panel además señala por nombre al equipo al que le falta el dato.
export const MATCH_SCOPE_COLUMNS = `
  CASE WHEN sc_gh.id IS NOT NULL AND sc_ga.id IS NOT NULL
       THEN sc_gh.id   ELSE sc_gm.id   END AS group_id,
  CASE WHEN sc_gh.id IS NOT NULL AND sc_ga.id IS NOT NULL
       THEN sc_gh.name ELSE sc_gm.name END AS group_name,
  CASE WHEN sc_gh.id IS NOT NULL AND sc_ga.id IS NOT NULL
       THEN (CASE WHEN sc_gh.id <> sc_ga.id THEN sc_ga.id   END)
       ELSE sc_gm2.id   END AS group_id_2,
  CASE WHEN sc_gh.id IS NOT NULL AND sc_ga.id IS NOT NULL
       THEN (CASE WHEN sc_gh.id <> sc_ga.id THEN sc_ga.name END)
       ELSE sc_gm2.name END AS group_name_2,

  COALESCE(sc_cfo.id,
           CASE WHEN sc_cfh.id IS NOT NULL AND sc_cfa.id IS NOT NULL THEN sc_cfh.id   END,
           sc_cfg.id,   sc_cfd.id)   AS conference_id,
  COALESCE(sc_cfo.name,
           CASE WHEN sc_cfh.id IS NOT NULL AND sc_cfa.id IS NOT NULL THEN sc_cfh.name END,
           sc_cfg.name, sc_cfd.name) AS conference_name,
  CASE WHEN sc_cfo.id IS NULL AND sc_cfh.id IS NOT NULL AND sc_cfa.id IS NOT NULL
             AND sc_cfh.id <> sc_cfa.id THEN sc_cfa.id   END AS conference_id_2,
  CASE WHEN sc_cfo.id IS NULL AND sc_cfh.id IS NOT NULL AND sc_cfa.id IS NOT NULL
             AND sc_cfh.id <> sc_cfa.id THEN sc_cfa.name END AS conference_name_2,

  -- La conferencia de cada equipo por separado. El panel la usa para explicar
  -- de dónde salió el dato ("heredado de los equipos") sin volver a calcularlo.
  sc_cfh.id   AS home_conference_id,
  sc_cfh.name AS home_conference_name,
  sc_cfa.id   AS away_conference_id,
  sc_cfa.name AS away_conference_name,
  (m.conference_override_id IS NOT NULL) AS conference_is_override
`;
