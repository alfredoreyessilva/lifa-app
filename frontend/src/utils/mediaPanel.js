// Lo que el panel de un medio calcula con lo que le llega: si puede transmitir,
// en qué va cada transmisión, qué le toca, qué le falta a su ficha y cómo se
// acomoda lo que se juega. Funciones puras, porque es lo único de esta pantalla
// que se puede probar sin Postgres (tests/unit/mediaPanel.test.mjs). README, "El
// panel de un medio".
//
// Las dos listas llegan con la misma forma de partido (PARTIDO_COLUMNAS, en
// routes/broadcasts.js): el id del partido en `match_id`, los escudos ya
// resueltos y la ventana del estado automático de su categoría.
//
//   GET /broadcasts/organization/:id            sus transmisiones; `id` y `url` son de la transmisión
//   GET /broadcasts/organization/:id/upcoming   lo que se juega; `broadcast_id` y `broadcast_url`,
//                                               si ya está en el partido

import { formatNumber, pluralize } from './adminPanel.js';
import { matchState } from './leaguePanel.js';
import { fechaCorta, fechaLarga, rondaDelPartido, torneoDelPartido } from './matchDisplay.js';
import { joinWithAnd } from './storePanel.js';
import { validUrl } from './validation.js';

const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== '';
const time = (m) => (m.match_date ? new Date(m.match_date).getTime() : null);
// El espacio que no se parte, por su código: escrito tal cual no se distingue de
// uno normal al leer el archivo.
const NBSP = String.fromCharCode(0xa0);

/* ---------- El medio ---------- */

// Para transmitir: publicado Y verificado, la regla de `puedeTransmitir` en el
// backend (utils/orgVisibility.js). Las dos las pone CFBAMX, así que esto se
// dice sin botón y no va en amarillo: el medio no tiene nada que arreglar aquí.
export function broadcastGate(org) {
  const published = org?.is_public === true;
  const verified = org?.is_verified === true;
  if (published && verified) return { on: true, tone: 'on', label: 'Listo', sub: 'Publicado y verificado' };
  const missing = [];
  if (!published) missing.push('te publique');
  if (!verified) missing.push('te verifique');
  return { on: false, tone: 'off', label: 'Todavía no', sub: `Falta que CFBAMX ${joinWithAnd(missing)}` };
}

// Dónde lo siguen: lo que su ficha enseña como botones (redesDeOrganizacion).
const FOLLOW_FIELDS = ['facebook_url', 'instagram_url', 'youtube_url', 'tiktok_url', 'website_url'];

export const hasFollowLinks = (org) => Boolean(org) && FOLLOW_FIELDS.some((key) => hasValue(org[key]));

// Lo que le falta a su ficha para que diga quién es y dónde seguirlo. Un medio
// vive de que lo sigan en sus redes (README, "Lo que enseña su ficha"); el
// teléfono, el correo y la portada no cuentan para esto.
export function mediaProfileGaps(org) {
  if (!org) return [];
  const gaps = [];
  if (!hasValue(org.logo_url)) gaps.push('el logo');
  if (!hasValue(org.description)) gaps.push('la descripción');
  if (!hasFollowLinks(org)) gaps.push('dónde seguirte');
  return gaps;
}

/* ---------- Un partido ---------- */

// En qué va el partido, con la cuenta del panel de una liga (`matchState`): lo
// que terminó por el estado automático de su categoría, o ya debió terminar
// aunque nadie lo cerró, ya no "viene".
export function matchStage(match, now = Date.now()) {
  const state = matchState(match, match, now);
  if (state === 'live') return 'live';
  if (state === 'upcoming') return 'upcoming';
  return 'past';
}

// "ONEFA · LIGA MAYOR 2026 · PLAYOFFS": de dónde es el partido, con su ronda como
// la dice el calendario. En un teléfono este renglón se parte, y dos espacios que
// no se parten deciden dónde: el número de la jornada va pegado a "Jornada" (se
// quedaba solo en el renglón de abajo), y cada punto, a lo que lo antecede, para
// que no abra un renglón (la misma lección de `detalleDelPartido`).
export function matchContext(match) {
  const ronda = rondaDelPartido(match).replace(/ (\d+)$/, `${NBSP}$1`);
  return [match.league_name, torneoDelPartido(match), ronda].filter(Boolean).join(`${NBSP}· `);
}

// Cuándo sigue: lo más cercano con fecha que todavía no empieza.
function nextDated(rows, now) {
  return rows.find((m) => m.stage === 'upcoming' && time(m) !== null && time(m) >= now) || null;
}

/* ---------- Sus transmisiones ---------- */

export const hasLink = (b) => hasValue(b?.url);

// Lo que le toca: una transmisión que viene sin link. Sin link, su logo en
// "También transmiten" abre su ficha y no su transmisión. A una ya jugada se le
// puede poner la repetición, pero ya no le urge a nadie.
export const lacksLink = (b) => b.stage !== 'past' && !hasLink(b);

export function annotate(rows, now = Date.now()) {
  return (rows || []).map((row) => ({ ...row, stage: matchStage(row, now) }));
}

// Las celdas del marcador de Transmisiones, que además filtran la tabla.
export const BROADCAST_FILTERS = [
  { key: 'todas',        label: 'Transmisiones', test: () => true },
  { key: 'proximas',     label: 'Próximas',      test: (b) => b.stage === 'upcoming' },
  { key: 'en-vivo',      label: 'En vivo',       test: (b) => b.stage === 'live', optional: true },
  { key: 'transmitidas', label: 'Transmitidas',  test: (b) => b.stage === 'past' },
  { key: 'sin-link',     label: 'Sin link',      test: lacksLink, attention: true },
];

const soonestFirst = (a, b) => (time(a) ?? Infinity) - (time(b) ?? Infinity) || a.match_id - b.match_id;
const newestFirst = (a, b) => (time(b) ?? -Infinity) - (time(a) ?? -Infinity) || b.match_id - a.match_id;

// La tabla en tramos: lo que se está jugando, lo que viene (lo más cercano
// primero y lo que no tiene fecha al final) y lo ya transmitido, de lo más
// reciente a lo más viejo.
export function broadcastGroups(rows) {
  const list = rows || [];
  return [
    { key: 'live',     label: 'En vivo',      rows: list.filter((b) => b.stage === 'live').sort(soonestFirst) },
    { key: 'upcoming', label: 'Próximas',     rows: list.filter((b) => b.stage === 'upcoming').sort(soonestFirst) },
    { key: 'past',     label: 'Transmitidas', rows: list.filter((b) => b.stage === 'past').sort(newestFirst) },
  ].filter((group) => group.rows.length > 0);
}

// Lo que viene, en el orden en que se va a jugar: primero lo que está en vivo.
export function nextBroadcasts(rows, limit = 5) {
  const groups = broadcastGroups(rows);
  return groups.filter((g) => g.key !== 'past').flatMap((g) => g.rows).slice(0, limit);
}

// Lo último que transmitió, de lo más reciente a lo más viejo. El Resumen lo
// enseña cuando no hay nada por venir, que es casi toda la semana de un medio.
export function lastBroadcasts(rows, limit = 3) {
  return (broadcastGroups(rows).find((g) => g.key === 'past')?.rows ?? []).slice(0, limit);
}

export function broadcastTotals(rows, now = Date.now()) {
  const list = rows || [];
  const live = list.filter((b) => b.stage === 'live').length;
  const upcoming = list.filter((b) => b.stage === 'upcoming').length;
  const next = nextDated([...list].sort(soonestFirst), now);
  return {
    total: list.length,
    live,
    upcoming,
    coming: live + upcoming,
    past: list.filter((b) => b.stage === 'past').length,
    noLink: list.filter(lacksLink).length,
    next,
  };
}

// La celda "Próximas" del Resumen: cuántas, y debajo lo más urgente.
export function comingFigure(totals) {
  if (!totals) return { value: null, sub: null };
  if (totals.live > 0) return { value: formatNumber(totals.coming), sub: `${formatNumber(totals.live)} en vivo` };
  if (totals.next) {
    return { value: formatNumber(totals.coming), sub: `Sigue el ${fechaCorta(totals.next.match_date, totals.next.timezone)}` };
  }
  return { value: formatNumber(totals.coming), sub: totals.coming ? 'Con fecha por definir' : null };
}

/* ---------- Lo que se juega ---------- */

// Lo que llega de /upcoming, sin lo que ya terminó por el reloj de su categoría:
// el backend trae lo de las últimas 12 horas que nadie dio por terminado. El
// backend ya lo manda por fecha; se vuelve a ordenar aquí (estable, así que entre
// dos a la misma hora se queda su orden por liga) para que los días y "Se juega
// pronto" no dependan de eso.
export function scheduleOf(matches, now = Date.now()) {
  return annotate(matches, now)
    .filter((m) => m.stage !== 'past')
    .sort((a, b) => (time(a) ?? Infinity) - (time(b) ?? Infinity));
}

export const isMine = (m) => hasValue(m.broadcast_id);

// Las celdas de Partidos. Una por liga, solo si hay más de una: con una sola,
// "Partidos" y "ONEFA" dirían el mismo número.
export function scheduleFilters(rows) {
  const leagues = new Map();
  for (const m of rows || []) if (!leagues.has(m.league_id)) leagues.set(m.league_id, m.league_name || 'Liga');
  const byLeague = leagues.size > 1
    ? [...leagues]
      .sort((a, b) => a[1].localeCompare(b[1], 'es', { sensitivity: 'base' }))
      .map(([id, name]) => ({ key: `liga-${id}`, label: name, test: (m) => m.league_id === id }))
    : [];
  return [
    { key: 'todos', label: 'Partidos', test: () => true },
    ...byLeague,
    { key: 'transmites', label: 'Ya transmites', test: isMine, optional: true },
  ];
}

// Por día, en la zona de cada partido ("Sábado 15 de noviembre"), en el orden
// en que llegan: el backend los manda por fecha, con los que no tienen al final.
export function scheduleDays(rows, now = Date.now()) {
  const days = new Map();
  for (const m of rows || []) {
    const label = m.match_date ? fechaLarga(m.match_date, m.timezone || m.league_timezone, now) : 'Fecha por definir';
    if (!days.has(label)) days.set(label, { key: label, label, tbd: !m.match_date, rows: [] });
    days.get(label).rows.push(m);
  }
  return [...days.values()];
}

// "Se juega pronto" del Resumen: lo que viene y todavía no transmite.
export function upcomingToJoin(rows, limit = 5) {
  return (rows || []).filter((m) => !isMine(m)).slice(0, limit);
}

/* ---------- Lo que le toca al medio ---------- */

// La sección va en `?seccion=` y el filtro en `?filtro=`, como en el panel de una
// tienda: una ruta por sección desmontaría la página en cada clic.
export function mediaHref(id, section = 'resumen', filter = null) {
  const params = new URLSearchParams();
  if (section && section !== 'resumen') params.set('seccion', section);
  if (filter) params.set('filtro', filter);
  const query = params.toString();
  return `/panel/medio/${id}${query ? `?${query}` : ''}`;
}

// Cuántas transmisiones le toca completar: las que vienen sin link, y solo si
// puede transmitir. Sin eso, POST /broadcasts le contesta 403 también para
// cambiar un link, y el amarillo pediría algo que no está en su mano. Es el
// número de la barra, de la celda del Resumen y del renglón de "Lo que te toca".
export function pendingLinks(org, broadcasts) {
  if (!broadcastGate(org).on) return 0;
  return (broadcasts || []).filter(lacksLink).length;
}

// Lo que sale arriba del Resumen. Cada renglón lleva a donde se arregla. No
// decide nada por el medio: cuenta lo que el público ve de él.
export function mediaAttention(org, broadcasts) {
  const items = [];
  const id = org?.id;

  const noLink = pendingLinks(org, broadcasts);
  if (noLink > 0) {
    items.push({
      key: 'sin-link',
      text: noLink === 1
        ? '1 transmisión por venir no tiene link'
        : `${formatNumber(noLink)} transmisiones por venir no tienen link`,
      where: 'Sin link, tu logo en el partido abre tu ficha y no tu transmisión',
      to: mediaHref(id, 'transmisiones', 'sin-link'),
    });
  }

  const gaps = mediaProfileGaps(org);
  if (gaps.length > 0) {
    items.push({
      key: 'perfil',
      text: `A tu ficha le falta ${joinWithAnd(gaps)}`,
      where: 'Es lo que ve quien toca tu logo en un partido o en el home',
      to: mediaHref(id, 'perfil'),
    });
  }

  return items;
}

/* ---------- El link ---------- */

// La misma regla del backend (isValidUrl): opcional, y si va, http o https.
export function validateLink(value) {
  return validUrl(String(value ?? ''), 'El link');
}

export const linkPayload = (value) => String(value ?? '').trim() || null;

// "1 partido", "12 partidos": para los enlaces de "Ver todos".
export const matchesWord = (n) => pluralize(n, 'partido');
