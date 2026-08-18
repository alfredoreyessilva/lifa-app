import db from '../config/db.js';

// Reemplaza la comparación repetida "owner_user_id === req.user.id" que hoy
// vive en las 10 funciones de middleware/ownership.js. En vez de reescribir
// cada una desde cero, todas van a llamar a este único helper.
//
// allowedRoles por default incluye 'owner', 'admin' y 'editor' porque hoy
// no hay ninguna acción que distinga entre ellos todavía — cuando exista
// una acción que solo el 'owner' pueda hacer (por ejemplo, borrar la
// organización), ahí sí se le pasará un allowedRoles más corto.
//
// Devuelve boolean. Nunca lanza error — si organizationId es null/undefined
// (una liga/equipo que por lo que sea no tenga organización enlazada todavía)
// simplemente devuelve false, para que el que lo llama decida cómo manejarlo
// (normalmente cayendo de vuelta a owner_user_id, ver ownership.js paso 3).
export async function isOrgMember(userId, organizationId, allowedRoles = ['owner', 'admin', 'editor']) {
  if (!userId || !organizationId) return false;
  const member = await db
    .prepare('SELECT role FROM organization_members WHERE organization_id = ? AND user_id = ? AND status = ?')
    .get(organizationId, userId, 'active');
  if (!member) return false;
  return allowedRoles.includes(member.role);
}
