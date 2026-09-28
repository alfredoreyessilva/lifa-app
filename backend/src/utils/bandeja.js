import { puede } from './orgRoles.js';
import { jornadaDe, repasoPorJornada, hitoEntre } from './rankingPredicciones.js';

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
// cuando la abres, así que no dependen del cron. "Marcador final" sale cuando
// el partido terminó y tiene marcador (`gradable_at`, utils/scoring.js), que se
// arma con dos eventos de `match_events`. "Cambio de fecha o sede" viene
// directo de `match_events`, porque ahí importa cuándo pasó y el dato de antes
// ya no existe.

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
 *                                y `gradable_at` (Date o null: todavía no terminó)
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

    // Marcador final: cuando el partido TERMINÓ y tiene marcador, no cuando se
    // capturó el primer marcador. El organizador sube el parcial durante el
    // partido, y antes el 7–0 del primer cuarto ya decía "Marcador final"
    // (README, "Cuándo terminó un partido: `gradable_at`").
    const final = partido.gradable_at == null ? NaN : new Date(partido.gradable_at).getTime();
    if (!Number.isNaN(final) && entra(cubren, 'final_score', final)) {
      avisos.push({ key: `final_score-${partido.id}`, type: 'final_score', at: new Date(final), partido, data: null });
    }

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

  // De los eventos solo sale el cambio de fecha o sede: `final_score` y
  // `finished` ya entraron arriba, dentro de `gradable_at`.
  for (const evento of eventos) {
    if (evento.type !== 'schedule_change') continue;
    if (ultimoCambio.get(evento.match_id) !== evento) continue;
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

// ── Los avisos de tus predicciones ────────────────────────────────────────
//
// README, "Los avisos de tus predicciones". Se CALCULAN al leer, como
// "próximo" y "en vivo": no hay una fila por aviso. No hace falta seguir nada,
// basta con haber votado. Tres tipos:
//
//   prediction_result    uno por partido que votaste, cuando terminó
//   prediction_round     al cerrar una jornada: tu lugar, y el de tus quinielas
//   prediction_reminder  24 h antes de una jornada en la que te falta votar

// El alcance de "el ranking" es el del calendario que lo muestra: la rama del
// partido, o su categoría en el modelo viejo sin ramas.
export function alcanceDe(partido) {
  return partido.branch_id != null ? `rama-${partido.branch_id}` : `categoria-${partido.category_id}`;
}

// El calendario de ese alcance. Una rama vive dentro de su torneo
// (TournamentPage la preselecciona con `?rama=`); una categoría sin rama, en
// su calendario del modelo viejo.
export function urlDelCalendario(partido, params = {}) {
  const deTorneo = partido.tournament_id != null && partido.branch_id != null;
  const base = deTorneo ? `/torneos/${partido.tournament_id}` : `/categorias/${partido.category_id}/calendario`;
  const q = new URLSearchParams();
  if (deTorneo) q.set('rama', String(partido.branch_id));
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export const HORAS_DE_RECORDATORIO = 24;

const msDe = (v) => (v == null ? NaN : new Date(v).getTime());

/**
 * @param {object} p
 * @param {number} p.userId
 * @param {Array}  p.partidos      todos los de tus alcances: { id, branch_id, category_id,
 *                                 tournament_id, week_label, match_date, timezone,
 *                                 gradable_at, exhibition, ... }
 * @param {Array}  p.predicciones  las de TODOS en esos partidos: { user_id, match_id,
 *                                 pick, created_at, correct, points }
 * @param {Array}  p.quinielas     las tuyas: { id, name, join_code, miembros: [userId] }
 * @param {Date}   p.ahora
 * @returns {Array<{ key, type, at: Date, url, partido, data }>}
 */
export function avisosDePrediccion({ userId, partidos, predicciones, quinielas = [], ahora }) {
  const ahoraMs = ahora.getTime();
  const piso = ahoraMs - DIAS_DE_BANDEJA * DIA_MS;
  const enVentana = (atMs) => atMs >= piso && atMs <= ahoraMs;
  const avisos = [];

  const partidoPorId = new Map(partidos.map((p) => [p.id, p]));
  const alcances = new Map();
  for (const p of partidos) {
    const clave = alcanceDe(p);
    if (!alcances.has(clave)) alcances.set(clave, { partidos: [], predicciones: [] });
    alcances.get(clave).partidos.push(p);
  }
  const votos = new Map();
  for (const pr of predicciones) {
    const p = partidoPorId.get(pr.match_id);
    if (!p) continue;
    alcances.get(alcanceDe(p)).predicciones.push(pr);
    if (!votos.has(pr.match_id)) votos.set(pr.match_id, { home: 0, away: 0, tie: 0, total: 0 });
    const v = votos.get(pr.match_id);
    v[pr.pick] = (v[pr.pick] || 0) + 1;
    v.total += 1;
  }
  const mias = predicciones.filter((pr) => pr.user_id === userId);
  const miVoto = new Map(mias.map((pr) => [pr.match_id, pr]));

  // 1. El resultado de cada partido que votaste, a la hora en que terminó.
  //    Los amistosos no reparten puntos: no hay nada que avisar.
  //    Van en su propia lista y al final: el cierre de una jornada tiene la
  //    MISMA hora que el resultado del partido que la cerró, y juntarBandeja()
  //    respeta el orden en un empate — así el resumen queda arriba.
  const resultados = [];
  for (const pr of mias) {
    const p = partidoPorId.get(pr.match_id);
    if (!p || p.exhibition) continue;
    const at = msDe(p.gradable_at);
    if (Number.isNaN(at) || !enVentana(at)) continue;
    const v = votos.get(p.id);
    resultados.push({
      key: `prediction-${p.id}`,
      type: 'prediction_result',
      at: new Date(at),
      url: `/partidos/${p.id}`,
      partido: p,
      data: {
        pick: pr.pick,
        correct: Boolean(pr.correct),
        points: Number(pr.points) || 0,
        votes: v.total,
        same_pct: v.total > 0 ? Math.round((v[pr.pick] / v.total) * 100) : null,
      },
    });
  }

  for (const [clave, alcance] of alcances) {
    const oficiales = alcance.partidos.filter((p) => !p.exhibition);
    if (oficiales.length === 0) continue;
    const muestra = oficiales[0];

    // 2. El cierre de cada jornada: tu lugar en el calendario y en cada
    //    quiniela tuya donde vote alguien más (una quiniela de una sola
    //    persona no compara nada).
    const repaso = repasoPorJornada({ partidos: alcance.partidos, predicciones: alcance.predicciones, ahora });
    const votaron = new Set(alcance.predicciones.map((pr) => pr.user_id));
    const misQuinielas = quinielas
      .filter((q) => q.miembros.includes(userId) && q.miembros.some((id) => id !== userId && votaron.has(id)))
      .map((q) => ({
        q,
        repaso: repasoPorJornada({ partidos: alcance.partidos, predicciones: alcance.predicciones, ahora, miembros: q.miembros }),
      }));

    // Cuántos más comparten tu lugar: en la jornada 0 de ONEFA (un solo
    // partido) varios quedaron empatados en el 1.º, y "¡vas 1.º!" a cada uno
    // presumía algo que no era. El texto dice "compartes el 1.º".
    const empatados = (tabla, yo) => [...tabla.values()].filter((f) => f.position === yo.position).length - 1;

    repaso.forEach((corte, i) => {
      if (!enVentana(corte.at.getTime())) return;
      const yo = corte.tabla.get(userId);
      if (!yo || yo.total === 0) return;
      const antes = i > 0 ? repaso[i - 1].tabla.get(userId) : null;
      const antesPos = antes && antes.total > 0 ? antes.position : null;
      const hito = hitoEntre(antesPos, yo.position, corte.participantes);

      // Los cortes dependen solo de los partidos, así que la quiniela tiene
      // los mismos, en el mismo orden.
      const enQuinielas = misQuinielas.map(({ q, repaso: rq }) => {
        const miaQ = rq[i].tabla.get(userId);
        const antesQ = i > 0 ? rq[i - 1].tabla.get(userId) : null;
        const antesQPos = antesQ && antesQ.total > 0 ? antesQ.position : null;
        return {
          name: q.name,
          join_code: q.join_code,
          position: miaQ.position,
          tied: empatados(rq[i].tabla, miaQ),
          members: rq[i].participantes,
          change: antesQPos == null ? null : antesQPos - miaQ.position,
          milestone: hitoEntre(antesQPos, miaQ.position, rq[i].participantes),
        };
      });

      // Lo tuyo en ESTA jornada.
      const deLaJornada = mias.filter((pr) => {
        const p = partidoPorId.get(pr.match_id);
        return p && !p.exhibition && alcanceDe(p) === clave && jornadaDe(p).key === corte.jornada.key;
      });
      const perdioPrimero = hito === 'lost_first' || enQuinielas.some((q) => q.milestone === 'lost_first');
      if (deLaJornada.length === 0 && !perdioPrimero) return;

      let graded = 0;
      let correct = 0;
      let points = 0;
      for (const pr of deLaJornada) {
        const p = partidoPorId.get(pr.match_id);
        if (p.gradable_at == null || msDe(p.gradable_at) > corte.at.getTime()) continue;
        graded += 1;
        if (pr.correct) {
          correct += 1;
          points += Number(pr.points) || 0;
        }
      }

      avisos.push({
        key: `round-${clave}-${corte.jornada.key}`,
        type: 'prediction_round',
        at: corte.at,
        url: urlDelCalendario(muestra, { tab: 'ranking' }),
        partido: muestra,
        data: {
          jornada: corte.jornada,
          voted: deLaJornada.length,
          graded,
          correct,
          points,
          total_points: yo.points,
          position: yo.position,
          tied: empatados(corte.tabla, yo),
          participants: corte.participantes,
          change: antesPos == null ? null : antesPos - yo.position,
          milestone: hito,
          pools: enQuinielas,
        },
      });
    });

    // 3. Te falta votar: 24 h antes del primer partido de una jornada que
    //    todavía tiene partidos por empezar sin tu voto. Solo en tus
    //    alcances, que son los calendarios donde ya votaste. Se quita solo
    //    cuando votas todos o cuando ya no queda ninguno por empezar.
    const jornadas = new Map();
    for (const p of oficiales) {
      const j = jornadaDe(p);
      if (!jornadas.has(j.key)) jornadas.set(j.key, { jornada: j, partidos: [] });
      jornadas.get(j.key).partidos.push(p);
    }
    for (const { jornada, partidos: dela } of jornadas.values()) {
      const primero = Math.min(...dela.map((p) => msDe(p.match_date)));
      const at = primero - HORAS_DE_RECORDATORIO * HORA_MS;
      if (Number.isNaN(at) || !enVentana(at)) continue;
      const faltan = dela
        .filter((p) => msDe(p.match_date) > ahoraMs && !miVoto.has(p.id))
        .sort((a, b) => msDe(a.match_date) - msDe(b.match_date));
      if (faltan.length === 0) continue;
      avisos.push({
        key: `vote-${clave}-${jornada.key}`,
        type: 'prediction_reminder',
        at: new Date(at),
        url: urlDelCalendario(faltan[0], jornada.week_label ? { view: 'jornada', sel: jornada.week_label } : {}),
        partido: faltan[0],
        data: { jornada, missing: faltan.length },
      });
    }
  }

  return [...avisos, ...resultados];
}

// Si sigues un partido Y lo predijiste, llega un solo aviso: el de tu
// predicción, que ya trae el marcador. Misma regla que "un aviso por partido"
// de lo que sigues. Trabaja sobre los avisos ya armados para la API.
export function sinMarcadorRepetido(deLoQueSigue, dePredicciones) {
  const predichos = new Set(
    dePredicciones.filter((a) => a.type === 'prediction_result').map((a) => a.match?.id)
  );
  return deLoQueSigue.filter((a) => !(a.type === 'final_score' && predichos.has(a.match?.id)));
}

// Lo nuevo (README, "Lo nuevo y el numerito del balón"). Nunca en el futuro, y
// una de dos:
//   - su hora es posterior a hasta dónde ya viste (`vistoHasta`), o
//   - es un aviso CALCULADO y no estaba en la bandeja la última vez que la
//     abriste (`vistos`, un Set de `key`). Su hora es la de lo que pasó, no la
//     de cuándo empezó a existir: una jornada que se destraba días después
//     nace con la hora de su cierre, y la marca sola la daba por vista.
// Los de organización son filas que nacen a la hora que dicen, así que les
// basta la marca. `vistos` en null: la persona no ha abierto la bandeja desde
// que se guardan, y cuenta solo la marca.
export function esNuevo(aviso, { vistoHasta, vistos = null }, ahora) {
  const t = new Date(aviso.at).getTime();
  if (t > ahora.getTime()) return false;
  if (t > new Date(vistoHasta).getTime()) return true;
  return aviso.origin !== 'organization' && vistos != null && !vistos.has(aviso.key);
}

export function contarNuevos(avisos, marca, ahora) {
  return avisos.filter((a) => esNuevo(a, marca, ahora)).length;
}

// Las dos listas en una, lo más nuevo arriba.
export const LIMITE_DE_BANDEJA = 100;

export function juntarBandeja(listas, limite = LIMITE_DE_BANDEJA) {
  return listas
    .flat()
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, limite);
}
