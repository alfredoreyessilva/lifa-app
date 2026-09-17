// De dónde sale la FASE de un partido (temporada regular, playoffs, final…).
//
// Es la pieza que faltaba para poder calcular una tabla de posiciones: sin
// saber qué juegos cuentan, la tabla suma playoffs y scrimmages junto con la
// temporada regular y queda mal. Hasta ahora ese dato existía, pero como
// TEXTO LIBRE dentro de `week_label` ('PLAYOFF', 'SEMIFINAL', 'FINAL',
// 'SCRIMMAGE'), con la lista repetida a mano en utils/scoring.js y en
// MatchForm.jsx. Eso funcionaba para pintar una etiqueta; no alcanza para
// calcular, porque no dice si el juego cuenta ni permite que una liga defina
// sus propias fases ("Repechaje", "Liguilla", "Tazón de Campeones").
//
// Mismo patrón que matchScope.js, por las mismas razones:
//
//   1. matches.phase_id — la fase elegida explícitamente. Manda siempre.
//   2. Derivada de week_label — lo que se capturó antes de que existieran
//      las fases. La columna NO se toca ni se borra: sigue siendo la etiqueta
//      que se muestra ("J5", "FINAL") y ahora además es el respaldo.
//
// Al resolverse AL LEER y no reescribiendo filas, ninguna liga tiene que
// migrar nada: sus partidos viejos siguen contando bien desde el primer día,
// y el día que alguien cree fases de verdad, esas ganan sin tocar el pasado.

// Las etiquetas de week_label que históricamente significan "fase final".
// Es la misma lista que ya usaba scoring.js — se centraliza aquí para que
// deje de estar escrita en dos lugares.
export const LEGACY_KNOCKOUT_LABELS = ['PLAYOFF', 'SEMIFINAL', 'FINAL'];

// Y la que significa "ni siquiera es oficial". Un scrimmage no cuenta para
// la tabla ni vale puntos en la quiniela.
export const LEGACY_EXHIBITION_LABELS = ['SCRIMMAGE'];

const asSqlList = (arr) => arr.map((s) => `'${s}'`).join(', ');

// El JOIN que necesita la derivación. Prefijo `ph_` para no chocar con los
// alias de matchScope.js (`sc_`) ni con los de cada consulta. Asume que la
// tabla de partidos es `m`.
export const MATCH_PHASE_JOINS = `
  LEFT JOIN phases ph_p ON ph_p.id = m.phase_id
`;

// Columnas resueltas. Igual que MATCH_SCOPE_COLUMNS, van DESPUÉS de `m.*` en
// el SELECT para pisar los valores crudos de la fila: quien consume la API ve
// el valor ya resuelto y no necesita saber nada de esta lógica.
export const MATCH_PHASE_COLUMNS = `
  ph_p.id   AS phase_id,
  ph_p.name AS phase_name,
  COALESCE(
    ph_p.type,
    CASE
      WHEN UPPER(COALESCE(m.week_label, '')) IN (${asSqlList(LEGACY_KNOCKOUT_LABELS)})   THEN 'knockout'
      WHEN UPPER(COALESCE(m.week_label, '')) IN (${asSqlList(LEGACY_EXHIBITION_LABELS)}) THEN 'exhibition'
      ELSE 'regular'
    END
  ) AS phase_type,
  COALESCE(
    ph_p.counts_for_standings,
    UPPER(COALESCE(m.week_label, '')) NOT IN (
      ${asSqlList([...LEGACY_KNOCKOUT_LABELS, ...LEGACY_EXHIBITION_LABELS])}
    )
  ) AS counts_for_standings,
  (m.phase_id IS NOT NULL) AS phase_is_explicit
`;

// El tipo de fase de un partido, como expresión SUELTA — no necesita JOIN.
//
// Existe además de MATCH_PHASE_COLUMNS porque los rankings de predicciones
// (utils/scoring.js) ya tienen sus consultas armadas y con LEFT JOINs de por
// medio; meterles un JOIN más era tocar tres consultas de un concurso en
// curso para no ganar nada. La subconsulta correlacionada cuesta un índice
// por renglón (matches.phase_id lo tiene) sobre rankings de decenas de filas.
//
// Asume que la tabla de partidos es `m`. Devuelve siempre un tipo válido,
// incluso si `m` viene en NULL por un LEFT JOIN — ahí da 'regular', que es lo
// mismo que hacía la comparación por texto que reemplaza.
export const MATCH_PHASE_TYPE_SQL = `COALESCE(
  (SELECT ph.type FROM phases ph WHERE ph.id = m.phase_id),
  CASE
    WHEN UPPER(COALESCE(m.week_label, '')) IN (${asSqlList(LEGACY_KNOCKOUT_LABELS)})   THEN 'knockout'
    WHEN UPPER(COALESCE(m.week_label, '')) IN (${asSqlList(LEGACY_EXHIBITION_LABELS)}) THEN 'exhibition'
    ELSE 'regular'
  END
)`;

// Los tipos de fase. `regular` es la única que cuenta para la tabla por
// default; las demás nacen sin contar, y la liga puede cambiarlo por fase
// (hay ligas donde el repechaje sí suma a la tabla general).
export const PHASE_TYPES = {
  regular:    { label: 'Temporada regular', counts_for_standings: true },
  knockout:   { label: 'Eliminatoria (playoffs, semis, final)', counts_for_standings: false },
  placement:  { label: 'Reclasificación / repechaje', counts_for_standings: false },
  exhibition: { label: 'Amistoso / scrimmage', counts_for_standings: false },
};

export const PHASE_TYPE_KEYS = Object.keys(PHASE_TYPES);
