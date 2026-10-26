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
// pantalla. `width` es en pixeles de la imagen (1080 de ancho): lo justo para
// la cifra más ancha con la letra más grande —"1.000", "+131", "10.357", el
// encabezado "EN CONF."—, para que al nombre del equipo le toque todo lo demás.
// `highlight` es la cifra que ordena la tabla, la que va resaltada.
//
// PF, PC y DIF eran 62, 62 y 72: con AVG (2026-10-25) recortaban a PUMAS FES
// ACATLÁN UNAM, que a la letra mínima de su renglón mide 218. Medido en Oswald
// a 30 px, "108" ocupa 43 y "+131" 51, así que se angostaron 6 cada una y AVG
// quedó en 80 para su "10.357" de 76. README, "La columna AVG".
export const IMAGE_COLUMNS = {
  played: { label: 'JJ', width: 48 },
  wins:   { label: 'G', width: 48 },
  losses: { label: 'P', width: 48 },
  ties:   { label: 'E', width: 48 },
  points: { label: 'PTS', width: 80, highlight: true },
  pct:    { label: '%', width: 80, highlight: true },
  scope:  { label: '', width: 92 },
  pf:     { label: 'PF', width: 56 },
  pc:     { label: 'PC', width: 56 },
  diff:   { label: 'DIF', width: 66 },
  avg:    { label: 'AVG', width: 80 },
  streak: { label: 'RACHA', width: 70 },
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
 * ACATLÁN UNAM"). Es el nombre el que ajusta su letra (standingsShareCard.js).
 *
 * @param {{level:string, rows:Array}} table
 * @param {boolean} usesPoints
 * @returns {Array<{id:string,label:string,width:number,highlight:boolean}>}
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
      width: IMAGE_COLUMNS[id].width,
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
