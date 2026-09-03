import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

// Middleware: solo admin
function adminRequired(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso restringido a administradores' });
  }
  next();
}

/* ===================== ESTADÍSTICAS ===================== */

router.get('/stats', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const [leagues, users, matches, teams, homeViews, homeViewsByDay] = await Promise.all([
    db.prepare('SELECT COUNT(*) as count FROM leagues').get(),
    db.prepare('SELECT COUNT(*) as count FROM users').get(),
    db.prepare('SELECT COUNT(*) as count FROM matches').get(),
    db.prepare('SELECT COUNT(*) as count FROM teams').get(),
    db.prepare(`SELECT COUNT(*) as count FROM page_views WHERE event_type = 'home_view'`).get(),
    db.prepare(`
      SELECT created_at::date as day, COUNT(*) as count
      FROM page_views
      WHERE event_type = 'home_view'
        AND created_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY day
      ORDER BY day ASC
    `).all(),
  ]);
  res.json({
    leagues: leagues.count,
    users:   users.count,
    matches: matches.count,
    teams:   teams.count,
    homeViews: {
      total: Number(homeViews.count),
      last30Days: homeViewsByDay.map((row) => ({
        day: row.day,
        count: Number(row.count),
      })),
    },
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
// clínica/marca). Para "medio" en particular, esto es lo que habilita
// aparecer en el directorio público y autoasignarse a partidos.
router.get('/organizations', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const orgs = await db.prepare(`
    SELECT o.*, c.name AS country_name
    FROM organizations o
    LEFT JOIN countries c ON c.id = o.country_id
    WHERE o.type NOT IN ('league', 'team')
    ORDER BY o.is_verified ASC, o.type, o.name
  `).all();
  res.json(orgs);
}));

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

router.delete('/users/:id', authRequired, adminRequired, asyncHandler(async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (user.role === 'admin') return res.status(400).json({ error: 'No puedes eliminar una cuenta de admin' });
  await db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
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
