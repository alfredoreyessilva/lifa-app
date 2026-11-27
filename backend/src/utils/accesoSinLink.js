// Lo que decide el Panel Admin cuando agrega a una cuenta que ya existe a una
// organización, sin link, y cuándo no deja borrar una cuenta (README, "Sin link:
// el Panel Admin agrega a una cuenta que ya existe", 2026-11-26).
//
// Va en un archivo propio y puro —no importa `db`— por la misma razón que
// `utils/invitaciones.js`: lo que decide quién entra a una organización tiene
// que poder probarse sin Postgres, que es lo único que el CI alcanza a correr.
// Las preguntas a la base las hace `routes/admin.js` y le pasa aquí las
// respuestas.
import { esRolValido, etiquetaDeRol, rolesDeTipo } from './orgRoles.js';

// Los roles que se pueden dar sin link en una organización de este tipo. Son los
// mismos de un link, con una excepción: a un equipo sin nadie adentro, su primera
// persona entra como dueño, porque eso es la entrega —y la entrega siempre es
// como dueño—. Un coach que entrara primero dejaría a `orgTieneMiembros()`
// diciendo que el equipo ya se entregó, sin que tenga dueño: su liga lo perdería
// y nadie adentro podría repartir su acceso.
export function rolesSinLink(tipo, { vacio = false } = {}) {
  if (tipo === 'team' && vacio) return ['owner'];
  return rolesDeTipo(tipo);
}

// Lo que se responde cuando no se puede agregar, o null si sí se puede.
//
//   organizacion  { name, type, sinEntidad }, o null si no existe. `sinEntidad`
//                 es la que se quedó sin la liga o el equipo de detrás (PD-42)
//   cuenta        { id, name, role } de `users`, o null si no existe
//   quienAgrega   el `req.user` de quien llama
//   rol           el que se pidió
//   rolActual     el que esa cuenta ya tiene ahí, o null
//   vacio         si es un equipo sin nadie adentro: agregar ahí es la entrega
//
// El orden importa: primero a quién y a dónde, después con qué rol. A quien eligió
// mal la cuenta no se le contesta del rol.
export function motivoParaNoAgregar({ organizacion, cuenta, quienAgrega, rol, rolActual = null, vacio = false }) {
  if (!organizacion) return { status: 404, error: 'Organización no encontrada' };
  if (organizacion.sinEntidad) {
    return { status: 404, error: 'Esa organización se quedó sin la liga o el equipo de detrás: no hay nada que administrar.' };
  }
  if (!cuenta) return { status: 404, error: 'Esa cuenta no existe' };

  // Ya entran a todo, así que la fila no les daría nada, salvo en una tienda: ahí
  // ser su dueño de verdad es lo único que deja conectar su Mercado Pago, y el
  // permiso `cobros` deja fuera al admin de la plataforma a propósito.
  if (quienAgrega && cuenta.id === quienAgrega.id) {
    return { status: 400, error: 'No te agregas a ti: como admin de la plataforma ya entras a todas las organizaciones.' };
  }
  if (cuenta.role === 'admin') {
    return { status: 400, error: `${cuenta.name} es admin de la plataforma: ya entra a todas las organizaciones.` };
  }

  if (!esRolValido(organizacion.type, rol)) {
    return { status: 400, error: 'Ese rol no existe para este tipo de organización', roles: rolesSinLink(organizacion.type, { vacio }) };
  }

  // Un link es para alguien que todavía no está, y esto también: volver a dar un
  // rol reescribía el de quien ya estaba. El rol se cambia en el panel de la
  // organización (PATCH /organizations/:id/members/:userId).
  if (rolActual) {
    const suRol = etiquetaDeRol(rolActual, organizacion.type) ?? rolActual;
    return {
      status: 409,
      error: `${cuenta.name} ya es parte de ${organizacion.name} como ${suRol}. `
        + `Su rol se cambia desde el panel de ${organizacion.name}, con «Cambiar rol».`,
    };
  }

  if (!rolesSinLink(organizacion.type, { vacio }).includes(rol)) {
    return {
      status: 409,
      error: `${organizacion.name} todavía no se entrega: su primera persona entra como dueño, porque eso es la entrega del equipo.`,
      roles: rolesSinLink(organizacion.type, { vacio }),
    };
  }
  return null;
}

// "Halcones", "Halcones y Coyotes", "Halcones, Coyotes y Toros".
export function listaDeNombres(nombres) {
  const lista = (nombres ?? []).filter(Boolean);
  if (lista.length <= 1) return lista[0] ?? '';
  return `${lista.slice(0, -1).join(', ')} y ${lista[lista.length - 1]}`;
}

// No se borra la cuenta del único dueño de un equipo (README, "Borrar una cuenta
// no vacía un equipo"). `equipos` son los nombres de los equipos donde esa cuenta
// es el único dueño; vacío, se puede borrar.
//
// Por qué un equipo y no cualquier organización: `organization_members` se borra
// en cascada con la cuenta, y un equipo que se queda sin nadie vuelve a estar
// "sin entregar" para `orgTieneMiembros()`. Su liga podría volver a entregárselo
// a sí misma y quedarse con el padrón del club. Una liga, un medio o una tienda
// no tienen padrón que perder.
//
// Un equipo siempre conserva un dueño —desde su panel no se quita ni se le cambia
// el rol a uno—, así que la única persona de un equipo es siempre su único dueño:
// esta regla cubre también al equipo que se quedaría vacío.
export function motivoParaNoBorrarCuenta(equipos) {
  const lista = (equipos ?? []).filter(Boolean);
  if (lista.length === 0) return null;
  const uno = lista.length === 1;
  return {
    status: 409,
    error: `Es la única cuenta con el rol de Dueño en ${listaDeNombres(lista)}: si se borra, `
      + `${uno ? 'ese equipo se queda' : 'esos equipos se quedan'} sin dueño. `
      + 'Primero agrega a otro dueño con «Agregar a una organización».',
  };
}
