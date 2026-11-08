// Lo que el Panel Admin calcula con los datos que le llegan: qué fila cae en qué
// filtro, qué le toca atender a Alfredo, cómo se reparte un eje. Funciones puras,
// porque es lo único de esta pantalla que se puede probar sin Postgres.
//
// Dos cosas de la API que explican varias líneas de aquí:
//
// - `COUNT(*)` llega como TEXTO: `pg` no convierte bigint y el proyecto no le
//   puso parser, así que `stats.leagues` es "99" y `league_count` es "1". Hasta el
//   2026-11-06 `u.league_count !== 1` salía verdadero siempre y decía "1 ligas".
// - `last30Days` trae solo los días CON visitas, y la fecha llega con hora y zona
//   según dónde corra el servidor ("2026-10-30T05:00:00.000Z" en una máquina en
//   México, "…T00:00:00.000Z" en Render). Ver `fillDays`.

export const toNumber = (value) => Number(value) || 0;
export const formatNumber = (value) => toNumber(value).toLocaleString('es-MX');

// Plural de lo que sale en el panel: `pluralize(1, 'liga')`, `pluralize(2, 'liga')`.
export function pluralize(count, singular, plural = `${singular}s`) {
  return `${formatNumber(count)} ${toNumber(count) === 1 ? singular : plural}`;
}

/* ---------- Búsqueda ---------- */

// Sin acentos y sin mayúsculas: en una lista donde conviven "QUERÉTARO" y
// "Queretaro", buscar no puede depender de cómo lo capturó cada quien.
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Cada palabra tiene que aparecer en alguno de los campos, en cualquier orden.
export function matchesSearch(query, fields) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields.map(normalize);
  return words.every((word) => haystack.some((field) => field.includes(word)));
}

/* ---------- Filtros: las celdas del marcador de cada sección ---------- */

export const leagueHasRequest = (league) => Boolean(league.publish_requested && !league.is_public);

export const LEAGUE_FILTERS = [
  { key: 'todas',       label: 'Registradas', test: () => true },
  // La única cifra de la fila que pide algo: por eso va en amarillo.
  { key: 'solicitudes', label: 'Solicitudes', test: leagueHasRequest, attention: true },
  { key: 'publicas',    label: 'Públicas',    test: (lg) => Boolean(lg.is_public) },
  { key: 'privadas',    label: 'Privadas',    test: (lg) => !lg.is_public },
  { key: 'verificadas', label: 'Verificadas', test: (lg) => Boolean(lg.is_verified) },
];

export const ORGANIZATION_FILTERS = [
  { key: 'todas',         label: 'Registradas',  test: () => true },
  { key: 'sin_verificar', label: 'Sin verificar', test: (org) => !org.is_verified, attention: true },
  // Un tipo sin organizaciones no ocupa celda: las dos de arriba se quedan siempre.
  { key: 'media',  label: 'Medios',   test: (org) => org.type === 'media',  optional: true },
  { key: 'store',  label: 'Tiendas',  test: (org) => org.type === 'store',  optional: true },
  { key: 'clinic', label: 'Clínicas', test: (org) => org.type === 'clinic', optional: true },
  { key: 'brand',  label: 'Marcas',   test: (org) => org.type === 'brand',  optional: true },
  { key: 'team',   label: 'Equipos',  test: (org) => org.type === 'team',   optional: true },
];

// La cuenta del mes se hace en hora del centro de México, igual que el resto de
// las fechas del panel: a las 7 p. m. del día 31 en México, en UTC ya es el mes
// siguiente, y quien se registrara a esa hora saldría en el mes equivocado.
function monthInMexico(value) {
  return new Date(value).toLocaleDateString('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit',
  });
}

export function isNewThisMonth(user, now = new Date()) {
  return Boolean(user.created_at) && monthInMexico(user.created_at) === monthInMexico(now);
}

export function userFilters(now = new Date()) {
  return [
    { key: 'todos',     label: 'Registrados',      test: () => true },
    { key: 'nuevos',    label: 'Nuevos este mes',  test: (u) => isNewThisMonth(u, now) },
    { key: 'con_liga',  label: 'Dueños de liga',   test: (u) => toNumber(u.league_count) > 0 },
    { key: 'admins',    label: 'Administradores',  test: (u) => u.role === 'admin' },
  ];
}

// Cuántas filas caen en cada filtro, en el orden del marcador. Un filtro
// `optional` sin filas no se regresa: la excepción es que sea el elegido, porque
// una cuenta que acaba de quedar en 0 no debe desaparecer bajo el dedo.
export function countFilters(filters, rows, activeKey = null) {
  return filters
    .map((filter) => ({ ...filter, count: rows.filter(filter.test).length }))
    .filter((filter) => !filter.optional || filter.count > 0 || filter.key === activeKey);
}

// Las solicitudes de publicación van primero, para atenderlas sin buscarlas. El
// resto conserva el orden del backend (las más nuevas arriba).
export function sortLeagues(leagues) {
  return [...leagues].sort((a, b) => Number(leagueHasRequest(b)) - Number(leagueHasRequest(a)));
}

/* ---------- Qué le toca atender a Alfredo ---------- */

// Lo que sale arriba del Resumen. Cada renglón lleva a su sección ya filtrada.
export function attentionItems({ leagues, organizations, cron }) {
  const items = [];

  const requests = (leagues ?? []).filter(leagueHasRequest).length;
  if (requests > 0) {
    items.push({
      key: 'solicitudes',
      tone: 'ask',
      text: requests === 1 ? '1 liga pidió publicarse' : `${formatNumber(requests)} ligas pidieron publicarse`,
      to: '/admin?seccion=ligas&filtro=solicitudes',
    });
  }

  const unverified = (organizations ?? []).filter((org) => !org.is_verified).length;
  if (unverified > 0) {
    items.push({
      key: 'sin_verificar',
      tone: 'ask',
      text: `${pluralize(unverified, 'organización', 'organizaciones')} sin verificar`,
      to: '/admin?seccion=organizaciones&filtro=sin_verificar',
    });
  }

  // Sin `cron` todavía no se dice nada: "no sé" no es lo mismo que "no da señal".
  if (cron?.estado === 'atrasado' || cron?.estado === 'sin_señal') {
    items.push({
      key: 'cron',
      tone: cron.estado === 'atrasado' ? 'ask' : 'bad',
      text: cron.estado === 'atrasado' ? 'El cron va atrasado' : 'El cron no da señal',
      to: '/admin?seccion=cron',
    });
  }

  return items;
}

/* ---------- Organizaciones ---------- */

// Cómo se dice cada tipo de organización en un panel. La usan /admin y Mi panel
// (utils/dashboard.js): una sola tabla, para que no digan cosas distintas. `team`
// solo aplica en /admin, donde un equipo sin liga sale entre las organizaciones.
export const ORG_TYPE_LABELS = {
  media: 'Medio de comunicación',
  store: 'Tienda / proveedor',
  clinic: 'Clínica',
  brand: 'Marca',
  team: 'Equipo independiente',
};

// Un equipo entra a esta lista de dos formas: independiente (sin liga) o entregado
// por su liga. Ver GET /admin/organizations y README, "Organizaciones: publicar y
// verificar".
export const isHandedOverTeam = (org) => org.type === 'team' && org.league_id != null;

// `plan='pro'` con la fecha vencida ya no es Pro. Sin fecha, Pro no vence.
export function planStatus(org, now = new Date()) {
  const expires = org.plan_expires_at ? new Date(org.plan_expires_at) : null;
  const active = org.plan === 'pro' && (!expires || expires > now);
  return { active, expires };
}

/* ---------- Tablas y cifras ---------- */

export function paginate(rows, page, size) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  // Si la lista se encoge (un filtro, un borrado), la página no se queda colgada.
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * size;
  return {
    rows: rows.slice(start, start + size),
    page: current,
    pages,
    total: rows.length,
    from: rows.length === 0 ? 0 : start + 1,
    to: Math.min(start + size, rows.length),
  };
}

// Porcentaje de clics sobre impresiones. Sin impresiones no hay porcentaje: un
// "0.0 %" diría que se mostró y nadie le dio clic.
export function clickRate(impressions, clicks) {
  const shown = toNumber(impressions);
  return shown > 0 ? (toNumber(clicks) / shown) * 100 : null;
}

export function sponsorTotals(sponsors) {
  const impressions = sponsors.reduce((sum, s) => sum + toNumber(s.impressions), 0);
  const clicks = sponsors.reduce((sum, s) => sum + toNumber(s.clicks), 0);
  return { impressions, clicks, rate: clickRate(impressions, clicks) };
}

/* ---------- Gráficas ---------- */

// Una escala de números redondos para el eje Y: 615 usuarios dan 0-200-400-600-800
// y no 0-500-1,000, que dejaría la curva en la mitad de abajo de la gráfica.
export function niceScale(max, ticks = 4) {
  const top = Math.max(toNumber(max), 1);
  const rough = top / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = Math.max(1, (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude);
  const values = [];
  for (let value = 0; value < top + step; value += step) values.push(value);
  return { top: values[values.length - 1], values };
}

// Los últimos `size` días SEGUIDOS, con 0 en los que no hubo visitas. La API solo
// trae los días con visitas: pintados tal cual, cinco días sueltos de un mes salían
// pegados y parecían cinco días consecutivos.
//
// `today` es la fecha en UTC, la misma con la que el servidor agrupa
// (`created_at::date`).
export function fillDays(rows, today = new Date().toISOString().slice(0, 10), size = 30) {
  const counts = new Map(rows.map((row) => [String(row.day).slice(0, 10), toNumber(row.count)]));
  const last = new Date(`${today}T00:00:00Z`);
  return Array.from({ length: size }, (_, index) => {
    const date = new Date(last);
    date.setUTCDate(last.getUTCDate() - (size - 1 - index));
    const day = date.toISOString().slice(0, 10);
    return { day, count: counts.get(day) ?? 0 };
  });
}

// Con tantos renglones como quepan a la vista; el resto se abre a pedido.
export function topRows(rows, limit, expanded) {
  return expanded ? rows : rows.slice(0, limit);
}
