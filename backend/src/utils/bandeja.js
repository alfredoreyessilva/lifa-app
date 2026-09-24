import { puede } from './orgRoles.js';

// "Mis notificaciones": una sola bandeja por persona. Aquí viven las reglas
// PURAS —quién lee qué aviso de una organización y cómo se arman los avisos de
// lo que uno sigue—; el SQL está en routes/notifications.js. README,
// "Notificaciones: la bandeja y el push".

// ── Quién lee cada aviso de una organización ──────────────────────────────
//
// Antes la bandeja de un equipo se leía con `ver` y la de una liga con
// `estructura`, sin mirar de qué trataba el aviso: el coach leía cuotas
// vencidas con nombres del padrón, y el tesorero de la liga no veía el pago
// que le tocaba confirmar. Ahora cada tipo pide el permiso de su tema, y la
// tabla de permisos sigue viviendo en un solo lugar (utils/orgRoles.js).
export const PERMISO_POR_AVISO = {
  // Cobranza liga ↔ equipo, de los dos lados.
  billing_charge_new:       'cobranza_liga',
  billing_payment_recorded: 'cobranza_liga',
  billing_payment_rejected: 'cobranza_liga',
  billing_due_soon:         'cobranza_liga',
  billing_overdue:          'cobranza_liga',
  team_payment_reported:    'cobranza_liga',
  // Cuotas del club: llevan nombres del padrón.
  player_payment_reported:  'cuotas_club',
  player_billing_due_soon:  'cuotas_club',
  player_billing_overdue:   'cuotas_club',
  // Recordatorios de captura: son el trabajo del visor.
  score_reminder:           'marcadores',
  match_not_started:        'marcadores',
  // Un medio se sumó a un partido: las transmisiones son `estructura`.
  broadcast_added:          'estructura',
  // Lo que la plataforma decidió sobre la publicación de la liga.
  league_approved:          'perfil',
  league_unapproved:        'perfil',
  league_publish_declined:  'perfil',
  league_verified:          'perfil',
  league_unverified:        'perfil',
  // Quién entró a la organización.
  team_claimed:             'miembros',
  org_admin_claimed:        'miembros',
};

// Un tipo que nadie clasificó lo leen solo los dueños. Falla cerrado sin ser
// invisible: un aviso nuevo que se olvidó agregar arriba sigue llegándole a
// alguien, y no se le cuela a un coach.
const PERMISO_SIN_CLASIFICAR = 'duenos';

export function permisoDeAviso(tipoDeAviso) {
  return PERMISO_POR_AVISO[tipoDeAviso] ?? PERMISO_SIN_CLASIFICAR;
}

export function puedeLeerAviso(tipoDeOrg, rol, tipoDeAviso) {
  return puede(tipoDeOrg, rol, permisoDeAviso(tipoDeAviso));
}

// Qué pedirle a `notifications` para un usuario, dadas sus organizaciones
// (`[{ tipo: 'league'|'team', id, rol }]`). Devuelve grupos
// `{ tipo, ids, avisos }`: `avisos` es la lista de tipos que ese rol puede leer,
// o `null` si los lee todos (quien tiene `duenos`, que además es el único que
// lee lo no clasificado). Se agrupa por (tipo de organización, lista de avisos)
// para que el SQL tenga una condición por grupo y no una por organización: la
// cuenta de quien capturó una liga entera es dueña de decenas de equipos.
export function filtrosDeBandeja(organizaciones) {
  const grupos = new Map();
  for (const { tipo, id, rol } of organizaciones) {
    let avisos = null;
    if (!puede(tipo, rol, PERMISO_SIN_CLASIFICAR)) {
      avisos = Object.keys(PERMISO_POR_AVISO).filter((aviso) => puedeLeerAviso(tipo, rol, aviso));
      if (avisos.length === 0) continue;
    }
    const clave = `${tipo}|${avisos ? avisos.join(',') : '*'}`;
    if (!grupos.has(clave)) grupos.set(clave, { tipo, ids: [], avisos });
    grupos.get(clave).ids.push(id);
  }
  return [...grupos.values()];
}

// ── Los avisos de lo que uno sigue ────────────────────────────────────────
//
// "Próximo" y "en vivo" se CALCULAN con la hora del partido: la bandeja se lee
// cuando la abres, así que no dependen del cron. "Marcador final" y "cambio de
// fecha o sede" vienen de `match_events`, porque ahí importa cuándo pasó y el
// dato de antes ya no existe.

export const DIAS_DE_BANDEJA = 30;
const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

// Qué casilla del menú de "Seguir" controla cada aviso.
const CASILLA_POR_AVISO = {
  upcoming:        'notify_upcoming',
  live:            'notify_live',
  final_score:     'notify_final',
  schedule_change: 'notify_changes',
};

const mayus = (s) => String(s ?? '').trim().toUpperCase();

// ¿Este seguimiento cubre este partido? Un partido; un equipo dentro de una
// liga (o en cualquier liga, si el seguimiento no dice cuál); o una liga.
export function cubre(seguimiento, partido) {
  if (seguimiento.match_id != null) return seguimiento.match_id === partido.id;
  if (seguimiento.team_name) {
    if (seguimiento.league_id != null && seguimiento.league_id !== partido.league_id) return false;
    const equipo = mayus(seguimiento.team_name);
    return mayus(partido.home_team) === equipo || mayus(partido.away_team) === equipo;
  }
  if (seguimiento.league_id != null) return seguimiento.league_id === partido.league_id;
  return false;
}

// Una casilla en NULL cuenta como marcada: así nacían las filas viejas.
const quiere = (seguimiento, aviso) => seguimiento[CASILLA_POR_AVISO[aviso]] !== false;

/**
 * Los avisos de seguimiento de una persona.
 *
 * @param {object} p
 * @param {Array} p.seguimientos  filas de push_subscriptions, con `desde` (Date)
 * @param {Array} p.partidos      los partidos que cubren, con `match_date` ISO en UTC
 * @param {Array} p.eventos       filas de match_events, con `at` (Date)
 * @param {Date}  p.ahora
 * @returns {Array<{key, type, at: Date, partido, data}>}
 */
export function avisosDeSeguimiento({ seguimientos, partidos, eventos, ahora }) {
  const ahoraMs = ahora.getTime();
  const piso = ahoraMs - DIAS_DE_BANDEJA * DIA_MS;
  const avisos = [];

  // Un aviso entra si pasó en la ventana, ya pasó, y alguno de los
  // seguimientos que cubren el partido lo pide y ya existía en ese momento.
  // Así un partido que sigues directamente Y por su equipo avisa una sola vez.
  const entra = (cubren, aviso, atMs) =>
    atMs >= piso &&
    atMs <= ahoraMs &&
    cubren.some((s) => quiere(s, aviso) && atMs >= new Date(s.desde).getTime());

  const porId = new Map();
  for (const partido of partidos) {
    const cubren = seguimientos.filter((s) => cubre(s, partido));
    if (cubren.length === 0) continue;
    porId.set(partido.id, { partido, cubren });

    const inicio = new Date(partido.match_date).getTime();
    if (Number.isNaN(inicio)) continue;
    if (entra(cubren, 'upcoming', inicio - HORA_MS)) {
      avisos.push({ key: `upcoming-${partido.id}`, type: 'upcoming', at: new Date(inicio - HORA_MS), partido, data: null });
    }
    if (entra(cubren, 'live', inicio)) {
      avisos.push({ key: `live-${partido.id}`, type: 'live', at: new Date(inicio), partido, data: null });
    }
  }

  // De los cambios de fecha o sede solo el último de cada partido: los
  // anteriores ya no son verdad.
  const ultimoCambio = new Map();
  for (const evento of eventos) {
    if (evento.type !== 'schedule_change') continue;
    const previo = ultimoCambio.get(evento.match_id);
    if (!previo || new Date(evento.at) > new Date(previo.at)) ultimoCambio.set(evento.match_id, evento);
  }

  for (const evento of eventos) {
    if (!CASILLA_POR_AVISO[evento.type]) continue;
    if (evento.type === 'schedule_change' && ultimoCambio.get(evento.match_id) !== evento) continue;
    const seguido = porId.get(evento.match_id);
    if (!seguido) continue;
    const atMs = new Date(evento.at).getTime();
    if (!entra(seguido.cubren, evento.type, atMs)) continue;
    avisos.push({
      key: `${evento.type}-${evento.id}`,
      type: evento.type,
      at: new Date(atMs),
      partido: seguido.partido,
      data: evento.data ?? null,
    });
  }

  return avisos;
}

// Lo nuevo: después de hasta dónde ya viste, y nunca en el futuro.
export function esNuevo(at, vistoHasta, ahora) {
  const t = new Date(at).getTime();
  return t > new Date(vistoHasta).getTime() && t <= ahora.getTime();
}

export function contarNuevos(avisos, vistoHasta, ahora) {
  return avisos.filter((a) => esNuevo(a.at, vistoHasta, ahora)).length;
}

// Las dos listas en una, lo más nuevo arriba.
export const LIMITE_DE_BANDEJA = 100;

export function juntarBandeja(listas, limite = LIMITE_DE_BANDEJA) {
  return listas
    .flat()
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, limite);
}
