import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { isValidUrl, isNonEmptyString } from '../utils/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isOrgMember } from '../utils/orgMembers.js';
import { organizationAdminRequired } from '../middleware/ownership.js';

const router = express.Router();

function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Tipos que se registran por este endpoint genérico. "league" y "team"
// quedan fuera a propósito — esos siguen su flujo especializado de siempre
// (POST /leagues, POST /manage/leagues/:id/teams para un equipo de liga,
// POST /manage/teams para un equipo independiente sin liga), con sus
// propios campos (venues, torneos, categorías...) que no tiene sentido
// generalizar. Este endpoint es solo para los tipos de organización
// nuevos, que no necesitan nada de esa estructura deportiva. Los tres
// flujos de equipo/liga terminan creando la misma fila en "organizations"
// por debajo (type='team'/'league'), así que comparten el mismo mecanismo
// de verificación (is_verified) que estos tipos genéricos.
const REGISTERABLE_TYPES = ['media', 'store', 'clinic', 'brand'];

router.get('/types', (req, res) => {
  res.json({
    types: [
      { value: 'media', label: 'Medio de comunicación' },
      { value: 'store', label: 'Tienda / proveedor deportivo' },
      { value: 'clinic', label: 'Clínica de rehabilitación / medicina deportiva' },
      { value: 'brand', label: 'Marca / patrocinador' },
    ],
  });
});

// Catálogo de países para el selector del formulario de registro. Público,
// sin authRequired — es información de referencia, no de una cuenta.
router.get('/countries', asyncHandler(async (req, res) => {
  const countries = await db.prepare('SELECT id, code, name FROM countries ORDER BY name').all();
  res.json({ countries });
}));

// Directorio público de organizaciones verificadas — lo que alimenta la
// sección "Medios de comunicación" (y a futuro, proveedores/tiendas/
// clínicas) del home. Solo trae verificadas: is_verified es justo el
// filtro que decide qué se hace público, como se definió desde el paso 1.
router.get('/', asyncHandler(async (req, res) => {
  const { type } = req.query;
  const params = [];
  let sql = `
    SELECT o.id, o.name, o.slug, o.type, o.logo_url, o.description, o.website_url, c.name AS country_name
    FROM organizations o
    LEFT JOIN countries c ON c.id = o.country_id
    WHERE o.is_verified = TRUE AND o.status = 'active'
  `;
  if (type) {
    sql += ' AND o.type = ?';
    params.push(type);
  } else {
    sql += " AND o.type NOT IN ('league', 'team')";
  }
  sql += ' ORDER BY o.name';
  const organizations = await db.prepare(sql).all(...params);
  res.json({ organizations });
}));

router.post('/', authRequired, asyncHandler(async (req, res) => {
  const { type, name, country_id, logo_url, description, website_url } = req.body;

  if (!REGISTERABLE_TYPES.includes(type)) {
    return res.status(400).json({ error: `Tipo inválido. Debe ser uno de: ${REGISTERABLE_TYPES.join(', ')}` });
  }
  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (logo_url && !isValidUrl(logo_url)) return res.status(400).json({ error: 'El logo no es una dirección web válida' });
  if (website_url && !isValidUrl(website_url)) return res.status(400).json({ error: 'El sitio web no es válido' });

  let slug = slugify(name);
  const existing = await db.prepare('SELECT id FROM organizations WHERE slug = ?').get(slug);
  if (existing) slug = `${slug}-${Date.now().toString().slice(-5)}`;

  const org = await db.prepare(`
    INSERT INTO organizations (name, slug, type, country_id, logo_url, description, website_url, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    RETURNING *
  `).get(name.trim(), slug, type, country_id || null, logo_url || null, description || null, website_url || null);

  // Quien la registra queda como owner — mismo patrón que leagues.owner_user_id,
  // pero aquí directo en organization_members porque este tipo de
  // organización no tiene una tabla propia (leagues/teams) por debajo.
  await db.prepare(`
    INSERT INTO organization_members (organization_id, user_id, role)
    VALUES (?, ?, 'owner')
  `).run(org.id, req.user.id);

  res.status(201).json(org);
}));

// Público, sin authRequired — mismo criterio que la tarjeta del jugador:
// el perfil de un medio/proveedor/tienda/clínica debe poder verse sin
// necesitar sesión, igual que cualquier liga o equipo hoy.
router.get('/:id', asyncHandler(async (req, res) => {
  const org = await db.prepare(`
    SELECT o.*, c.name AS country_name
    FROM organizations o
    LEFT JOIN countries c ON c.id = o.country_id
    WHERE o.id = ?
  `).get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
  res.json(org);
}));

router.put('/:id', authRequired, asyncHandler(async (req, res) => {
  const org = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

  // league y team NO se editan aquí — tienen su propio endpoint
  // especializado (PUT /leagues/:id, PUT /manage/teams/:id) con su propia
  // validación de campos deportivos. Editarlos por aquí duplicaría lógica
  // y podría dejarlos inconsistentes con esas rutas.
  if (org.type === 'league' || org.type === 'team') {
    return res.status(400).json({ error: 'Las ligas y equipos se editan desde su propio panel, no aquí' });
  }

  const isMember = await isOrgMember(req.user.id, org.id, ['owner', 'admin']);
  if (req.user.role !== 'admin' && !isMember) {
    return res.status(403).json({ error: 'No tienes permiso sobre esta organización' });
  }

  const { name, country_id, logo_url, description, website_url } = req.body;
  if (name !== undefined && !isNonEmptyString(name)) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
  if (logo_url && !isValidUrl(logo_url)) return res.status(400).json({ error: 'El logo no es una dirección web válida' });
  if (website_url && !isValidUrl(website_url)) return res.status(400).json({ error: 'El sitio web no es válido' });

  const updated = await db.prepare(`
    UPDATE organizations SET
      name = ?, country_id = ?, logo_url = ?, description = ?, website_url = ?
    WHERE id = ?
    RETURNING *
  `).get(
    name !== undefined ? name.trim() : org.name,
    country_id !== undefined ? country_id : org.country_id,
    logo_url !== undefined ? logo_url : org.logo_url,
    description !== undefined ? description : org.description,
    website_url !== undefined ? website_url : org.website_url,
    org.id
  );

  res.json(updated);
}));

/* ===================== ADMINISTRADORES DE LA ORGANIZACIÓN ===================== */
// Quiénes tienen acceso hoy al panel de esta liga/equipo/organización, vía
// organization_members. Mismo permiso que para invitar a uno nuevo: cualquier
// administrador actual puede ver la lista, no hace falta ser el owner.
router.get('/:id/members', authRequired, organizationAdminRequired, asyncHandler(async (req, res) => {
  const members = await db.prepare(`
    SELECT om.id, om.user_id, om.role, om.created_at, u.name, u.email
    FROM organization_members om
    JOIN users u ON u.id = om.user_id
    WHERE om.organization_id = ? AND om.status = 'active'
    ORDER BY om.created_at ASC
  `).all(req.organization.id);
  res.json({ members });
}));

// Quita a alguien como administrador — o te retiras tú, que es el mismo
// endpoint: quitarse a uno mismo siempre estuvo permitido aquí, lo que faltaba
// era que de verdad surtiera efecto (ver el bloque de abajo sobre el principal).
//
// Dos candados, y son distintos:
//   1. No se deja vaciar la organización: si solo queda un administrador, hay
//      que invitar a otro antes (nadie se queda sin quien la administre).
//   2. Al **administrador principal** no se le quita el acceso desde aquí. No
//      es una regla de cortesía: `leagues.owner_user_id`/`teams.owner_user_id`
//      lo siguen autorizando por el respaldo de `middleware/ownership.js`, así
//      que borrar su fila de organization_members lo sacaba de la lista sin
//      quitarle nada — la pantalla decía que había perdido el acceso y no era
//      cierto. Primero se cede el puesto (POST /:id/transfer-owner, que mueve
//      las dos cosas a la vez), y entonces sí se puede quitar o retirarse.
router.delete('/:id/members/:userId', authRequired, organizationAdminRequired, asyncHandler(async (req, res) => {
  const targetUserId = Number(req.params.userId);
  const esYoMismo = targetUserId === req.user.id;

  const target = await db.prepare(
    `SELECT role FROM organization_members WHERE organization_id = ? AND user_id = ? AND status = 'active'`
  ).get(req.organization.id, targetUserId);
  if (!target) {
    return res.status(404).json({ error: 'Esa persona no administra esta organización' });
  }

  const { count } = await db.prepare(
    `SELECT COUNT(*)::int AS count FROM organization_members WHERE organization_id = ? AND status = 'active'`
  ).get(req.organization.id);
  if (count <= 1) {
    return res.status(400).json({
      error: esYoMismo
        ? 'Eres la única persona que administra esto — invita a alguien más antes de retirarte'
        : 'No puedes quitar al único administrador — invita a alguien más antes de quitar este acceso',
    });
  }

  if (target.role === 'owner') {
    return res.status(409).json({
      error: esYoMismo
        ? 'Eres el administrador principal — nombra a otro administrador principal antes de retirarte'
        : 'Es el administrador principal — hay que nombrar a otro antes de quitarle el acceso',
    });
  }

  await db.prepare(
    `DELETE FROM organization_members WHERE organization_id = ? AND user_id = ?`
  ).run(req.organization.id, targetUserId);

  res.json({ ok: true });
}));

// Cede el puesto de administrador principal a otro administrador ya existente.
//
// Mueve DOS cosas que tienen que viajar juntas o no viajar: el `role` en
// organization_members y el `owner_user_id` de la liga o el equipo detrás de
// esta organización. Si se movieran por separado, quedaría un principal en la
// lista y otro distinto autorizado por el respaldo de ownership.js — que es
// exactamente el desajuste que hacía que "quitar" no quitara nada.
//
// Va en UNA sola sentencia con CTEs, no en varias seguidas, porque `db.prepare`
// toma una conexión del pool por consulta (y del otro lado hay un pooler en
// modo transacción): un BEGIN/COMMIT repartido en varias llamadas no tiene
// garantizada la misma conexión. Una sentencia sí es atómica pase lo que pase.
router.post('/:id/transfer-owner', authRequired, organizationAdminRequired, asyncHandler(async (req, res) => {
  const nuevoUserId = Number(req.body?.userId);
  if (!nuevoUserId) {
    return res.status(400).json({ error: 'Falta decir a quién se le cede el puesto' });
  }

  const principalActual = await db.prepare(
    `SELECT user_id FROM organization_members WHERE organization_id = ? AND role = 'owner' AND status = 'active'`
  ).get(req.organization.id);

  // A diferencia de invitar (que cualquier administrador puede hacer), ceder
  // el puesto solo lo decide quien lo tiene — si no, un invitado podría
  // nombrarse principal a sí mismo y después quitar a quien lo invitó.
  if (req.user.role !== 'admin' && principalActual?.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Solo el administrador principal puede nombrar a otro' });
  }
  if (principalActual?.user_id === nuevoUserId) {
    return res.status(400).json({ error: 'Esa persona ya es la administradora principal' });
  }

  const destino = await db.prepare(
    `SELECT 1 FROM organization_members WHERE organization_id = ? AND user_id = ? AND status = 'active'`
  ).get(req.organization.id, nuevoUserId);
  if (!destino) {
    return res.status(400).json({ error: 'Esa persona todavía no administra esto — invítala primero' });
  }

  // Las dos ramas `UPDATE ... leagues` / `UPDATE ... teams` no se estorban:
  // una organización es de una liga o de un equipo, nunca de las dos, así que
  // la que no aplique afecta cero filas.
  await db.prepare(`
    WITH ceder AS (
      UPDATE organization_members SET role = 'admin'
       WHERE organization_id = ? AND role = 'owner' AND status = 'active'
      RETURNING user_id
    ), recibir AS (
      UPDATE organization_members SET role = 'owner'
       WHERE organization_id = ? AND user_id = ? AND status = 'active'
      RETURNING user_id
    ), liga AS (
      UPDATE leagues SET owner_user_id = ? WHERE organization_id = ?
      RETURNING id
    )
    UPDATE teams SET owner_user_id = ? WHERE organization_id = ?
  `).run(
    req.organization.id,
    req.organization.id, nuevoUserId,
    nuevoUserId, req.organization.id,
    nuevoUserId, req.organization.id
  );

  res.json({ ok: true });
}));

export default router;
