import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HOY_MX } from '../utils/sqlDates.js';
import { TIPOS_PUBLICABLES, puedePremiarSql } from '../utils/orgVisibility.js';
import { INTERRUPTORES, cambiarInterruptor, esInterruptor, historialDeInterruptor } from '../utils/interruptores.js';
import {
  AJUSTES, cambiarAjuste, esAjuste, historialDeAjuste, validarAjuste, valorDeAjuste,
} from '../utils/ajustesDePlataforma.js';
import { faltanVariables, mercadoPagoConfigurado } from '../utils/mercadoPago.js';
import { orgTieneMiembrosSql } from '../utils/orgMembers.js';
import { etiquetaDeRol } from '../utils/orgRoles.js';
import { motivoParaNoAgregar, motivoParaNoBorrarCuenta, rolesSinLink } from '../utils/accesoSinLink.js';
import { armarCatalogo } from '../utils/catalogoDeAvisos.js';
import { pushEncendido } from '../utils/pushNotifier.js';
import { emailAvailable } from '../utils/email.js';

const router = express.Router();

// Middleware: solo admin
function adminRequired(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso restringido a administradores' });
  }
  next();
}

/* ===================== INTERRUPTORES ===================== */

// Lo que Alfredo prende y apaga desde el Panel Admin (utils/interruptores.js):
// hoy, los premios por acertar (README, "Premios por acertar" → "El
// interruptor"). Cada uno con su estado y quién lo movió y cuándo; el estado es
// la primera fila del historial, leída de la base y no de la memoria de diez
// segundos. Junto, lo que ayuda a decidir: cuántos premios hay puestos y cuántas
// tiendas pueden ponerlos.
router.get('/switches', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const claves = Object.keys(INTERRUPTORES);
  const [historiales, premios] = await Promise.all([
    Promise.all(claves.map((clave) => historialDeInterruptor(clave))),
    db.prepare(`
      SELECT
        (SELECT COUNT(*)::int FROM prediction_prizes WHERE withdrawn_at IS NULL) AS active,
        (SELECT COUNT(*)::int FROM organizations o WHERE ${puedePremiarSql('o')}) AS stores
    `).get(),
  ]);
  const switches = {};
  claves.forEach((clave, i) => {
    switches[clave] = {
      label: INTERRUPTORES[clave],
      enabled: historiales[i][0]?.enabled === true,
      history: historiales[i],
    };
  });
  res.json({ switches, prizes: premios });
}));

// Prender o apagar. Cuerpo: { enabled: true | false }. Solo deja fila si cambia.
router.put('/switches/:key', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const clave = req.params.key;
  if (!esInterruptor(clave)) return res.status(404).json({ error: 'No existe ese interruptor' });
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'Falta decir si se prende o se apaga' });
  }
  await cambiarInterruptor(clave, req.body.enabled, req.user.id);
  const historial = await historialDeInterruptor(clave);
  res.json({ key: clave, label: INTERRUPTORES[clave], enabled: historial[0]?.enabled === true, history: historial });
}));

/* ===================== COMPRAS ===================== */

// Panel Admin → Compras (README, "Compras en la vitrina"): el botón, la comisión
// y lo que ayuda a decidir. Conteos, nunca datos de quien compró: el admin no
// los necesita para operar la plataforma. "Pagados" son los pedidos con su pago
// aprobado en los últimos 30 días, sin importar lo que pasó después.
router.get('/shop', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const [historial, comision, historialDeComision, conteos] = await Promise.all([
    historialDeInterruptor('store_purchases'),
    valorDeAjuste('purchase_fee_percent'),
    historialDeAjuste('purchase_fee_percent'),
    db.prepare(`
      SELECT
        (SELECT COUNT(*)::int FROM organizations o WHERE ${puedePremiarSql('o')}) AS trusted_stores,
        (SELECT COUNT(DISTINCT a.organization_id)::int FROM store_payment_accounts a
          WHERE a.disconnected_at IS NULL AND a.access_token_enc IS NOT NULL) AS connected_stores,
        (SELECT COUNT(*)::int FROM store_orders) AS orders,
        (SELECT COUNT(*)::int FROM store_order_events e
          WHERE e.kind = 'payment_approved' AND e.created_at >= NOW() - INTERVAL '30 days') AS paid_30d,
        (SELECT COALESCE(SUM(o.total), 0) FROM store_orders o
          JOIN store_order_events e ON e.order_id = o.id AND e.kind = 'payment_approved'
          WHERE e.created_at >= NOW() - INTERVAL '30 days') AS paid_amount_30d,
        (SELECT COALESCE(SUM(o.fee_amount), 0) FROM store_orders o
          JOIN store_order_events e ON e.order_id = o.id AND e.kind = 'payment_approved'
          WHERE e.created_at >= NOW() - INTERVAL '30 days') AS fees_30d
    `).get(),
  ]);
  res.json({
    switch: { label: INTERRUPTORES.store_purchases, enabled: historial[0]?.enabled === true, history: historial },
    configured: mercadoPagoConfigurado(),
    missing_variables: faltanVariables(),
    fee: { percent: comision, limits: AJUSTES.purchase_fee_percent, history: historialDeComision },
    counts: {
      ...conteos,
      paid_amount_30d: Number(conteos.paid_amount_30d),
      fees_30d: Number(conteos.fees_30d),
    },
  });
}));

// Cambiar un ajuste de la plataforma. Cuerpo: { value }. Solo deja fila si cambia.
router.put('/settings/:key', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const clave = req.params.key;
  if (!esAjuste(clave)) return res.status(404).json({ error: 'No existe ese ajuste' });
  const { valor, error } = validarAjuste(clave, req.body?.value);
  if (error) return res.status(400).json({ error });
  await cambiarAjuste(clave, valor, req.user.id);
  res.json({ key: clave, value: await valorDeAjuste(clave), history: await historialDeAjuste(clave) });
}));

/* ===================== SALUD DEL CRON ===================== */

// Cuántos días de historia pinta el panel.
const DIAS = 14;

// El cron que dispara POST /api/notifications/trigger es EXTERNO al
// repositorio y durante mucho tiempo nadie supo cada cuánto corría ni si
// seguía vivo (ver "Pendientes abiertos" del README). Este endpoint contesta
// las dos preguntas desde adentro, con lo que la propia app registró, en vez
// de entrar al panel de un proveedor.
//
// La frecuencia NO se configura en ningún lado: se MIDE. Un día completo con
// 96 llamadas son 15 minutos entre una y otra. Por eso el umbral de "atrasado"
// tampoco es un número fijo — se calcula del ritmo observado, y así el panel
// sirve igual si el cron corre cada 15 minutos que si corre una vez al día.
router.get(`/cron`, authRequired, adminRequired, asyncHandler(async (req, res) => {
  const resumen = await db.prepare(`
    SELECT to_char(${HOY_MX}, 'YYYY-MM-DD') AS hoy_mx,
           (SELECT MAX(last_call_at) FROM cron_runs WHERE phase = 'trigger') AS ultima_llamada,
           (SELECT ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(last_call_at))) / 60)
              FROM cron_runs WHERE phase = 'trigger') AS minutos_desde
  `).get();

  const dias = await db.prepare(`
    SELECT to_char(ran_on, 'YYYY-MM-DD') AS dia,
           COALESCE(MAX(calls) FILTER (WHERE phase = 'trigger'), 0) AS llamadas,
           MAX(last_call_at) FILTER (WHERE phase = 'trigger') AS ultima_llamada,
           BOOL_OR(phase = 'cobranza' AND finished_at IS NOT NULL) AS cobranza_ok,
           MAX(finished_at) FILTER (WHERE phase = 'cobranza') AS cobranza_a_las,
           (ARRAY_AGG(result) FILTER (WHERE phase = 'cobranza' AND result IS NOT NULL))[1] AS cobranza_resultado
    FROM cron_runs
    WHERE ran_on >= ${HOY_MX} - ${DIAS}
    GROUP BY ran_on
    ORDER BY ran_on DESC
  `).all();

  // Ya viene como texto YYYY-MM-DD desde SQL, igual que `dia` en la otra
  // consulta: las dos tienen que compararse como cadena.
  const hoyMx = resumen.hoy_mx;
  const hoy   = dias.find((d) => d.dia === hoyMx) || null;
  const minutos = resumen.minutos_desde === null ? null : Number(resumen.minutos_desde);

  // El ritmo se estima con el último día COMPLETO, no con el de hoy: hoy va a
  // la mitad y daría siempre una frecuencia inventada.
  const completo = dias.find((d) => d.dia !== hoyMx && Number(d.llamadas) > 0);
  const cadenciaMin = completo ? Math.round(1440 / Number(completo.llamadas)) : null;

  // Sin un día completo todavía, se asume lo más lento posible (una vez al día)
  // para no gritar en falso el primer día.
  const esperado = cadenciaMin ?? 1440;
  const limite = Math.max(2 * esperado, 90);

  let estado;
  if (minutos === null)        estado = 'sin_señal';
  else if (minutos > 36 * 60)  estado = 'sin_señal';
  else if (minutos > limite)   estado = 'atrasado';
  else                         estado = 'ok';

  res.json({
    estado,
    hoy_mx: hoyMx,
    ultima_llamada: resumen.ultima_llamada,
    minutos_desde_ultima_llamada: minutos,
    minutos_de_tolerancia: limite,
    cadencia_estimada_min: cadenciaMin,
    cadencia_medida_el: completo ? completo.dia : null,
    llamadas_hoy: hoy ? Number(hoy.llamadas) : 0,
    cobranza_corrio_hoy: hoy ? Boolean(hoy.cobranza_ok) : false,
    dias,
  });
}));

/* ===================== NOTIFICACIONES ===================== */

// El catálogo de todo lo que la app avisa (README, "Notificaciones: todo lo que
// la app avisa"). Lo que se escribe a mano vive en utils/catalogoDeAvisos.js;
// aquí se le suma lo que solo sabe la base: cuántos de cada uno salieron, y a
// cuántas personas les puede llegar uno de los que se calculan al leer.
//
// `created_at` de `notifications` y de `email_verification_codes` es TIMESTAMP
// sin zona, guardado en UTC: se convierte antes de comparar, como en la bandeja.
router.get('/notifications', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const [envios, codigos, seguidores, predicen] = await Promise.all([
    db.prepare(`
      SELECT type AS tipo,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'UTC') > NOW() - INTERVAL '30 days')::int AS ultimos_30,
             COUNT(DISTINCT recipient_type || '-' || recipient_id)
               FILTER (WHERE (created_at AT TIME ZONE 'UTC') > NOW() - INTERVAL '30 days')::int AS destinatarios_30,
             MAX(created_at) AT TIME ZONE 'UTC' AS ultimo
      FROM notifications
      GROUP BY type
    `).all(),
    // Cada código es un correo: se manda en cuanto se crea, y con el correo
    // apagado no se crea ninguno.
    db.prepare(`
      SELECT 'email_verification_codes' AS tabla,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'UTC') > NOW() - INTERVAL '30 days')::int AS ultimos_30,
             COUNT(DISTINCT user_id) FILTER (WHERE (created_at AT TIME ZONE 'UTC') > NOW() - INTERVAL '30 days')::int AS destinatarios_30,
             MAX(created_at) AT TIME ZONE 'UTC' AS ultimo
      FROM email_verification_codes
      UNION ALL
      SELECT 'password_reset_codes',
             COUNT(*)::int,
             COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int,
             COUNT(DISTINCT user_id) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int,
             MAX(created_at)
      FROM password_reset_codes
    `).all(),
    // Quien tiene marcada cada casilla en algo que sigue, con la bandeja
    // encendida: la misma condición con que la bandeja arma sus avisos
    // (routes/notifications.js, avisosDeLoQueSigue). Una casilla en NULL cuenta
    // como marcada.
    db.prepare(`
      SELECT COUNT(DISTINCT user_id) FILTER (WHERE notify_upcoming IS DISTINCT FROM FALSE)::int AS notify_upcoming,
             COUNT(DISTINCT user_id) FILTER (WHERE notify_live     IS DISTINCT FROM FALSE)::int AS notify_live,
             COUNT(DISTINCT user_id) FILTER (WHERE notify_final    IS DISTINCT FROM FALSE)::int AS notify_final,
             COUNT(DISTINCT user_id) FILTER (WHERE notify_changes  IS DISTINCT FROM FALSE)::int AS notify_changes
      FROM push_subscriptions
      WHERE user_id IS NOT NULL AND in_app IS DISTINCT FROM FALSE
    `).get(),
    // Quien votó en un calendario que la bandeja todavía repasa: con algún
    // partido de los últimos 60 días, o sin fecha (routes/notifications.js,
    // avisosDePredicciones). A los demás no se les calcula nada.
    db.prepare(`
      SELECT COUNT(DISTINCT p.user_id)::int AS personas
      FROM predictions p
      JOIN matches m ON m.id = p.match_id
      WHERE m.match_date IS NULL OR m.match_date::timestamptz > NOW() - INTERVAL '60 days'
    `).get(),
  ]);

  res.json(armarCatalogo({
    envios,
    codigos: Object.fromEntries(codigos.map(({ tabla, ...fila }) => [tabla, fila])),
    seguidores,
    predicen: predicen?.personas ?? 0,
    canales: { push: pushEncendido(), correo: emailAvailable() },
  }));
}));

/* ===================== ESTADÍSTICAS ===================== */

// Las visitas desde un navegador del admin no cuentan (lo marca POST /track).
// Se descuentan al leer, así que salen también las que hizo antes de quedar
// marcado. Una fila sin visitor_id no se puede atribuir y sí cuenta.
const SIN_VISITAS_DEL_ADMIN = `NOT EXISTS (
  SELECT 1 FROM internal_visitors iv WHERE iv.visitor_id = page_views.visitor_id
)`;

router.get('/stats', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const [leagues, users, matches, teams, homeViews, uniqueVisitors, homeViewsByDay, sponsorStats, userGrowthByMonth, predictionStats, leaguesByStateRows] = await Promise.all([
    db.prepare('SELECT COUNT(*) as count FROM leagues').get(),
    db.prepare('SELECT COUNT(*) as count FROM users').get(),
    db.prepare('SELECT COUNT(*) as count FROM matches').get(),
    db.prepare('SELECT COUNT(*) as count FROM teams').get(),
    db.prepare(`SELECT COUNT(*) as count FROM page_views WHERE event_type = 'home_view' AND ${SIN_VISITAS_DEL_ADMIN}`).get(),
    // Visitantes únicos (por visitor_id, ver track.js) contra vistas totales
    // de Home: la diferencia entre ambos es lo que le importa a un
    // patrocinador — cuánta GENTE llega, no solo cuántas veces se cargó la
    // página. Solo cuenta desde que se agregó visitor_id (filas viejas
    // quedan NULL), no es un histórico retroactivo.
    db.prepare(`
      SELECT COUNT(DISTINCT visitor_id) as count
      FROM page_views
      WHERE event_type = 'home_view' AND visitor_id IS NOT NULL
        AND ${SIN_VISITAS_DEL_ADMIN}
    `).get(),
    db.prepare(`
      SELECT created_at::date as day, COUNT(*) as count
      FROM page_views
      WHERE event_type = 'home_view'
        AND created_at >= CURRENT_DATE - INTERVAL '30 days'
        AND ${SIN_VISITAS_DEL_ADMIN}
      GROUP BY day
      ORDER BY day ASC
    `).all(),
    // Impresiones (se le mostró el logo) y clics por patrocinador, para
    // poder presentarle a cada uno el alcance real de su espacio.
    db.prepare(`
      SELECT
        s.id,
        s.name,
        s.logo_url,
        COUNT(*) FILTER (WHERE pv.event_type = 'sponsor_impression') as impressions,
        COUNT(*) FILTER (WHERE pv.event_type = 'sponsor_click') as clicks
      FROM sponsors s
      LEFT JOIN page_views pv ON pv.sponsor_id = s.id
      GROUP BY s.id, s.name, s.logo_url, s.sort_order
      ORDER BY s.sort_order ASC
    `).all(),
    // Usuarios nuevos por mes y el acumulado hasta ese mes, para la gráfica
    // de crecimiento (mucho más útil para mostrarle a un patrocinador que
    // el conteo total suelto: cuenta la tendencia, no solo el punto actual).
    db.prepare(`
      SELECT
        to_char(month, 'YYYY-MM-DD') as month,
        new_users,
        SUM(new_users) OVER (ORDER BY month ASC) as total_users
      FROM (
        SELECT date_trunc('month', created_at)::date as month, COUNT(*) as new_users
        FROM users
        GROUP BY month
      ) monthly
      ORDER BY month ASC
    `).all(),
    // Participación en quinielas: cuánta gente predice partidos y cuánta se
    // organiza en quinielas privadas — la prueba de que no es tráfico
    // pasivo, hay una comunidad interactuando de verdad.
    db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM predictions) as total_predictions,
        (SELECT COUNT(DISTINCT user_id) FROM predictions) as unique_predictors,
        (SELECT COUNT(*) FROM pools) as total_pools,
        (SELECT COUNT(DISTINCT user_id) FROM pool_members) as pool_members
    `).get(),
    // Ligas por estado, para el mapa/lista de alcance geográfico. Una liga
    // puede estar en varios estados a la vez ("states", jsonb) — cada una
    // suma un conteo por CADA estado en el que opera, no solo uno. Las
    // ligas viejas o de otros países que no tienen "states" (arreglo vacío)
    // caen a su "state" de texto libre, o a "Sin estado" si no tienen nada.
    db.prepare(`
      SELECT state, COUNT(*) as count FROM (
        SELECT jsonb_array_elements_text(states) as state
        FROM leagues
        WHERE jsonb_array_length(states) > 0
        UNION ALL
        SELECT COALESCE(NULLIF(TRIM(state), ''), 'Sin estado') as state
        FROM leagues
        WHERE jsonb_array_length(states) = 0
      ) expanded
      GROUP BY state
      ORDER BY count DESC
    `).all(),
  ]);
  res.json({
    leagues: leagues.count,
    users:   users.count,
    matches: matches.count,
    teams:   teams.count,
    homeViews: {
      total: Number(homeViews.count),
      uniqueVisitors: Number(uniqueVisitors.count),
      last30Days: homeViewsByDay.map((row) => ({
        day: row.day,
        count: Number(row.count),
      })),
    },
    sponsors: sponsorStats.map((s) => ({
      id: s.id,
      name: s.name,
      logo_url: s.logo_url,
      impressions: Number(s.impressions),
      clicks: Number(s.clicks),
    })),
    userGrowth: userGrowthByMonth.map((row) => ({
      month: row.month,
      newUsers: Number(row.new_users),
      totalUsers: Number(row.total_users),
    })),
    predictions: {
      total: Number(predictionStats.total_predictions),
      uniquePredictors: Number(predictionStats.unique_predictors),
      totalPools: Number(predictionStats.total_pools),
      poolMembers: Number(predictionStats.pool_members),
    },
    leaguesByState: leaguesByStateRows.map((row) => ({
      state: row.state,
      count: Number(row.count),
    })),
  });
}));

/* ===================== LIGAS ===================== */

router.get('/leagues', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const leagues = await db.prepare(`
    SELECT l.*, u.name as owner_name, u.email as owner_email
    FROM leagues l
    LEFT JOIN users u ON l.owner_user_id = u.id
    ORDER BY l.created_at DESC
  `).all();
  res.json(leagues);
}));

router.delete('/leagues/:id', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id);
  if (!league) return res.status(404).json({ error: 'Liga no encontrada' });
  await db.prepare('DELETE FROM leagues WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

router.put('/leagues/:id/publish', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id);
  if (!league) return res.status(404).json({ error: 'Liga no encontrada' });
  await db.prepare('UPDATE leagues SET is_public = TRUE WHERE id = ?').run(req.params.id);

  await db.prepare(`
    INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
    VALUES ('league', ?, 'league_approved', ?, ?, ?)
  `).run(
    league.id,
    '¡Tu liga ha sido aprobada y publicada! 🎉',
    `La liga ${league.name} ya está visible para el público en general en el directorio de ligas.`,
    JSON.stringify({ league_id: league.id, league_slug: league.slug, url: `/ligas/${league.slug}` })
  );

  res.json(await db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id));
}));

router.put('/leagues/:id/unpublish', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id);
  if (!league) return res.status(404).json({ error: 'Liga no encontrada' });
  await db.prepare('UPDATE leagues SET is_public = FALSE WHERE id = ?').run(req.params.id);

  const reason = req.body?.reason || 'Tu liga ha sido ocultada del sitio público por el equipo de administración.';
  await db.prepare(`
    INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
    VALUES ('league', ?, 'league_unapproved', ?, ?, ?)
  `).run(
    league.id,
    'Estado de publicación de liga actualizado',
    reason,
    JSON.stringify({ league_id: league.id, league_slug: league.slug, url: `/panel/liga/${league.id}` })
  );

  res.json(await db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id));
}));

// Rechaza la SOLICITUD de publicación de una liga. Era el hueco del panel de
// admin: ante una liga que pidió publicarse solo había "Publicar" o "Eliminar"
// (que la borra para siempre, con todo su calendario), y no había manera de
// decir "todavía no, y esto es lo que falta".
//
// No toca `is_public` — la liga simplemente sigue sin publicarse. Lo que apaga
// es `publish_requested`, o sea la señal que el dueño le mandó al admin. Al
// apagarse, el dueño puede volver a solicitarlo cuando haya corregido lo que
// se le pidió (`PUT /leagues/:id/request-publish`), así que el ciclo se cierra
// sin intervención manual de nadie más.
//
// El motivo es OBLIGATORIO: el punto de rechazar en vez de ignorar es que el
// dueño sepa qué arreglar. Un rechazo sin explicación deja al dueño esperando
// y al admin contestando WhatsApps, que es justo lo que se quiere evitar.
router.put('/leagues/:id/decline-publish', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id);
  if (!league) return res.status(404).json({ error: 'Liga no encontrada' });

  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!reason) {
    return res.status(400).json({ error: 'Escribe el motivo del rechazo — el dueño de la liga lo va a leer.' });
  }

  if (!league.publish_requested) {
    return res.status(400).json({ error: 'Esa liga no tiene ninguna solicitud de publicación pendiente.' });
  }

  await db.prepare('UPDATE leagues SET publish_requested = FALSE WHERE id = ?').run(req.params.id);

  await db.prepare(`
    INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
    VALUES ('league', ?, 'league_publish_declined', ?, ?, ?)
  `).run(
    league.id,
    'Tu solicitud de publicación no fue aprobada todavía',
    `${reason}\n\nCuando lo tengas listo, vuelve a solicitar la publicación desde tu panel.`,
    JSON.stringify({ league_id: league.id, league_slug: league.slug, reason, url: `/panel/liga/${league.id}/estructura` })
  );

  res.json(await db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id));
}));

router.put('/leagues/:id/verify', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id);
  if (!league) return res.status(404).json({ error: 'Liga no encontrada' });
  await db.prepare('UPDATE leagues SET is_verified = TRUE WHERE id = ?').run(req.params.id);

  await db.prepare(`
    INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
    VALUES ('league', ?, 'league_verified', ?, ?, ?)
  `).run(
    league.id,
    '¡Tu liga ha sido verificada oficialmente! ⭐',
    `La liga ${league.name} cuenta ahora con el distintivo oficial de verificación.`,
    JSON.stringify({ league_id: league.id, league_slug: league.slug, url: `/ligas/${league.slug}` })
  );

  res.json(await db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id));
}));

router.put('/leagues/:id/unverify', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id);
  if (!league) return res.status(404).json({ error: 'Liga no encontrada' });
  await db.prepare('UPDATE leagues SET is_verified = FALSE WHERE id = ?').run(req.params.id);

  const reason = req.body?.reason || `La insignia de verificación de la liga ${league.name} ha sido retirada por el equipo de administración.`;
  await db.prepare(`
    INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
    VALUES ('league', ?, 'league_unverified', ?, ?, ?)
  `).run(
    league.id,
    'Insignia de verificación retirada ⚠️',
    reason,
    JSON.stringify({ league_id: league.id, league_slug: league.slug, url: `/panel/liga/${league.id}` })
  );

  res.json(await db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id));
}));

// Mismo patrón que arriba, para organizaciones (medio/proveedor/tienda/
// clínica/marca): publicar y verificar son dos botones (README,
// "Organizaciones: publicar y verificar", 2026-10-29). Un medio necesita los
// dos para autoasignarse a partidos.
//
// Un equipo de liga se excluye a propósito mientras su liga lo administra desde
// su propio panel. Desde que se entrega ya se administra solo (2026-11-06), y
// entra aquí igual que un equipo INDEPENDIENTE (sin liga, ver POST /manage/teams):
// es exactamente el mismo mecanismo de verificación de identidad que cualquier
// otra organización. Publicarlo no: si sale en el home lo decide el propio
// equipo (`show_on_platform`), y viaja aquí solo para que se vea.
//
// El nombre y el logo de un equipo se leen de `teams`: ahí los edita (PUT
// /manage/teams/:id), y no se copian a `organizations`. Van después de `o.*` a
// propósito: de dos columnas con el mismo nombre, en la fila queda la última.
//
// `team` es lo que enseña su ficha (`TeamInfoPanel`), para el botón "Ver": las
// columnas de las lecturas públicas de un equipo en `routes/leagues.js`. Viaja
// aquí, y no en `GET /organizations/:id`, porque aquella ruta es pública y no mira
// si la liga del equipo lo es: publicaría el contacto de una liga privada.
router.get('/organizations', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const orgs = await db.prepare(`
    SELECT o.*, c.name AS country_name, t.show_on_platform AS show_on_platform,
           COALESCE(t.name, o.name) AS name, COALESCE(t.logo_url, o.logo_url) AS logo_url,
           t.league_id AS league_id, l.name AS league_name,
           CASE WHEN t.id IS NOT NULL THEN json_build_object(
             'id', t.id, 'name', t.name, 'logo_url', t.logo_url, 'cover_url', t.cover_url,
             'city', t.city, 'institution', t.institution, 'maps_url', t.maps_url,
             'contact_email', t.contact_email, 'contact_phone', t.contact_phone,
             'facebook_url', t.facebook_url, 'instagram_url', t.instagram_url,
             'twitter_url', t.twitter_url, 'website_url', t.website_url
           ) END AS team
    FROM organizations o
    LEFT JOIN countries c ON c.id = o.country_id
    LEFT JOIN teams t ON t.organization_id = o.id
    LEFT JOIN leagues l ON l.id = t.league_id
    WHERE o.type NOT IN ('league', 'team')
       OR (o.type = 'team' AND (t.league_id IS NULL OR ${orgTieneMiembrosSql('o')}))
    ORDER BY o.is_verified ASC, o.type, o.name
  `).all();
  res.json(orgs);
}));

// Publicar es que la plataforma la muestre: el directorio del home y su página
// para cualquiera. Solo medio/tienda/clínica/marca — una liga tiene su propio
// botón y un equipo independiente decide solo; escribirles `is_public` dejaría
// una fila que dice lo que no hace.
async function setOrganizationPublic(req, res, isPublic) {
  const org = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
  if (!TIPOS_PUBLICABLES.includes(org.type)) {
    return res.status(400).json({
      error: 'Las ligas y los equipos no se publican desde aquí: una liga tiene su propio botón, y un equipo independiente decide solo si sale en el home',
    });
  }
  res.json(await db.prepare('UPDATE organizations SET is_public = ? WHERE id = ? RETURNING *').get(isPublic, org.id));
}

router.put('/organizations/:id/publish', authRequired, adminRequired, asyncHandler(async (req, res) => {
  await setOrganizationPublic(req, res, true);
}));

router.put('/organizations/:id/unpublish', authRequired, adminRequired, asyncHandler(async (req, res) => {
  await setOrganizationPublic(req, res, false);
}));

// Verificar es solo la insignia: ya no publica (hasta el 2026-10-29 sí).
router.put('/organizations/:id/verify', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const org = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
  await db.prepare('UPDATE organizations SET is_verified = TRUE WHERE id = ?').run(req.params.id);
  res.json(await db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id));
}));

router.put('/organizations/:id/unverify', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const org = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
  await db.prepare('UPDATE organizations SET is_verified = FALSE WHERE id = ?').run(req.params.id);
  res.json(await db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id));
}));

// Gestión manual del plan de pago y de la conexión de WhatsApp de una
// organización. Es el reemplazo temporal de un sistema de cobro
// automático: mientras no haya Stripe/Conekta integrado, el admin activa
// aquí el plan a mano cuando el cliente paga por fuera de la plataforma
// (transferencia/PayPal), y pega los datos que Meta le dio a esa tienda
// (phone_number_id) para que el webhook del bot sepa a quién pertenece
// cada número. Ver routes/bot.js para dónde se consultan estos campos.
router.put('/organizations/:id/plan', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const org = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

  const { plan, plan_expires_at, whatsapp_phone_number_id, whatsapp_display_number } = req.body;
  if (plan !== undefined && !['free', 'pro'].includes(plan)) {
    return res.status(400).json({ error: 'El plan debe ser "free" o "pro"' });
  }

  const updated = await db.prepare(`
    UPDATE organizations SET
      plan                     = COALESCE(?, plan),
      plan_expires_at          = ?,
      whatsapp_phone_number_id = COALESCE(?, whatsapp_phone_number_id),
      whatsapp_display_number  = COALESCE(?, whatsapp_display_number)
    WHERE id = ?
    RETURNING *
  `).get(
    plan ?? null,
    plan_expires_at !== undefined ? (plan_expires_at || null) : org.plan_expires_at,
    whatsapp_phone_number_id ?? null,
    whatsapp_display_number ?? null,
    org.id
  );

  res.json(updated);
}));

/* ===================== USUARIOS ===================== */

router.get('/users', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const users = await db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.created_at,
      COUNT(l.id) as league_count
    FROM users u
    LEFT JOIN leagues l ON l.owner_user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();
  res.json(users);
}));

// Borrar una cuenta no vacía un equipo (README, "Borrar una cuenta no vacía un
// equipo", 2026-11-26). `organization_members` se va en cascada con la cuenta, y
// hasta ese día borrar a la única persona de un equipo entregado lo dejaba "sin
// entregar": su liga podía volver a generar el link, reclamarlo ella misma y
// quedarse con el padrón del club. Dos cosas, antes del DELETE:
//
//   1. La cuenta del único dueño de un equipo no se borra. Primero se agrega a
//      otro dueño, desde la misma pantalla.
//   2. Si era la del principal (`teams.owner_user_id`), el puesto pasa a otro
//      dueño. Con la columna vacía, la fila del equipo en el panel de su liga lo
//      enseñaba "Sin entregar", con botones que el servidor después negaba.
//
// Son dos sentencias y no una: si el DELETE fallara después de mover el puesto,
// queda principal otro de sus dueños, que también lo es. Nada que deshacer.
router.delete('/users/:id', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const user = Number.isInteger(id) ? await db.prepare('SELECT * FROM users WHERE id = ?').get(id) : null;
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (user.role === 'admin') return res.status(400).json({ error: 'No puedes eliminar una cuenta de admin' });

  const soloEl = await db.prepare(`
    SELECT COALESCE(t.name, o.name) AS name
    FROM organization_members om
    JOIN organizations o ON o.id = om.organization_id AND o.type = 'team'
    LEFT JOIN teams t ON t.organization_id = o.id
    WHERE om.user_id = ? AND om.status = 'active' AND om.role = 'owner'
      AND NOT EXISTS (
        SELECT 1 FROM organization_members otro
         WHERE otro.organization_id = om.organization_id AND otro.user_id <> om.user_id
           AND otro.status = 'active' AND otro.role = 'owner'
      )
    ORDER BY LOWER(COALESCE(t.name, o.name))
  `).all(user.id);
  const motivo = motivoParaNoBorrarCuenta(soloEl.map((e) => e.name));
  if (motivo) return res.status(motivo.status).json({ error: motivo.error });

  // El dueño más antiguo que quede. Sin otro dueño, la subconsulta da NULL, que es
  // lo que haría el ON DELETE SET NULL de todos modos; con el candado de arriba,
  // eso solo le pasa a una fila vieja sin su miembro.
  await db.prepare(`
    UPDATE teams t SET owner_user_id = (
      SELECT om.user_id FROM organization_members om
       WHERE om.organization_id = t.organization_id AND om.user_id <> ?
         AND om.status = 'active' AND om.role = 'owner'
       ORDER BY om.created_at, om.id
       LIMIT 1
    )
    WHERE t.owner_user_id = ?
  `).run(user.id, user.id);

  await db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  res.json({ ok: true });
}));

/* ===================== AGREGAR SIN LINK ===================== */

// Panel Admin → Usuarios → "Agregar a una organización": a una cuenta que ya
// existe se le da un rol en una organización, sin link y sin que tenga que
// aceptar (README, "Sin link: el Panel Admin agrega a una cuenta que ya existe",
// 2026-11-26). Queda exactamente como si hubiera usado un link. Las reglas que no
// necesitan la base están en utils/accesoSinLink.js.

// La organización con lo que hace falta para decidir: su nombre como se edita —en
// la liga o el equipo de detrás, igual que en GET /admin/organizations—, con quién
// avisar, y si es un equipo sin nadie adentro, donde agregar es la entrega.
const ORGANIZACION_PARA_AGREGAR = `
  SELECT o.id, o.type,
         COALESCE(l.name, t.name, o.name) AS name,
         COALESCE(l.logo_url, t.logo_url, o.logo_url) AS logo_url,
         l.id AS league_id, t.id AS team_id, t.league_id AS team_league_id, tl.name AS league_name,
         (o.type = 'team' AND NOT ${orgTieneMiembrosSql('o')}) AS vacio
  FROM organizations o
  LEFT JOIN leagues l  ON l.organization_id = o.id
  LEFT JOIN teams t    ON t.organization_id = o.id
  LEFT JOIN leagues tl ON tl.id = t.league_id
`;

// Una liga o un equipo que se borró y dejó su organización (PD-42).
const sinEntidad = (org) => (org.type === 'league' && !org.league_id) || (org.type === 'team' && !org.team_id);

const rolesConEtiqueta = (tipo, vacio) => rolesSinLink(tipo, { vacio })
  .map((value) => ({ value, label: etiquetaDeRol(value, tipo) }));

// Lo que pinta la ventana: la persona, dónde está hoy y las organizaciones a las
// que se puede agregar, cada una con los roles que ahí se dan y si es una entrega.
// Las ligas primero, luego los equipos y al final las demás, por nombre.
router.get('/users/:id/organizations', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const user = Number.isInteger(id)
    ? await db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(id)
    : null;
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const filas = await db.prepare(`
    SELECT org.*, mine.role AS member_role
    FROM (${ORGANIZACION_PARA_AGREGAR}) org
    LEFT JOIN organization_members mine
           ON mine.organization_id = org.id AND mine.user_id = ? AND mine.status = 'active'
    ORDER BY CASE org.type WHEN 'league' THEN 0 WHEN 'team' THEN 1 ELSE 2 END, LOWER(org.name), org.id
  `).all(user.id);

  const organizations = filas
    .filter((org) => !sinEntidad(org))
    .map((org) => ({
      id: org.id,
      type: org.type,
      name: org.name,
      logo_url: org.logo_url,
      league_name: org.league_name,
      handover: org.vacio === true,
      roles: rolesConEtiqueta(org.type, org.vacio === true),
      member_role: org.member_role,
      member_role_label: org.member_role ? etiquetaDeRol(org.member_role, org.type) : null,
    }));

  res.json({
    user,
    memberships: organizations
      .filter((org) => org.member_role)
      .map((org) => ({ organization_id: org.id, name: org.name, type: org.type, role: org.member_role, role_label: org.member_role_label })),
    organizations,
  });
}));

// Agrega a `user_id` con `role`. En un equipo sin nadie adentro es la entrega: el
// dueño y `teams.owner_user_id` en una sola sentencia, como el claim de un link de
// entrega (routes/invites.js), y el aviso a su liga.
//
// El aviso va después y aparte, igual que en el claim: es una fila de
// `notifications` con su INSERT … VALUES, que es lo que la prueba del catálogo de
// avisos sabe leer. Si fallara, la persona ya entró, que es lo que importa.
router.post('/organizations/:id/members', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const org = Number.isInteger(id) ? await db.prepare(`${ORGANIZACION_PARA_AGREGAR} WHERE o.id = ?`).get(id) : null;

  const userId = Number(req.body?.user_id);
  const cuenta = Number.isInteger(userId)
    ? await db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(userId)
    : null;
  const actual = org && cuenta
    ? await db.prepare(
      `SELECT role FROM organization_members WHERE organization_id = ? AND user_id = ? AND status = 'active'`
    ).get(org.id, cuenta.id)
    : null;

  const role = req.body?.role;
  const vacio = org?.vacio === true;
  const motivo = motivoParaNoAgregar({
    organizacion: org && { name: org.name, type: org.type, sinEntidad: sinEntidad(org) },
    cuenta,
    quienAgrega: req.user,
    rol: role,
    rolActual: actual?.role ?? null,
    vacio,
  });
  if (motivo) return res.status(motivo.status).json({ error: motivo.error, ...(motivo.roles ? { roles: motivo.roles } : {}) });

  const roleLabel = etiquetaDeRol(role, org.type);
  const yaEstaba = () => res.status(409).json({
    error: `${cuenta.name} ya es parte de ${org.name}. Su rol se cambia desde el panel de ${org.name}, con «Cambiar rol».`,
  });

  if (vacio) {
    // `owner_user_id IS NULL` cierra la carrera con un link de entrega que alguien
    // reclame al mismo instante: el segundo espera el candado de la fila, la
    // vuelve a leer ya con dueño y no la toca.
    const r = await db.prepare(`
      WITH entregado AS (
        UPDATE teams SET owner_user_id = ?
         WHERE organization_id = ? AND owner_user_id IS NULL
        RETURNING organization_id
      ), alta AS (
        INSERT INTO organization_members (organization_id, user_id, role, status)
        SELECT organization_id, ?, 'owner', 'active' FROM entregado
        ON CONFLICT (organization_id, user_id)
        DO UPDATE SET role = 'owner', status = 'active'
        RETURNING 1
      )
      SELECT (SELECT COUNT(*) FROM entregado)::int AS entregados
    `).get(cuenta.id, org.id, cuenta.id);
    if (r.entregados === 0) {
      return res.status(409).json({
        error: `${org.name} se acaba de entregar por otro lado. Vuelve a abrir la ventana para ver quién lo administra.`,
      });
    }

    if (org.team_league_id) {
      await db.prepare(`
        INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
        VALUES ('league', ?, 'team_claimed', ?, ?, ?)
      `).run(
        org.team_league_id,
        `${org.name} tomó control de su perfil`,
        `CFBAMX le entregó el perfil a ${cuenta.name}, que ahora administra su información.`,
        JSON.stringify({ team_id: org.team_id, team_name: org.name, user_id: cuenta.id, user_name: cuenta.name, by: 'admin' })
      );
    }
  } else {
    // El ON CONFLICT solo alcanza a una fila que no esté activa; a un miembro
    // activo ya se le contestó arriba. Si entró en el instante de en medio, no
    // regresa fila y se le dice lo mismo.
    const alta = await db.prepare(`
      INSERT INTO organization_members (organization_id, user_id, role, status)
      VALUES (?, ?, ?, 'active')
      ON CONFLICT (organization_id, user_id)
      DO UPDATE SET role = EXCLUDED.role, status = 'active'
      WHERE organization_members.status <> 'active'
      RETURNING id
    `).get(org.id, cuenta.id, role);
    if (!alta) return yaEstaba();

    // A la bandeja de la liga o del equipo de detrás, como el claim de un link.
    // A un medio o una tienda no les llega nada: `notifications` solo recibe
    // avisos de ligas y equipos.
    const destino = org.league_id ? { tipo: 'league', id: org.league_id } : org.team_id ? { tipo: 'team', id: org.team_id } : null;
    if (destino) {
      await db.prepare(`
        INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
        VALUES (?, ?, 'org_admin_claimed', ?, ?, ?)
      `).run(
        destino.tipo,
        destino.id,
        `${cuenta.name} entró a ${org.name}`,
        `CFBAMX le dio acceso como ${roleLabel}, sin link de invitación.`,
        JSON.stringify({ organization_id: org.id, user_id: cuenta.id, user_name: cuenta.name, role, by: 'admin' })
      );
    }
  }

  res.status(201).json({
    ok: true,
    organization_id: org.id,
    user_id: cuenta.id,
    role,
    role_label: roleLabel,
    handover: vacio,
  });
}));

/* ===================== PATROCINADORES ===================== */

router.get('/sponsors', asyncHandler(async (req, res) => {
  const sponsors = await db.prepare('SELECT * FROM sponsors ORDER BY sort_order ASC').all();
  res.json(sponsors);
}));

router.post('/sponsors', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const { name, logo_url, link_url, sort_order } = req.body;
  if (!logo_url) return res.status(400).json({ error: 'El logo es obligatorio' });

  const count = await db.prepare('SELECT COUNT(*) as count FROM sponsors').get();
  if (count.count >= 4) return res.status(400).json({ error: 'Solo se permiten 4 patrocinadores' });

  const result = await db.prepare(`
    INSERT INTO sponsors (name, logo_url, link_url, sort_order)
    VALUES (?, ?, ?, ?)
  `).run(name || null, logo_url, link_url || null, sort_order || count.count + 1);

  res.status(201).json(await db.prepare('SELECT * FROM sponsors WHERE id = ?').get(result.lastInsertRowid));
}));

router.put('/sponsors/:id', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const { name, logo_url, link_url, sort_order } = req.body;
  const sponsor = await db.prepare('SELECT * FROM sponsors WHERE id = ?').get(req.params.id);
  if (!sponsor) return res.status(404).json({ error: 'Patrocinador no encontrado' });

  await db.prepare(`
    UPDATE sponsors SET
      name       = COALESCE(?, name),
      logo_url   = COALESCE(?, logo_url),
      link_url   = COALESCE(?, link_url),
      sort_order = COALESCE(?, sort_order)
    WHERE id = ?
  `).run(name ?? null, logo_url ?? null, link_url ?? null, sort_order ?? null, sponsor.id);

  res.json(await db.prepare('SELECT * FROM sponsors WHERE id = ?').get(sponsor.id));
}));

router.delete('/sponsors/:id', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const sponsor = await db.prepare('SELECT * FROM sponsors WHERE id = ?').get(req.params.id);
  if (!sponsor) return res.status(404).json({ error: 'Patrocinador no encontrado' });
  await db.prepare('DELETE FROM sponsors WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

export default router;
