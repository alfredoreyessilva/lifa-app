import express from 'express';
import db from '../config/db.js';
import { authRequired, optionalAuth } from '../middleware/auth.js';
import { isNonEmptyString, isValidUrl } from '../utils/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isOrgMember, puedeVerOrganizacion } from '../utils/orgMembers.js';
import { existenciasSiguenValiendo, leerExistenciasPorTalla } from '../utils/compras.js';

const router = express.Router();

// Helper compartido: confirma que la organización existe y que quien hace
// la petición tiene permiso sobre ella (admin de la plataforma, o miembro
// con rol owner/admin/editor de esa organización puntual). Se usa en las
// tres rutas protegidas de abajo para no repetir la misma verificación.
async function assertOrgAccess(req, res, organizationId) {
  const org = await db.prepare('SELECT id FROM organizations WHERE id = ?').get(organizationId);
  if (!org) {
    res.status(404).json({ error: 'Organización no encontrada' });
    return null;
  }
  const isMember = await isOrgMember(req.user.id, org.id);
  if (req.user.role !== 'admin' && !isMember) {
    res.status(403).json({ error: 'No tienes permiso sobre esta organización' });
    return null;
  }
  return org;
}

// Vacío es NULL —"Precio a consultar", "Sin registrar"—, venga como '' o como
// null. Hasta el 2026-11-14 un null se volvía 0 con Number(null): la ventana del
// producto manda null cuando el campo va vacío, así que un producto sin precio
// salía en la vitrina en "$0" y uno sin existencias, "Agotado".
const numeroOpcional = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

function validateProductFields(body, { partial } = {}) {
  const { name, price, stock } = body;
  if (!partial || name !== undefined) {
    if (!isNonEmptyString(name)) return 'El nombre del producto es obligatorio';
  }
  if (price !== undefined && price !== null && price !== '' && Number.isNaN(Number(price))) {
    return 'El precio debe ser un número';
  }
  if (stock !== undefined && stock !== null && stock !== '' && !Number.isInteger(Number(stock))) {
    return 'El stock debe ser un número entero';
  }
  if (body.image_url && !isValidUrl(body.image_url)) return 'La imagen no es una dirección web válida';
  return null;
}

// Las existencias por talla (README, "Compras en la vitrina" → "Existencias,
// también por talla"): opcionales, de todas las tallas o de ninguna. Cuando
// están, `stock` es su suma, para que el bot, el panel y "Agotado" sigan leyendo
// una sola columna. Si la tienda cambia sus tallas sin tocar las casillas, las
// existencias por talla viejas ya no dicen nada y el producto vuelve a un solo
// número, el que ya tenía.
function existenciasDelCuerpo(body, existing = null) {
  const tallas = body.size_variant !== undefined ? body.size_variant : existing?.size_variant;
  if (body.size_stock !== undefined) {
    const r = leerExistenciasPorTalla(body.size_stock, tallas);
    if (r.error) return { error: r.error };
    return r.sizeStock ? { sizeStock: r.sizeStock, stock: r.stock } : { sizeStock: null };
  }
  if (existing?.size_stock && !existenciasSiguenValiendo(existing.size_stock, tallas)) return { sizeStock: null };
  return null;
}

// Listado público del inventario de una organización — lo consume el
// perfil público (OrganizationDetailPage). Filtra por is_active (existe y
// se vende) Y show_on_platform (la tienda decidió que esto sí es del
// nicho y quiere que se vea en CFBAMX). El bot de WhatsApp NO usa este
// endpoint — usa el catálogo completo directo desde bot.js, porque ahí sí
// debe poder responder sobre cualquier producto, sea o no del nicho.
// Sin authRequired a propósito, igual que GET /organizations/:id — y con su
// mismo criterio: el catálogo de una tienda privada no existe para el público,
// solo para quien la administra (README, "Organizaciones: publicar y
// verificar").
router.get('/organization/:organizationId', optionalAuth, asyncHandler(async (req, res) => {
  const org = await db.prepare('SELECT id, type, is_public FROM organizations WHERE id = ?').get(req.params.organizationId);
  if (!org || !(await puedeVerOrganizacion(req.user, org))) {
    return res.status(404).json({ error: 'Organización no encontrada' });
  }
  const products = await db.prepare(`
    SELECT id, organization_id, name, description, price, currency, stock, size_stock, size_variant, image_url
    FROM products
    WHERE organization_id = ? AND is_active = TRUE AND show_on_platform = TRUE
    ORDER BY created_at DESC
  `).all(org.id);
  res.json({ products });
}));

// Listado completo (incluye inactivos) para el dueño de la tienda desde su
// panel de inventario — por eso sí requiere permiso sobre la organización.
router.get('/organization/:organizationId/manage', authRequired, asyncHandler(async (req, res) => {
  const org = await assertOrgAccess(req, res, req.params.organizationId);
  if (!org) return;

  const products = await db.prepare(`
    SELECT * FROM products WHERE organization_id = ? ORDER BY created_at DESC
  `).all(org.id);
  res.json({ products });
}));

router.post('/organization/:organizationId', authRequired, asyncHandler(async (req, res) => {
  const org = await assertOrgAccess(req, res, req.params.organizationId);
  if (!org) return;

  const error = validateProductFields(req.body);
  if (error) return res.status(400).json({ error });
  const porTalla = existenciasDelCuerpo(req.body);
  if (porTalla?.error) return res.status(400).json({ error: porTalla.error });

  const { name, description, price, currency, stock, size_variant, image_url, show_on_platform } = req.body;
  const product = await db.prepare(`
    INSERT INTO products (organization_id, name, description, price, currency, stock, size_stock, size_variant, image_url, show_on_platform)
    VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?)
    RETURNING *
  `).get(
    org.id,
    name.trim(),
    description || null,
    numeroOpcional(price),
    currency || 'MXN',
    porTalla?.sizeStock ? porTalla.stock : numeroOpcional(stock),
    porTalla?.sizeStock ? JSON.stringify(porTalla.sizeStock) : null,
    size_variant || null,
    image_url || null,
    show_on_platform !== undefined ? show_on_platform : true
  );

  res.status(201).json(product);
}));

router.put('/:id', authRequired, asyncHandler(async (req, res) => {
  const existing = await db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

  const org = await assertOrgAccess(req, res, existing.organization_id);
  if (!org) return;

  const error = validateProductFields(req.body, { partial: true });
  if (error) return res.status(400).json({ error });
  const porTalla = existenciasDelCuerpo(req.body, existing);
  if (porTalla?.error) return res.status(400).json({ error: porTalla.error });

  const { name, description, price, currency, stock, size_variant, image_url, is_active, show_on_platform } = req.body;
  // Con existencias por talla, el número del producto es su suma, y uno suelto que
  // llegue no la pisa; si se quitaron, el que mande la ventana, o el que ya tenía.
  let existencias;
  if (porTalla?.sizeStock) existencias = porTalla.stock;
  else if (porTalla === null && existing.size_stock) existencias = existing.stock;
  else existencias = stock !== undefined ? numeroOpcional(stock) : existing.stock;
  const existenciasPorTalla = porTalla
    ? (porTalla.sizeStock ? JSON.stringify(porTalla.sizeStock) : null)
    : (existing.size_stock ? JSON.stringify(existing.size_stock) : null);
  const updated = await db.prepare(`
    UPDATE products SET
      name = ?, description = ?, price = ?, currency = ?, stock = ?, size_stock = ?::jsonb,
      size_variant = ?, image_url = ?, is_active = ?, show_on_platform = ?, updated_at = NOW()
    WHERE id = ?
    RETURNING *
  `).get(
    name !== undefined ? name.trim() : existing.name,
    description !== undefined ? description : existing.description,
    price !== undefined ? numeroOpcional(price) : existing.price,
    currency !== undefined ? currency : existing.currency,
    existencias,
    existenciasPorTalla,
    size_variant !== undefined ? size_variant : existing.size_variant,
    image_url !== undefined ? image_url : existing.image_url,
    is_active !== undefined ? is_active : existing.is_active,
    show_on_platform !== undefined ? show_on_platform : existing.show_on_platform,
    existing.id
  );

  res.json(updated);
}));

router.delete('/:id', authRequired, asyncHandler(async (req, res) => {
  const existing = await db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

  const org = await assertOrgAccess(req, res, existing.organization_id);
  if (!org) return;

  await db.prepare('DELETE FROM products WHERE id = ?').run(existing.id);
  res.json({ ok: true });
}));

export default router;
