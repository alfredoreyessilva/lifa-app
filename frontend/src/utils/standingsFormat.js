// Cómo se escribe cada cifra de una tabla de posiciones, y qué columnas lleva
// la imagen para compartir. Funciones PURAS, sin DOM: las usan la tabla en
// pantalla (StandingsTable.jsx) y la imagen (standingsShareCard.js), para que
// las dos digan exactamente lo mismo, y por eso se pueden probar con node --test.
//
// Nada de esto ordena ni calcula récords: eso ya viene resuelto del backend
// (utils/standings.js), que es el único lugar donde vive el reglamento.

// Porcentaje de ganados como en las tablas deportivas: ".750", "1.000".
export const pct = (v) => (v === 1 ? '1.000' : v.toFixed(3).replace(/^0/, ''));

export function recordLabel(rec) {
  if (!rec) return '—';
  const base = `${rec.wins}-${rec.losses}`;
  return rec.ties ? `${base}-${rec.ties}` : base;
}

// La columna AVG: puntos a favor ÷ en contra, con tres decimales como el
// porcentaje. El backend la manda en null cuando no hay puntos en contra
// (JSON no lleva infinito): con algo a favor es "∞", que es como la ordena el
// reglamento; sin nada a favor ni en contra, "—". README, "La columna AVG".
export function goalAverageLabel(row) {
  if (row.goal_average === null || row.goal_average === undefined) {
    return row.points_for > 0 ? '∞' : '—';
  }
  return row.goal_average.toFixed(3);
}

// Una tabla enseña AVG solo si su reglamento lo usa: en las demás no ordena
// nada y es una columna más que no cabe en el teléfono.
export function showsGoalAverage(table) {
  return Array.isArray(table?.tiebreakers) && table.tiebreakers.includes('goal_average');
}

// Quién lleva la barra de "clasifica": los primeros `qualifyingCount` de la
// tabla, más el que pasa por lugar extra (comodín) aunque su lugar no alcance.
export function rowQualifies(row, qualifyingCount = 0) {
  return Boolean((qualifyingCount && row.rank <= qualifyingCount) || row.qualified_as === 'wildcard');
}

// ── La imagen para compartir ─────────────────────────────────────────────

const SCOPE_PREFIX = { conference: 'Conferencia', group: 'Grupo' };

const sinAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// El nombre de la tabla en la imagen. En la página basta "NACIONAL", porque
// la pestaña de arriba ya dice "Por conferencia"; la imagen viaja sola y sin
// esa pestaña, así que dice "Conferencia NACIONAL". Un grupo que ya se llama
// "Grupo A" no se vuelve "Grupo Grupo A". La tabla general no lleva nombre.
export function scopeLabel(level, scopeName) {
  const name = (scopeName || '').trim();
  const prefix = SCOPE_PREFIX[level];
  if (!name || !prefix) return '';
  return sinAcentos(name).startsWith(sinAcentos(prefix)) ? name : `${prefix} ${name}`;
}

// La fecha de corte. Una tabla que circula por WhatsApp sin fecha no dice de
// qué jornada es, y la de hace dos semanas se ve igual que la de hoy.
export function cutoffLabel(date) {
  return `Al ${date.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

// Las columnas que puede llevar la imagen, en el orden de la tabla en
// pantalla. `highlight` es la cifra que ordena la tabla, la que va resaltada. Lo
// ancho de cada una lo mide la imagen contra lo que trae esa tabla
// (standingsShareCard.js): una tabla de "1.000" y "+131" y una de "10.357" no
// necesitan lo mismo, y lo que no se ocupa es del nombre del equipo.
export const IMAGE_COLUMNS = {
  played: { label: 'JJ' },
  wins:   { label: 'G' },
  losses: { label: 'P' },
  ties:   { label: 'E' },
  points: { label: 'PTS', highlight: true },
  pct:    { label: '%', highlight: true },
  scope:  { label: '' },
  pf:     { label: 'PF' },
  pc:     { label: 'PC' },
  diff:   { label: 'DIF' },
  avg:    { label: 'AVG' },
  streak: { label: 'RACHA' },
};

const ORDER = ['played', 'wins', 'losses', 'ties', 'points', 'pct', 'scope', 'pf', 'pc', 'diff', 'avg', 'streak'];

const SCOPE_HEADER = { conference: 'EN CONF.', group: 'EN GRUPO' };

/**
 * Las columnas que lleva la imagen de UNA tabla: las mismas que la tabla en
 * pantalla, en el mismo orden. La E solo si hubo empates, el récord dentro
 * del alcance solo en tablas de conferencia o grupo, y AVG solo si el
 * reglamento de la tabla usa el goal average, igual que en pantalla.
 *
 * Ninguna se suelta para darle aire al nombre. La primera versión soltaba PF
 * y PC en las tablas de conferencia, como el teléfono, y no hacía falta: en
 * 1080 de ancho caben todas con el nombre más largo de hoy ("PUMAS FES
 * ACATLÁN UNAM"). Son las cifras y el nombre los que ajustan su letra
 * (standingsShareCard.js).
 *
 * @param {{level:string, rows:Array}} table
 * @param {boolean} usesPoints
 * @returns {Array<{id:string,label:string,highlight:boolean}>}
 */
export function imageColumns(table, usesPoints) {
  const anyTies = table.rows.some((r) => r.ties > 0);
  const applies = {
    ties: anyTies,
    points: usesPoints,
    pct: !usesPoints,
    scope: table.level !== 'branch',
    avg: showsGoalAverage(table),
  };
  return ORDER
    .filter((id) => applies[id] ?? true)
    .map((id) => ({
      id,
      label: id === 'scope' ? SCOPE_HEADER[table.level] : IMAGE_COLUMNS[id].label,
      highlight: Boolean(IMAGE_COLUMNS[id].highlight),
    }));
}

// El texto de una celda de la imagen, con el mismo formato que la tabla.
export function cellText(id, row) {
  switch (id) {
    case 'played': return String(row.played);
    case 'wins':   return String(row.wins);
    case 'losses': return String(row.losses);
    case 'ties':   return String(row.ties);
    case 'points': return String(row.table_points ?? 0);
    case 'pct':    return pct(row.win_pct);
    case 'scope':  return recordLabel(row.scope_record);
    case 'pf':     return String(row.points_for);
    case 'pc':     return String(row.points_against);
    case 'diff':   return row.point_diff > 0 ? `+${row.point_diff}` : String(row.point_diff);
    case 'avg':    return goalAverageLabel(row);
    case 'streak': return row.streak || '—';
    default:       return '';
  }
}

// "Conferencia NACIONAL, COLEGIAL UNIVERSITARIO Varonil", con la misma forma que
// el detalle de la portada de un partido. `context` es "categoría · rama", tal
// como lo enseña la página del torneo.
export function tableDetail(table, context) {
  return [
    scopeLabel(table.level, table.scope_name),
    (context || '').split(' · ').join(' ').trim(),
  ].filter(Boolean).join(', ');
}

// Un nombre largo en dos líneas parejas: "PUMAS FES / ACATLÁN UNAM", y no "PUMAS
// FES ACATLÁN / UNAM", que obligaría a la columna a medir casi lo mismo que en una
// sola. `mide` dice cuánto ocupa un texto con la letra que se va a usar, y `extra`,
// lo que va pegado a la última línea: la pill de comodín se cuenta al partir, o el
// nombre que la lleva sería el que no cabe. Con ella también vale dejar el nombre
// entero arriba y la pill sola abajo: "LOBOS UADEC" solo se parte de una manera, y
// en esa no le queda lugar.
export function splitName(name, mide, extra = 0) {
  const words = name.split(/\s+/).filter(Boolean);
  const options = words.slice(1).map((_, i) => [words.slice(0, i + 1).join(' '), words.slice(i + 1).join(' ')]);
  if (extra > 0) options.push([name, '']);
  let best = [name];
  let bestWidth = Infinity;
  for (const pair of options) {
    const width = Math.max(mide(pair[0]), mide(pair[1]) + extra);
    if (width < bestWidth) {
      best = pair;
      bestWidth = width;
    }
  }
  return best;
}

// Las marcas que la tabla trae y que la leyenda de la imagen tiene que
// explicar. Solo se explica lo que aparece: una leyenda de cosas ausentes es
// ruido.
export function tableMarks(table) {
  const q = table.qualifying_count || 0;
  return {
    qualifies: table.rows.some((r) => rowQualifies(r, q)),
    unresolvedTie: table.rows.some((r) => r.unresolved_tie),
  };
}
