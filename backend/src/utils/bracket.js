// El bracket de los playoffs: la siembra, los cruces y quién avanza. README,
// "El bracket de los playoffs" (2026-11-01).
//
// Es PURO, igual que utils/standings.js: recibe las tablas ya calculadas, la
// regla de clasificación, las fases y los partidos, y devuelve el bracket. No
// se guarda nada en ningún lado — se arma al leer, como la tabla y el campeón,
// así que un marcador corregido corrige el bracket solo. Las consultas viven en
// utils/branchStandings.js.
//
// Las tres decisiones de fondo:
//
//   1. La siembra va por LUGAR: todos los primeros, luego todos los segundos…
//      y al final los lugares extra. Dentro de cada lugar se comparan con los
//      criterios de la regla para equipos de tablas distintas, los mismos que
//      eligen a los mejores terceros (crossCriteriaOf).
//   2. Las rondas después de la primera SE REACOMODAN: los vivos se ordenan
//      otra vez por su siembra y el mejor recibe al peor. Es como juega ONEFA
//      (Alfredo, 2026-11-01).
//   3. Lo capturado manda: cada cruce busca su partido por la pareja de
//      equipos, y un partido capturado con la fase de una ronda que contradice
//      la proyección la corrige.

import { crossCriteriaOf, compareByCriteria, sortByPrecomputed, countsForStandings } from './standings.js';

// ── La siembra ───────────────────────────────────────────────────────────

/**
 * Los clasificados de una regla, numerados del 1 al N.
 *
 * @param {object[]} tables  [{ key, name, rows }]: las tablas donde aplica la
 *                           regla, en el mismo orden que usa markWildcards()
 *                           para que los lugares extra salgan iguales.
 * @param {object}   rule    la fila de phase_qualifications.
 * @returns {object[]} [{ seed, team_id, name, logo_url, wins, losses, ties,
 *                      qualified_as, table_name, table_rank, tied }]
 */
export function computeSeeding({ tables = [], rule = {} } = {}) {
  const topN  = Number.isFinite(rule.top_n) ? rule.top_n : 1;
  const plusN = Number.isFinite(rule.plus_best_n) ? rule.plus_best_n : 0;
  const ofRank = Number.isFinite(rule.of_rank) ? rule.of_rank : topN + 1;
  const keys = crossCriteriaOf(rule);

  const conMeta = (table, k, qualifiedAs) => {
    const row = table.rows[k];
    return row && { ...row, table_name: table.name ?? null, table_rank: k + 1, qualified_as: qualifiedAs };
  };

  // Un número que no decidió ningún criterio lleva asterisco: o los criterios
  // no lo separan de otro de su mismo lugar, o su lugar en su propia tabla ya
  // venía en empate sin resolver (y entonces ni siquiera se sabe si es primero
  // o segundo de su grupo).
  const sinSeparar = (row, otros) => otros.some((o) => o !== row && compareByCriteria(row, o, keys) === 0);

  const seeds = [];
  const agregar = (row, empatado) => {
    seeds.push({
      seed: seeds.length + 1,
      team_id: row.team_id,
      name: row.name,
      logo_url: row.logo_url ?? null,
      wins: row.wins ?? 0,
      losses: row.losses ?? 0,
      ties: row.ties ?? 0,
      qualified_as: row.qualified_as,
      table_name: row.table_name,
      table_rank: row.table_rank,
      tied: Boolean(row.unresolved_tie) || empatado,
    });
  };

  for (let k = 0; k < topN; k++) {
    const lugar = sortByPrecomputed(tables.map((t) => conMeta(t, k, 'direct')).filter(Boolean), keys);
    for (const row of lugar) agregar(row, sinSeparar(row, lugar));
  }

  // Los lugares extra: la misma cuenta que computeQualification(), sobre las
  // mismas tablas en el mismo orden. Un empate exacto con el que se quedó
  // fuera también lleva asterisco: ahí no se decidió ni quién clasifica.
  if (plusN > 0) {
    const yaEstan = new Set(seeds.map((s) => s.team_id));
    const candidatos = sortByPrecomputed(
      tables.map((t) => conMeta(t, ofRank - 1, 'wildcard')).filter((r) => r && !yaEstan.has(r.team_id)),
      keys,
    );
    for (const row of candidatos.slice(0, plusN)) agregar(row, sinSeparar(row, candidatos));
  }

  return seeds;
}

// ── La forma del bracket ─────────────────────────────────────────────────

// El tamaño del bracket: la potencia de dos que alcanza a todos. Con 6
// clasificados es de 8, y los que faltan son descansos del 1 y del 2.
export function bracketSize(n) {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

// El orden estándar de un bracket, en el orden en que se dibuja de arriba
// abajo: [1, 8, 4, 5, 2, 7, 3, 6] para 8. Cada par consecutivo es un cruce (el
// mejor contra el peor), y el 1 y el 2 quedan en mitades distintas: solo se
// pueden ver en la final. La mitad de arriba es el lado izquierdo del espejo.
export function bracketOrder(size) {
  let order = [1];
  for (let n = 2; n <= size; n *= 2) {
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

// Nombres de ronda contados desde la final, para cuando la rama no tiene una
// fase por ronda que les preste el suyo.
const NOMBRES_DESDE_LA_FINAL = ['Final', 'Semifinales', 'Cuartos de final', 'Octavos de final'];

function nombreGenerico(r, roundCount) {
  return NOMBRES_DESDE_LA_FINAL[roundCount - 1 - r] || `Ronda ${r + 1}`;
}

/**
 * Las fases de eliminación directa que siguen a una regla de clasificación:
 * desde su fase destino (o, si no tiene, la primera de eliminación directa
 * después de la fase de la regla) mientras sigan siendo de eliminación directa.
 */
export function knockoutPhasesFor(rule = {}, phases = []) {
  const orden = [...phases].sort((a, b) => ((a.sort_order ?? 0) - (b.sort_order ?? 0)) || (a.id - b.id));
  let start = rule.target_phase_id ? orden.findIndex((p) => p.id === rule.target_phase_id) : -1;
  if (start < 0) {
    const desde = orden.findIndex((p) => p.id === rule.phase_id);
    start = orden.findIndex((p, i) => i > desde && p.type === 'single_elimination');
  }
  const fases = [];
  for (let i = Math.max(start, 0); start >= 0 && i < orden.length && orden[i].type === 'single_elimination'; i++) {
    fases.push(orden[i]);
  }
  return fases;
}

// ── Partidos ─────────────────────────────────────────────────────────────

function hasScore(value) {
  if (value === null || value === undefined || value === '') return false;
  return Number.isFinite(Number(value));
}

// Lo que el bracket necesita de un partido, sin cargar la fila entera.
function resumen(m) {
  return {
    id: m.id,
    match_date: m.match_date ?? null,
    timezone: m.timezone ?? null,
    status: m.status ?? null,
    is_final: Boolean(m.is_final),
    home_team_id: m.home_team_id,
    away_team_id: m.away_team_id,
    home_score: hasScore(m.home_score) ? Number(m.home_score) : null,
    away_score: hasScore(m.away_score) ? Number(m.away_score) : null,
    auto_status_enabled: m.auto_status_enabled ?? null,
    auto_status_window_hours: m.auto_status_window_hours ?? null,
  };
}

// Quién ganó, si ya se sabe: terminado, con los dos marcadores y sin empate.
// Un empate capturado no hace avanzar a nadie (mismo criterio que el campeón
// por partido de branchStandings.js).
function ganadorDe(m) {
  if (!m || !m.is_final || !hasScore(m.home_score) || !hasScore(m.away_score)) return null;
  const h = Number(m.home_score);
  const a = Number(m.away_score);
  if (h === a) return null;
  return h > a ? m.home_team_id : m.away_team_id;
}

const parDe = (m) => [m.home_team_id, m.away_team_id];
const mismaPareja = (m, a, b) => (m.home_team_id === a && m.away_team_id === b) || (m.home_team_id === b && m.away_team_id === a);

// Fecha por definir al final, igual que en el calendario.
function porFecha(a, b) {
  const da = a.match_date ? String(a.match_date) : '￿';
  const dbb = b.match_date ? String(b.match_date) : '￿';
  return da.localeCompare(dbb) || (a.id - b.id);
}

// ── El bracket ───────────────────────────────────────────────────────────

/**
 * Arma el bracket de una regla.
 *
 * @param {object[]} seeds    de computeSeeding()
 * @param {object[]} phases   las fases de eliminación directa (knockoutPhasesFor)
 * @param {object[]} matches  los partidos de eliminación directa entre equipos
 *                            del bracket, con `is_final` ya resuelto
 * @param {Map}      teams    team_id → { name, logo_url }: para nombrar a un
 *                            equipo que aparece en un partido capturado sin
 *                            estar en la siembra
 * @returns {object|null}     null si no hay a quién cruzar (menos de 2)
 */
export function buildBracket({ seeds = [], phases = [], matches = [], teams = new Map() } = {}) {
  if (seeds.length < 2) return null;

  const size = bracketSize(seeds.length);
  const roundCount = Math.log2(size);

  // Una fase por ronda presta su nombre y deja corregir con la fase del
  // partido. Si no cuadran (una sola fase "Playoffs" para todo), nombres
  // genéricos y la corrección por fase no aplica; la pareja sí.
  const porFase = phases.length === roundCount;
  const rondaDeFase = new Map(porFase ? phases.map((p, r) => [p.id, r]) : []);

  const seedDe = new Map(seeds.map((s) => [s.team_id, s]));
  const participante = (teamId, extra = {}) => {
    if (teamId === null || teamId === undefined) return null;
    const s = seedDe.get(teamId);
    const t = teams.get?.(teamId);
    return {
      team_id: teamId,
      seed: s ? s.seed : null,
      name: s?.name ?? t?.name ?? null,
      logo_url: s?.logo_url ?? t?.logo_url ?? null,
      ...extra,
    };
  };
  // El mejor sembrado va arriba (es el local). Uno que no está en la siembra
  // —entró por un partido capturado— va abajo.
  const ordenar = (a, b) => {
    const sa = a?.seed ?? Infinity;
    const sb = b?.seed ?? Infinity;
    return sa <= sb ? [a, b] : [b, a];
  };

  const candidatos = [...matches].sort(porFecha);
  const usados = new Set();

  const rondas = [];
  let cruces = bracketOrder(size).reduce((acc, s, i, arr) => {
    if (i % 2 === 0) {
      const top = seeds[s - 1] ? participante(seeds[s - 1].team_id) : null;
      const bottom = seeds[arr[i + 1] - 1] ? participante(seeds[arr[i + 1] - 1].team_id) : null;
      acc.push({ top, bottom });
    }
    return acc;
  }, []);

  for (let r = 0; r < roundCount; r++) {
    const games = cruces.map((c) => ({
      top: c.top,
      bottom: c.bottom,
      // Descanso: solo pasa en la primera ronda, cuando no hay suficientes
      // clasificados para llenar el bracket.
      bye: r === 0 && Boolean(c.top) !== Boolean(c.bottom),
      match: null,
      corrected: false,
      winner_team_id: null,
    }));

    // 1. Cada cruce con sus dos equipos toma el partido entre esos dos. En
    //    eliminación directa se enfrentan una sola vez, así que la pareja
    //    basta, sin importar la fase o la jornada con que se capturó.
    for (const g of games) {
      if (!g.top || !g.bottom) continue;
      const m = candidatos.find((x) => !usados.has(x.id) && mismaPareja(x, g.top.team_id, g.bottom.team_id));
      if (m) { g.match = m; usados.add(m.id); }
    }

    // 2. Lo capturado manda: un partido con la fase de ESTA ronda que no cuadra
    //    con la proyección corrige el cruce que comparte uno de sus equipos, o
    //    llena uno que todavía no se conoce. Solo con fase explícita: un
    //    partido que solo dice "PLAYOFF" no dice de qué ronda es.
    for (const m of candidatos) {
      if (usados.has(m.id) || rondaDeFase.get(m.explicit_phase_id) !== r) continue;
      const [h, a] = parDe(m);
      const juega = (p) => p && (p.team_id === h || p.team_id === a);
      const abiertos = games.filter((g) => !g.match && !g.bye);
      const g = abiertos.find((x) => juega(x.top) || juega(x.bottom))
        || abiertos.find((x) => !x.top && !x.bottom);
      if (!g) continue;
      const [top, bottom] = ordenar(participante(h, fromOf(g, h)), participante(a, fromOf(g, a)));
      g.top = top; g.bottom = bottom;
      g.match = m; g.corrected = true;
      usados.add(m.id);
      // Un equipo juega un solo cruce por ronda: si la proyección lo tenía en
      // otro que sigue abierto, ahí queda su lugar por definir.
      for (const otro of abiertos) {
        if (otro === g) continue;
        if (juega(otro.top)) otro.top = null;
        if (juega(otro.bottom)) otro.bottom = null;
      }
    }

    for (const g of games) {
      if (g.bye) {
        g.winner_team_id = (g.top || g.bottom).team_id;
      } else {
        g.winner_team_id = ganadorDe(g.match);
      }
    }

    // Lo que un participante necesita para pintarse en este cruce: su
    // marcador. El partido viaja resumido, sin la fila entera.
    const pintados = games.map((g) => {
      const m = g.match;
      const scoreOf = (p) => {
        if (!p || !m) return null;
        return p.team_id === m.home_team_id ? (hasScore(m.home_score) ? Number(m.home_score) : null)
          : p.team_id === m.away_team_id ? (hasScore(m.away_score) ? Number(m.away_score) : null) : null;
      };
      return {
        top: g.top && { ...g.top, score: scoreOf(g.top) },
        bottom: g.bottom && { ...g.bottom, score: scoreOf(g.bottom) },
        bye: g.bye,
        match: m ? resumen(m) : null,
        corrected: g.corrected,
        winner_team_id: g.winner_team_id,
      };
    });

    const fase = porFase ? phases[r] : null;
    rondas.push({
      name: fase ? fase.name : nombreGenerico(r, roundCount),
      phase_id: fase ? fase.id : null,
      games: pintados,
    });

    if (r === roundCount - 1) break;

    // La siguiente ronda se reacomoda: los vivos, por su siembra, con el mismo
    // orden de bracket (el mejor contra el peor). Solo cuando terminó toda
    // esta ronda; antes no se sabe quién es el peor que sigue vivo.
    const vivos = games.map((g, i) => {
      if (!g.winner_team_id) return null;
      const quien = g.top?.team_id === g.winner_team_id ? g.top : g.bottom;
      return { ...quien, from_game: i };
    });
    const siguientes = games.length / 2;
    if (vivos.every(Boolean)) {
      const orden = [...vivos].sort((a, b) => (a.seed ?? Infinity) - (b.seed ?? Infinity));
      const ob = bracketOrder(orden.length);
      cruces = [];
      for (let i = 0; i < ob.length; i += 2) {
        const [top, bottom] = ordenar(orden[ob[i] - 1], orden[ob[i + 1] - 1]);
        cruces.push({ top: limpio(top), bottom: limpio(bottom) });
      }
    } else if (siguientes === 1) {
      // La final no tiene nada que reacomodar: la juegan los dos que ganen las
      // semifinales, y solo falta saber quién es local. El que ya ganó la suya
      // se pinta desde ahora, de su lado.
      const conocidos = vivos.filter(Boolean);
      cruces = [{ top: limpio(conocidos[0] || null), bottom: null }];
      rondas[r].advanced = conocidos.map(limpio);
    } else {
      cruces = Array.from({ length: siguientes }, () => ({ top: null, bottom: null }));
      // Los que ya avanzaron, para decirlo mientras se completa la ronda.
      rondas[r].advanced = vivos.filter(Boolean).map(limpio);
    }
  }

  const final = rondas[rondas.length - 1].games[0];
  const champion = final.winner_team_id
    ? (final.top?.team_id === final.winner_team_id ? final.top : final.bottom)
    : null;

  return {
    size,
    teams_count: seeds.length,
    pairing: 'reseed',
    seeds,
    rounds: rondas,
    champion: champion ? limpio(champion) : null,
    unplaced_matches: candidatos.filter((m) => !usados.has(m.id)).map(resumen),
  };
}

// De qué cruce de la ronda anterior viene un equipo, para que el espejo lo
// pinte de su lado. Si el equipo no estaba proyectado en este cruce (lo trajo
// un partido capturado), no se sabe.
function fromOf(g, teamId) {
  const p = [g.top, g.bottom].find((x) => x?.team_id === teamId);
  return p && p.from_game !== undefined ? { from_game: p.from_game } : {};
}

// Sin el marcador de la ronda anterior: cada ronda pinta el suyo.
function limpio(p) {
  if (!p) return null;
  const { score, ...resto } = p; // eslint-disable-line no-unused-vars
  return resto;
}

// ── Cuándo se publica ────────────────────────────────────────────────────

/**
 * Cuántos partidos de temporada regular del bracket ya se jugaron y cuántos
 * faltan. "De temporada regular" es lo que cuenta para la tabla, entre dos
 * equipos inscritos en la rama y con al menos uno del bracket.
 */
export function regularSeasonProgress({ matches = [], poolIds = [], eligibleIds = [] } = {}) {
  const pool = new Set(poolIds);
  const eligible = new Set(eligibleIds);
  let played = 0;
  let pending = 0;
  for (const m of matches) {
    if (m.is_draft || m.counts_for_standings === false) continue;
    if (!eligible.has(m.home_team_id) || !eligible.has(m.away_team_id)) continue;
    if (!pool.has(m.home_team_id) && !pool.has(m.away_team_id)) continue;
    if (countsForStandings(m)) played += 1;
    else pending += 1;
  }
  return { played, pending };
}

// Los partidos de eliminación directa entre dos equipos del bracket: los que
// el bracket puede leer. La fase puede ser explícita o deducida de la jornada
// ("PLAYOFF", "SEMIFINAL", "FINAL"), y por eso se mira `phase_type` resuelto.
export function knockoutMatchesOf({ matches = [], poolIds = [] } = {}) {
  const pool = new Set(poolIds);
  return matches
    .filter((m) => !m.is_draft
      && m.phase_type === 'single_elimination'
      && pool.has(m.home_team_id) && pool.has(m.away_team_id))
    .map((m) => ({ ...m, explicit_phase_id: m.phase_is_explicit ? m.phase_id : null }));
}

/**
 * Si el bracket ya se publica: cuando su temporada regular terminó, o en
 * cuanto hay un partido de playoffs capturado (con los playoffs empezados,
 * esconderlo por un partido olvidado sería peor).
 */
export function isBracketReady({ played = 0, pending = 0, knockoutCount = 0 } = {}) {
  return (pending === 0 && played > 0) || knockoutCount > 0;
}
