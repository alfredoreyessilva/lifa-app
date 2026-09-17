// Tabla de posiciones: el cálculo y el reglamento de desempates.
//
// Todo aquí es función PURA — recibe equipos, partidos y configuración, y
// devuelve la tabla ya ordenada. No toca la base de datos a propósito: el
// algoritmo de desempate real no se puede expresar en SQL sin volverse
// ilegible, y así se puede probar de verdad, caso por caso, con `node --test`
// y sin Postgres de por medio.
//
// ── Por qué un catálogo y no una lista fija de criterios ──
//
// Revisando los reglamentos reales (NFL, FIFA, UEFA, FIBA) resulta que todos
// se escriben con las mismas piezas: cada criterio de desempate es un par
// (MÉTRICA, UNIVERSO).
//
//   · MÉTRICA  — qué se mide: ganados, % de ganados, puntos, diferencia,
//                puntos a favor, puntos en contra.
//   · UNIVERSO — sobre qué partidos se mide:
//                  all          → todos los del equipo en la rama
//                  head_to_head → SOLO los jugados entre los equipos empatados
//                  scope        → solo dentro del grupo/conferencia de la tabla
//                  common       → rivales que TODOS los empatados enfrentaron
//
// Con esos dos ejes se arma cualquier reglamento sin escribir código nuevo.
// Reglamentos reales que se revisaron al diseñar esto, y que el modelo
// expresa sin casos especiales (van como comprobación, NO como categorías
// que la app ofrezca — un reglamento no le pertenece a un deporte):
//
//   ONEFA           ganados → entre sí → diferencia de puntos
//   NFL (división)  entre sí → % división → % conferencia → rivales en común
//   FIBA            puntos → entre sí → diferencia → anotados
//   FIFA/UEFA       puntos → entre sí (pts, dif, goles) → diferencia general
//
// Nótese que ONEFA y NFL son el MISMO deporte y ordenan distinto: una por
// juegos ganados, la otra por porcentaje. Eso es exactamente por qué la lista
// es configurable por rama y no una constante — no existe un orden universal,
// ni siquiera dentro de un deporte.
//
// ── El empate de tres o más, que es donde casi todos se equivocan ──
//
// Ordenar tres equipos empatados de corrido NO da el mismo resultado que
// dice el reglamento. Los reglamentos que se molestan en especificarlo (FIBA
// y FIFA lo escriben con todas sus letras) dicen lo mismo: se arma una
// sub-clasificación SOLO entre los empatados y, en cuanto uno se separa, se
// REINICIA desde el primer criterio con los que quedan. La razón es que al
// salir un equipo del grupo, el universo "entre sí" cambia — ya no son los
// mismos partidos — así que seguir con el criterio siguiente usaría números
// calculados sobre un conjunto que ya no existe.
//
// Otros reglamentos lo resuelven al revés y siguen de largo con el criterio
// siguiente (la NFL, por ejemplo, elimina primero a todos menos al mejor de
// cada división y luego recomienza). Por eso hay dos modos:
//
//   restart    → al separarse uno, se vuelve al primer criterio. Es el default
//                porque es el que no usa números de un grupo que ya cambió.
//   sequential → se sigue con el criterio siguiente.

// ── Catálogo de criterios ────────────────────────────────────────────────
//
// `lower_is_better` es solo para puntos en contra: menos es mejor. Todo lo
// demás se ordena de mayor a menor.
//
// `min_games` es para los criterios que exigen una muestra mínima: el de
// rivales en común no aplica si los empatados no comparten al menos cuatro
// (umbral tomado del reglamento de la NFL, que es donde está especificado).
// Cuando no se cumple, el criterio se SALTA — no desempata ni elimina a
// nadie — y se pasa al siguiente, que es distinto a que todos queden iguales.
export const TIEBREAKER_CATALOG = {
  // Primarios — normalmente el primero de la lista
  win_pct: {
    metric: 'win_pct', universe: 'all',
    label: '% de ganados (general)',
    help: 'El empate cuenta como medio juego ganado.',
  },
  wins: {
    metric: 'wins', universe: 'all',
    label: 'Juegos ganados (general)',
  },
  points: {
    metric: 'points', universe: 'all',
    label: 'Puntos de tabla (general)',
    help: 'Solo si la rama usa sistema de puntos (ej. 3 por ganar).',
  },

  // Entre sí — el head-to-head
  h2h_wins: {
    metric: 'wins', universe: 'head_to_head',
    label: 'Entre sí — juegos ganados',
    help: 'Si los empatados no se enfrentaron, no separa a nadie y pasa al criterio siguiente.',
  },
  h2h_win_pct: {
    metric: 'win_pct', universe: 'head_to_head',
    label: 'Entre sí — % de ganados',
  },
  h2h_points: {
    metric: 'points', universe: 'head_to_head',
    label: 'Entre sí — puntos de tabla',
  },
  h2h_point_diff: {
    metric: 'point_diff', universe: 'head_to_head',
    label: 'Entre sí — diferencia de puntos',
  },
  h2h_points_for: {
    metric: 'points_for', universe: 'head_to_head',
    label: 'Entre sí — puntos anotados',
  },

  // Dentro del alcance de la tabla (su grupo o su conferencia)
  scope_win_pct: {
    metric: 'win_pct', universe: 'scope',
    label: '% de ganados dentro del grupo/conferencia',
  },
  scope_point_diff: {
    metric: 'point_diff', universe: 'scope',
    label: 'Diferencia de puntos dentro del grupo/conferencia',
  },

  // Rivales en común. Van DOS variantes, con y sin muestra mínima, porque el
  // umbral no es una propiedad del criterio sino del empate que se resuelve:
  // entre equipos del mismo grupo, que comparten casi todo el calendario,
  // siempre hay muestra y el reglamento de la NFL lo aplica sin mínimo; entre
  // equipos de grupos distintos puede haber dos rivales en común, y ahí el
  // mismo reglamento exige cuatro para no decidir sobre ruido.
  //
  // Se ofrecen como dos criterios y no como un parámetro para que la lista de
  // desempates siga siendo un arreglo de nombres —simple de guardar, de mandar
  // y de reordenar en pantalla— y para que la elección quede escrita y
  // auditable en vez de deducida por el código a espaldas de quien configura.
  common_win_pct: {
    metric: 'win_pct', universe: 'common',
    label: '% de ganados ante rivales en común',
    help: 'Sin muestra mínima. Para empates dentro de un mismo grupo, donde los equipos comparten casi todo el calendario.',
  },
  common_win_pct_min4: {
    metric: 'win_pct', universe: 'common', min_games: 4,
    label: '% de ganados ante rivales en común (mínimo 4)',
    help: 'Se salta si los empatados no comparten al menos 4 rivales. Para comparar equipos de grupos distintos, donde la muestra puede ser mínima.',
  },

  // Generales
  point_diff: {
    metric: 'point_diff', universe: 'all',
    label: 'Diferencia de puntos (general)',
  },
  points_for: {
    metric: 'points_for', universe: 'all',
    label: 'Puntos anotados (general)',
  },
  points_against: {
    metric: 'points_against', universe: 'all', lower_is_better: true,
    label: 'Puntos recibidos (general) — menos es mejor',
  },
};

// ── Reglamentos preconfigurados ──────────────────────────────────────────
//
// Se nombran por LO QUE HACEN, no por dónde se vieron por primera vez. Un
// reglamento de desempate no le pertenece a un deporte ni a una liga: ONEFA y
// la NFL juegan el mismo deporte y ordenan distinto (ONEFA por juegos
// ganados, la NFL por porcentaje), así que llamarle "el de americano" a
// cualquiera de los dos sería falso además de inútil para quien lo configura.
//
// Son un punto de partida para no empezar desde una lista vacía. Lo normal es
// tomar el más cercano y reordenarlo: el reglamento de cada competencia lo
// escribe la competencia, no esta app.
export const TIEBREAKER_PRESETS = {
  ganados: {
    label: 'Por juegos ganados',
    description: 'Ordena por cuántos ganó. Si dos empatan manda el juego entre ellos, y si no se enfrentaron, la diferencia de puntos.',
    tiebreakers: ['wins', 'h2h_wins', 'point_diff', 'points_for'],
    multi_team_mode: 'restart',
  },
  porcentaje: {
    label: 'Por porcentaje de ganados',
    description: 'Para cuando no todos juegan el mismo número de partidos (descansos, calendarios disparejos): 3-1 vale más que 2-0 por ganados, pero menos por porcentaje.',
    tiebreakers: ['win_pct', 'h2h_win_pct', 'scope_win_pct', 'common_win_pct', 'point_diff', 'points_for'],
    multi_team_mode: 'sequential',
  },
  puntos: {
    label: 'Por puntos de tabla',
    description: 'Cada resultado vale puntos (3 por ganar, 1 por empatar). Útil donde el empate es un resultado común.',
    tiebreakers: ['points', 'h2h_points', 'h2h_point_diff', 'h2h_points_for', 'point_diff', 'points_for'],
    multi_team_mode: 'restart',
    points_win: 3, points_draw: 1, points_loss: 0,
  },
  entre_si: {
    label: 'Entre sí, hasta agotarlo',
    description: 'Los juegos entre los empatados deciden casi todo: primero quién ganó, luego por cuánto, luego cuánto anotó. Solo si eso no alcanza se miran los números generales.',
    tiebreakers: ['wins', 'h2h_wins', 'h2h_point_diff', 'h2h_points_for', 'point_diff', 'points_for'],
    multi_team_mode: 'restart',
  },
};

// El default de una rama nueva. Juegos ganados es lo más común en las ligas
// de esta app (es el reglamento de ONEFA, por ejemplo) y es el que menos
// sorprende: "ganó más juegos" se entiende sin explicación. Una liga que
// necesite porcentaje —porque sus equipos no juegan el mismo número de
// partidos— lo cambia en un clic.
export const DEFAULT_TIEBREAKERS = TIEBREAKER_PRESETS.ganados.tiebreakers;
// Un partido cuenta para la tabla solo si terminó y tiene los dos marcadores.
// Un partido "finalizado" sin marcador capturado no se inventa como 0-0: se
// ignora, igual que hace el ranking de predicciones con los no calificables.
//
// `is_final` lo resuelve QUIEN CONSULTA, no esta función, y a propósito: la
// regla real de "ya terminó" no es `status = 'finished'` a secas — un partido
// en 'scheduled' también cuenta si su categoría tiene auto-status y ya pasó la
// ventana de juego. Esa regla ya vive en utils/scoring.js (MATCH_IS_FINAL_SQL),
// compartida por todos los rankings para que todos usen el mismo criterio, y
// la tabla de posiciones se suma a esa misma fuente en vez de escribir una
// segunda versión que tarde o temprano diría algo distinto.
export function countsForStandings(match) {
  if (!match) return false;
  if (match.is_draft) return false;
  if (match.counts_for_standings === false) return false; // la fase lo excluye
  if (!match.is_final) return false;
  return hasScore(match.home_score) && hasScore(match.away_score);
}

// Ojo con el atajo obvio: `Number.isFinite(Number(x))` NO sirve aquí, porque
// `Number(null)` es 0 y `Number('')` también. Un partido marcado como
// finalizado pero SIN marcador capturado (que es justo lo que el recordatorio
// de notifications.js le reclama a la liga) entraría entonces a la tabla como
// un 0-0 inventado, dándole un empate a los dos equipos.
function hasScore(value) {
  if (value === null || value === undefined || value === '') return false;
  return Number.isFinite(Number(value));
}

// Récord vacío — el punto de partida de todo equipo, incluido el que no ha
// jugado. Que aparezca en 0-0 es intencional: un equipo inscrito existe en
// la tabla desde antes de su primer juego.
function emptyRecord() {
  return { wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 };
}

function accumulate(rec, scored, allowed) {
  rec.points_for += scored;
  rec.points_against += allowed;
  if (scored > allowed) rec.wins += 1;
  else if (scored < allowed) rec.losses += 1;
  else rec.ties += 1;
  return rec;
}

// % de ganados contando el empate como medio juego — el estándar de
// americano. Sin juegos jugados devuelve 0, no NaN: un equipo sin partidos
// se va al fondo en vez de romper el ordenamiento.
function winPct(rec) {
  const played = rec.wins + rec.losses + rec.ties;
  if (played === 0) return 0;
  return (rec.wins + rec.ties / 2) / played;
}

function tablePoints(rec, cfg) {
  const w = Number.isFinite(cfg.points_win) ? cfg.points_win : 3;
  const d = Number.isFinite(cfg.points_draw) ? cfg.points_draw : 1;
  const l = Number.isFinite(cfg.points_loss) ? cfg.points_loss : 0;
  return rec.wins * w + rec.ties * d + rec.losses * l;
}

function metricValue(metric, rec, cfg) {
  switch (metric) {
    case 'win_pct':        return winPct(rec);
    case 'wins':           return rec.wins;
    case 'points':         return tablePoints(rec, cfg);
    case 'point_diff':     return rec.points_for - rec.points_against;
    case 'points_for':     return rec.points_for;
    case 'points_against': return rec.points_against;
    default:               return 0;
  }
}

// Construye el récord de un equipo sobre un subconjunto de partidos.
function recordOver(teamId, matches) {
  const rec = emptyRecord();
  for (const m of matches) {
    if (m.home_team_id === teamId) accumulate(rec, Number(m.home_score), Number(m.away_score));
    else if (m.away_team_id === teamId) accumulate(rec, Number(m.away_score), Number(m.home_score));
  }
  return rec;
}

function opponentsOf(teamId, matches) {
  const out = new Set();
  for (const m of matches) {
    if (m.home_team_id === teamId) out.add(m.away_team_id);
    else if (m.away_team_id === teamId) out.add(m.home_team_id);
  }
  return out;
}

// Los partidos sobre los que se evalúa un criterio, según su universo.
// `tied` son los equipos que siguen empatados en este punto del desempate —
// por eso "entre sí" se recalcula en cada nivel de la recursión y no una vez
// al principio: si un equipo se separa, el universo cambia.
function universeMatches(universe, teamId, tied, ctx) {
  const tiedIds = new Set(tied.map((t) => t.team_id));

  switch (universe) {
    case 'all':
      return ctx.matchesByTeam.get(teamId) || [];

    case 'head_to_head':
      return (ctx.matchesByTeam.get(teamId) || []).filter((m) => {
        const other = m.home_team_id === teamId ? m.away_team_id : m.home_team_id;
        return tiedIds.has(other);
      });

    case 'scope':
      return (ctx.matchesByTeam.get(teamId) || []).filter((m) => ctx.inScope(m));

    case 'common': {
      // Rivales que TODOS los empatados enfrentaron, excluyéndose entre sí.
      let common = null;
      for (const t of tied) {
        const opp = opponentsOf(t.team_id, ctx.matchesByTeam.get(t.team_id) || []);
        for (const id of tiedIds) opp.delete(id);
        common = common === null ? opp : new Set([...common].filter((id) => opp.has(id)));
      }
      const commonIds = common || new Set();
      return (ctx.matchesByTeam.get(teamId) || []).filter((m) => {
        const other = m.home_team_id === teamId ? m.away_team_id : m.home_team_id;
        return commonIds.has(other);
      });
    }

    default:
      return ctx.matchesByTeam.get(teamId) || [];
  }
}

// Evalúa un criterio sobre los equipos empatados. Devuelve null cuando el
// criterio no aplica (ej. rivales en común con menos de 4 juegos), que es
// distinto de "aplicó y todos quedaron iguales": null salta al siguiente
// criterio sin registrar nada en la explicación.
function evaluateCriterion(key, tied, ctx) {
  const def = TIEBREAKER_CATALOG[key];
  if (!def) return null;

  const values = new Map();
  for (const t of tied) {
    const ms = universeMatches(def.universe, t.team_id, tied, ctx);
    if (def.min_games && ms.length < def.min_games) return null;
    values.set(t.team_id, metricValue(def.metric, recordOver(t.team_id, ms), ctx.config));
  }
  return { def, values };
}

// El ordenador recursivo. Devuelve los equipos ordenados y anota en cada uno
// `resolved_by`: con qué criterio se separó del resto. Eso es lo que después
// permite explicar la tabla en pantalla ("2º por diferencia de puntos") en
// vez de mostrar un orden que nadie puede auditar.
function rankTied(tied, criteriaIndex, ctx, depth = 0) {
  // Guarda de profundidad: con listas de criterios mal configuradas (todo
  // 'restart' y ningún criterio que separe) la recursión podría no avanzar.
  // No debería pasar — solo se reinicia cuando alguien SÍ se separó — pero
  // un tope barato vale más que un servidor colgado.
  if (tied.length <= 1 || depth > 40) return tied;

  const criteria = ctx.config.tiebreakers;
  if (criteriaIndex >= criteria.length) {
    // Se agotó el reglamento y siguen empatados de verdad. No se inventa un
    // ganador: quedan marcados para que la liga lo resuelva como diga su
    // reglamento (sorteo, moneda) y la tabla lo muestre con honestidad.
    return tied.map((t) => ({ ...t, unresolved_tie: true }));
  }

  const evaluated = evaluateCriterion(criteria[criteriaIndex], tied, ctx);
  if (!evaluated) return rankTied(tied, criteriaIndex + 1, ctx, depth + 1);

  const { def, values } = evaluated;
  const sign = def.lower_is_better ? -1 : 1;

  const buckets = new Map();
  for (const t of tied) {
    const v = values.get(t.team_id);
    if (!buckets.has(v)) buckets.set(v, []);
    buckets.get(v).push(t);
  }

  // Nadie se separó: el criterio no sirvió, se pasa al siguiente sin anotar.
  if (buckets.size === 1) return rankTied(tied, criteriaIndex + 1, ctx, depth + 1);

  const orderedValues = [...buckets.keys()].sort((a, b) => (b - a) * sign);

  // Al separarse alguien, el sub-empate se reevalúa. En modo 'restart'
  // (FIBA/FIFA) vuelve al criterio 0 porque el universo "entre sí" cambió;
  // en 'sequential' (NFL) continúa con el criterio siguiente.
  const nextIndex = ctx.config.multi_team_mode === 'sequential' ? criteriaIndex + 1 : 0;

  const out = [];
  for (const v of orderedValues) {
    const bucket = buckets.get(v);
    if (bucket.length === 1) {
      out.push({ ...bucket[0], resolved_by: criteriaIndex === 0 ? null : criteria[criteriaIndex] });
    } else {
      out.push(...rankTied(bucket, nextIndex, ctx, depth + 1));
    }
  }
  return out;
}

/**
 * Calcula una tabla de posiciones.
 *
 * @param {object[]} teams    equipos inscritos: { team_id, name, logo_url, conference_id, group_id }
 * @param {object[]} matches  partidos de la rama (se filtran los que no cuentan)
 * @param {object}   config   { tiebreakers[], multi_team_mode, points_win/draw/loss }
 * @param {function} inScope  opcional: qué partido cuenta como "dentro del alcance"
 *                            de esta tabla (para el universo 'scope')
 */
export function computeStandings({ teams = [], matches = [], config = {}, inScope = null } = {}) {
  const cfg = {
    tiebreakers: Array.isArray(config.tiebreakers) && config.tiebreakers.length
      ? config.tiebreakers.filter((k) => TIEBREAKER_CATALOG[k])
      : DEFAULT_TIEBREAKERS,
    multi_team_mode: config.multi_team_mode === 'sequential' ? 'sequential' : 'restart',
    points_win: config.points_win,
    points_draw: config.points_draw,
    points_loss: config.points_loss,
  };
  if (!cfg.tiebreakers.length) cfg.tiebreakers = DEFAULT_TIEBREAKERS;

  const teamIds = new Set(teams.map((t) => t.team_id));

  // Solo partidos jugados, con marcador, y entre dos equipos de ESTA tabla.
  // Lo último importa: un amistoso contra un invitado de fuera no debe
  // ensuciar el récord de nadie (es el mismo criterio que ya usa
  // matchScope.js para no colar un juego ajeno a una conferencia).
  const usable = matches.filter((m) =>
    countsForStandings(m) && teamIds.has(m.home_team_id) && teamIds.has(m.away_team_id));

  const matchesByTeam = new Map();
  for (const t of teams) matchesByTeam.set(t.team_id, []);
  for (const m of usable) {
    matchesByTeam.get(m.home_team_id).push(m);
    matchesByTeam.get(m.away_team_id).push(m);
  }

  const ctx = {
    config: cfg,
    matchesByTeam,
    inScope: typeof inScope === 'function' ? inScope : () => true,
  };

  // Récord base de cada equipo, más los desgloses que la tabla muestra:
  // general, dentro del alcance, de local y de visita.
  const rows = teams.map((t) => {
    const own = matchesByTeam.get(t.team_id) || [];
    const overall = recordOver(t.team_id, own);
    const scoped  = recordOver(t.team_id, own.filter((m) => ctx.inScope(m)));
    const home    = recordOver(t.team_id, own.filter((m) => m.home_team_id === t.team_id));
    const away    = recordOver(t.team_id, own.filter((m) => m.away_team_id === t.team_id));

    return {
      ...t,
      ...overall,
      played: overall.wins + overall.losses + overall.ties,
      win_pct: winPct(overall),
      point_diff: overall.points_for - overall.points_against,
      table_points: tablePoints(overall, cfg),
      scope_record: scoped,
      home_record: home,
      away_record: away,
      streak: streakOf(t.team_id, own),
      resolved_by: null,
      unresolved_tie: false,
    };
  });

  const ranked = rankTied(rows, 0, ctx, 0);
  return ranked.map((r, i) => ({ ...r, rank: i + 1 }));
}

// Racha actual, del partido más reciente hacia atrás: "G3", "P2", "E1".
// Se calcula por fecha, no por el orden en que llegaron los partidos, porque
// la captura no siempre es cronológica.
function streakOf(teamId, matches) {
  const ordered = [...matches].sort((a, b) => String(b.match_date).localeCompare(String(a.match_date)));
  let kind = null;
  let count = 0;
  for (const m of ordered) {
    const own   = m.home_team_id === teamId ? Number(m.home_score) : Number(m.away_score);
    const other = m.home_team_id === teamId ? Number(m.away_score) : Number(m.home_score);
    const k = own > other ? 'G' : own < other ? 'P' : 'E';
    if (kind === null) { kind = k; count = 1; }
    else if (k === kind) count += 1;
    else break;
  }
  return kind ? `${kind}${count}` : null;
}

// ── Clasificación: quién avanza a la siguiente fase ──────────────────────
//
// Esto NO es desempate, es otra cosa — es lo que responde "grupos de 4, pasa
// el primero de cada uno", o el wild card de NFL, o los 8 mejores terceros
// del Mundial. Se resuelve en dos partes:
//
//   1. `top_n` de CADA tabla (el primero de cada grupo, los dos primeros…).
//   2. `plus_best_n` comparando entre sí a los que quedaron en el MISMO
//      lugar de tablas distintas (los mejores terceros, los wild cards).
//
// La parte 2 compara equipos que quizá nunca jugaron entre sí — por eso no
// puede usar "entre sí" y aplica `cross_tiebreakers`, que por default son
// los criterios generales. Es exactamente la razón por la que FIFA cambia de
// criterio al rankear terceros lugares.
export function computeQualification({ tables = [], rule = {} } = {}) {
  const topN = Number.isFinite(rule.top_n) ? rule.top_n : 1;
  const plusN = Number.isFinite(rule.plus_best_n) ? rule.plus_best_n : 0;
  const ofRank = Number.isFinite(rule.of_rank) ? rule.of_rank : topN + 1;

  const direct = [];
  for (const table of tables) {
    for (const row of table.rows.slice(0, topN)) {
      direct.push({ ...row, qualified_as: 'direct', from_table: table.key });
    }
  }

  let wild = [];
  if (plusN > 0) {
    const candidates = [];
    for (const table of tables) {
      const row = table.rows[ofRank - 1];
      if (row) candidates.push({ ...row, from_table: table.key });
    }

    // Comparación entre grupos: solo criterios de universo general, porque
    // estos equipos no se enfrentaron. Se reusa el mismo motor con una lista
    // recortada en vez de escribir un segundo ordenador.
    const crossKeys = (Array.isArray(rule.cross_tiebreakers) && rule.cross_tiebreakers.length
      ? rule.cross_tiebreakers
      : ['win_pct', 'point_diff', 'points_for']
    ).filter((k) => TIEBREAKER_CATALOG[k] && TIEBREAKER_CATALOG[k].universe === 'all');

    const ctx = {
      config: { ...rule, tiebreakers: crossKeys.length ? crossKeys : ['win_pct'], multi_team_mode: 'sequential' },
      matchesByTeam: new Map(candidates.map((c) => [c.team_id, []])),
      inScope: () => true,
    };
    // Los récords ya vienen calculados en cada fila, así que se ordena sobre
    // los valores que traen en vez de volver a leer partidos.
    wild = sortByPrecomputed(candidates, ctx.config.tiebreakers)
      .slice(0, plusN)
      .map((row) => ({ ...row, qualified_as: 'wildcard' }));
  }

  return [...direct, ...wild];
}

// Ordena filas ya calculadas por una lista de criterios generales, leyendo
// los valores que la fila trae. Solo sirve para la comparación entre tablas
// (arriba); el desempate normal usa el motor completo con partidos.
function sortByPrecomputed(rows, keys) {
  const valueOf = (row, key) => {
    const def = TIEBREAKER_CATALOG[key];
    if (!def) return 0;
    const rec = {
      wins: row.wins, losses: row.losses, ties: row.ties,
      points_for: row.points_for, points_against: row.points_against,
    };
    return metricValue(def.metric, rec, row) * (def.lower_is_better ? -1 : 1);
  };
  return [...rows].sort((a, b) => {
    for (const key of keys) {
      const diff = valueOf(b, key) - valueOf(a, key);
      if (diff !== 0) return diff;
    }
    return 0;
  });
}
