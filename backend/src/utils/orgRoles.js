// El catálogo de roles de una organización: cuáles existen, cuáles valen para
// cada tipo de organización, cómo se leen en pantalla y qué puede hacer cada
// uno. El porqué de cada decisión está en el README, "Roles y fronteras de
// información" (decidido el 2026-09-19).
//
// Va en un archivo propio y NO dentro de utils/orgMembers.js a propósito: ese
// importa `db`, así que nada de ahí se puede probar sin Postgres. Esto es puro
// —no importa nada— y por eso el CI sí lo alcanza a cubrir. Es también lo que
// `config/db.js` usa para construir el CHECK del esquema, de modo que la lista
// de la base y la del código no puedan separarse (regla 6 de CLAUDE.md).

// Lo que se guarda en organization_members.role, con su etiqueta por default.
//
// `editor` es el **visor**: se reusó el valor que ya estaba en el CHECK desde
// que se creó la tabla y que ninguna fila usaba, para no pagar ni migración de
// datos ni ventana de incompatibilidad al desplegar. En pantalla nunca se lee
// "editor" a secas — se lee la etiqueta, siempre vía `etiquetaDeRol()`.
export const ROLES = {
  owner:         'Dueño',
  admin:         'Administrador',
  treasurer:     'Tesorero',
  editor:        'Editor de partidos (Visor)',
  roster_editor: 'Editor de roster',
  coach:         'Coach',
};

// El orden importa: es el que se pinta en el selector al invitar, de más
// acceso a menos.
export const TODOS_LOS_ROLES = Object.keys(ROLES);

// Qué roles tienen sentido en cada tipo de organización. Un `coach` no
// significa nada en una liga y un visor no significa nada en un equipo, así
// que el CHECK del esquema acepta la UNIÓN y la validación de verdad es esta.
// El tipo vive en `organizations.type` y no se puede mirar desde un CHECK de
// `organization_members`, que es la otra razón de que esto viva aquí.
const POR_TIPO = {
  league: ['owner', 'admin', 'treasurer', 'editor'],
  team:   ['owner', 'admin', 'treasurer', 'roster_editor', 'coach'],
  // Medio, tienda, clínica y marca no manejan dinero ni datos de menores en la
  // plataforma; no hay para qué inventarles roles que nadie pidió.
  media:  ['owner', 'admin'],
  store:  ['owner', 'admin'],
  clinic: ['owner', 'admin'],
  brand:  ['owner', 'admin'],
};

// Un tesorero de liga y uno de equipo no hacen lo mismo, y en el panel de una
// liga "Tesorero" a secas se lee ambiguo. Solo se escriben las excepciones.
const ETIQUETAS_POR_TIPO = {
  league: { treasurer: 'Tesorero de liga' },
};

// ── Permisos ──────────────────────────────────────────────────────────────
//
// Cada permiso es un DOMINIO sobre el que se puede actuar, no una ruta. Las
// rutas piden el permiso y este archivo decide, que es la regla de CLAUDE.md
// de que los permisos no viven en línea dentro del handler.
//
// `ver` es la línea base: el panel, el perfil, el calendario y el roster en
// solo lectura. Los dos dominios sensibles NO caen ahí — para **leerlos**
// también hace falta su permiso, no solo para escribir:
//
//   · `cuotas_club`  el padrón (CURP, nacimiento, tutor, share_token) y su libro
//   · `cobranza_liga` el libro entre la liga y el equipo
//
// Si algún día `ver` arrastrara esos dos, un coach vería el padrón completo —
// que es exactamente lo que este modelo existe para impedir.
//
// `asistencia` es el caso contrario y por eso vale la pena decirlo aquí:
// **solo existe del lado de la liga**, porque pasar lista es un acto de la
// liga en su partido. Un equipo no marca la asistencia de nadie, ni la suya.
// Leer la de los suyos sí, y eso cae en `ver` —incluido el coach, que es justo
// quien necesita saber a quién le falta antes de que sea tarde—: la asistencia
// es del dominio torneo, como el roster, no de los dos dominios sensibles.
//
// Y no hace falta un "actuar como visor": el emprendedor que registró la liga
// a veces pasa lista él mismo, y su rol de dueño ya trae el permiso. Un rol no
// es un disfraz que uno se pone; es lo que uno puede. Es también por qué el
// permiso se llama `asistencia` y no "ser visor".
//
// `estadisticas` —capturar las jugadas— se reparte IGUAL que `asistencia`, y
// por las mismas razones: es la otra pantalla del visor en la cancha, y quien
// pasa lista es quien se queda a capturar. Se mantiene como permiso APARTE y
// no dentro de `asistencia` porque son dos trabajos de tamaños muy distintos
// —cuarenta marcas contra ciento veinte jugadas—, y una liga va a querer
// poder dar el primero sin el segundo.
//
// La diferencia con la asistencia está del lado de la LECTURA, no de la
// escritura: el box score **sí es público**, porque es el resultado deportivo
// y eso es justo lo que un torneo publica. La asistencia no lo es nunca. Lo
// que no sale en ninguno de los dos es el dato personal detrás del jugador,
// que ya está cubierto por la regla 7.
export const PERMISOS = [
  'ver',               // leer el panel: perfil, calendario y roster
  'perfil',            // editar el perfil de la organización
  'estructura',        // categorías, ramas, grupos, fases, títulos, sedes, equipos, transmisiones
  'partidos',          // crear, borrar e importar partidos
  'marcadores',        // editar un partido que YA existe: marcador, estado, fecha, hora, sede, links
  'cobranza_liga',     // el libro liga ↔ equipo, de los dos lados
  'cuotas_club',       // el padrón del club y su libro
  'roster',            // el roster de torneo
  'asistencia',        // pasar lista en un partido
  'estadisticas',      // capturar las jugadas de un partido
  'miembros',          // invitar y quitar gente que no sea dueño
  'duenos',            // invitar y quitar dueños
  'entregar_equipos',  // entregarle a un equipo su perfil (una sola vez, no se deshace)
];

// Qué permisos trae cada rol, por tipo de organización. Se escribe completo y
// no por herencia ("admin = owner menos X") a propósito: la tabla se lee de un
// vistazo y un permiso nuevo obliga a decidir rol por rol en vez de colarse
// solo a todos los que heredaban.
const PERMISOS_POR_ROL = {
  league: {
    owner:     ['ver', 'perfil', 'estructura', 'partidos', 'marcadores', 'cobranza_liga', 'roster', 'asistencia', 'estadisticas', 'miembros', 'duenos', 'entregar_equipos'],
    admin:     ['ver', 'perfil', 'estructura', 'partidos', 'marcadores', 'cobranza_liga', 'roster', 'asistencia', 'estadisticas', 'miembros', 'entregar_equipos'],
    treasurer: ['ver', 'cobranza_liga'],
    editor:    ['ver', 'marcadores', 'asistencia', 'estadisticas'],
  },
  team: {
    owner:         ['ver', 'perfil', 'roster', 'cuotas_club', 'cobranza_liga', 'miembros', 'duenos'],
    admin:         ['ver', 'perfil', 'roster', 'cuotas_club', 'cobranza_liga', 'miembros'],
    treasurer:     ['ver', 'cuotas_club', 'cobranza_liga'],
    roster_editor: ['ver', 'roster'],
    coach:         ['ver'],
  },
  media:  { owner: ['ver', 'perfil', 'miembros', 'duenos'], admin: ['ver', 'perfil', 'miembros'] },
  store:  { owner: ['ver', 'perfil', 'miembros', 'duenos'], admin: ['ver', 'perfil', 'miembros'] },
  clinic: { owner: ['ver', 'perfil', 'miembros', 'duenos'], admin: ['ver', 'perfil', 'miembros'] },
  brand:  { owner: ['ver', 'perfil', 'miembros', 'duenos'], admin: ['ver', 'perfil', 'miembros'] },
};

// ── Lo que consume el resto del proyecto ──────────────────────────────────
//
// Las cuatro funciones FALLAN CERRADO: un tipo de organización que no existe,
// un rol que no existe o un permiso mal escrito devuelven "no" o una lista
// vacía, nunca un error y nunca acceso. Un typo en una ruta tiene que dejar a
// alguien fuera, no dejar a todos adentro.

// Los roles que se le pueden dar a alguien en una organización de este tipo.
export function rolesDeTipo(tipo) {
  return POR_TIPO[tipo] ? [...POR_TIPO[tipo]] : [];
}

// ¿Se puede invitar a alguien con este rol a una organización de este tipo?
export function esRolValido(tipo, rol) {
  return rolesDeTipo(tipo).includes(rol);
}

// Cómo se lee el rol en pantalla. Nunca devuelve el valor crudo: si el rol no
// existe, devuelve null para que quien llama decida qué pintar — así un rol
// desconocido no termina mostrándose como "editor" en la interfaz.
export function etiquetaDeRol(rol, tipo) {
  return ETIQUETAS_POR_TIPO[tipo]?.[rol] ?? ROLES[rol] ?? null;
}

// La pregunta que hacen las rutas.
export function puede(tipo, rol, permiso) {
  if (!PERMISOS.includes(permiso)) return false;
  return (PERMISOS_POR_ROL[tipo]?.[rol] ?? []).includes(permiso);
}

// Los roles de este tipo de organización que tienen tal permiso. Es lo que se
// le pasa a `isOrgMember(..., allowedRoles)` desde una ruta, para no repetir
// la lista a mano en cada endpoint y que se desincronice.
export function rolesConPermiso(tipo, permiso) {
  return rolesDeTipo(tipo).filter((rol) => puede(tipo, rol, permiso));
}

// Los permisos que trae un rol, ya resueltos. Es lo que viaja al frontend en
// `/auth/me` para que pueda esconder lo que este rol no puede hacer.
//
// Se manda la lista resuelta y NO la tabla de permisos: el frontend pregunta
// "¿puedo 'cuotas_club'?" y no "¿qué es un tesorero?". Así la tabla vive en un
// solo lado (regla 6) y agregar un rol no obliga a tocar el frontend.
//
// Ojo con lo que esto es y lo que no: es para **esconder**, no para proteger.
// Quien decide de verdad es la guarda del backend. Una lista que llegue de más
// enseña un botón que va a dar 403; una que llegue de menos esconde algo que sí
// se podía. Ninguna de las dos abre nada.
export function permisosDeRol(tipo, rol) {
  return PERMISOS.filter((permiso) => puede(tipo, rol, permiso));
}

// ── La invitación que no dice rol ─────────────────────────────────────────
//
// `invites.role` existe desde el paso 4 y nace NULL; lo generado antes se
// queda NULL para siempre (regla 8: el esquema se agrega, no se edita). Esta
// es la regla que lee esas filas, y dice exactamente lo que el código hacía
// antes de que la columna existiera: una invitación de organización entregaba
// 'admin' y una de equipo entregaba el equipo completo.
//
// Vive aquí y no en `routes/invites.js` por la misma razón que el catálogo:
// un link repartido por WhatsApp hace tres días no se puede volver a probar a
// mano, así que la regla que decide cuánto vale tiene que poder probarse sin
// Postgres — y eso es lo único que el CI alcanza a correr.
const ROL_POR_DEFECTO = {
  team: 'owner',
  org_admin: 'admin',
};

// Falla cerrado como las demás: un tipo de invitación que no existe no
// devuelve un rol, devuelve null.
export function rolDeInvitacion(invite) {
  return invite?.role ?? ROL_POR_DEFECTO[invite?.type] ?? null;
}
