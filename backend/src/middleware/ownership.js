import db from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isOrgMember, orgTieneMiembros } from '../utils/orgMembers.js';
import { rolesConPermiso } from '../utils/orgRoles.js';

// ── Las guardas se piden por PERMISO, no por rol ──────────────────────────
//
// Una ruta no dice "aquí entran owner y admin": dice qué DOMINIO toca, y
// `utils/orgRoles.js` contesta quiénes son esos. Es la regla de CLAUDE.md de
// que los permisos no viven en línea dentro del handler, llevada hasta el
// final — la lista de roles no se escribe en ningún lado más que el catálogo,
// así que no hay dos listas que se puedan separar.
//
// Por qué son fábricas y no un parámetro suelto: estas guardas se usan como
// middleware (`router.get(ruta, authRequired, laGuarda, handler)`), así que
// tienen que quedar ya configuradas al exportarse.
//
// Detalle que explica por qué casi nada cambia de comportamiento: en el
// catálogo, `owner` y `admin` tienen exactamente los mismos permisos salvo
// `duenos`. Así que cualquier permiso que se le pase a una guarda de liga
// devuelve {owner, admin} — igual que antes— y lo único que hace la fábrica es
// decidir **a quién más** deja entrar: al tesorero en la cobranza, al visor en
// los marcadores, al editor de roster en el roster. Los roles nuevos no ganan
// acceso por existir; hay que dárselo aquí, ruta por ruta.
function guardaDeLiga(permiso) {
  return asyncHandler(async (req, res, next) => {
    const leagueId = Number(req.params.leagueId || req.params.id);
    const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId);
    if (!league) return res.status(404).json({ error: 'Liga no encontrada' });
    // owner_user_id se deja como respaldo (no se quita) — si por lo que sea la
    // liga no tuviera organization_id o el usuario no apareciera todavía en
    // organization_members, el acceso de siempre sigue funcionando igual. Se
    // retirará cuando se confirme que esto corre bien en producción. (En
    // `teamClubRequired` sí se retiró ya, y ahí está explicado por qué era
    // distinto.)
    const isMember = await isOrgMember(req.user.id, league.organization_id, rolesConPermiso('league', permiso));
    if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
      req.league = league;
      return next();
    }
    return res.status(403).json({ error: 'No tienes permiso sobre esta liga' });
  });
}

// Lo que administra una liga: estructura, equipos, sedes, partidos, roster y
// su propio perfil. Dueño y administrador — nadie más.
export const leagueOwnerRequired = guardaDeLiga('estructura');

// La cobranza liga → equipos, que es lo único que toca el TESORERO DE LIGA.
// Es la razón de ser de ese rol: lleva el dinero sin tocar la competencia.
export const leagueBillingRequired = guardaDeLiga('cobranza_liga');

export const tournamentOwnerRequired = asyncHandler(async (req, res, next) => {
  const tournamentId = Number(req.params.tournamentId);
  const tournament = await db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(tournament.league_id);
  const isMember = await isOrgMember(req.user.id, league.organization_id);
  if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
    req.league = league;
    req.tournament = tournament;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre este torneo' });
});

export const branchOwnerRequired = asyncHandler(async (req, res, next) => {
  const branchId = Number(req.params.branchId);
  const branch = await db.prepare('SELECT * FROM branches WHERE id = ?').get(branchId);
  if (!branch) return res.status(404).json({ error: 'Rama no encontrada' });
  const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(branch.category_id);
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(category.league_id);
  const isMember = await isOrgMember(req.user.id, league.organization_id);
  if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
    req.league = league;
    req.category = category;
    req.branch = branch;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre esta rama' });
});

export const conferenceOwnerRequired = asyncHandler(async (req, res, next) => {
  const conferenceId = Number(req.params.conferenceId);
  const conference = await db.prepare('SELECT * FROM conferences WHERE id = ?').get(conferenceId);
  if (!conference) return res.status(404).json({ error: 'Conferencia no encontrada' });
  const branch = await db.prepare('SELECT * FROM branches WHERE id = ?').get(conference.branch_id);
  const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(branch.category_id);
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(category.league_id);
  const isMember = await isOrgMember(req.user.id, league.organization_id);
  if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
    req.league = league;
    req.category = category;
    req.branch = branch;
    req.conference = conference;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre esta conferencia' });
});

export const categoryOwnerRequired = asyncHandler(async (req, res, next) => {
  const categoryId = Number(req.params.categoryId);
  const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
  if (!category) return res.status(404).json({ error: 'Categoría no encontrada' });
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(category.league_id);
  const isMember = await isOrgMember(req.user.id, league.organization_id);
  if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
    req.league = league;
    req.category = category;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre esta categoría' });
});

// Un partido se guarda con DOS permisos distintos, y la diferencia es el visor.
//
// `marcadores` es tocar un partido que ya existe —marcador, estado, fecha,
// hora, sede, links, estadísticas—; `partidos` es crearlo o borrarlo. Quien
// toma marcadores en la cancha necesita lo primero y no debe poder lo segundo:
// un visor que pueda borrar un partido puede desaparecer un resultado que no le
// gustó, y eso no se recupera desde la app.
function guardaDePartido(permiso) {
  return asyncHandler(async (req, res, next) => {
    const matchId = Number(req.params.id);
    const match = await db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
    if (!match) return res.status(404).json({ error: 'Partido no encontrado' });
    const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(match.category_id);
    const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(category.league_id);
    const isMember = await isOrgMember(req.user.id, league.organization_id, rolesConPermiso('league', permiso));
    if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
      req.league = league;
      req.category = category;
      req.match = match;
      return next();
    }
    return res.status(403).json({ error: 'No tienes permiso sobre este partido' });
  });
}

// Crear o BORRAR un partido: dueño y administrador.
export const matchOwnerRequired = guardaDePartido('partidos');

// Editar un partido que ya existe. Aquí sí entra el **visor** — es todo lo que
// hace, y es para lo que existe ese rol.
export const matchScoreRequired = guardaDePartido('marcadores');

// Un equipo se mira desde DOS lados —la liga que lo administra y el equipo
// mismo— y cada lado tiene su propio catálogo de roles, así que la fábrica
// toma dos permisos. No son el mismo nombre por casualidad ni por simetría:
// para la liga, tocar un equipo es `estructura` (ahí viven "equipos"); para el
// equipo, es lo que la ruta haga con él.
//
// Lo que esta guarda todavía NO hace, y está anotado en el README: una liga
// que ya entregó un equipo sigue pasando por aquí. Separar "administra" de
// "participa" es un cambio de modelo aparte.
function guardaDeEquipo(permisoDeLiga, permisoDeEquipo) {
  return asyncHandler(async (req, res, next) => {
    const teamId = Number(req.params.id);
    const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
    if (!team) return res.status(404).json({ error: 'Equipo no encontrado' });
    // Un equipo independiente (registrado sin liga) no tiene league_id — no
    // hay liga de la que preguntar membresía ni owner_user_id.
    const league = team.league_id
      ? await db.prepare('SELECT * FROM leagues WHERE id = ?').get(team.league_id)
      : null;
    // Se pregunta por membresía tanto en la organización de la liga como en la
    // del equipo (son organizaciones distintas), cada una con los roles que en
    // SU catálogo tienen el permiso que pide la ruta. owner_user_id sigue de
    // respaldo por los dos lados.
    const isLeagueMember = league
      ? await isOrgMember(req.user.id, league.organization_id, rolesConPermiso('league', permisoDeLiga))
      : false;
    const isTeamMember = await isOrgMember(req.user.id, team.organization_id, rolesConPermiso('team', permisoDeEquipo));
    if (
      req.user.role === 'admin' ||
      isLeagueMember ||
      isTeamMember ||
      (league && league.owner_user_id === req.user.id) ||
      team.owner_user_id === req.user.id
    ) {
      req.league = league;
      req.team = team;
      return next();
    }
    return res.status(403).json({ error: 'No tienes permiso sobre este equipo' });
  });
}

// El perfil del equipo: nombre, logo, contacto, redes. Dueño y administrador.
export const teamOwnerRequired = guardaDeEquipo('estructura', 'perfil');

// El lado del EQUIPO en la cuenta con la liga: reportar un pago, retirarlo y
// ver su estado de cuenta. Aquí entra el tesorero del equipo — es la mitad de
// su trabajo (la otra mitad son las cuotas del club, en teamClubRequired).
export const teamBillingRequired = guardaDeEquipo('cobranza_liga', 'cobranza_liga');

// Leer el equipo sin cambiarlo: su bandeja de avisos y en qué ramas está
// inscrito. Es el único lugar donde el COACH pasa, y para eso existe ese rol.
export const teamViewRequired = guardaDeEquipo('estructura', 'ver');

// Da acceso al DOMINIO DEL CLUB de un equipo: su padrón (`club_members`) y sus
// cuotas (`club_ledger_entries`). Es la guarda que NO deja entrar a la liga, y
// ahí está toda su razón de ser.
//
// La diferencia con `teamOwnerRequired` es deliberada y es el corazón del
// modelo (README, "Roles y fronteras de información"): una liga administra el
// perfil, el roster y el calendario de sus equipos —para eso sigue existiendo
// la otra guarda—, pero el padrón del club no lo ve nunca, en ningún estado
// del equipo. Ahí viven CURP, fecha de nacimiento, foto, contacto del tutor y
// el `share_token` de cada familia, de gente en buena parte menor de edad; y
// ese token ES la credencial del estado de cuenta, así que filtrarlo es dar
// acceso, no solo mostrar un dato.
//
// Antes del permiso hay una pregunta más temprana: si el equipo todavía no ha
// sido entregado, las cuotas del club **no están encendidas** y se responde
// 409, no 403. No es un problema de quién pregunta —es que la función no
// existe todavía para ese equipo—. Un 403 le diría a la liga "no tienes
// permiso" y la dejaría buscando cuál conseguir, cuando lo que hay que hacer
// es entregar el equipo a su representante. Y de paso es lo que garantiza que
// la liga nunca llegue a ver un padrón: antes de la entrega no existe ninguno.
export const teamClubRequired = asyncHandler(async (req, res, next) => {
  const teamId = Number(req.params.id || req.params.teamId);
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  if (!team) return res.status(404).json({ error: 'Equipo no encontrado' });

  // "Entregado" es tener miembros en la organización del equipo, y nada más.
  //
  // Cuando esta guarda nació (paso 2) preguntaba también por `owner_user_id`,
  // porque reclamar un equipo solo llenaba esa columna sin dar de alta a nadie.
  // Desde el paso 4 la entrega puebla la organización (`routes/invites.js`), y
  // por eso el respaldo se retiró: es la única guarda de este archivo que ya no
  // tiene, y a propósito. Un respaldo por `owner_user_id` aquí no sería una
  // red de seguridad sino una segunda puerta al padrón, que es justo lo que
  // esta guarda existe para que no haya.
  //
  // Lo ya entregado no se queda fuera: el backfill de `db.js` da de alta como
  // 'owner' a todo `teams.owner_user_id` no nulo, y corre en cada arranque.
  //
  // La pregunta vive en `orgTieneMiembros` y no aquí porque `routes/invites.js`
  // hace exactamente la misma antes de dejar que una liga entregue un equipo.
  // Dos redacciones de la misma pregunta abrirían un estado donde la liga puede
  // volver a invitar a un equipo que para esta guarda ya está entregado.
  const entregado = await orgTieneMiembros(team.organization_id);

  if (!entregado) {
    return res.status(409).json({
      error: 'Las cuotas del club se activan cuando el equipo recibe su acceso. '
        + 'Entrégale el perfil a su representante desde la ficha del equipo.',
    });
  }

  // El administrador de la PLATAFORMA sigue pasando, igual que en todas las
  // guardas de este archivo. Es una excepción consciente y no un descuido:
  // quien opera la plataforma ya puede leer la base directamente, así que
  // cerrarle la API no protegería el dato, solo movería el camino. Si algún
  // día se quiere cerrar de verdad, se quita esta línea y ya.
  // `cuotas_club` y no la lista por defecto: el padrón y su libro los ven el
  // dueño, el administrador y el TESORERO del equipo. El editor de roster y el
  // coach no — y que el coach no vea el padrón no es un detalle, es la razón
  // por la que `ver` no arrastra este dominio (utils/orgRoles.js).
  const esMiembroDelEquipo = await isOrgMember(
    req.user.id, team.organization_id, rolesConPermiso('team', 'cuotas_club')
  );
  if (req.user.role === 'admin' || esMiembroDelEquipo) {
    req.team = team;
    // La liga NO se resuelve ni se cuelga de `req` aquí: nada del dominio del
    // club depende de ella, y dejarla puesta invitaría a usarla para decidir
    // un permiso, que es justo lo que esta guarda vino a impedir.
    return next();
  }

  return res.status(403).json({ error: 'El padrón y las cuotas de este equipo solo los administra el equipo' });
});

// Para entregarle a un equipo su perfil (y cancelar esa entrega mientras nadie
// la reclame):
// a propósito NO se le permite esto al representante del equipo mismo, solo
// a quien administra la liga completa (o un admin) — para que nadie pueda
// "regalar" su propio equipo a alguien más sin que la liga se entere.
export const teamLeagueOwnerRequired = asyncHandler(async (req, res, next) => {
  const teamId = Number(req.params.teamId || req.params.id);
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  if (!team) return res.status(404).json({ error: 'Equipo no encontrado' });

  // Un equipo independiente (sin liga) no tiene "liga dueña" a quien pedirle
  // permiso — el dueño del equipo mismo (o un admin) es la máxima autoridad
  // sobre sus propias invitaciones, a diferencia del caso normal donde a
  // propósito no se le permite esto al representante del equipo.
  if (!team.league_id) {
    const isTeamMember = await isOrgMember(req.user.id, team.organization_id);
    if (req.user.role === 'admin' || isTeamMember || team.owner_user_id === req.user.id) {
      req.team = team;
      return next();
    }
    return res.status(403).json({ error: 'No tienes permiso sobre este equipo' });
  }

  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(team.league_id);
  const isMember = await isOrgMember(req.user.id, league.organization_id);
  if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
    req.league = league;
    req.team = team;
    return next();
  }
  return res.status(403).json({ error: 'Solo el representante de la liga puede gestionar esto' });
});

// Para gestionar administradores de la organización detrás de una liga o un
// equipo (invitar/listar/quitar vía organization_members) — a diferencia de
// teamLeagueOwnerRequired (que solo deja a la liga entregar un equipo), aquí
// sí se le permite esto a quien ya administra esa organización (owner o
// admin), sea liga o equipo, porque a diferencia de "regalar" el equipo
// completo, sumar a alguien más con el mismo acceso es una decisión que
// cualquiera de los administradores actuales puede tomar por su cuenta.
export const organizationAdminRequired = asyncHandler(async (req, res, next) => {
  const organizationId = Number(req.params.organizationId || req.params.id);
  const organization = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(organizationId);
  if (!organization) return res.status(404).json({ error: 'Organización no encontrada' });

  // La lista de roles ya no se escribe a mano aquí: sale del catálogo, que es
  // quien sabe que 'miembros' es de dueño y administrador y de nadie más. Un
  // rol nuevo que deba repartir acceso se agrega en utils/orgRoles.js y esta
  // guarda se entera sola; un tipo de organización desconocido devuelve lista
  // vacía y no deja pasar a nadie, que es como tiene que fallar.
  const roles = rolesConPermiso(organization.type, 'miembros');
  const miembro = await db.prepare(
    `SELECT role FROM organization_members WHERE organization_id = ? AND user_id = ? AND status = 'active'`
  ).get(organization.id, req.user.id);

  if (miembro && roles.includes(miembro.role)) {
    req.organization = organization;
    // Con qué rol pregunta. Lo cuelga la guarda y no lo vuelve a consultar
    // cada ruta, porque hay decisiones que dependen de él y no solo de pasar:
    // invitar a otro dueño es del dueño (permiso 'duenos', ver invites.js).
    req.orgRole = miembro.role;
    return next();
  }

  // El administrador de la PLATAFORMA pasa como si fuera dueño, igual que en
  // todas las guardas de este archivo.
  if (req.user.role === 'admin') {
    req.organization = organization;
    req.orgRole = 'owner';
    return next();
  }

  // Respaldo mientras se completa la migración a organization_members: el
  // owner_user_id de siempre (de la liga o el equipo detrás de esta
  // organización) también puede invitar administradores nuevos. Entra como
  // dueño porque eso es lo que esa columna significa.
  const league = await db.prepare('SELECT * FROM leagues WHERE organization_id = ?').get(organization.id);
  if (league && league.owner_user_id === req.user.id) {
    req.organization = organization;
    req.league = league;
    req.orgRole = 'owner';
    return next();
  }
  const team = await db.prepare('SELECT * FROM teams WHERE organization_id = ?').get(organization.id);
  if (team && team.owner_user_id === req.user.id) {
    req.organization = organization;
    req.team = team;
    req.orgRole = 'owner';
    return next();
  }

  return res.status(403).json({ error: 'No tienes permiso sobre esta organización' });
});

export const venueOwnerRequired = asyncHandler(async (req, res, next) => {
  const venueId = Number(req.params.id);
  const venue = await db.prepare('SELECT * FROM venues WHERE id = ?').get(venueId);
  if (!venue) return res.status(404).json({ error: 'Sede no encontrada' });
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(venue.league_id);
  const isMember = await isOrgMember(req.user.id, league.organization_id);
  if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
    req.league = league;
    req.venue = venue;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre esta sede' });
});

export const groupOwnerRequired = asyncHandler(async (req, res, next) => {
  const groupId = Number(req.params.id);
  const group = await db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
  const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(group.category_id);
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(category.league_id);
  const isMember = await isOrgMember(req.user.id, league.organization_id);
  if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
    req.league = league;
    req.category = category;
    req.group = group;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre este grupo' });
});

// Da acceso al roster de UN equipo dentro de UNA rama específica — a quien
// administra la liga (dueña de la rama) O a quien administra ese equipo,
// igual que teamOwnerRequired. La diferencia es que además valida que el
// equipo esté inscrito en branch_teams: no se puede subir roster de un
// equipo que la liga no haya inscrito en esa rama primero.
export const branchTeamOwnerRequired = asyncHandler(async (req, res, next) => {
  const branchId = Number(req.params.branchId);
  const teamId = Number(req.params.teamId);

  const branch = await db.prepare('SELECT * FROM branches WHERE id = ?').get(branchId);
  if (!branch) return res.status(404).json({ error: 'Rama no encontrada' });
  const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(branch.category_id);
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(category.league_id);
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  if (!team) return res.status(404).json({ error: 'Equipo no encontrado' });

  const enrolled = await db.prepare('SELECT 1 FROM branch_teams WHERE branch_id = ? AND team_id = ?').get(branchId, teamId);
  if (!enrolled) return res.status(400).json({ error: 'Este equipo no está inscrito en esta rama todavía' });

  // El roster de torneo es el dominio del EDITOR DE ROSTER, que es todo lo que
  // ese rol hace: altas, bajas, plantilla de Excel, número y posición. Del lado
  // de la liga es `estructura`, porque la liga administra el roster de sus
  // ramas por ser la liga y no por un rol aparte.
  const isLeagueMember = await isOrgMember(
    req.user.id, league.organization_id, rolesConPermiso('league', 'estructura')
  );
  const isTeamMember = await isOrgMember(
    req.user.id, team.organization_id, rolesConPermiso('team', 'roster')
  );
  if (
    req.user.role === 'admin' ||
    isLeagueMember ||
    isTeamMember ||
    league.owner_user_id === req.user.id ||
    team.owner_user_id === req.user.id
  ) {
    req.league = league;
    req.category = category;
    req.branch = branch;
    req.team = team;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre el roster de este equipo en esta rama' });
});

// Fase de una rama. Mismo encadenamiento que conferenceOwnerRequired: la
// fase cuelga de la rama, la rama de la categoría y la categoría de la liga,
// que es donde vive el permiso.
export const phaseOwnerRequired = asyncHandler(async (req, res, next) => {
  const phaseId = Number(req.params.phaseId);
  const phase = await db.prepare('SELECT * FROM phases WHERE id = ?').get(phaseId);
  if (!phase) return res.status(404).json({ error: 'Fase no encontrada' });
  const branch = await db.prepare('SELECT * FROM branches WHERE id = ?').get(phase.branch_id);
  const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(branch.category_id);
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(category.league_id);
  const isMember = await isOrgMember(req.user.id, league.organization_id);
  if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
    req.league = league;
    req.category = category;
    req.branch = branch;
    req.phase = phase;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre esta fase' });
});

// Título (campeonato) de una rama — mismo encadenamiento que la fase.
export const titleOwnerRequired = asyncHandler(async (req, res, next) => {
  const titleId = Number(req.params.titleId);
  const title = await db.prepare('SELECT * FROM titles WHERE id = ?').get(titleId);
  if (!title) return res.status(404).json({ error: 'Título no encontrado' });
  const branch = await db.prepare('SELECT * FROM branches WHERE id = ?').get(title.branch_id);
  const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(branch.category_id);
  const league = await db.prepare('SELECT * FROM leagues WHERE id = ?').get(category.league_id);
  const isMember = await isOrgMember(req.user.id, league.organization_id);
  if (req.user.role === 'admin' || isMember || league.owner_user_id === req.user.id) {
    req.league = league;
    req.category = category;
    req.branch = branch;
    req.title = title;
    return next();
  }
  return res.status(403).json({ error: 'No tienes permiso sobre este título' });
});
