import express from 'express';
import webpush from 'web-push';
import jwt from 'jsonwebtoken';
import db from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { runBillingReminders, runPlayerBillingReminders } from '../utils/billingReminders.js';
import { runMonthlyChargeGeneration } from '../utils/monthlyCharges.js';
import { runOncePerDay, registrarLlamada, podarBitacora } from '../utils/cronSchedule.js';
import { pushEncendido } from '../utils/pushNotifier.js';
import {
  filtrosDeBandeja, avisosDeSeguimiento, contarNuevos, juntarBandeja, esNuevo,
  DIAS_DE_BANDEJA, LIMITE_DE_BANDEJA,
} from '../utils/bandeja.js';

const router = express.Router();

const NOTIFY_WINDOW_MS = 60 * 60 * 1000;
const LIVE_WINDOW_MS   = 3  * 60 * 60 * 1000;

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return;
  const email  = process.env.VAPID_EMAIL;
  const pubKey = process.env.VAPID_PUBLIC_KEY;
  const prvKey = process.env.VAPID_PRIVATE_KEY;
  if (!email || !pubKey || !prvKey) throw new Error('Faltan variables VAPID en .env');
  const subject = email.startsWith('mailto:') ? email : `mailto:${email}`;
  webpush.setVapidDetails(subject, pubKey, prvKey);
  vapidConfigured = true;
}

// Envía las notificaciones en paralelo para que el cronjob no tarde
async function sendToSubs(subs, payload) {
  const validSubs = subs.filter((sub) => sub.endpoint && sub.p256dh && sub.auth);
  if (validSubs.length === 0) return 0;

  const results = await Promise.allSettled(
    validSubs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      )
    )
  );

  let errors = 0;
  const expiredEndpoints = [];

  results.forEach((result, idx) => {
    if (result.status === 'rejected') {
      errors++;
      if (result.reason?.statusCode === 410) {
        expiredEndpoints.push(validSubs[idx].endpoint);
      }
    }
  });

  if (expiredEndpoints.length > 0) {
    await Promise.allSettled(
      expiredEndpoints.map((endpoint) =>
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint)
      )
    );
  }

  return errors;
}

// Clave pública VAPID
router.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

// Si el push está encendido. Público: el botón de "Seguir" lo pregunta antes de
// ofrecer el canal. Ver pushEncendido() en utils/pushNotifier.js.
router.get('/push-status', (req, res) => {
  res.json({ enabled: pushEncendido() });
});

// Suscribirse o actualizar preferencias — acepta opciones granulares
// y permite guardar seguimiento en bandeja (in-app) sin requerir push de navegador.
router.post('/subscribe', authRequired, asyncHandler(async (req, res) => {
  const { subscription, preferences, league_id, match_id, team_name } = req.body;
  if (!league_id && !match_id && !team_name) {
    return res.status(400).json({ error: 'Debes indicar una liga, partido o equipo' });
  }

  // Con el push en pausa se guarda el seguimiento, pero ningún dispositivo: ni
  // la bandera ni el endpoint. Y la bandeja queda siempre encendida, porque
  // sin push es el único canal — un seguimiento sin ninguno no avisaría nada.
  const conPush = pushEncendido();
  const dispositivo = conPush && subscription?.endpoint ? subscription : null;
  const inApp = !conPush || (preferences?.in_app !== undefined ? Boolean(preferences.in_app) : true);
  const pushEnabled = Boolean(dispositivo && preferences?.push_enabled);
  const notifyUpcoming = preferences?.notify_upcoming !== undefined ? Boolean(preferences.notify_upcoming) : true;
  const notifyLive = preferences?.notify_live !== undefined ? Boolean(preferences.notify_live) : true;
  const notifyFinal = preferences?.notify_final !== undefined ? Boolean(preferences.notify_final) : true;
  const notifyChanges = preferences?.notify_changes !== undefined ? Boolean(preferences.notify_changes) : true;

  // Un seguimiento por usuario y por cosa seguida (índice `idx_push_user_sub`):
  // si ya existía, se actualiza en su lugar. Antes se borraba y se volvía a
  // insertar, y eso reiniciaba `created_at` — que es "desde cuándo lo sigues",
  // y la bandeja no enseña lo que pasó antes de esa fecha (utils/bandeja.js).
  // Ajustar las casillas habría borrado los avisos anteriores.
  await db.prepare(`
    INSERT INTO push_subscriptions (
      endpoint, p256dh, auth, league_id, match_id, team_name, user_id,
      in_app, push_enabled, notify_upcoming, notify_live, notify_final, notify_changes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, (COALESCE(league_id, 0)), (COALESCE(match_id, 0)), (COALESCE(team_name, '')))
      WHERE user_id IS NOT NULL
    DO UPDATE SET
      endpoint        = EXCLUDED.endpoint,
      p256dh          = EXCLUDED.p256dh,
      auth            = EXCLUDED.auth,
      in_app          = EXCLUDED.in_app,
      push_enabled    = EXCLUDED.push_enabled,
      notify_upcoming = EXCLUDED.notify_upcoming,
      notify_live     = EXCLUDED.notify_live,
      notify_final    = EXCLUDED.notify_final,
      notify_changes  = EXCLUDED.notify_changes
  `).run(
    dispositivo?.endpoint || null,
    dispositivo?.keys?.p256dh || null,
    dispositivo?.keys?.auth || null,
    league_id  || null,
    match_id   || null,
    team_name  || null,
    req.user.id,
    inApp,
    pushEnabled,
    notifyUpcoming,
    notifyLive,
    notifyFinal,
    notifyChanges
  );

  res.status(201).json({
    ok: true,
    preferences: {
      in_app: inApp,
      push_enabled: pushEnabled,
      notify_upcoming: notifyUpcoming,
      notify_live: notifyLive,
      notify_final: notifyFinal,
      notify_changes: notifyChanges,
    }
  });
}));

// Verificar si ya está suscrito y devolver preferencias actuales
router.post('/check', asyncHandler(async (req, res) => {
  const { endpoint, league_id, match_id, team_name } = req.body;

  let userId = null;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
      userId = decoded.id;
    } catch {}
  }

  let sub = null;
  if (userId) {
    sub = await db.prepare(`
      SELECT * FROM push_subscriptions
      WHERE user_id = ?
        AND league_id IS NOT DISTINCT FROM ?
        AND match_id  IS NOT DISTINCT FROM ?
        AND team_name IS NOT DISTINCT FROM ?
    `).get(userId, league_id || null, match_id || null, team_name || null);
  }

  if (!sub && endpoint) {
    sub = await db.prepare(`
      SELECT * FROM push_subscriptions
      WHERE endpoint = ?
        AND league_id IS NOT DISTINCT FROM ?
        AND match_id  IS NOT DISTINCT FROM ?
        AND team_name IS NOT DISTINCT FROM ?
    `).get(endpoint, league_id || null, match_id || null, team_name || null);
  }

  res.json({
    subscribed: !!sub,
    preferences: sub ? {
      in_app: sub.in_app !== false,
      push_enabled: Boolean(sub.push_enabled),
      notify_upcoming: sub.notify_upcoming !== false,
      notify_live: sub.notify_live !== false,
      notify_final: sub.notify_final !== false,
      notify_changes: sub.notify_changes !== false,
    } : null
  });
}));

// Cancelar suscripción general
router.post('/unsubscribe', asyncHandler(async (req, res) => {
  const { subscription, league_id, match_id, team_name } = req.body;

  let userId = null;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
      userId = decoded.id;
    } catch {}
  }

  if (userId) {
    await db.prepare(`
      DELETE FROM push_subscriptions
      WHERE user_id = ?
        AND league_id IS NOT DISTINCT FROM ?
        AND match_id  IS NOT DISTINCT FROM ?
        AND team_name IS NOT DISTINCT FROM ?
    `).run(userId, league_id || null, match_id || null, team_name || null);
  }

  if (subscription?.endpoint) {
    await db.prepare(`
      DELETE FROM push_subscriptions
      WHERE endpoint = ?
        AND league_id IS NOT DISTINCT FROM ?
        AND match_id  IS NOT DISTINCT FROM ?
        AND team_name IS NOT DISTINCT FROM ?
    `).run(subscription.endpoint, league_id || null, match_id || null, team_name || null);
  }

  res.json({ ok: true });
}));

// Dejar de seguir un partido puntual. Lo usa "Mi cartelera"; solo borra el
// seguimiento de ESE partido — uno que está ahí porque sigues a su equipo se
// deja desde la página del equipo.
router.post('/unfollow-match', authRequired, asyncHandler(async (req, res) => {
  const { match_id } = req.body;
  if (!match_id) return res.status(400).json({ error: 'match_id requerido' });

  await db.prepare(`
    DELETE FROM push_subscriptions
    WHERE user_id = ? AND match_id = ?
  `).run(req.user.id, match_id);

  res.json({ ok: true });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Bloque de ALTA frecuencia: todo lo que depende de la hora de un partido.
//
// Vive en su propia función, y no en línea dentro del handler, por dos motivos
// que en realidad son uno solo — es la mitad del cron que necesita correr cada
// pocos minutos, y es la mitad que puede fallar sin que eso le cueste nada a
// la otra.
//
// Antes estaba todo en el mismo handler, así que cualquier error aquí impedía
// que corrieran la cobranza y la generación de mensualidades. El caso más
// claro era la primera línea: `ensureVapid()` LANZA si faltan las variables
// VAPID, y estaba antes de todo, de modo que una configuración de push
// incompleta bastaba para que el club dejara de facturar — dos cosas que no
// tienen absolutamente nada que ver entre sí.
// ─────────────────────────────────────────────────────────────────────────────
async function faseDePartidos() {
  // El push de "próximo" y "en vivo" está en pausa (README, "El push, en
  // pausa"). La bandeja no lo necesita: esos dos avisos los calcula al leer,
  // con la hora del partido (utils/bandeja.js).
  if (pushEncendido()) {
    await pushDePartidosProximos();
  }
  await recordatoriosDeCaptura();
}

// Push a los seguidores de los partidos que están por empezar o empezaron.
// Antes de encenderlo, ver PD-02 en docs/PENDIENTES.md: aquí se manda antes de
// marcar, y la marca no se reinicia si cambia la fecha.
async function pushDePartidosProximos() {
  ensureVapid();

  const now = Date.now();

  const matches = await db.prepare(`
    SELECT m.*, c.league_id,
           l.name as league_name, l.slug as league_slug
    FROM matches m
    JOIN categories c ON c.id = m.category_id
    JOIN leagues l    ON l.id = c.league_id
    WHERE m.match_date IS NOT NULL
      AND m.is_draft = FALSE
      AND m.home_score IS NULL
      AND m.away_score IS NULL
      AND (m.notified_upcoming = FALSE OR m.notified_live = FALSE)
      AND m.match_date::timestamptz BETWEEN (NOW() - INTERVAL '3 hours') AND (NOW() + INTERVAL '1 hour')
  `).all();

  for (const match of matches) {
    const matchTime = new Date(match.match_date).getTime();
    const endTime   = matchTime + LIVE_WINDOW_MS;
    const timeUntil = matchTime - now;

    const isUpcoming = timeUntil > 0 && timeUntil <= NOTIFY_WINDOW_MS && !match.notified_upcoming;
    const isLive     = now >= matchTime && now < endTime && !match.notified_live;

    if (!isUpcoming && !isLive) continue;

    const title = isLive
      ? `🔴 EN VIVO — ${match.home_team} vs ${match.away_team}`
      : `⏰ Próximo — ${match.home_team} vs ${match.away_team}`;

    const body = isLive
      ? 'El partido ya comenzó. ¡No te lo pierdas!'
      : 'El partido empieza en menos de 1 hora.';

    const payload = {
      title,
      body,
      url:  `/categorias/${match.category_id}/calendario`,
      icon: '/favicon.svg',
    };

    // Filtramos suscriptores con push habilitado y preferencia coincidente
    const prefCol = isLive ? 'notify_live' : 'notify_upcoming';

    const leagueSubs = await db.prepare(`
      SELECT * FROM push_subscriptions
      WHERE league_id = ? AND match_id IS NULL AND team_name IS NULL
        AND endpoint IS NOT NULL
        AND (push_enabled = TRUE OR push_enabled IS NULL)
        AND (${prefCol} = TRUE OR ${prefCol} IS NULL)
    `).all(match.league_id);

    const matchSubs = await db.prepare(`
      SELECT * FROM push_subscriptions
      WHERE match_id = ? AND team_name IS NULL
        AND endpoint IS NOT NULL
        AND (push_enabled = TRUE OR push_enabled IS NULL)
        AND (${prefCol} = TRUE OR ${prefCol} IS NULL)
    `).all(match.id);

    const teamSubs = await db.prepare(`
      SELECT * FROM push_subscriptions
      WHERE team_name IN (?, ?) AND match_id IS NULL AND (league_id = ? OR league_id IS NULL)
        AND endpoint IS NOT NULL
        AND (push_enabled = TRUE OR push_enabled IS NULL)
        AND (${prefCol} = TRUE OR ${prefCol} IS NULL)
    `).all(match.home_team, match.away_team, match.league_id);

    const allSubs = [...leagueSubs, ...matchSubs, ...teamSubs].filter(
      (sub, idx, arr) => arr.findIndex((s) => s.endpoint === sub.endpoint) === idx
    );

    if (allSubs.length > 0) {
      await sendToSubs(allSubs, payload);
    }

    const notifiedColumn = isLive ? 'notified_live' : 'notified_upcoming';
    await db.prepare(`UPDATE matches SET ${notifiedColumn} = TRUE WHERE id = ?`).run(match.id);
  }
}

async function recordatoriosDeCaptura() {
  // ─────────────────────────────────────────────────────────────────────────
  // Recordatorios de captura a la BANDEJA de la liga (in-app, sin push a nadie).
  // Van a la tabla `notifications` (recipient_type='league'), igual que los
  // avisos de admin. Se quedan en el bloque frecuente, y no en el diario,
  // porque cuelgan de la hora de un partido igual que los avisos de arriba:
  // su disparo es "una hora después del fin nominal", no "una vez al día".
  //
  // Son de una sola vez: al enviarlos se marca la bandera correspondiente y
  // el cron ya no vuelve a mirar ese partido.
  //
  // El fin nominal de un partido se calcula como match_date + ventana de la
  // categoría (auto_status_window_hours, 3h por defecto). El recordatorio
  // entra 1h después de ese fin nominal. Solo se miran partidos de los
  // últimos 2 días para no reprocesar todo el histórico ni escanear la
  // tabla completa en cada corrida.
  // ─────────────────────────────────────────────────────────────────────────

  const NOMINAL_END = `
    m.match_date::timestamptz
    + (COALESCE(c.auto_status_window_hours, 3) || ' hours')::interval
    + INTERVAL '1 hour'
  `;

  // (1) Partido FINALIZADO (a mano o por auto-status) que sigue sin marcador.
  const missingScore = await db.prepare(`
    SELECT m.id, m.home_team, m.away_team, m.week_label, c.league_id
    FROM matches m
    JOIN categories c ON c.id = m.category_id
    WHERE m.is_draft = FALSE
      AND m.reminded_missing_score = FALSE
      AND (m.home_score IS NULL OR m.away_score IS NULL)
      AND m.match_date::timestamptz > NOW() - INTERVAL '2 days'
      AND NOW() > ${NOMINAL_END}
      AND (
        m.status = 'finished'
        OR (COALESCE(c.auto_status_enabled, FALSE) = TRUE AND m.status = 'scheduled')
      )
  `).all();

  for (const match of missingScore) {
    const jornada = match.week_label ? ` (${match.week_label})` : '';
    await db.prepare(`
      INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
      VALUES ('league', ?, 'score_reminder', ?, ?, ?)
    `).run(
      match.league_id,
      'Falta capturar un marcador ⏳',
      `El partido ${match.home_team} vs ${match.away_team}${jornada} terminó hace más de una hora y todavía no tiene marcador. Captúralo para mantener la tabla al día.`,
      JSON.stringify({ match_id: match.id, league_id: match.league_id, url: `/partidos/${match.id}` })
    );
    await db.prepare('UPDATE matches SET reminded_missing_score = TRUE WHERE id = ?').run(match.id);
  }

  // (2) Partido PROGRAMADO cuya fecha ya pasó y nunca se tocó (ni inicio ni
  //     final). Solo aplica a categorías SIN auto-status — si tuvieran
  //     auto-status, el partido ya contaría como finalizado y caería en (1).
  const notStarted = await db.prepare(`
    SELECT m.id, m.home_team, m.away_team, m.week_label, c.league_id
    FROM matches m
    JOIN categories c ON c.id = m.category_id
    WHERE m.is_draft = FALSE
      AND m.reminded_not_started = FALSE
      AND m.status = 'scheduled'
      AND COALESCE(c.auto_status_enabled, FALSE) = FALSE
      AND m.match_date::timestamptz > NOW() - INTERVAL '2 days'
      AND NOW() > ${NOMINAL_END}
  `).all();

  for (const match of notStarted) {
    const jornada = match.week_label ? ` (${match.week_label})` : '';
    await db.prepare(`
      INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
      VALUES ('league', ?, 'match_not_started', ?, ?, ?)
    `).run(
      match.league_id,
      'Un partido programado ya pasó 📅',
      `El partido ${match.home_team} vs ${match.away_team}${jornada} estaba programado y ya pasó su fecha, pero nunca se marcó como iniciado ni finalizado. Actualiza su estado, su marcador o su fecha.`,
      JSON.stringify({ match_id: match.id, league_id: match.league_id, url: `/partidos/${match.id}` })
    );
    await db.prepare('UPDATE matches SET reminded_not_started = TRUE WHERE id = ?').run(match.id);
  }
}

// Trigger del cron job.
//
// UN endpoint, DOS cadencias. Se puede llamar con la frecuencia que sea y las
// dos mitades quedan bien servidas:
//
//   - Los avisos de partido corren en CADA llamada. Su ventana es de una hora,
//     así que quieren la frecuencia más alta que el scheduler dé (~15 min).
//   - La cobranza y la mensualidad corren UNA VEZ AL DÍA, la reclame quien la
//     reclame. Ver utils/cronSchedule.js para por qué el candado es de la base
//     y no del código.
//
// Esto es lo que vuelve irrelevante el pendiente de "nadie sabe cada cuánto
// corre el cron" para la corrección del sistema: sigue siendo un dato que hay
// que ir a buscar, pero ya no es la diferencia entre facturar y no facturar.
//
// `?force=1` vuelve a correr las fases diarias aunque ya hayan corrido hoy.
// Va detrás del mismo CRON_SECRET y sirve para probar y para recuperar a mano.
//
// El secreto se acepta en DOS formatos: `x-cron-secret: <secreto>`, que es el
// de siempre, y `Authorization: Bearer <secreto>`. El segundo no es capricho:
// varios schedulers mandan solo ese (Vercel Cron, entre otros), y aceptar los
// dos es lo que deja cambiar de proveedor sin tocar el backend. Es el mismo
// secreto, no dos.
router.post('/trigger', asyncHandler(async (req, res) => {
  const esperado = process.env.CRON_SECRET;
  const cabecera = req.headers.authorization || '';
  const recibido = req.headers['x-cron-secret']
    || (cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null);

  // El `!esperado` va primero: sin CRON_SECRET configurado, los dos lados
  // serían undefined y cualquiera podría disparar el cron.
  if (!esperado || recibido !== esperado) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const forzar = req.query.force === '1' || req.query.force === 'true';

  // El latido, antes que nada: deja constancia de que el cron llamó, incluso
  // si todo lo de abajo se cae. Es de lo que sale la respuesta a "¿cada cuánto
  // corre?" y "¿sigue vivo?" en el panel de administración.
  const llamadasHoy = await registrarLlamada(db);

  // ── Cada corrida ──
  // Se captura el error en vez de dejarlo subir: lo que sigue es dinero y no
  // depende de nada de esto. Pero capturar no puede significar esconder — el
  // mensaje sube a la respuesta, que es el único rastro que deja este handler.
  let partidosError = null;
  try {
    await faseDePartidos();
  } catch (err) {
    console.error('[cron] la fase de partidos falló:', err);
    partidosError = err.message;
  }

  // ── Una vez al día ──
  // Las tres fases de dinero, en este orden a propósito: la mensualidad va
  // DESPUÉS de los recordatorios porque un cargo que nace hoy vence dentro de
  // cinco días, así que alcanza el aviso de "por vencer" de mañana sin
  // necesidad de adelantarlo, y los recordatorios siguen siendo lo último que
  // ve una corrida sobre datos estables.
  //
  // Las tres son idempotentes por su cuenta (banderas por fila las dos
  // primeras, índice único la tercera), así que el candado diario es una
  // mejora de cadencia, no la garantía de nada: si alguna corriera de más, no
  // pasaría nada malo. Por eso también se puede seguir llamando desde el panel
  // (la vía perezosa de la mensualidad) sin coordinarse con esto.
  const cobranza = await runOncePerDay(db, 'cobranza', async () => {
    const liga        = await runBillingReminders(db);
    const jugadores   = await runPlayerBillingReminders(db);
    const mensualidad = await runMonthlyChargeGeneration(db);
    // La bitácora se poda aquí y no en cada llamada: es mantenimiento, y este
    // bloque ya tiene la garantía de correr una sola vez al día.
    const podadas = await podarBitacora(db);
    return {
      billing_reminders:        liga,
      player_billing_reminders: jugadores,
      monthly_charges_created:  mensualidad.created,
      monthly_charges_error:    mensualidad.error,
      bitacora_podada:          podadas,
    };
  }, { force: forzar });

  res.json({
    ok: true,
    llamadas_hoy: llamadasHoy,
    partidos_error: partidosError,
    cobranza,
    // Se conservan en la raíz porque eran lo único que esta respuesta decía
    // hasta ahora, y del otro lado hay un servicio que no podemos inspeccionar.
    // `null` cuando el bloque diario no corrió: un 0 ahí se leería como
    // "corrió y no generó nada", que es justo lo contrario.
    monthly_charges_created: cobranza.resultado?.monthly_charges_created ?? null,
    monthly_charges_error:   cobranza.resultado?.monthly_charges_error   ?? null,
  });
}));

// ─────────────────────────────────────────────────────────────────────────────
// "Mis notificaciones": una bandeja por persona (README, "Notificaciones: la
// bandeja y el push"). Junta lo de sus organizaciones —filtrado por lo que su
// rol puede leer— con lo de los partidos y equipos que sigue. Las reglas son
// puras y viven en utils/bandeja.js; aquí solo se junta lo que necesitan.
//
// Reemplaza a GET /league/:id y GET /team/:id, que leían la bandeja de una
// organización con una sola guarda (`estructura` o `ver`) sin mirar de qué
// trataba el aviso: el coach leía cuotas vencidas con nombres del padrón, y el
// tesorero de la liga no veía el pago que le tocaba confirmar. Se retiraron en
// vez de esconderse: esconder la pantalla no le quitaba al coach la API.
// ─────────────────────────────────────────────────────────────────────────────

// Las organizaciones de la persona, con su rol. Mismo criterio que /auth/me:
// miembro activo, o dueño por `owner_user_id`. La cuenta de administrador de
// la plataforma no es la excepción — pasa todas las guardas, pero su bandeja es
// la de sus organizaciones, no la de todas las de la plataforma.
async function organizacionesDe(userId) {
  const ligas = await db.prepare(`
    SELECT l.id, l.name, l.logo_url,
           COALESCE(om.role, CASE WHEN l.owner_user_id = ? THEN 'owner' END) AS rol
    FROM leagues l
    LEFT JOIN organization_members om
           ON om.organization_id = l.organization_id AND om.user_id = ? AND om.status = 'active'
    WHERE l.owner_user_id = ? OR om.id IS NOT NULL
  `).all(userId, userId, userId);
  const equipos = await db.prepare(`
    SELECT t.id, t.name, t.logo_url,
           COALESCE(om.role, CASE WHEN t.owner_user_id = ? THEN 'owner' END) AS rol
    FROM teams t
    LEFT JOIN organization_members om
           ON om.organization_id = t.organization_id AND om.user_id = ? AND om.status = 'active'
    WHERE t.owner_user_id = ? OR om.id IS NOT NULL
  `).all(userId, userId, userId);
  return [
    ...ligas.map((o) => ({ ...o, tipo: 'league' })),
    ...equipos.map((o) => ({ ...o, tipo: 'team' })),
  ];
}

// Los avisos de `notifications` que esta persona puede leer. Con `desde`, solo
// los posteriores (para contar lo nuevo sin traer la lista entera).
//
// `created_at` es TIMESTAMP sin zona y se guarda en UTC (Neon corre en UTC). Se
// convierte con AT TIME ZONE 'UTC' ANTES de salir: sin eso, `pg` lo leería en
// la zona del proceso de Node, que en una máquina de México son seis horas de
// diferencia contra la hora del partido y la de "visto hasta".
async function avisosDeOrganizaciones(organizaciones, desde = null) {
  const grupos = filtrosDeBandeja(organizaciones);
  if (grupos.length === 0) return [];

  const condiciones = [];
  const params = [];
  for (const g of grupos) {
    if (g.avisos) {
      condiciones.push('(n.recipient_type = ? AND n.recipient_id = ANY(?::int[]) AND n.type = ANY(?::text[]))');
      params.push(g.tipo, g.ids, g.avisos);
    } else {
      condiciones.push('(n.recipient_type = ? AND n.recipient_id = ANY(?::int[]))');
      params.push(g.tipo, g.ids);
    }
  }
  let soloDesde = '';
  if (desde) {
    soloDesde = `AND (n.created_at AT TIME ZONE 'UTC') > ?`;
    params.push(desde);
  }

  const filas = await db.prepare(`
    SELECT n.id, n.recipient_type, n.recipient_id, n.type, n.title, n.body, n.data,
           n.created_at AT TIME ZONE 'UTC' AS at
    FROM notifications n
    WHERE (${condiciones.join(' OR ')})
      ${soloDesde}
    ORDER BY n.created_at DESC
    LIMIT ${LIMITE_DE_BANDEJA}
  `).all(...params);

  const porClave = new Map(organizaciones.map((o) => [`${o.tipo}-${o.id}`, o]));
  return filas.map((n) => {
    const org = porClave.get(`${n.recipient_type}-${n.recipient_id}`);
    let data = n.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { data = null; }
    }
    return {
      key: `n-${n.id}`,
      origin: 'organization',
      type: n.type,
      title: n.title,
      body: n.body,
      url: data?.url ?? null,
      at: n.at,
      org: org ? { kind: org.tipo, id: org.id, name: org.name, logo_url: org.logo_url } : null,
    };
  });
}

// Los avisos de los partidos, equipos y ligas que sigue. Se traen todos los
// partidos que cubren sus seguimientos (una liga son cientos, no miles) y sus
// eventos de los últimos días; qué aviso sale de ahí lo decide
// avisosDeSeguimiento(), que es pura.
async function avisosDeLoQueSigue(userId, ahora) {
  const seguimientos = await db.prepare(`
    SELECT match_id, team_name, league_id,
           notify_upcoming, notify_live, notify_final, notify_changes,
           created_at AT TIME ZONE 'UTC' AS desde
    FROM push_subscriptions
    WHERE user_id = ? AND in_app IS DISTINCT FROM FALSE
  `).all(userId);
  if (seguimientos.length === 0) return [];

  const condiciones = [];
  const params = [];
  const partidosSeguidos = seguimientos.filter((s) => s.match_id != null).map((s) => s.match_id);
  if (partidosSeguidos.length > 0) {
    condiciones.push('m.id = ANY(?::int[])');
    params.push(partidosSeguidos);
  }
  const ligasSeguidas = seguimientos
    .filter((s) => s.match_id == null && !s.team_name && s.league_id != null)
    .map((s) => s.league_id);
  if (ligasSeguidas.length > 0) {
    condiciones.push('c.league_id = ANY(?::int[])');
    params.push(ligasSeguidas);
  }
  // Un equipo sin liga en el seguimiento cuenta en cualquier liga: es el caso
  // de un equipo independiente que juega en varias.
  for (const s of seguimientos.filter((x) => x.match_id == null && x.team_name)) {
    if (s.league_id != null) {
      condiciones.push('(c.league_id = ? AND (UPPER(m.home_team) = UPPER(?) OR UPPER(m.away_team) = UPPER(?)))');
      params.push(s.league_id, s.team_name, s.team_name);
    } else {
      condiciones.push('(UPPER(m.home_team) = UPPER(?) OR UPPER(m.away_team) = UPPER(?))');
      params.push(s.team_name, s.team_name);
    }
  }
  if (condiciones.length === 0) return [];

  const partidos = await db.prepare(`
    SELECT m.id, m.match_date, m.timezone, m.home_team, m.away_team,
           m.home_score, m.away_score, m.category_id,
           c.league_id, l.name AS league_name
    FROM matches m
    JOIN categories c   ON c.id = m.category_id
    LEFT JOIN leagues l ON l.id = c.league_id
    WHERE m.is_draft = FALSE
      AND (${condiciones.join(' OR ')})
  `).all(...params);
  if (partidos.length === 0) return [];

  const eventos = await db.prepare(`
    SELECT id, match_id, type, data, created_at AS at
    FROM match_events
    WHERE match_id = ANY(?::int[])
      AND created_at > NOW() - INTERVAL '${DIAS_DE_BANDEJA} days'
  `).all(partidos.map((p) => p.id));

  return avisosDeSeguimiento({ seguimientos, partidos, eventos, ahora }).map((a) => ({
    key: a.key,
    origin: 'follow',
    type: a.type,
    url: `/partidos/${a.partido.id}`,
    at: a.at,
    data: a.data,
    match: {
      id: a.partido.id,
      home_team: a.partido.home_team,
      away_team: a.partido.away_team,
      home_score: a.partido.home_score,
      away_score: a.partido.away_score,
      match_date: a.partido.match_date,
      timezone: a.partido.timezone,
      league_name: a.partido.league_name,
    },
  }));
}

// La bandeja completa de una persona y hasta dónde la vio. Con `soloNuevos`,
// los avisos de organizaciones se piden ya filtrados desde esa marca: es lo
// que pregunta el balón de arriba en cada cambio de página.
async function armarBandeja(userId, { soloNuevos = false } = {}) {
  // "Ahora" es la hora de la BASE, no la del proceso: los avisos, los eventos y
  // la marca de "visto hasta" los fecha Postgres, y si el reloj de Node va
  // atrasado, lo recién creado parece del futuro y no cuenta como nuevo. No es
  // teórico: la suite e2e lo encontró con Neon tres segundos adelante de la
  // máquina local.
  const usuario = await db.prepare(
    'SELECT notifications_seen_at AS seen_at, NOW() AS ahora FROM users WHERE id = ?'
  ).get(userId);
  const ahora = usuario?.ahora ? new Date(usuario.ahora) : new Date();
  const vistoHasta = usuario?.seen_at ?? ahora;

  const organizaciones = await organizacionesDe(userId);
  const [deOrganizaciones, deLoQueSigue] = await Promise.all([
    avisosDeOrganizaciones(organizaciones, soloNuevos ? vistoHasta : null),
    avisosDeLoQueSigue(userId, ahora),
  ]);
  const items = juntarBandeja([deOrganizaciones, deLoQueSigue]);
  return { items, vistoHasta, ahora, unread: contarNuevos(items, vistoHasta, ahora) };
}

router.get('/mine', authRequired, asyncHandler(async (req, res) => {
  const { items, vistoHasta, ahora, unread } = await armarBandeja(req.user.id);
  res.json({
    items: items.map((a) => ({
      ...a,
      at: new Date(a.at).toISOString(),
      is_new: esNuevo(a.at, vistoHasta, ahora),
    })),
    seen_at: new Date(vistoHasta).toISOString(),
    unread,
  });
}));

// Solo el número, para el balón de la barra de arriba.
router.get('/mine/unread', authRequired, asyncHandler(async (req, res) => {
  const { unread } = await armarBandeja(req.user.id, { soloNuevos: true });
  res.json({ unread });
}));

// Abrir "Mis notificaciones" mueve la marca a ahora. Lo leído es de la
// persona: que un administrador vea un aviso no lo marca para los demás.
router.post('/mine/seen', authRequired, asyncHandler(async (req, res) => {
  const fila = await db.prepare(`
    UPDATE users SET notifications_seen_at = NOW()
    WHERE id = ?
    RETURNING notifications_seen_at AS seen_at
  `).get(req.user.id);
  res.json({ ok: true, seen_at: fila?.seen_at ?? null });
}));

export default router;