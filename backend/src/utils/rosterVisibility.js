// Qué sale de un roster en público, y quién lo decidió. El porqué está en el
// README, "Roster público y pase de lista" (2026-09-20), y la regla de fondo
// es la 7 de CLAUDE.md: nombre, número y posición, nada más; `curp` y
// `birth_date` no salen nunca.
//
// Vive en un archivo propio, puro y sin importar `db`, por la misma razón que
// `orgRoles.js`: es la regla que decide si la cara de un menor de edad sale en
// una página abierta, así que tiene que poder probarse sin Postgres — y eso es
// lo único que el CI alcanza a correr.
//
// Son dos interruptores y una asimetría:
//
//   categories.roster_public   la liga publica (o no) el roster de la categoría
//   categories.roster_photos   la liga permite (o no) que además salga la foto
//   branch_teams.show_photos   el equipo APAGA la suya, aunque la liga la permita
//
// El equipo puede bajar el techo, nunca subirlo. No existe la operación
// contraria: ningún equipo enciende lo que su categoría dejó apagado. Así la
// liga puede publicar un programa de mano sin perseguir a veinte equipos, y el
// equipo conserva el veto sobre las caras de sus jugadores.

// Las cuatro funciones FALLAN CERRADO, igual que el catálogo de roles: una
// categoría que no se encontró, una fila a medias o un campo que llegó como
// `undefined` responden "no se publica". Un typo tiene que esconder un roster,
// nunca publicarlo.

// ¿El roster de esta categoría sale en público?
export function rosterEsPublico(categoria) {
  return categoria?.roster_public === true;
}

// ¿Y la foto? Las dos tienen que estar de acuerdo. `show_photos` es NULL
// mientras el equipo no toque nada, y NULL significa "sigue a la categoría" —
// por eso el default del equipo no bloquea a su liga. Solo un FALSE explícito
// veta, porque solo eso es una decisión que alguien tomó.
export function fotoSePublica(categoria, branchTeam) {
  if (!rosterEsPublico(categoria)) return false;
  if (categoria?.roster_photos !== true) return false;
  return branchTeam?.show_photos !== false;
}

// La misma regla, del lado de Postgres, para las consultas que la tienen que
// aplicar sobre muchas filas (hoy: la foto de la tarjeta del jugador). Se
// generan los alias en vez de escribir la expresión a mano en cada consulta:
// que la regla exista dos veces ya es bastante, que existan cuatro copias es
// como nacen los desajustes.
export function fotoSePublicaSql(aliasCategoria = 'c', aliasBranchTeam = 'bt') {
  return `(${aliasCategoria}.roster_public AND ${aliasCategoria}.roster_photos`
    + ` AND COALESCE(${aliasBranchTeam}.show_photos, TRUE))`;
}

// Lo que llega del formulario de la categoría, ya coherente. Los dos
// interruptores VIAJAN JUNTOS —mismo criterio que `auto_status_enabled` y sus
// horas en ese mismo handler—: si la edición no menciona `roster_public`, no se
// toca ninguno de los dos, para no apagar la foto por editar el nombre.
//
// Devuelve null cuando no hay nada que escribir. Y fuerza la coherencia en la
// escritura: "con foto" sobre un roster privado no se guarda, aunque la regla
// de lectura ya lo ignoraría de todos modos. Una fila que dice lo que no hace
// es la que alguien lee mal seis meses después.
export function interruptoresDeCategoria(body) {
  if (body?.roster_public === undefined) return null;
  const roster_public = body.roster_public === true;
  return { roster_public, roster_photos: roster_public && body.roster_photos === true };
}

// Lo que el frontend necesita para pintar el estado sin volver a razonar la
// regla: los tres valores crudos más la conclusión ya resuelta. Viaja tal cual
// en el GET del roster (el privado, el del panel) — ver README, regla 6: un
// valor que viaja en la API se cambia en los tres lados o en ninguno.
export function visibilidadDeRoster(categoria, branchTeam) {
  return {
    roster_public: rosterEsPublico(categoria),
    roster_photos: categoria?.roster_photos === true,
    show_photos: branchTeam?.show_photos ?? null,
    photos_visible: fotoSePublica(categoria, branchTeam),
  };
}
