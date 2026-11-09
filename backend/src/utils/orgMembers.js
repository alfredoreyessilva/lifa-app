import db from '../config/db.js';
import { esPrivadaAlPublico } from './orgVisibility.js';
import { rolesConPermiso } from './orgRoles.js';

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

// La misma pregunta, del lado de Postgres, para una lista: la pestaña
// Organizaciones del admin decide con esto qué equipos de liga enseña. Va junto
// a la de arriba para que sigan siendo una sola respuesta.
export function orgTieneMiembrosSql(aliasOrganizacion = 'o') {
  return `EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = ${aliasOrganizacion}.id AND om.status = 'active'
  )`;
}

// ¿Puede esta persona ver la página de esta organización (y su catálogo)?
// Una privada no existe para el público, igual que una liga oculta: la ven
// quienes la administran y el admin de la plataforma. `user` es el de
// `optionalAuth`, así que puede no venir. README, "Organizaciones: publicar y
// verificar".
export async function puedeVerOrganizacion(user, org) {
  if (!esPrivadaAlPublico(org)) return true;
  return administraOrganizacion(user, org);
}

// ¿Esta persona la administra, o es el admin de la plataforma? Es la pregunta
// de arriba sin la parte de "es pública": decide también qué más le llega de
// la organización en su página —su plan, si está publicada—, que el público no
// ve (PD-46, `organizacionParaQuienLaVe` en `orgVisibility.js`).
export async function administraOrganizacion(user, org) {
  if (!user || !org) return false;
  if (user.role === 'admin') return true;
  return isOrgMember(user.id, org.id);
}

// ¿Puede esta persona ver la página pública de esta liga y lo que cuelga de
// ella: sus equipos y sedes, sus torneos, la tabla, el bracket, lo que rodea a
// un partido y el roster público? La misma pregunta que una organización
// privada, del lado de las ligas: una sin publicar no existe para el público,
// y quien la administra la ve entera, como la verá el público el día que
// CFBAMX la publique — su vista previa. README, "La vista previa de una liga
// sin publicar". `user` es el de `optionalAuth`, así que puede no venir.
//
// `league` necesita `is_public`, `owner_user_id` y `organization_id`.
export async function puedeVerLiga(user, league) {
  if (!league) return false;
  if (league.is_public === true) return true;
  return administraLiga(user, league);
}

// ¿La administra? Dueño y administrador, que es el permiso `perfil`: la página
// es el perfil de la liga a la vista, y "Ver mi página" vive en la sección
// Perfil de su panel. Entra también quien la registró y se quedó en
// `owner_user_id` sin fila en organization_members, con el mismo respaldo que
// `guardaDeLiga` (middleware/ownership.js), y el admin de la plataforma, que es
// quien decide publicarla. El visor y el tesorero no: no deciden lo que la liga
// publica.
export async function administraLiga(user, league) {
  if (!user || !league) return false;
  if (user.role === 'admin') return true;
  if (league.owner_user_id != null && league.owner_user_id === user.id) return true;
  return isOrgMember(user.id, league.organization_id, rolesConPermiso('league', 'perfil'));
}
