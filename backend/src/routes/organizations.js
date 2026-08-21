import express from 'express';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { isValidUrl, isNonEmptyString } from '../utils/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isOrgMember } from '../utils/orgMembers.js';

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
// (POST /leagues, POST /manage/leagues/:id/teams), con sus propios campos
// (venues, torneos, categorías...) que no tiene sentido generalizar. Este
// endpoint es solo para los tipos de organización nuevos, que no necesitan
// nada de esa estructura deportiva.
const REGISTERABLE_TYPES = ['media', 'supplier', 'store', 'clinic', 'brand'];

router.get('/types', (req, res) => {
  res.json({
    types: [
      { value: 'media', label: 'Medio de comunicación' },
      { value: 'supplier', label: 'Proveedor de uniformes / equipo' },
      { value: 'store', label: 'Tienda deportiva' },
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

export default router;
