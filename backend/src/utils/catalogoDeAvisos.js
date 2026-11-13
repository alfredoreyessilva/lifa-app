import { permisoDeAviso } from './bandeja.js';
import { etiquetaDeRol, rolesConPermiso } from './orgRoles.js';

// El catálogo de TODO lo que la app le avisa a alguien: cada tipo de aviso de
// la bandeja ("Mis notificaciones"), su versión de push cuando la tiene, y los
// correos. Lo enseña el Panel Admin, en Notificaciones (README, "Notificaciones:
// todo lo que la app avisa").
//
// Para qué existe: antes de crear un aviso nuevo se busca aquí si ya hay uno
// que lo diga. Alfredo lo pidió así el 2026-11-09, "para evitar repetir o crear
// notificaciones redundantes".
//
// Lo que vive aquí es lo que el código no puede decir solo: de qué tema es,
// cuándo sale dicho en palabras, las reglas que ya evitan que se repita y un
// texto de muestra. Lo demás se lee al armar la respuesta, de donde ya vive:
// quién lo ve, de los permisos (`PERMISO_POR_AVISO` y utils/orgRoles.js); cuántos
// salieron, de la base; si el push y el correo están encendidos, de sus
// interruptores.
//
// Un catálogo escrito a mano se queda viejo en silencio. Por eso
// tests/unit/catalogoDeAvisos.test.mjs lee el código y falla si un tipo que se
// escribe en `notifications`, uno que calcula la bandeja o un correo no está
// aquí; si aquí hay uno que ya nadie manda; o si un pedazo de texto de
// `fuentes` ya no aparece en su archivo. Un aviso nuevo se agrega aquí en el
// mismo commit, o el CI no pasa.
//
// Cada entrada:
//   tipo        el `type` que se guarda o se calcula; en un correo, su función
//   tema        una de TEMAS
//   como        'guardado' (una fila en `notifications`), 'calculado' (se arma
//               al abrir la bandeja) o 'correo'
//   para        a quién: 'liga', 'equipo', 'aficionado' o 'cuenta'
//   canales     'bandeja', 'push', 'correo'
//   quien       a quién, en palabras, cuando no es una organización (en una
//               liga o un equipo, quién lo ve sale de los permisos)
//   cuando      qué lo dispara
//   sinRepetir  las reglas que ya evitan que llegue dos veces o encimado
//   ojo         lo que hay que saber de él y no es una regla
//   muestra     un ejemplo, con la forma en que lo manda la API de la bandeja:
//               los guardados traen su texto; los calculados, los datos con los
//               que el frontend arma el suyo (utils/misNotificaciones.js)
//   variantes   otros textos del mismo tipo
//   push        su versión de push, en pausa (README, "El push, en pausa")
//   fuentes     { archivo: [pedazos de texto que tienen que aparecer ahí] }

export const TEMAS = [
  {
    clave: 'partidos',
    nombre: 'Los partidos que sigues',
    nota: 'A quien sigue un partido, un equipo o una liga, según las casillas del menú de Seguir. Se calculan al abrir la bandeja: no se guardan.',
  },
  {
    clave: 'predicciones',
    nombre: 'Predicciones',
    nota: 'A quien vota quién gana, sin seguir nada. Se calculan al abrir la bandeja: no se guardan.',
  },
  {
    clave: 'captura',
    nombre: 'Marcadores por capturar',
    nota: 'A la liga, para que su tabla no se quede atrás. Los revisa el cron.',
  },
  {
    clave: 'cobranza_liga',
    nombre: 'Cobranza: la liga y sus equipos',
    nota: 'Los dos lados del estado de cuenta entre una liga y un equipo.',
  },
  {
    clave: 'cuotas_club',
    nombre: 'Cuotas del club',
    nota: 'Al equipo, sobre las cuotas de sus jugadores. A la familia no le llega nada de la app: el tesorero le escribe por WhatsApp.',
  },
  {
    clave: 'publicacion',
    nombre: 'La liga en CFBAMX',
    nota: 'Lo que el admin de CFBAMX decide sobre la publicación y la verificación de una liga.',
  },
  {
    clave: 'miembros',
    nombre: 'Quién entra y quién transmite',
    nota: 'Quién se suma al equipo de trabajo de una liga o un equipo, y qué medio se suma a un partido.',
  },
  {
    clave: 'cuenta',
    nombre: 'Correos de la cuenta',
    nota: 'Lo único que sale por correo: un código de seis dígitos que vence en 10 minutos.',
  },
];

// Los datos de las muestras: una liga, dos equipos y un partido que no existen.
const LIGA = 'Liga del Valle';
const EQUIPO = 'Halcones';
const PARTIDO = {
  home_team: 'Halcones',
  away_team: 'Coyotes',
  home_score: null,
  away_score: null,
  match_date: '2026-11-15T00:00:00.000Z',
  timezone: 'America/Mexico_City',
  league_name: LIGA,
};
const JUGADO = { ...PARTIDO, home_score: 21, away_score: 14 };
const SIN_FECHA = { ...PARTIDO, home_team: 'Toros', away_team: 'Linces', match_date: null };
const jornada = (etiqueta) => ({ key: `J:${etiqueta}`, week_label: etiqueta, fecha: null });

const BANDEJA = 'backend/src/utils/bandeja.js';
const CRON = 'backend/src/routes/notifications.js';
const PARTIDOS = 'backend/src/routes/manage.js';
const COBRANZA = 'backend/src/routes/billing.js';
const CUOTAS = 'backend/src/routes/playerBilling.js';
const RECORDATORIOS = 'backend/src/utils/billingReminders.js';
const ADMIN = 'backend/src/routes/admin.js';
const INVITACIONES = 'backend/src/routes/invites.js';
const TRANSMISIONES = 'backend/src/routes/broadcasts.js';
const CORREO = 'backend/src/utils/email.js';

const UNO_POR_PARTIDO = 'Uno por partido, aunque lo sigas directo y además a uno de sus equipos o a su liga.';
const DESDE_QUE_SIGUES = 'Solo de lo que pasó después de que empezaste a seguir, y de los últimos 30 días.';
const VENTANA_DE_BANDEJA = 'export const DIAS_DE_BANDEJA = 30;';

export const CATALOGO_DE_AVISOS = [
  // ── Los partidos que sigues ─────────────────────────────────────────────
  {
    tipo: 'upcoming',
    tema: 'partidos',
    como: 'calculado',
    para: ['aficionado'],
    canales: ['bandeja', 'push'],
    quien: 'Quien sigue el partido',
    casilla: 'notify_upcoming',
    cuando: 'Una hora antes de la hora del partido. Un partido con fecha por definir no lo tiene.',
    sinRepetir: [UNO_POR_PARTIDO, DESDE_QUE_SIGUES],
    muestra: { match: PARTIDO, data: null },
    push: [
      { titulo: '⏰ Próximo — Halcones vs Coyotes', cuerpo: 'El partido empieza en menos de 1 hora.', cuando: 'Lo manda el cron, si pasa dentro de esa hora.' },
    ],
    fuentes: {
      [BANDEJA]: ["type: 'upcoming'", VENTANA_DE_BANDEJA],
      [CRON]: ['⏰ Próximo — ', 'El partido empieza en menos de 1 hora.'],
    },
  },
  {
    tipo: 'live',
    tema: 'partidos',
    como: 'calculado',
    para: ['aficionado'],
    canales: ['bandeja', 'push'],
    quien: 'Quien sigue el partido',
    casilla: 'notify_live',
    cuando: 'A la hora del partido. Sale con la hora, no con el botón «En vivo».',
    sinRepetir: [UNO_POR_PARTIDO, DESDE_QUE_SIGUES],
    muestra: { match: PARTIDO, data: null },
    push: [
      { titulo: '🔴 EN VIVO — Halcones vs Coyotes', cuerpo: 'El partido ya comenzó. ¡No te lo pierdas!', cuando: 'Lo manda el cron, dentro de la ventana del partido.' },
      { titulo: '🔴 EN VIVO — Halcones vs Coyotes', cuerpo: '¡El partido ya comenzó!', cuando: 'Cuando la liga lo marca En vivo antes de que pase el cron.' },
    ],
    fuentes: {
      [BANDEJA]: ["type: 'live'"],
      [CRON]: ['🔴 EN VIVO — ', 'El partido ya comenzó. ¡No te lo pierdas!'],
      [PARTIDOS]: ['🔴 EN VIVO — ', "'¡El partido ya comenzó!'"],
    },
  },
  {
    tipo: 'final_score',
    tema: 'partidos',
    como: 'calculado',
    para: ['aficionado'],
    canales: ['bandeja', 'push'],
    quien: 'Quien sigue el partido',
    casilla: 'notify_final',
    cuando: 'Cuando el partido terminó y tiene marcador: la más tardía entre la hora en que se completó el marcador y la hora en que se marcó Finalizado (o, con estado automático, la ventana de la categoría).',
    sinRepetir: [
      'Si la persona también predijo el partido no sale: lo dice «Tu predicción», que ya trae el marcador.',
      'El marcador parcial que la liga captura durante el partido no lo dispara.',
      UNO_POR_PARTIDO,
    ],
    ojo: ['El push sí sale con el primer marcador completo, aunque sea parcial. Está en la lista de PD-02 para cuando se encienda.'],
    muestra: { match: JUGADO, data: null },
    push: [
      { titulo: '🏆 Marcador final — Halcones vs Coyotes', cuerpo: 'Resultado: Halcones 21 · Coyotes 14.', cuando: 'Cuando el marcador pasa de incompleto a completo.' },
    ],
    fuentes: {
      [BANDEJA]: ["type: 'final_score'"],
      [PARTIDOS]: ['🏆 Marcador final — ', 'Resultado: '],
    },
  },
  {
    tipo: 'schedule_change',
    tema: 'partidos',
    como: 'calculado',
    para: ['aficionado'],
    canales: ['bandeja', 'push'],
    quien: 'Quien sigue el partido',
    casilla: 'notify_changes',
    cuando: 'Al guardar otra fecha, hora o sede en un partido que todavía no se juega; también al ponerle o quitarle la fecha.',
    sinRepetir: [
      'Solo el último cambio de cada partido: los anteriores ya no son verdad.',
      'Dice la fecha y la sede de hoy, no las del momento del cambio.',
      DESDE_QUE_SIGUES,
    ],
    muestra: { match: PARTIDO, data: { date_changed: true, venue_changed: false } },
    variantes: [
      { data: { date_changed: true, venue_changed: true } },
      { data: { date_changed: false, venue_changed: true } },
      { match: { ...PARTIDO, match_date: null }, data: { date_changed: true, venue_changed: false } },
    ],
    push: [
      { titulo: '📅 Cambio de programación — Halcones vs Coyotes', cuerpo: 'Cambió la fecha u hora de este partido.', cuando: 'Al guardar el cambio. Tiene cinco textos, según qué cambió.' },
    ],
    fuentes: {
      [BANDEJA]: ["schedule_change: 'notify_changes'"],
      [PARTIDOS]: ['📅 Cambio de programación — ', 'Cambió la fecha u hora de este partido.'],
    },
  },

  // ── Predicciones ────────────────────────────────────────────────────────
  {
    tipo: 'prediction_result',
    tema: 'predicciones',
    como: 'calculado',
    para: ['aficionado'],
    canales: ['bandeja'],
    quien: 'Quien votó el partido',
    alcance: 'predicciones',
    cuando: 'Por cada partido que votaste, cuando terminó y tiene marcador: la misma hora que reparte los puntos. Los amistosos no.',
    sinRepetir: ['Reemplaza a «Marcador final» para quien sigue el partido y además lo predijo.'],
    ojo: [
      'Si acertaste y una tienda le puso premio al partido, la tarjeta lo trae debajo del marcador (data.prizes): no es un aviso aparte. Solo sale con los premios prendidos (Panel Admin → Premios; README, «Premios por acertar»).',
    ],
    muestra: { match: JUGADO, data: { pick: 'home', correct: true, points: 1, votes: 36, same_pct: 64 } },
    variantes: [
      { data: { pick: 'away', correct: false, points: 0, votes: 36, same_pct: 36 } },
      { data: { pick: 'away', correct: true, points: 2, votes: 36, same_pct: 19 } },
      {
        data: {
          pick: 'home', correct: true, points: 1, votes: 36, same_pct: 64,
          prizes: [{
            id: 27,
            discount_percent: 20,
            valid_days: 30,
            product: { name: 'Jersey oficial', price: 899, currency: 'MXN', image_url: null },
            store: { id: 0, name: 'Deportes Halcón', logo_url: null, is_verified: true },
            code: 'CFB-27-K7M2Q9',
            expires_at: '2026-12-15T06:00:00.000Z',
            redeemed_at: null,
            status: 'valid',
          }],
        },
      },
    ],
    fuentes: { [BANDEJA]: ["type: 'prediction_result'"] },
  },
  {
    tipo: 'prediction_round',
    tema: 'predicciones',
    como: 'calculado',
    para: ['aficionado'],
    canales: ['bandeja'],
    quien: 'Quien votó en la jornada',
    alcance: 'predicciones',
    cuando: 'Al cerrar una jornada en la que votaste: cuando todos sus partidos ya jugados tienen marcador. También a quien le quitaron el 1.º lugar, aunque no haya votado.',
    sinRepetir: [
      'Uno por jornada y calendario: tu lugar en cada quiniela va dentro del mismo aviso, no aparte.',
      'Entrar al top 10, al top 3 o al 1.º es el título del mismo aviso, no uno más.',
    ],
    muestra: {
      match: JUGADO,
      data: {
        jornada: jornada('Jornada 4'), voted: 7, graded: 7, correct: 5, points: 5, total_points: 21,
        position: 4, tied: 0, participants: 36, change: 2, milestone: null,
        pools: [{ name: 'La quiniela de la oficina', position: 2, tied: 0, members: 8, change: 1, milestone: null }],
      },
    },
    variantes: [
      {
        data: {
          jornada: jornada('Jornada 4'), voted: 7, graded: 7, correct: 6, points: 6, total_points: 25,
          position: 3, tied: 0, participants: 36, change: 3, milestone: 'top3', pools: [],
        },
      },
      {
        data: {
          jornada: jornada('Jornada 4'), voted: 0, graded: 0, correct: 0, points: 0, total_points: 30,
          position: 2, tied: 0, participants: 36, change: -1, milestone: 'lost_first', pools: [],
        },
      },
    ],
    fuentes: { [BANDEJA]: ["type: 'prediction_round'"] },
  },
  {
    tipo: 'prediction_reminder',
    tema: 'predicciones',
    como: 'calculado',
    para: ['aficionado'],
    canales: ['bandeja'],
    quien: 'Quien votó en ese calendario',
    alcance: 'predicciones',
    cuando: '24 horas antes del primer partido de una jornada en la que te falta votar algo, en un calendario donde ya votaste.',
    sinRepetir: [
      'Se quita solo cuando votas todos, o cuando ya no queda ninguno por empezar.',
      'No cuenta los partidos que ya anuncia «Partidos nuevos para predecir».',
      'A quien nunca votó en ese calendario no le llega.',
    ],
    muestra: { match: PARTIDO, data: { jornada: jornada('Jornada 5'), missing: 6 } },
    variantes: [{ data: { jornada: jornada('Jornada 5'), missing: 1 } }],
    fuentes: { [BANDEJA]: ["type: 'prediction_reminder'", 'export const HORAS_DE_RECORDATORIO = 24;'] },
  },
  {
    tipo: 'prediction_new_matches',
    tema: 'predicciones',
    como: 'calculado',
    para: ['aficionado'],
    canales: ['bandeja'],
    quien: 'Quien votó en ese calendario',
    alcance: 'predicciones',
    cuando: 'Cuando la liga agrega partidos —o publica borradores— en un calendario donde ya votaste.',
    sinRepetir: [
      'Los partidos que aparecen con menos de 3 horas entre uno y otro son un solo aviso.',
      'Solo los que aparecieron después de tu primer voto en ese calendario.',
      'Cuenta lo que todavía puedes votar, y se quita solo cuando ya no queda nada.',
    ],
    muestra: {
      match: SIN_FECHA,
      data: {
        added: 6,
        missing: 6,
        jornadas: [
          { jornada: jornada('PLAYOFFS'), missing: 4 },
          { jornada: jornada('SEMIFINAL'), missing: 2 },
        ],
      },
    },
    variantes: [{ data: { added: 6, missing: 1, jornadas: [{ jornada: jornada('SEMIFINAL'), missing: 1 }] } }],
    fuentes: { [BANDEJA]: ["type: 'prediction_new_matches'", 'export const HORAS_ENTRE_TANDAS = 3;'] },
  },

  // ── Marcadores por capturar ─────────────────────────────────────────────
  {
    tipo: 'score_reminder',
    tema: 'captura',
    como: 'guardado',
    para: ['liga'],
    canales: ['bandeja'],
    cuando: 'Una hora después del fin del partido —su hora más la ventana de la categoría— si está Finalizado, o con estado automático, y sigue sin marcador.',
    sinRepetir: ['Una sola vez por partido.', 'Solo de los partidos de los últimos 2 días.'],
    muestra: {
      de: LIGA,
      titulo: 'Falta capturar un marcador ⏳',
      cuerpo: 'El partido Halcones vs Coyotes (Jornada 4) terminó hace más de una hora y todavía no tiene marcador. Captúralo para mantener la tabla al día.',
    },
    fuentes: {
      [CRON]: [
        "'score_reminder'",
        'Falta capturar un marcador ⏳',
        'terminó hace más de una hora y todavía no tiene marcador. Captúralo para mantener la tabla al día.',
      ],
    },
  },
  {
    tipo: 'match_not_started',
    tema: 'captura',
    como: 'guardado',
    para: ['liga'],
    canales: ['bandeja'],
    cuando: 'Una hora después del fin del partido si nadie lo tocó: sigue Programado, en una categoría sin estado automático.',
    sinRepetir: [
      'Una sola vez por partido.',
      'Con estado automático no sale: ese partido cae en «Falta capturar un marcador».',
    ],
    muestra: {
      de: LIGA,
      titulo: 'Un partido programado ya pasó 📅',
      cuerpo: 'El partido Halcones vs Coyotes (Jornada 4) estaba programado y ya pasó su fecha, pero nunca se marcó como iniciado ni finalizado. Actualiza su estado, su marcador o su fecha.',
    },
    fuentes: {
      [CRON]: [
        "'match_not_started'",
        'Un partido programado ya pasó 📅',
        'estaba programado y ya pasó su fecha, pero nunca se marcó como iniciado ni finalizado.',
      ],
    },
  },

  // ── Cobranza: la liga y sus equipos ─────────────────────────────────────
  {
    tipo: 'billing_charge_new',
    tema: 'cobranza_liga',
    como: 'guardado',
    para: ['equipo'],
    canales: ['bandeja'],
    cuando: 'Cuando la liga registra un cargo o repite un lote: uno por equipo.',
    sinRepetir: [],
    muestra: {
      de: EQUIPO,
      titulo: 'Nuevo cargo de tu liga 🧾',
      cuerpo: 'Liga del Valle te registró un cargo de $800.00 MXN (Arbitraje Jornada 4). Vence el 15 nov 2026.',
    },
    fuentes: { [COBRANZA]: ["'billing_charge_new'", 'Nuevo cargo de tu liga 🧾', ' te registró un cargo de '] },
  },
  {
    tipo: 'billing_due_soon',
    tema: 'cobranza_liga',
    como: 'guardado',
    para: ['equipo'],
    canales: ['bandeja'],
    cuando: 'Cuando a un cargo abierto le faltan 3 días o menos para vencer, si la liga encendió los recordatorios. Lo revisa el cron una vez al día.',
    sinRepetir: ['Una sola vez por cargo.'],
    muestra: {
      de: EQUIPO,
      titulo: 'Cargo por vencer ⏰',
      cuerpo: 'Tu liga Liga del Valle te registró un cargo de $800.00 MXN (Arbitraje Jornada 4) que vence pronto. Ponte al corriente con la liga.',
    },
    fuentes: {
      [RECORDATORIOS]: [
        "'billing_due_soon'",
        'Cargo por vencer ⏰',
        'que vence pronto. Ponte al corriente con la liga.',
        'const DUE_SOON_DAYS = 3;',
      ],
    },
  },
  {
    tipo: 'billing_overdue',
    tema: 'cobranza_liga',
    como: 'guardado',
    para: ['equipo'],
    canales: ['bandeja'],
    cuando: 'Cuando un cargo abierto ya venció, si la liga encendió los recordatorios: cada 3 días, hasta 4 veces. Lo revisa el cron una vez al día.',
    sinRepetir: ['Máximo 4 por cargo, con 3 días entre uno y otro.'],
    muestra: {
      de: EQUIPO,
      titulo: 'Cargo vencido 🔴',
      cuerpo: 'El cargo de $800.00 MXN (Arbitraje Jornada 4) con tu liga Liga del Valle ya venció. Regulariza tu pago para no acumular adeudo.',
    },
    fuentes: {
      [RECORDATORIOS]: [
        "'billing_overdue'",
        'Cargo vencido 🔴',
        'ya venció. Regulariza tu pago para no acumular adeudo.',
        'const OVERDUE_REPEAT_DAYS = 3;',
        'const OVERDUE_MAX_REMINDERS = 4;',
      ],
    },
  },
  {
    tipo: 'billing_payment_recorded',
    tema: 'cobranza_liga',
    como: 'guardado',
    para: ['equipo'],
    canales: ['bandeja'],
    cuando: 'Tres momentos con el mismo tipo: la liga registra un pago, cancela un cargo, o confirma un pago que reportó el equipo.',
    sinRepetir: [],
    ojo: ['Cancelar un cargo también sale con la etiqueta «Pago registrado» (PD-47).'],
    muestra: {
      de: EQUIPO,
      titulo: 'Tu liga registró un pago ✅',
      cuerpo: 'Liga del Valle registró un pago de $800.00 MXN a tu cuenta. Saldo actual: $0.00 MXN.',
    },
    variantes: [
      { titulo: 'Tu liga canceló un cargo ✅', cuerpo: 'Liga del Valle canceló el cargo de $800.00 MXN (Arbitraje Jornada 4). Saldo actual: $0.00 MXN.' },
      { titulo: 'Tu liga confirmó tu pago ✅', cuerpo: 'Liga del Valle confirmó el pago de $800.00 MXN que reportaste. Saldo actual: $0.00 MXN.' },
    ],
    fuentes: {
      [COBRANZA]: [
        "'billing_payment_recorded'",
        'Tu liga registró un pago ✅',
        'Tu liga canceló un cargo ✅',
        'Tu liga confirmó tu pago ✅',
      ],
    },
  },
  {
    tipo: 'billing_payment_rejected',
    tema: 'cobranza_liga',
    como: 'guardado',
    para: ['equipo'],
    canales: ['bandeja'],
    cuando: 'Cuando la liga rechaza un pago que el equipo le reportó.',
    sinRepetir: [],
    muestra: {
      de: EQUIPO,
      titulo: 'Tu liga no pudo confirmar tu pago ⚠️',
      cuerpo: 'Liga del Valle rechazó el pago de $800.00 MXN que reportaste (no llegó la transferencia). Revisa tu estado de cuenta y vuelve a reportarlo.',
    },
    fuentes: {
      [COBRANZA]: [
        "'billing_payment_rejected'",
        'Tu liga no pudo confirmar tu pago ⚠️',
        'Revisa tu estado de cuenta y vuelve a reportarlo.',
      ],
    },
  },
  {
    tipo: 'team_payment_reported',
    tema: 'cobranza_liga',
    como: 'guardado',
    para: ['liga'],
    canales: ['bandeja'],
    cuando: 'Cuando un equipo le reporta un pago a su liga desde su estado de cuenta.',
    sinRepetir: [],
    ojo: ['Tiene el mismo título que el pago reportado de las cuotas del club, pero le llega a la liga, no al equipo.'],
    muestra: {
      de: LIGA,
      titulo: 'Un pago espera tu confirmación 🧾',
      cuerpo: 'Halcones reportó un pago de $800.00 MXN (transferencia). Revísalo en Cobranza para que se aplique a su estado de cuenta.',
    },
    fuentes: {
      [COBRANZA]: [
        "'team_payment_reported'",
        'Un pago espera tu confirmación 🧾',
        'Revísalo en Cobranza para que se aplique a su estado de cuenta.',
      ],
    },
  },

  // ── Cuotas del club ─────────────────────────────────────────────────────
  {
    tipo: 'player_payment_reported',
    tema: 'cuotas_club',
    como: 'guardado',
    para: ['equipo'],
    canales: ['bandeja'],
    cuando: 'Cuando la familia de un jugador reporta un pago desde su estado de cuenta (el link que no pide cuenta).',
    sinRepetir: [],
    muestra: {
      de: EQUIPO,
      titulo: 'Un pago espera tu confirmación 🧾',
      cuerpo: 'Juan Pérez reportó un pago de $600.00 MXN (transferencia). Revísalo en Finanzas para que se aplique a su estado de cuenta.',
    },
    fuentes: {
      [CUOTAS]: [
        "'player_payment_reported'",
        'Un pago espera tu confirmación 🧾',
        'Revísalo en Finanzas para que se aplique a su estado de cuenta.',
      ],
    },
  },
  {
    tipo: 'player_billing_due_soon',
    tema: 'cuotas_club',
    como: 'guardado',
    para: ['equipo'],
    canales: ['bandeja'],
    cuando: 'Cuando a una cuota abierta le faltan 3 días o menos para vencer, si el equipo encendió los recordatorios. Lo revisa el cron una vez al día.',
    sinRepetir: [
      'Llega junto: uno por equipo y corrida, no uno por jugador.',
      'Una sola vez por cuota.',
    ],
    muestra: {
      de: EQUIPO,
      titulo: 'Cuotas por vencer ⏰',
      cuerpo: '3 jugadores tienen cuotas que vencen pronto, $1,800.00 MXN en total. Mándales el recordatorio desde Finanzas.',
    },
    fuentes: {
      [RECORDATORIOS]: ["'player_billing_due_soon'", 'Cuotas por vencer ⏰', 'Mándales el recordatorio desde Finanzas.'],
    },
  },
  {
    tipo: 'player_billing_overdue',
    tema: 'cuotas_club',
    como: 'guardado',
    para: ['equipo'],
    canales: ['bandeja'],
    cuando: 'Cuando una cuota abierta ya venció, si el equipo encendió los recordatorios: cada 3 días, hasta 4 veces por cuota.',
    sinRepetir: [
      'Llega junto: uno por equipo y corrida, no uno por jugador.',
      'Máximo 4 por cuota, con 3 días entre uno y otro.',
    ],
    muestra: {
      de: EQUIPO,
      titulo: 'Cuotas vencidas 🔴',
      cuerpo: '3 jugadores tienen cuotas vencidas, $1,800.00 MXN en total. Revisa quiénes en Finanzas.',
    },
    fuentes: {
      [RECORDATORIOS]: ["'player_billing_overdue'", 'Cuotas vencidas 🔴', 'Revisa quiénes en Finanzas.'],
    },
  },

  // ── La liga en CFBAMX ───────────────────────────────────────────────────
  {
    tipo: 'league_approved',
    tema: 'publicacion',
    como: 'guardado',
    para: ['liga'],
    canales: ['bandeja'],
    cuando: 'Cuando el admin de CFBAMX publica la liga.',
    sinRepetir: [],
    ojo: ['A un medio o a una tienda no se le avisa cuando se publica: la bandeja solo recibe avisos de ligas y equipos.'],
    muestra: {
      de: LIGA,
      titulo: '¡Tu liga ha sido aprobada y publicada! 🎉',
      cuerpo: 'La liga Liga del Valle ya está visible para el público en general en el directorio de ligas.',
    },
    fuentes: {
      [ADMIN]: [
        "'league_approved'",
        '¡Tu liga ha sido aprobada y publicada! 🎉',
        'ya está visible para el público en general en el directorio de ligas.',
      ],
    },
  },
  {
    tipo: 'league_unapproved',
    tema: 'publicacion',
    como: 'guardado',
    para: ['liga'],
    canales: ['bandeja'],
    cuando: 'Cuando el admin de CFBAMX oculta una liga que ya era pública. El texto es el motivo que escriba, o uno por defecto.',
    sinRepetir: [],
    muestra: {
      de: LIGA,
      titulo: 'Estado de publicación de liga actualizado',
      cuerpo: 'Tu liga ha sido ocultada del sitio público por el equipo de administración.',
    },
    fuentes: {
      [ADMIN]: [
        "'league_unapproved'",
        'Estado de publicación de liga actualizado',
        'Tu liga ha sido ocultada del sitio público por el equipo de administración.',
      ],
    },
  },
  {
    tipo: 'league_publish_declined',
    tema: 'publicacion',
    como: 'guardado',
    para: ['liga'],
    canales: ['bandeja'],
    cuando: 'Cuando el admin de CFBAMX rechaza una solicitud de publicación. El motivo es obligatorio y va en el aviso.',
    sinRepetir: [],
    muestra: {
      de: LIGA,
      titulo: 'Tu solicitud de publicación no fue aprobada todavía',
      cuerpo: 'Falta el logo de la liga y al menos un torneo con partidos.\n\nCuando lo tengas listo, vuelve a solicitar la publicación desde tu panel.',
    },
    fuentes: {
      [ADMIN]: [
        "'league_publish_declined'",
        'Tu solicitud de publicación no fue aprobada todavía',
        'Cuando lo tengas listo, vuelve a solicitar la publicación desde tu panel.',
      ],
    },
  },
  {
    tipo: 'league_verified',
    tema: 'publicacion',
    como: 'guardado',
    para: ['liga'],
    canales: ['bandeja'],
    cuando: 'Cuando el admin de CFBAMX verifica la liga.',
    sinRepetir: [],
    ojo: ['A un medio o a una tienda no se le avisa cuando se verifica: la bandeja solo recibe avisos de ligas y equipos.'],
    muestra: {
      de: LIGA,
      titulo: '¡Tu liga ha sido verificada oficialmente! ⭐',
      cuerpo: 'La liga Liga del Valle cuenta ahora con el distintivo oficial de verificación.',
    },
    fuentes: {
      [ADMIN]: [
        "'league_verified'",
        '¡Tu liga ha sido verificada oficialmente! ⭐',
        'cuenta ahora con el distintivo oficial de verificación.',
      ],
    },
  },
  {
    tipo: 'league_unverified',
    tema: 'publicacion',
    como: 'guardado',
    para: ['liga'],
    canales: ['bandeja'],
    cuando: 'Cuando el admin de CFBAMX le quita la verificación. El texto es el motivo que escriba, o uno por defecto.',
    sinRepetir: [],
    muestra: {
      de: LIGA,
      titulo: 'Insignia de verificación retirada ⚠️',
      cuerpo: 'La insignia de verificación de la liga Liga del Valle ha sido retirada por el equipo de administración.',
    },
    fuentes: {
      [ADMIN]: [
        "'league_unverified'",
        'Insignia de verificación retirada ⚠️',
        'ha sido retirada por el equipo de administración.',
      ],
    },
  },

  // ── Quién entra y quién transmite ───────────────────────────────────────
  {
    tipo: 'team_claimed',
    tema: 'miembros',
    como: 'guardado',
    para: ['liga'],
    canales: ['bandeja'],
    cuando: 'Cuando un equipo abre el link de entrega que le mandó su liga y se queda con su perfil.',
    sinRepetir: ['Una sola vez por equipo: la entrega no se repite.'],
    ojo: ['No trae botón: no lleva a ninguna pantalla.'],
    muestra: {
      de: LIGA,
      titulo: 'Halcones tomó control de su perfil',
      cuerpo: 'El equipo ya inició sesión con el link que le compartiste y ahora administra su propia información.',
      boton: false,
    },
    fuentes: {
      [INVITACIONES]: [
        "'team_claimed'",
        ' tomó control de su perfil',
        'El equipo ya inició sesión con el link que le compartiste y ahora administra su propia información.',
      ],
    },
  },
  {
    tipo: 'org_admin_claimed',
    tema: 'miembros',
    como: 'guardado',
    para: ['liga', 'equipo'],
    canales: ['bandeja'],
    cuando: 'Cuando alguien acepta una invitación con rol a una liga o a un equipo.',
    sinRepetir: [],
    ojo: [
      'Si la invitación es a un medio o a una tienda, no le llega a nadie: la bandeja solo recibe avisos de ligas y equipos.',
      'No trae botón: no lleva a ninguna pantalla.',
    ],
    muestra: {
      de: LIGA,
      titulo: 'Ana López entró a Liga del Valle',
      cuerpo: 'Aceptó la invitación y entró como Tesorero de liga.',
      boton: false,
    },
    fuentes: { [INVITACIONES]: ["'org_admin_claimed'", ' entró a ', 'Aceptó la invitación y entró como '] },
  },
  {
    tipo: 'broadcast_added',
    tema: 'miembros',
    como: 'guardado',
    para: ['liga'],
    canales: ['bandeja'],
    cuando: 'La primera vez que un medio se suma a transmitir un partido de la liga.',
    sinRepetir: ['Una sola vez por medio y partido: poner o cambiar el link después no vuelve a avisar.'],
    ojo: ['A quien sigue el partido no le llega: está entre las ideas de «Fuera de esta versión» de Notificaciones.'],
    muestra: {
      de: LIGA,
      titulo: 'Nuevo medio transmitiendo tu partido 🎥',
      cuerpo: 'El medio "Transmisiones del Valle" se sumó a transmitir el partido Halcones vs Coyotes.',
    },
    fuentes: {
      [TRANSMISIONES]: ["'broadcast_added'", 'Nuevo medio transmitiendo tu partido 🎥', 'se sumó a transmitir el partido'],
    },
  },

  // ── Correos de la cuenta ────────────────────────────────────────────────
  {
    tipo: 'sendVerificationEmail',
    tema: 'cuenta',
    como: 'correo',
    para: ['cuenta'],
    canales: ['correo'],
    etiqueta: 'Código de verificación',
    icono: '✉️',
    quien: 'Quien se registra',
    tabla: 'email_verification_codes',
    cuando: 'Al registrarse con correo y contraseña, y cada vez que se pide otro código. Con el correo apagado no se pide: la cuenta se crea sin él.',
    sinRepetir: ['Cada código nuevo deja sin valor al anterior.'],
    muestra: {
      asunto: '482915 es tu código de verificación',
      saludo: 'Hola Ana 👋',
      linea: 'Usa este código para confirmar tu correo:',
      codigo: '482915',
      letraChica: 'Este código vence en 10 minutos. Si tú no pediste esto, puedes ignorar este correo.',
    },
    fuentes: {
      [CORREO]: [
        'export async function sendVerificationEmail(',
        'es tu código de verificación',
        'Usa este código para confirmar tu correo:',
        'Este código vence en 10 minutos. Si tú no pediste esto, puedes ignorar este correo.',
      ],
    },
  },
  {
    tipo: 'sendPasswordResetEmail',
    tema: 'cuenta',
    como: 'correo',
    para: ['cuenta'],
    canales: ['correo'],
    etiqueta: 'Cambiar la contraseña',
    icono: '🔑',
    quien: 'Quien pidió cambiar su contraseña',
    tabla: 'password_reset_codes',
    cuando: 'Cuando alguien pide cambiar su contraseña desde «¿Olvidaste tu contraseña?». Con el correo apagado, esa pantalla contesta que por ahora no se puede.',
    sinRepetir: ['Hasta 5 códigos por hora y por cuenta.'],
    muestra: {
      asunto: '482915 es tu código para cambiar tu contraseña',
      saludo: 'Hola Ana 👋',
      linea: 'Usa este código para elegir una contraseña nueva en CFBAMX:',
      codigo: '482915',
      letraChica: 'Este código vence en 10 minutos. Si tú no lo pediste, ignora este correo: tu contraseña no cambia. Al cambiarla se cierra tu sesión en los demás aparatos donde la tengas abierta.',
    },
    fuentes: {
      [CORREO]: [
        'export async function sendPasswordResetEmail(',
        'es tu código para cambiar tu contraseña',
        'Usa este código para elegir una contraseña nueva en CFBAMX:',
      ],
      'backend/src/routes/auth.js': ['const MAX_RESET_CODES_PER_HOUR = 5;'],
    },
  },
];

// ── Lo que se calcula al armar la respuesta ───────────────────────────────

const TIPO_DE_ORG = { liga: 'league', equipo: 'team' };

// Quién lo ve dentro de la organización que lo recibe: los roles con el permiso
// de su tema, el mismo cálculo con que la bandeja decide qué enseñarle a cada
// quien (utils/bandeja.js). Así la pantalla no puede decir otra cosa que la app.
export function quienLoVe(aviso) {
  const lo = {};
  for (const destino of aviso.para) {
    const tipo = TIPO_DE_ORG[destino];
    if (!tipo) continue;
    lo[destino] = rolesConPermiso(tipo, permisoDeAviso(aviso.tipo)).map((rol) => etiquetaDeRol(rol, tipo));
  }
  return lo;
}

// Los conteos llegan de `COUNT(...)::int`; un tipo que nunca salió no trae fila,
// y eso también es un dato: cero, no "sin datos".
function conteo(fila) {
  return {
    total: Number(fila?.total) || 0,
    ultimos_30: Number(fila?.ultimos_30) || 0,
    destinatarios_30: Number(fila?.destinatarios_30) || 0,
    ultimo: fila?.ultimo ? new Date(fila.ultimo).toISOString() : null,
  };
}

/**
 * El catálogo como lo enseña el Panel Admin.
 *
 * @param {object} p
 * @param {Array}  p.envios      filas `{ tipo, total, ultimos_30, destinatarios_30, ultimo }` de `notifications`
 * @param {object} p.codigos     `{ [tabla]: fila }`, lo mismo para las tablas de códigos de los correos
 * @param {object} p.seguidores  `{ notify_upcoming: n, ... }`: personas que siguen algo con esa casilla
 * @param {number} p.predicen    personas con un voto en un calendario que la bandeja todavía repasa
 * @param {object} p.canales     `{ push, correo }`: si están encendidos en este servidor
 */
export function armarCatalogo({ envios = [], codigos = {}, seguidores = {}, predicen = 0, canales = {} } = {}) {
  const porTipo = new Map(envios.map((fila) => [fila.tipo, fila]));

  const avisos = CATALOGO_DE_AVISOS.map(({ fuentes, ...aviso }) => {
    let enviados = null;
    if (aviso.como === 'guardado') enviados = conteo(porTipo.get(aviso.tipo));
    if (aviso.como === 'correo') enviados = conteo(codigos[aviso.tabla]);

    let alcance = null;
    if (aviso.casilla) alcance = Number(seguidores[aviso.casilla]) || 0;
    if (aviso.alcance === 'predicciones') alcance = Number(predicen) || 0;

    return {
      ...aviso,
      archivos: Object.keys(fuentes),
      lo_ven: aviso.como === 'guardado' ? quienLoVe(aviso) : null,
      envios: enviados,
      alcance,
    };
  });

  // Lo que está en la base y no en el catálogo: un aviso que alguien agregó sin
  // pasar por aquí, o uno que ya no se manda y dejó filas. La prueba unitaria
  // atrapa el primero en el código; esto lo atrapa en los datos.
  const conocidos = new Set(CATALOGO_DE_AVISOS.map((aviso) => aviso.tipo));
  const desconocidos = envios
    .filter((fila) => !conocidos.has(fila.tipo))
    .map((fila) => ({ tipo: fila.tipo, ...conteo(fila) }));

  return {
    canales: { bandeja: true, push: Boolean(canales.push), correo: Boolean(canales.correo) },
    temas: TEMAS,
    avisos,
    desconocidos,
  };
}
