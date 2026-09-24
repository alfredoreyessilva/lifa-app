import express from 'express';
import crypto from 'crypto';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { teamLeagueOwnerRequired, organizationAdminRequired } from '../middleware/ownership.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { orgTieneMiembros } from '../utils/orgMembers.js';
import { esRolValido, rolesDeTipo, etiquetaDeRol, puede, rolDeInvitacion } from '../utils/orgRoles.js';
import { VIGENCIA_DIAS, vigenteSql, segundosRestantesSql, motivoInvalido, limpiarNota } from '../utils/invitaciones.js';

const router = express.Router();

// Hay dos tipos de link, y comparten esta tabla y la pantalla de llegada pero
// NO sus reglas (README, "Dos links distintos: la entrega y la invitación con
// rol"). En corto:
//
//   - La ENTREGA (`type = 'team'`) es el primer acceso a un equipo. Una sola
//     viva a la vez —generar otra cancela la anterior— y una sola vez en la
//     vida del equipo.
//   - La INVITACIÓN CON ROL (`type = 'org_admin'`) suma a una persona más a una
//     organización que ya tiene dueño. Las que hagan falta, a la vez.
//
// Lo que comparten: caducan a los VIGENCIA_DIAS de generadas, y se gastan en la
// misma sentencia que da de alta a quien las usa.

function generateToken() {
  return crypto.randomBytes(12).toString('hex'); // ej. "a1b2c3d4e5f6…"
}

const YA_ENTREGADO = 'Este equipo ya se administra solo. Su acceso lo reparten sus dueños, no la liga — '
  + 'su participación en los torneos no cambia.';

/* ===================== ENTREGAR UN EQUIPO A SU REPRESENTANTE ===================== */
// Solo el representante de la liga (o un admin) puede generar esto — ver
// teamLeagueOwnerRequired.
//
// Esta invitación NO lleva selector de rol y siempre entrega 'owner': es la
// ENTREGA del equipo, no un reparto de acceso. La liga no decide quién es el
// tesorero de un club que todavía no es suyo — el representante que la reclame
// reparte desde adentro los roles que quiera (POST /organizations/:id/admins).
//
// SE ENTREGA UNA VEZ. Una liga crea equipos para poder subir su calendario, y
// cuando le entrega el perfil a alguien, se sale de la administración de ese
// equipo — no queda como administrador ni puede volver a entrar. Por eso esta
// ruta responde 409 en cuanto el equipo tiene a alguien adentro.
//
// Sin esta regla el modelo no cerraba por ningún lado: generar una invitación
// nueva y reclamarla uno mismo llega al padrón ajeno —CURP y fecha de
// nacimiento de menores, y el `share_token` que ES la credencial del estado de
// cuenta de cada familia— sin pedirle permiso a nadie.
//
// Que la liga se salga de la administración NO saca al equipo de sus torneos:
// eso vive en `branch_teams` y no se toca aquí. Son dos preguntas distintas
// —¿el equipo se administra solo? y ¿el equipo participa en esta liga?— y
// confundirlas es lo que hacía falta de este modelo (README).

// La entrega vigente de un equipo, para que volver a abrir "Entregar perfil"
// enseñe el link que ya se mandó en vez de generar otro. Hasta el 2026-09-23 el
// modal generaba uno al montarse, y como generar mata el anterior, abrirlo solo
// para copiar el link otra vez dejaba muerto el que ya estaba en el WhatsApp de
// alguien (PD-30).
//
// Devuelve la más reciente. Dos vivas no debería haber, pero dos peticiones al
// mismo tiempo (un doble clic) sí las dejan; no es un riesgo, porque el claim
// de abajo solo deja entregar el equipo una vez.
router.get('/teams/:teamId', authRequired, teamLeagueOwnerRequired, asyncHandler(async (req, res) => {
  if (await orgTieneMiembros(req.team.organization_id)) {
    return res.status(409).json({ error: YA_ENTREGADO });
  }

  const vigente = await db.prepare(`
    SELECT i.token, ${segundosRestantesSql('i')} AS seconds_left
    FROM invites i
    WHERE i.team_id = ? AND i.type = 'team' AND i.used_at IS NULL AND ${vigenteSql('i')}
    ORDER BY i.created_at DESC
    LIMIT 1
  `).get(req.team.id);

  res.json({
    invite: vigente
      ? { ...vigente, role: 'owner', role_label: etiquetaDeRol('owner', 'team') }
      : null,
  });
}));

// Generar una entrega nueva CANCELA la anterior. Es el único link que funciona
// así: del otro lado siempre hay una sola persona, el representante, y dos
// links vivos para lo mismo solo sirven para que uno se pierda en un chat.
router.post('/teams/:teamId', authRequired, teamLeagueOwnerRequired, asyncHandler(async (req, res) => {
  if (await orgTieneMiembros(req.team.organization_id)) {
    return res.status(409).json({ error: YA_ENTREGADO });
  }

  await db.prepare(`DELETE FROM invites WHERE team_id = ? AND used_at IS NULL`).run(req.team.id);

  const token = generateToken();
  await db.prepare(`
    INSERT INTO invites (token, type, team_id, role, created_by)
    VALUES (?, 'team', ?, 'owner', ?)
  `).run(token, req.team.id, req.user.id);

  res.status(201).json({
    token,
    role: 'owner',
    role_label: etiquetaDeRol('owner', 'team'),
    seconds_left: VIGENCIA_DIAS * 24 * 60 * 60,
  });
}));

/* ===================== CANCELAR UNA ENTREGA QUE NADIE RECLAMÓ ===================== */
// Esto era "quitar representante" y ya no lo es. **No existe revocar.**
//
// "Revocado" era un concepto equivocado, y su error era confundir dos cosas que
// no tienen nada que ver: *¿el equipo se administra solo?* y *¿el equipo
// participa en los torneos de esta liga?*. Una liga que le quita la
// administración a un equipo no le está quitando su lugar en el calendario, y
// una liga que saca a un equipo de su torneo no le está quitando su padrón.
// Mientras las dos preguntas compartieron un botón, la respuesta a una movía
// la otra — y ahí vivía la puerta trasera: revocar, invitar de nuevo,
// reclamarlo uno mismo, y el padrón del club quedaba del lado de la liga.
//
// Lo único que queda aquí es cancelar un link que todavía nadie usó, que es una
// necesidad real —se mandó a la persona equivocada, se mandó dos veces— y no
// le quita nada a nadie: si nadie lo reclamó, no hay acceso que retirar.
//
// Una vez que alguien reclamó, 409. Para dejar de ver a un equipo en su liga
// está la participación (`branch_teams`), que es otra cosa y otro botón.
router.delete('/teams/:teamId/owner', authRequired, teamLeagueOwnerRequired, asyncHandler(async (req, res) => {
  if (await orgTieneMiembros(req.team.organization_id)) {
    return res.status(409).json({
      error: 'Este equipo ya se administra solo y eso no se deshace desde aquí. '
        + 'Si lo que quieres es sacarlo de tu liga, eso es su participación y se hace por separado.',
    });
  }

  await db.prepare(`DELETE FROM invites WHERE team_id = ? AND used_at IS NULL`).run(req.team.id);
  res.json({ ok: true });
}));

/* ===================== GENERAR INVITACIÓN CON ROL ===================== */
// A diferencia de la entrega (que le da un equipo a su primer dueño), esta
// AGREGA a quien la reclame como un miembro más de la organización — liga o
// equipo, misma ruta para ambas, porque los dos ya tienen su organización
// propia (leagues.organization_id / teams.organization_id).
//
// El rol viaja en el cuerpo y se valida contra el TIPO de organización, que es
// la validación que un CHECK no puede hacer: el esquema acepta la unión de los
// seis roles porque el tipo vive en otra tabla, así que "un coach en una liga"
// solo se puede rechazar aquí (README, "Los roles").
//
// Sin `role` se entrega 'admin', que es lo único que esta ruta sabía dar antes
// del paso 4. Así el frontend viejo —que manda el cuerpo vacío— sigue haciendo
// exactamente lo mismo, y no hay ventana de incompatibilidad al desplegar.
router.post('/organizations/:organizationId/admins', authRequired, organizationAdminRequired, asyncHandler(async (req, res) => {
  const role = req.body?.role ?? 'admin';

  if (!esRolValido(req.organization.type, role)) {
    return res.status(400).json({
      error: 'Ese rol no existe para este tipo de organización',
      roles: rolesDeTipo(req.organization.type),
    });
  }

  // El único permiso que un administrador no tiene es repartir el puesto de
  // dueño. No es jerarquía por gusto: un dueño puede quitar a quien lo invitó,
  // así que dejar que un admin nombre dueños es dejar que se ascienda solo.
  // `req.orgRole` lo cuelga organizationAdminRequired.
  if (role === 'owner' && !puede(req.organization.type, req.orgRole, 'duenos')) {
    return res.status(403).json({ error: 'Solo un dueño puede invitar a otro dueño' });
  }

  // Antes de la entrega no hay invitaciones con rol a un equipo: su primera
  // persona entra SIEMPRE por la entrega. Ninguna liga llega hasta aquí
  // (organizationAdminRequired no la deja entrar a la organización del
  // equipo), pero el admin de la plataforma sí. Un coach que entrara por esta
  // vía haría que `orgTieneMiembros()` diera el equipo por entregado sin que
  // tenga dueño: la liga lo perdería y nadie adentro podría repartir su acceso.
  if (req.organization.type === 'team' && !(await orgTieneMiembros(req.organization.id))) {
    return res.status(409).json({
      error: 'Este equipo todavía no se entrega. Su primer acceso es la entrega del perfil, '
        + 'que se genera desde el panel de su liga.',
    });
  }

  // Ya NO se borra ningún link anterior (2026-09-23). Hasta aquí había uno
  // vigente por rol, y un equipo que quería invitar a veinte entrenadores no
  // podía: cada link de Coach mataba el anterior. Ahora cada link es para una
  // persona, y los vivos se ven y se cancelan en la lista de pendientes.
  const note = limpiarNota(req.body?.note);
  const token = generateToken();
  const { id } = await db.prepare(`
    INSERT INTO invites (token, type, organization_id, role, note, created_by)
    VALUES (?, 'org_admin', ?, ?, ?, ?)
    RETURNING id
  `).get(token, req.organization.id, role, note, req.user.id);

  res.status(201).json({
    id,
    token,
    role,
    role_label: etiquetaDeRol(role, req.organization.type),
    note,
    seconds_left: VIGENCIA_DIAS * 24 * 60 * 60,
  });
}));

/* ===================== INVITACIONES CON ROL PENDIENTES ===================== */
// Los links vivos (sin usar y sin caducar) de una organización. Los usados ya
// se ven como personas en la lista de miembros, y los caducados no le sirven
// a nadie.
//
// Ves y cancelas lo que tú mismo podrías generar. La lista enseña el link
// completo, y un link de dueño en manos de un administrador es una escalera:
// lo copia, lo usa él mismo y se asciende solo, que es justo lo que impide la
// regla de invitar dueños. Así que a un administrador se le dice que existe,
// pero sin el link. Los demás no le dan nada nuevo: los podría generar él.
function puedeManejarInvitacion(req, rol) {
  return rol !== 'owner' || puede(req.organization.type, req.orgRole, 'duenos');
}

router.get('/organizations/:organizationId', authRequired, organizationAdminRequired, asyncHandler(async (req, res) => {
  const filas = await db.prepare(`
    SELECT i.id, i.token, i.type, i.role, i.note, u.name AS created_by_name,
           ${segundosRestantesSql('i')} AS seconds_left
    FROM invites i
    LEFT JOIN users u ON u.id = i.created_by
    WHERE i.organization_id = ? AND i.type = 'org_admin'
      AND i.used_at IS NULL AND ${vigenteSql('i')}
    ORDER BY i.created_at DESC
  `).all(req.organization.id);

  const invites = filas.map(({ type, token, ...fila }) => {
    // Las de antes del paso 4 tienen role NULL y valen como 'admin'.
    const role = rolDeInvitacion({ type, role: fila.role });
    const puedeManejar = puedeManejarInvitacion(req, role);
    return {
      ...fila,
      role,
      role_label: etiquetaDeRol(role, req.organization.type),
      token: puedeManejar ? token : null,
      can_cancel: puedeManejar,
    };
  });

  res.json({ invites });
}));

// Cancelar un link con rol que nadie ha usado. Misma regla que generarlo: el
// de dueño, solo quien puede invitar dueños.
router.delete('/organizations/:organizationId/:inviteId', authRequired, organizationAdminRequired, asyncHandler(async (req, res) => {
  const invite = await db.prepare(`
    SELECT id, type, role, used_at FROM invites
    WHERE id = ? AND organization_id = ? AND type = 'org_admin'
  `).get(Number(req.params.inviteId), req.organization.id);
  if (!invite) return res.status(404).json({ error: 'Esa invitación no existe' });

  if (invite.used_at) {
    return res.status(409).json({
      error: 'Esa invitación ya se usó. Para quitarle el acceso a esa persona, quítala de la lista de quién tiene acceso.',
    });
  }
  if (!puedeManejarInvitacion(req, rolDeInvitacion(invite))) {
    return res.status(403).json({ error: 'Solo un dueño puede cancelar la invitación de otro dueño' });
  }

  await db.prepare(`DELETE FROM invites WHERE id = ? AND used_at IS NULL`).run(invite.id);
  res.json({ ok: true });
}));

/* ===================== VER INFO PÚBLICA DE UNA INVITACIÓN ===================== */
// Pública (sin sesión) — para mostrarle a la persona qué va a reclamar antes
// de pedirle que inicie sesión o se registre.
router.get('/:token', asyncHandler(async (req, res) => {
  const invite = await db.prepare(`
    SELECT
      i.token, i.type, i.used_at, i.role, (${vigenteSql('i')}) AS vigente,
      t.id AS team_id, t.name AS team_name, t.logo_url AS team_logo_url,
      t.organization_id AS team_organization_id,
      l.name AS league_name,
      o.id AS organization_id, o.name AS organization_name, o.logo_url AS organization_logo_url, o.type AS organization_type
    FROM invites i
    LEFT JOIN teams t         ON t.id = i.team_id
    LEFT JOIN leagues l       ON l.id = t.league_id
    LEFT JOIN organizations o ON o.id = i.organization_id
    WHERE i.token = ?
  `).get(req.params.token);

  const motivo = motivoInvalido(invite);
  if (motivo) return res.status(motivo.status).json({ error: motivo.error });

  const { vigente, team_organization_id: orgDelEquipo, ...publica } = invite;

  // Una entrega de un equipo que ya se entregó por otro link. Se dice aquí, y
  // no hasta el claim, para no pedirle a nadie que cree una cuenta para nada.
  if (invite.type === 'team' && await orgTieneMiembros(orgDelEquipo)) {
    return res.status(409).json({ error: 'Este equipo ya fue entregado. Si necesitas entrar, pídele acceso a quien lo administra.' });
  }

  // Con qué rol va a entrar, ya resuelto y ya legible. Quien recibe un link
  // tiene derecho a saber a qué lo están invitando ANTES de crearse una
  // cuenta, que es lo único que esta ruta pública existe para contestar.
  //
  // La etiqueta se arma aquí y no en el frontend a propósito: `editor` se lee
  // "Editor de partidos (Visor)" y `treasurer` cambia de nombre según el tipo
  // de organización. Dos catálogos separados se separan (regla 6).
  //
  // Una invitación de equipo no tiene `organization_id` —apunta al equipo, no
  // a su organización— así que su tipo se sabe por el tipo de invitación.
  const role = rolDeInvitacion(invite);
  const tipo = invite.type === 'team' ? 'team' : invite.organization_type;

  res.json({ ...publica, role, role_label: etiquetaDeRol(role, tipo) });
}));

/* ===================== RECLAMAR UNA INVITACIÓN ===================== */
// Requiere sesión iniciada (el frontend manda a la persona a iniciar sesión
// o crear una cuenta primero si hace falta).
//
// En los dos tipos, el link se GASTA EN LA MISMA SENTENCIA que da de alta a la
// persona: `UPDATE invites … WHERE used_at IS NULL` como primer CTE, y el alta
// colgada de lo que ese UPDATE devolvió. Hasta el 2026-09-23 se revisaba
// `used_at`, se daba de alta y se marcaba en tres llamadas, así que dos
// personas que abrían el mismo link reenviado al mismo tiempo entraban las dos.
// Ahora la segunda encuentra el link ya gastado y recibe 410.
//
// Una sola sentencia y no una transacción repartida en varias llamadas
// (CLAUDE.md): `db.prepare` toma una conexión del pool por consulta y del otro
// lado hay un pooler en modo transacción.
router.post('/:token/claim', authRequired, asyncHandler(async (req, res) => {
  const invite = await db.prepare(`
    SELECT i.*, (${vigenteSql('i')}) AS vigente FROM invites i WHERE i.token = ?
  `).get(req.params.token);

  const motivo = motivoInvalido(invite);
  if (motivo) return res.status(motivo.status).json({ error: motivo.error });

  const role = rolDeInvitacion(invite);
  const yaGastada = () => res.status(410).json({ error: 'Esta invitación ya fue utilizada' });

  let organization = null;

  if (invite.type === 'team') {
    const equipo = await db.prepare('SELECT organization_id FROM teams WHERE id = ?').get(invite.team_id);
    if (!equipo) return res.status(404).json({ error: 'Esta invitación no existe o ya no es válida' });

    // La entrega es una sola vez en la vida del equipo. Antes esto escribía el
    // dueño sin preguntar si el equipo ya había sido entregado: con un solo
    // link vivo no se notaba, pero un doble clic en "Entregar perfil" deja dos,
    // y el segundo metía como dueño a quien lo tuviera DESPUÉS de la entrega.
    // Si lo tiene la liga, esa es la puerta trasera al padrón que "entregado
    // es entregado" vino a cerrar. El link no se gasta: ya no sirve de todos
    // modos, y así la pantalla dice la razón verdadera.
    if (await orgTieneMiembros(equipo.organization_id)) {
      return res.status(409).json({ error: 'Este equipo ya fue entregado. Si necesitas entrar, pídele acceso a quien lo administra.' });
    }

    // LA ENTREGA PUEBLA LA ORGANIZACIÓN: quien reclama queda de alta como
    // 'owner' y en `teams.owner_user_id`, en la misma sentencia — a la mitad
    // quedaría un equipo con dueño y sin miembros.
    //
    // `owner_user_id IS NULL` en el UPDATE es lo que cierra la carrera entre
    // dos entregas del mismo equipo reclamadas al mismo instante: la segunda
    // espera el candado de la fila, la vuelve a leer ya con dueño y no la
    // toca. Su link sí queda gastado, que es lo correcto: el equipo ya se
    // entregó y ese link no le iba a servir a nadie.
    //
    // El WHERE de `organization_id IS NOT NULL` cubre al equipo sin
    // organización: el INSERT no corre y el UPDATE sí. No debería pasar
    // —db.js rellena esa columna en cada arranque— pero esta ruta no es lugar
    // para averiguarlo.
    const r = await db.prepare(`
      WITH gastada AS (
        UPDATE invites SET used_by = ?, used_at = CURRENT_TIMESTAMP
         WHERE id = ? AND used_at IS NULL AND ${vigenteSql('invites')}
        RETURNING team_id
      ), entregado AS (
        UPDATE teams SET owner_user_id = ?
         WHERE id IN (SELECT team_id FROM gastada) AND owner_user_id IS NULL
        RETURNING organization_id
      ), alta AS (
        INSERT INTO organization_members (organization_id, user_id, role, status)
        SELECT organization_id, ?, 'owner', 'active'
          FROM entregado
         WHERE organization_id IS NOT NULL
        ON CONFLICT (organization_id, user_id)
        DO UPDATE SET role = 'owner', status = 'active'
        RETURNING 1
      )
      SELECT (SELECT COUNT(*) FROM gastada)::int   AS gastadas,
             (SELECT COUNT(*) FROM entregado)::int AS entregados
    `).get(req.user.id, invite.id, req.user.id, req.user.id);

    if (r.gastadas === 0) return yaGastada();
    if (r.entregados === 0) {
      return res.status(409).json({ error: 'Este equipo ya fue entregado. Si necesitas entrar, pídele acceso a quien lo administra.' });
    }
  } else if (invite.type === 'org_admin') {
    organization = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(invite.organization_id);
    if (!organization) return res.status(404).json({ error: 'Esta invitación no existe o ya no es válida' });

    // Mismo candado que al generarla: a un equipo sin entregar solo se entra
    // por la entrega. Cubre los links que se hubieran generado antes de él.
    if (organization.type === 'team' && !(await orgTieneMiembros(organization.id))) {
      return res.status(409).json({
        error: 'Este equipo todavía no se entrega, así que esta invitación no puede usarse todavía.',
      });
    }

    // Un link es para alguien que todavía no está (2026-09-23). Antes, el rol
    // de la invitación reemplazaba al de quien ya era miembro —salvo a un
    // dueño—, y con varios links vivos eso se volvió peligroso: un
    // administrador que abría uno de los veinte links de Coach quedaba como
    // Coach, y encima gastaba el link de otra persona. Un dueño que abría uno
    // lo gastaba sin cambiar nada (PD-31). Ahora ninguno de los dos se gasta,
    // y cambiar un rol es un botón aparte (PATCH /organizations/:id/members/:userId).
    const yaEsMiembro = await db.prepare(`
      SELECT role FROM organization_members
      WHERE organization_id = ? AND user_id = ? AND status = 'active'
    `).get(organization.id, req.user.id);
    if (yaEsMiembro) {
      const suRol = etiquetaDeRol(yaEsMiembro.role, organization.type) ?? yaEsMiembro.role;
      return res.status(409).json({
        error: `Ya eres parte de ${organization.name} como ${suRol}. Este link es para otra persona: `
          + 'no se gastó, y todavía le sirve a quien se lo mandaron.',
      });
    }

    // No se reemplaza a nadie: se agrega a quien reclama con el rol que la
    // invitación diga. El ON CONFLICT solo alcanza a una fila que no esté
    // activa; a un miembro activo ya se le contestó arriba.
    const r = await db.prepare(`
      WITH gastada AS (
        UPDATE invites SET used_by = ?, used_at = CURRENT_TIMESTAMP
         WHERE id = ? AND used_at IS NULL AND ${vigenteSql('invites')}
        RETURNING organization_id
      ), alta AS (
        INSERT INTO organization_members (organization_id, user_id, role, status)
        SELECT organization_id, ?, ?, 'active' FROM gastada
        ON CONFLICT (organization_id, user_id)
        DO UPDATE SET role = EXCLUDED.role, status = 'active'
        WHERE organization_members.status <> 'active'
        RETURNING 1
      )
      SELECT (SELECT COUNT(*) FROM gastada)::int AS gastadas
    `).get(req.user.id, invite.id, req.user.id, role);

    if (r.gastadas === 0) return yaGastada();
  }

  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(invite.team_id);

  // Primer tipo de notificación en la bandeja de la liga: le avisa al
  // representante de la liga que el equipo ya tomó control de su perfil
  // (es decir, que alguien reclamó el magic link que le habían entregado).
  // Solo aplica a invitaciones de tipo 'team', que son las únicas que hoy
  // tienen una liga dueña a quien avisarle.
  if (invite.type === 'team' && team) {
    await db.prepare(`
      INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
      VALUES ('league', ?, 'team_claimed', ?, ?, ?)
    `).run(
      team.league_id,
      `${team.name} tomó control de su perfil`,
      'El equipo ya inició sesión con el link que le compartiste y ahora administra su propia información.',
      JSON.stringify({ team_id: team.id, team_name: team.name })
    );
  }

  if (organization) {
    // Mismo aviso que arriba pero para el nuevo administrador de una
    // organización: se manda a la bandeja de la liga o del equipo detrás
    // de ella (notifications solo acepta esos dos recipient_type hoy).
    const league = await db.prepare('SELECT id FROM leagues WHERE organization_id = ?').get(organization.id);
    const orgTeam = league ? null : await db.prepare('SELECT id FROM teams WHERE organization_id = ?').get(organization.id);
    if (league || orgTeam) {
      await db.prepare(`
        INSERT INTO notifications (recipient_type, recipient_id, type, title, body, data)
        VALUES (?, ?, 'org_admin_claimed', ?, ?, ?)
      `).run(
        league ? 'league' : 'team',
        league ? league.id : orgTeam.id,
        `${req.user.name} entró a ${organization.name}`,
        // El aviso dice el ROL y no "el mismo acceso que los demás", que era
        // cierto cuando todo invitado entraba como admin y dejó de serlo. Es
        // la única señal que le queda a la organización de qué se repartió.
        `Aceptó la invitación y entró como ${etiquetaDeRol(role, organization.type) ?? role}.`,
        JSON.stringify({ organization_id: organization.id, user_id: req.user.id, user_name: req.user.name, role })
      );
    }
  }

  // El rol se devuelve resuelto y legible, igual que en GET /:token: quien
  // acaba de reclamar tiene que poder leer con qué entró sin volver a
  // preguntar, y el panel al que cae ya depende de eso.
  const tipo = invite.type === 'team' ? 'team' : organization?.type;
  res.json({ ok: true, team, organization, role, role_label: etiquetaDeRol(role, tipo) });
}));

export default router;
