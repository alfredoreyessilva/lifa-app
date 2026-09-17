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
      WHEN UPPER(COALESCE(m.week_label, '')) IN (${asSqlList(LEGACY_KNOCKOUT_LABELS)})   THEN 'single_elimination'
      WHEN UPPER(COALESCE(m.week_label, '')) IN (${asSqlList(LEGACY_EXHIBITION_LABELS)}) THEN 'exhibition'
      ELSE 'round_robin'
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
    WHEN UPPER(COALESCE(m.week_label, '')) IN (${asSqlList(LEGACY_KNOCKOUT_LABELS)})   THEN 'single_elimination'
    WHEN UPPER(COALESCE(m.week_label, '')) IN (${asSqlList(LEGACY_EXHIBITION_LABELS)}) THEN 'exhibition'
    ELSE 'round_robin'
  END
)`;

// Los tipos de fase. `regular` es la única que cuenta para la tabla por
// default; las demás nacen sin contar, y la liga puede cambiarlo por fase
// (hay ligas donde el repechaje sí suma a la tabla general).
// Los SISTEMAS DE COMPETENCIA que puede usar una fase.
//
// Son los formatos reconocidos de cómo se reparte el juego entre los
// participantes, no una lista inventada ni prestada de un deporte: un sistema
// de competencia NO le pertenece a un deporte. El mismo todos-contra-todos lo
// usa la LFA, la Champions y un torneo de ajedrez; la misma eliminación
// directa la usa un Super Bowl y una final de dominó. Por eso se nombran por
// lo que son.
//
// El eje es "CÓMO se juega". Que una fase cuente o no para la tabla es una
// pregunta APARTE (counts_for_standings), porque no se deduce del formato:
// hay ligas donde el repechaje suma a la tabla general y otras donde no.
// Antes estaban mezclados en un solo campo ("regular" describía las dos cosas
// a la vez) y eso obligaba a que el formato mintiera para decir si contaba.
export const PHASE_TYPES = {
  round_robin: {
    label: 'Todos contra todos',
    help: 'Cada participante enfrenta a todos los demás una vez.',
    counts_for_standings: true,
  },
  double_round_robin: {
    label: 'Todos contra todos, ida y vuelta',
    help: 'Cada participante enfrenta a todos los demás dos veces, de local y de visita.',
    counts_for_standings: true,
  },
  groups: {
    label: 'Fase de grupos',
    help: 'Todos contra todos dentro de cada grupo; de ahí salen los que avanzan.',
    counts_for_standings: true,
  },
  swiss: {
    label: 'Sistema suizo',
    help: 'Nadie queda eliminado: cada ronda empareja a los que llevan un registro parecido.',
    counts_for_standings: true,
  },
  single_elimination: {
    label: 'Eliminación directa',
    help: 'El que pierde queda fuera. Playoffs, semifinales, final.',
    counts_for_standings: false,
  },
  double_elimination: {
    label: 'Eliminación doble',
    help: 'Hace falta perder dos veces para quedar fuera.',
    counts_for_standings: false,
  },
  series: {
    label: 'Serie',
    help: 'El cruce se decide al mejor de varios juegos, no en uno solo.',
    counts_for_standings: false,
  },
  exhibition: {
    label: 'Amistoso o pretemporada',
    help: 'No es juego oficial: no cuenta para nada.',
    counts_for_standings: false,
  },
};

export const PHASE_TYPE_KEYS = Object.keys(PHASE_TYPES);

// Los sistemas en los que perder te deja fuera (o te acerca a quedar fuera).
// Es lo que hace que un partido "valga más": la quiniela paga doble por
// acertarle a uno de estos (ver utils/scoring.js).
export const ELIMINATION_TYPES = ['single_elimination', 'double_elimination', 'series'];

// Traducción de los nombres con los que nació esta tabla, para la migración
// y para no romper nada que todavía los mande. Se conservan aquí y no en
// db.js porque el vocabulario vive en este archivo.
export const LEGACY_PHASE_TYPES = {
  regular:   'round_robin',
  knockout:  'single_elimination',
  placement: 'single_elimination',
};
