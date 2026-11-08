// Lo que Mi panel (/panel) calcula con lo que ya tiene: el orden de tus
// organizaciones, las cifras del marcador y por qué está cada partido en tu
// cartelera. Funciones puras, porque es lo único de la pantalla que se puede
// probar sin Postgres. README, "Mi panel".

import { ORG_TYPE_LABELS, formatNumber, pluralize, toNumber } from './adminPanel.js';
import { matchState } from './leaguePanel.js';
import { fechaCorta } from './matchDisplay.js';
import { getMatchStatus } from './matchStatus.js';
import { etiquetaDeMiRol } from './permisos.js';
import { storeHref } from './storePanel.js';

/* ---------- La banda ---------- */

// "Hola, Alfredo": el primer nombre, como lo escribió quien se registró. Sin
// nombre, la banda dice "Mi panel" y ya.
export function firstName(name) {
  return (name || '').trim().split(/\s+/)[0] || null;
}

/* ---------- Tus organizaciones ---------- */

const byName = (a, b) => (
  (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }) || a.id - b.id
);

// Una ficha por organización, con las mismas tres listas de /auth/me que leía la
// barra de logos. `organizations` trae TODAS, ligas y equipos incluidos, y esos ya
// vienen en su propia lista con el id que usan sus rutas: de ahí solo se toma lo
// demás (medios, tiendas, clínicas, marcas).
//
// Ligas, luego equipos, luego lo demás, y por abecedario dentro de cada grupo:
// /auth/me no ordena ligas ni equipos, y salían como la base los regresara.
export function organizationsOf({ leagues, teams, organizations } = {}) {
  const ligas = [...(leagues || [])].sort(byName).map((league) => ({
    key: `liga-${league.id}`,
    kind: 'liga',
    name: league.name,
    logo: league.logo_url || null,
    what: 'Liga',
    role: etiquetaDeMiRol(league),
    href: `/panel/liga/${league.id}/estructura`,
  }));

  const equipos = [...(teams || [])].sort(byName).map((team) => ({
    key: `equipo-${team.id}`,
    kind: 'equipo',
    name: team.name,
    logo: team.logo_url || null,
    // Lo mismo que dice el encabezado de su panel (TeamWorkspace).
    what: !team.league_id ? 'Equipo independiente'
      : team.league_name ? `Equipo · ${team.league_name}` : 'Equipo',
    role: etiquetaDeMiRol(team),
    href: `/panel/equipo/${team.id}`,
  }));

  const otras = (organizations || [])
    .filter((org) => !['league', 'team'].includes(org.type))
    .sort(byName)
    .map((org) => ({
      key: `organizacion-${org.id}`,
      kind: 'organizacion',
      type: org.type,
      name: org.name,
      logo: org.logo_url || null,
      what: ORG_TYPE_LABELS[org.type] || 'Organización',
      role: etiquetaDeMiRol(org),
      // Una tienda tiene su panel; lo demás, su formulario.
      href: org.type === 'store' ? storeHref(org.id) : `/panel/organizacion/${org.id}?edit=1`,
    }));

  return [...ligas, ...equipos, ...otras];
}

// Cómo se cuenta cada cosa debajo de "Organizaciones": "1 liga · 2 equipos · 1
// medio", en el orden de las fichas. Lo demás se cuenta por su tipo y no como
// "organización", que es justo lo que dice la celda de arriba.
const COUNT_WORDS = {
  liga: ['liga', 'ligas'],
  equipo: ['equipo', 'equipos'],
  media: ['medio', 'medios'],
  store: ['tienda', 'tiendas'],
  clinic: ['clínica', 'clínicas'],
  brand: ['marca', 'marcas'],
};
const OTHER_WORDS = ['otra', 'otras'];

// Cada cuenta lleva un espacio duro entre la cifra y la palabra: en una celda
// angosta el renglón se partía en "1 / tienda". Solo puede partirse en los " · ".
export function organizationsSummary(list) {
  const counts = new Map();
  for (const org of list || []) {
    const group = org.kind === 'organizacion' ? org.type : org.kind;
    counts.set(group, (counts.get(group) || 0) + 1);
  }
  return [...counts]
    .map(([group, count]) => pluralize(count, ...(COUNT_WORDS[group] || OTHER_WORDS)).replace(' ', ' '))
    .join(' · ');
}

/* ---------- Mi cartelera ---------- */

const time = (match) => (match.match_date ? new Date(match.match_date).getTime() : null);

// En qué lugar de "Próximos" va un partido: lo que se está jugando, lo que sigue
// por fecha, lo que no tiene fecha, y al final lo que ya debió terminar sin que
// nadie lo cerrara. Ese último sigue programado para siempre en una categoría sin
// estado automático; ordenado solo por fecha quedaba arriba de todo, encima del
// que está en vivo, y con seis por lista escondía a los que de verdad siguen. "Ya
// debió terminar" es la cuenta del panel de una liga y del aviso "Falta capturar
// un marcador" (`matchState`): cada fila de la cartelera trae la ventana de su
// categoría.
function upcomingRank(match, now) {
  const state = matchState(match, match, now);
  if (state === 'live') return 0;
  if (state !== 'upcoming') return 3;
  return match.match_date ? 1 : 2;
}

// Próximos y pasados. Lo que sigue va del más cercano al más lejano; lo que ya
// debió terminar y los pasados, del más reciente al más viejo, que es el que más
// pronto tiene o tuvo su resultado. Uno que finalizaron sin ponerle fecha va al
// final: `new Date(null)` es 1970 y lo ponía hasta arriba.
const newestFirst = (a, b) => (time(b) ?? -Infinity) - (time(a) ?? -Infinity) || a.id - b.id;

export function splitBoard(board, now = Date.now()) {
  const upcoming = [];
  const past = [];
  for (const match of board || []) {
    (getMatchStatus(match, now) === 'finished' ? past : upcoming).push(match);
  }
  const rank = new Map(upcoming.map((match) => [match, upcomingRank(match, now)]));
  upcoming.sort((a, b) => rank.get(a) - rank.get(b) || (rank.get(a) === 3 ? newestFirst(a, b)
    : (time(a) ?? Infinity) - (time(b) ?? Infinity) || a.id - b.id));
  past.sort(newestFirst);
  return { upcoming, past };
}

// La celda "Por jugar": cuántos, y debajo lo más urgente. Lo que está en vivo
// manda; si no, cuándo sigue el próximo con fecha. Un partido programado cuya hora
// ya pasó (en una categoría sin estado automático nadie lo cierra solo) sigue
// contando como por jugar, pero no se anuncia como "lo que sigue".
export function upcomingFigure(upcoming, now = Date.now()) {
  const live = upcoming.filter((match) => getMatchStatus(match, now) === 'live').length;
  if (live > 0) return { value: formatNumber(upcoming.length), sub: `${formatNumber(live)} en vivo` };
  const next = upcoming.find((match) => time(match) !== null && time(match) >= now);
  return {
    value: formatNumber(upcoming.length),
    sub: next ? `Sigue el ${fechaCorta(next.match_date, next.timezone)}` : null,
  };
}

// `stats` es lo que contesta GET /predictions/my-stats: null mientras llega, false
// si falló. Quien nunca ha votado ve la celda vacía con su razón: en un marcador,
// eso se lee como lo que es, y el renglón no cambia de forma al cargar.
export function accuracyFigure(stats) {
  if (stats == null) return { value: null, sub: null, loading: true };
  if (stats === false) return { value: '—', sub: 'No se pudo cargar' };
  if (!toNumber(stats.total)) return { value: '—', sub: 'Todavía no votas' };
  if (!toNumber(stats.graded) || stats.accuracyPct == null) {
    return { value: '—', sub: 'Ningún voto calificado todavía' };
  }
  return {
    value: `${stats.accuracyPct}%`,
    sub: `${formatNumber(stats.correct)} de ${pluralize(stats.graded, 'calificado')}`,
  };
}

export function pendingFigure(stats) {
  if (stats == null) return { value: null, loading: true };
  if (stats === false) return { value: '—' };
  return { value: formatNumber(stats.pending) };
}

// "Votaste por Borregos" y no "Tu predicción: Local", que obligaba a buscar quién
// era el local. Es la misma frase del "¿Quién gana?" de la tarjeta.
export function votedFor(match) {
  if (match.myPick === 'tie') return 'Votaste por el empate';
  const team = match.myPick === 'home' ? match.home_team
    : match.myPick === 'away' ? match.away_team : null;
  return team ? `Votaste por ${team}` : null;
}

// Por qué está este partido en tu cartelera, en el orden en que se lee. Lo que
// sigues directo se deja desde aquí; lo que sigues por su equipo, desde la página
// del equipo, porque ese seguimiento cubre todos sus partidos y no solo este.
//
// El voto solo se dice en un partido en vivo o ya jugado: en uno por jugar ya lo
// dice el "¿Quién gana?" de la misma tarjeta (PredictionWidget), que solo sale
// mientras el partido está programado.
export function boardReasons(match, now = Date.now()) {
  const reasons = [];
  if (match.followed_directly) reasons.push({ key: 'partido', text: 'Lo sigues', unfollow: true });
  else if (match.followed_team) reasons.push({ key: 'equipo', text: `Sigues a ${match.followed_team}` });
  if (match.predicted && getMatchStatus(match, now) !== 'scheduled') {
    const text = votedFor(match);
    if (text) reasons.push({ key: 'voto', text });
  }
  return reasons;
}

// Seis llenan una, dos o tres columnas sin huecos; "Ver más" suma doce, que también.
export const BOARD_FIRST = 6;
export const BOARD_STEP = 12;
