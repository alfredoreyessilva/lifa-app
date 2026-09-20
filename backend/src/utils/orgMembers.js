import db from '../config/db.js';

// Reemplaza la comparación repetida "owner_user_id === req.user.id" que hoy
// vive en las 10 funciones de middleware/ownership.js. En vez de reescribir
// cada una desde cero, todas van a llamar a este único helper.
//
// allowedRoles por default es 'owner' y 'admin' — LOS DOS QUE PUEDEN TODO. No
// es una lista conveniente: es el suelo, y toda ruta que deba dejar pasar a
// alguien más se lo dice explícitamente con `rolesConPermiso(tipo, permiso)`.
//
// Antes incluía 'editor'. Eso era inofensivo mientras no existiera forma de
// crear un 'editor' —no había endpoint ni pantalla que lo produjera— y dejó de
// serlo el día que la invitación empezó a llevar rol (paso 4): un visor, que
// solo debe tocar marcadores, pasaba TODAS las guardas de ownership.js, los
// dos libros incluidos. Sacarlo de aquí lo cierra de un lado en las diez.
//
// El default no cambia nada de lo ya escrito: al 2026-09-20 no había una sola
// fila con rol distinto de 'owner' o 'admin'.
//
// La dirección importa: este default DEJA FUERA, nunca deja entrar. Un rol
// nuevo en el catálogo no gana acceso por existir — hay que dárselo ruta por
// ruta, que es lo contrario de lo que pasó con 'editor'.
//
// Devuelve boolean. Nunca lanza error — si organizationId es null/undefined
// (una liga/equipo que por lo que sea no tenga organización enlazada todavía)
// simplemente devuelve false, para que el que lo llama decida cómo manejarlo
// (normalmente cayendo de vuelta a owner_user_id, ver ownership.js paso 3).
export async function isOrgMember(userId, organizationId, allowedRoles = ['owner', 'admin']) {
  if (!userId || !organizationId) return false;
  const member = await db
    .prepare('SELECT role FROM organization_members WHERE organization_id = ? AND user_id = ? AND status = ?')
    .get(organizationId, userId, 'active');
  if (!member) return false;
  return allowedRoles.includes(member.role);
}

// ¿Esta organización ya tiene a alguien adentro?
//
// Para un equipo, esta es LA pregunta de "¿ya se administra solo?" — y es una
// sola pregunta, con una sola respuesta, en los tres lugares que la hacen:
// la guarda del padrón (`teamClubRequired`) y las dos rutas con las que una
// liga entrega un equipo (`routes/invites.js`). Si cada una la contestara a su
// manera, habría un estado en el que la liga puede volver a invitar a un equipo
// que para el padrón ya está entregado, y esa grieta es exactamente por donde
// se cuela quien quiera el padrón ajeno.
//
// Ojo con lo que NO es: esto no dice nada sobre si el equipo participa en los
// torneos de una liga. Administrarse solo y competir son cosas distintas —
// ver README, "Roles y fronteras de información".
//
// Devuelve false si no hay organización, igual que `isOrgMember`: sin
// organización no hay nadie adentro.
export async function orgTieneMiembros(organizationId) {
  if (!organizationId) return false;
  const { count } = await db
    .prepare("SELECT COUNT(*)::int AS count FROM organization_members WHERE organization_id = ? AND status = 'active'")
    .get(organizationId);
  return Number(count) > 0;
}
