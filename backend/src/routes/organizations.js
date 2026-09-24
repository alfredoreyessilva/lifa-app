import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { isValidUrl, isNonEmptyString } from '../utils/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isOrgMember } from '../utils/orgMembers.js';
import { organizationAdminRequired } from '../middleware/ownership.js';
import { rolesDeTipo, etiquetaDeRol, puede, esRolValido } from '../utils/orgRoles.js';

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
// Los roles que se pueden repartir en ESTA organización — lo que el selector
// de "invitar" necesita saber y no puede deducir solo.
//
// Sale del catálogo y viaja por la API en vez de vivir repetido en el
// frontend, por la regla 6: los roles válidos dependen del tipo de
// organización y sus etiquetas también (un `treasurer` se lee "Tesorero de
// liga" en una liga y "Tesorero" en un equipo). Dos listas separadas se
// separan, y la que se desactualizaría es la que no toca la base.
//
// `grantable` es por quien pregunta, no por la organización: un administrador
// ve el rol de dueño en la lista —tiene que poder leer que existe— pero no lo
// puede repartir. Es la misma regla que aplica POST /invites/organizations/:id/admins,
// y se manda ya resuelta para que el selector no tenga que volver a deducirla.
router.get('/:id/roles', authRequired, organizationAdminRequired, asyncHandler(async (req, res) => {
  const puedeNombrarDuenos = puede(req.organization.type, req.orgRole, 'duenos');
  const roles = rolesDeTipo(req.organization.type).map((value) => ({
    value,
    label: etiquetaDeRol(value, req.organization.type),
    grantable: value === 'owner' ? puedeNombrarDuenos : true,
  }));
  res.json({ roles });
}));

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

  // La etiqueta la arma el backend por la misma razón que en las
  // invitaciones: `editor` no se lee nunca "editor" a secas y `treasurer`
  // cambia de nombre según el tipo. `role` crudo se sigue mandando porque es
  // lo que identifica la fila; la etiqueta es para pintarla.
  res.json({
    members: members.map((m) => ({ ...m, role_label: etiquetaDeRol(m.role, req.organization.type) })),
  });
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

// Cambia el rol de alguien que ya está adentro (2026-09-23). Hasta aquí la
// única forma de cambiar un rol era mandarle a esa persona una invitación
// nueva, y por eso el claim reescribía el rol de quien ya era miembro. Desde
// que un link es para alguien que todavía no está (README, "Dos links
// distintos: la entrega y la invitación con rol"), esa puerta se cerró y esta
// es la que la reemplaza.
//
// Pide lo mismo que invitar: el permiso `miembros` (lo revisa la guarda), y
// nombrar dueños es solo de quien tiene `duenos`. Y a un dueño no se le cambia
// el rol desde aquí: es el mismo candado que tiene DELETE para quitarlo, por
// la misma razón — el respaldo por `owner_user_id` de ownership.js lo seguiría
// autorizando, y la pantalla diría algo que no es cierto. Si ese candado se
// angosta algún día (PD-32), se angosta en los dos lugares.
router.patch('/:id/members/:userId', authRequired, organizationAdminRequired, asyncHandler(async (req, res) => {
  const targetUserId = Number(req.params.userId);
  const role = req.body?.role;

  if (!esRolValido(req.organization.type, role)) {
    return res.status(400).json({
      error: 'Ese rol no existe para este tipo de organización',
      roles: rolesDeTipo(req.organization.type),
    });
  }

  const target = await db.prepare(
    `SELECT role FROM organization_members WHERE organization_id = ? AND user_id = ? AND status = 'active'`
  ).get(req.organization.id, targetUserId);
  if (!target) {
    return res.status(404).json({ error: 'Esa persona no administra esta organización' });
  }

  if (target.role === 'owner') {
    return res.status(409).json({ error: 'A un dueño no se le cambia el rol desde aquí' });
  }
  if (role === 'owner' && !puede(req.organization.type, req.orgRole, 'duenos')) {
    return res.status(403).json({ error: 'Solo un dueño puede nombrar a otro dueño' });
  }

  // `role <> 'owner'` repite el candado de arriba dentro de la sentencia: entre
  // la lectura y la escritura alguien pudo haber nombrado dueño a esta persona.
  await db.prepare(`
    UPDATE organization_members SET role = ?
     WHERE organization_id = ? AND user_id = ? AND status = 'active' AND role <> 'owner'
  `).run(role, req.organization.id, targetUserId);

  res.json({ ok: true, user_id: targetUserId, role, role_label: etiquetaDeRol(role, req.organization.type) });
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

  // Quién puede ceder: un DUEÑO, y lo que cede es lo suyo.
  //
  // Antes esto preguntaba "¿eres el owner?" buscando la única fila con ese
  // rol. Desde el paso 4 puede haber varios dueños a la vez, así que esa
  // consulta devolvía uno al azar y solo ese podía ceder — los demás dueños
  // se quedaban fuera de una decisión que sí les toca. Ahora se pregunta por
  // el permiso, que es lo que `utils/orgRoles.js` sabe contestar, y quien cede
  // es quien llama. Un administrador sigue sin poder: nombrarse principal a sí
  // mismo y después quitar a quien lo invitó es exactamente la escalera que
  // este candado existe para cortar.
  if (req.user.role !== 'admin' && !puede(req.organization.type, req.orgRole, 'duenos')) {
    return res.status(403).json({ error: 'Solo un dueño puede ceder el puesto principal' });
  }
  if (nuevoUserId === req.user.id) {
    return res.status(400).json({ error: 'Ya tienes tú el puesto' });
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
  // `user_id = ?` y NO `role = 'owner'`: desde el paso 4 puede haber VARIOS
  // dueños a la vez, y degradarlos a todos para promover a uno los tumbaba a
  // los dos de un golpe. Solo se mueve quien de verdad cede — el que hoy tiene
  // el puesto—, y los demás dueños se quedan como estaban.
  await db.prepare(`
    WITH ceder AS (
      UPDATE organization_members SET role = 'admin'
       WHERE organization_id = ? AND user_id = ? AND status = 'active'
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
    req.organization.id, req.user.id,
    req.organization.id, nuevoUserId,
    nuevoUserId, req.organization.id,
    nuevoUserId, req.organization.id
  );

  res.json({ ok: true });
}));

export default router;
