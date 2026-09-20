// "¿Esta persona puede hacer esto aquí?" — la única pregunta de permisos que
// el frontend hace, y el único lugar donde se hace.
//
// La tabla de qué puede cada rol NO vive aquí. Vive en `backend/src/utils/
// orgRoles.js`, y `/auth/me` manda la lista ya resuelta en `my_permissions` de
// cada liga, equipo u organización. El frontend solo pregunta por el permiso
// que le importa. Es la regla 6 de CLAUDE.md: dos copias de una tabla se
// separan, y la que se desactualiza es siempre la que no toca la base.
//
// ESTO ES PARA ESCONDER, NO PARA PROTEGER. Quien decide de verdad es la guarda
// del backend, que vuelve a preguntar en cada petición. Si aquí sobrara un
// permiso se enseñaría un botón que va a dar 403; si faltara, se escondería
// algo que sí se podía. Ninguno de los dos abre nada.

// Falla cerrado cuando la lista existe y no trae el permiso. Pero cuando la
// lista NO VIENE se comporta al revés, y eso es deliberado:
//
// El backend (Render) y el frontend (Vercel) se despliegan por separado desde
// el mismo push, y Vercel termina primero. Durante esos minutos el frontend
// nuevo habla con el backend viejo, que todavía no manda `my_permissions`. Si
// eso se tratara como "no puede nada", TODO EL MUNDO vería su panel sin
// pestañas hasta que Render terminara — un apagón que nos haríamos solos.
//
// Distinguir "no vino el campo" de "vino y no incluye el permiso" resuelve las
// dos cosas: con backend viejo se ve lo de siempre (que es lo que ese backend
// va a permitir de todos modos), y con backend nuevo se esconde lo que toca.
// No abre nada en ningún caso: quien decide sigue siendo la guarda, que vuelve
// a preguntar en cada petición.
//
// `undefined` es "no vino"; un arreglo vacío es "vino y este rol no puede
// nada", y ese sí esconde.
export function puede(entidad, permiso) {
  if (!entidad) return false;
  if (entidad.my_permissions === undefined) return true;
  return entidad.my_permissions.includes(permiso);
}

// Para cuando hay que preguntar por varios de un jalón ("¿enseño la sección de
// dinero?" cuando la sección tiene los dos libros).
export function puedeAlguno(entidad, ...permisos) {
  return permisos.some((permiso) => puede(entidad, permiso));
}

// Cómo se lee el rol de esta persona en pantalla. Viene resuelto del backend
// (`my_role_label`) porque una etiqueta cambia según el tipo de organización:
// `treasurer` se lee "Tesorero de liga" en una liga y "Tesorero" en un equipo,
// y `editor` nunca se lee "editor" a secas sino "Editor de partidos (Visor)".
export function etiquetaDeMiRol(entidad) {
  return entidad?.my_role_label ?? null;
}
