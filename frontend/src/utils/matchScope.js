// A qué conferencia/grupo pertenece un equipo, y qué conferencia hereda de
// ellos un partido.
//
// Este archivo es el lado del navegador de una regla que vive en el backend
// (backend/src/utils/matchScope.js): la conferencia NO se captura partido por
// partido, se dice una vez por equipo al inscribirlo en la rama, y de ahí la
// toman todos sus juegos. Aquí no se decide nada — el backend vuelve a
// resolverlo por su cuenta al guardar y al leer. Esto solo sirve para mostrar
// de dónde salió el dato y para filtrar el calendario.

// Nombre legible del "casillero" de un equipo dentro de su rama. Un equipo
// puede estar en una conferencia, en un grupo dentro de ella, o en ninguna.
export function scopeName(team) {
  if (!team) return null;
  if (team.group_name) {
    return team.conference_name ? `${team.conference_name} — ${team.group_name}` : team.group_name;
  }
  return team.conference_name || null;
}

// Cómo se nombra a qué pertenece un PARTIDO, para enseñarlo junto a la jornada
// y la sede. Trabaja sobre lo que el backend ya resolvió (no vuelve a derivar
// nada): conference_name/group_name, más sus gemelos _2 que solo vienen cuando
// el local y el visitante son de conferencias o grupos distintos.
export function matchScopeLabel(match) {
  if (!match) return null;
  // Cruce entre dos grupos: el más específico manda, sin repetir la conferencia.
  if (match.group_name && match.group_name_2) {
    return `${match.group_name} × ${match.group_name_2}`;
  }
  if (match.group_name) {
    return match.conference_name ? `${match.conference_name} — ${match.group_name}` : match.group_name;
  }
  if (match.conference_name && match.conference_name_2) {
    return `${match.conference_name} × ${match.conference_name_2}`;
  }
  return match.conference_name || null;
}

// Un partido cuenta para una conferencia si es la suya o —cuando es un cruce
// entre dos— la de su rival. Compara como texto a propósito: el id llega como
// número desde la API y como string desde la URL del filtro.
export function matchInConference(match, conferenceId) {
  if (conferenceId === null || conferenceId === undefined || conferenceId === '') return false;
  return String(match.conference_id) === String(conferenceId)
      || String(match.conference_id_2) === String(conferenceId);
}

// Qué conferencia le toca a un partido según sus equipos, para mostrarla en el
// formulario antes de guardarlo. Devuelve uno de cuatro estados:
//
//   faltan-equipos → todavía no se eligen los dos; no hay nada que heredar
//   sin-asignar    → algún equipo no tiene conferencia puesta en la rama, y se
//                    nombra cuál: es el dato que hay que ir a arreglar (una
//                    vez), no algo que se resuelva en este partido
//   cruce          → local y visitante son de conferencias distintas; el
//                    partido pertenece a LAS DOS
//   heredada       → los dos coinciden; esa es la conferencia del partido
export function inheritedConference(homeTeamName, awayTeamName, branchTeams) {
  if (!homeTeamName || !awayTeamName) return { estado: 'faltan-equipos' };

  const porNombre = new Map(
    (branchTeams || []).map((t) => [String(t.name).trim().toLowerCase(), t])
  );
  const buscar = (nombre) => porNombre.get(String(nombre).trim().toLowerCase()) || null;

  const casa   = buscar(homeTeamName);
  const visita = buscar(awayTeamName);

  const pendientes = [];
  if (!scopeName(casa))   pendientes.push(homeTeamName);
  if (!scopeName(visita)) pendientes.push(awayTeamName);
  if (pendientes.length) return { estado: 'sin-asignar', pendientes };

  const nombreCasa   = scopeName(casa);
  const nombreVisita = scopeName(visita);
  if (nombreCasa !== nombreVisita) {
    return { estado: 'cruce', label: `${nombreCasa} × ${nombreVisita}` };
  }
  return { estado: 'heredada', label: nombreCasa };
}
