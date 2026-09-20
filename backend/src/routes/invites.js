import express from 'express';
import crypto from 'crypto';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { teamLeagueOwnerRequired, organizationAdminRequired } from '../middleware/ownership.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { orgTieneMiembros } from '../utils/orgMembers.js';
import { esRolValido, rolesDeTipo, etiquetaDeRol, puede, rolDeInvitacion } from '../utils/orgRoles.js';

const router = express.Router();

function generateToken() {
  return crypto.randomBytes(12).toString('hex'); // ej. "a1b2c3d4e5f6…"
}

/* ===================== ENTREGAR UN EQUIPO A SU REPRESENTANTE ===================== */
// Solo el representante de la liga (o un admin) puede generar esto — ver
// teamLeagueOwnerRequired. Si ya había una invitación sin usar para este
// equipo, se elimina primero para que solo quede una vigente a la vez.
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
router.post('/teams/:teamId', authRequired, teamLeagueOwnerRequired, asyncHandler(async (req, res) => {
  if (await orgTieneMiembros(req.team.organization_id)) {
    return res.status(409).json({
      error: 'Este equipo ya se administra solo. Su acceso lo reparten sus dueños, no la liga — '
        + 'su participación en los torneos no cambia.',
    });
  }

  await db.prepare(`DELETE FROM invites WHERE team_id = ? AND used_at IS NULL`).run(req.team.id);

  const token = generateToken();
  await db.prepare(`
    INSERT INTO invites (token, type, team_id, role, created_by)
    VALUES (?, 'team', ?, 'owner', ?)
  `).run(token, req.team.id, req.user.id);

  res.status(201).json({ token, role: 'owner', role_label: etiquetaDeRol('owner', 'team') });
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
// A diferencia de la de arriba (que REEMPLAZA al representante de un
// equipo), esta AGREGA a quien la reclame como un miembro más de la
// organización — liga o equipo, misma ruta para ambas, porque los dos ya
// tienen su organización propia (leagues.organization_id / teams.organization_id).
//
// El rol viaja en el cuerpo y se valida contra el TIPO de organización, que es
// la validación que un CHECK no puede hacer: el esquema acepta la unión de los
// seis roles porque el tipo vive en otra tabla, así que "un coach en una liga"
// solo se puede rechazar aquí (README, "Los roles").
//
// Sin `role` se entrega 'admin', que es lo único que esta ruta sabía dar antes
// del paso 4. Así el frontend viejo —que manda el cuerpo vacío— sigue haciendo
// exactamente lo mismo mientras llega su selector, y no hay ventana de
// incompatibilidad al desplegar.
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

  // Una invitación vigente POR ROL, no una sola para toda la organización.
  // Con roles, "solo una a la vez" se volvió un error: generar el link del
  // tesorero mataría en silencio el del coach que se mandó por WhatsApp hace
  // diez minutos, y esa persona llegaría a un 404 sin saber por qué.
  // COALESCE porque las invitaciones de antes del paso 4 tienen role NULL y
  // valen como 'admin'.
  await db.prepare(`
    DELETE FROM invites
    WHERE organization_id = ? AND type = 'org_admin' AND used_at IS NULL
      AND COALESCE(role, 'admin') = ?
  `).run(req.organization.id, role);

  const token = generateToken();
  await db.prepare(`
    INSERT INTO invites (token, type, organization_id, role, created_by)
    VALUES (?, 'org_admin', ?, ?, ?)
  `).run(token, req.organization.id, role, req.user.id);

  res.status(201).json({ token, role, role_label: etiquetaDeRol(role, req.organization.type) });
}));

/* ===================== VER INFO PÚBLICA DE UNA INVITACIÓN ===================== */
// Pública (sin sesión) — para mostrarle a la persona qué va a reclamar antes
// de pedirle que inicie sesión o se registre.
router.get('/:token', asyncHandler(async (req, res) => {
  const invite = await db.prepare(`
    SELECT
      i.token, i.type, i.used_at, i.role,
      t.id AS team_id, t.name AS team_name, t.logo_url AS team_logo_url,
      l.name AS league_name,
      o.id AS organization_id, o.name AS organization_name, o.logo_url AS organization_logo_url, o.type AS organization_type
    FROM invites i
    LEFT JOIN teams t         ON t.id = i.team_id
    LEFT JOIN leagues l       ON l.id = t.league_id
    LEFT JOIN organizations o ON o.id = i.organization_id
    WHERE i.token = ?
  `).get(req.params.token);

  if (!invite) return res.status(404).json({ error: 'Esta invitación no existe o ya no es válida' });
  if (invite.used_at) return res.status(410).json({ error: 'Esta invitación ya fue utilizada' });

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

  res.json({ ...invite, role, role_label: etiquetaDeRol(role, tipo) });
}));

/* ===================== RECLAMAR UNA INVITACIÓN ===================== */
// Requiere sesión iniciada (el frontend manda a la persona a iniciar sesión
// o crear una cuenta primero si hace falta).
router.post('/:token/claim', authRequired, asyncHandler(async (req, res) => {
  const invite = await db.prepare(`SELECT * FROM invites WHERE token = ?`).get(req.params.token);
  if (!invite) return res.status(404).json({ error: 'Esta invitación no existe o ya no es válida' });
  if (invite.used_at) return res.status(410).json({ error: 'Esta invitación ya fue utilizada' });

  const role = rolDeInvitacion(invite);

  if (invite.type === 'team') {
    // LA ENTREGA PUEBLA LA ORGANIZACIÓN. Antes del paso 4 esto solo llenaba
    // `teams.owner_user_id` y la organización del equipo —que ya existía, la
    // crea una migración de db.js para todo equipo que no la tenga— se quedaba
    // vacía. Un equipo entregado no tenía ni un miembro, así que el modelo de
    // roles no tenía sobre qué pararse y `teamClubRequired` necesitaba el
    // respaldo por `owner_user_id` para saber siquiera si había sido
    // entregado. Desde aquí ya no: quien reclama queda de alta como 'owner'.
    //
    // Las dos escrituras van en UNA sentencia con CTE, no en dos seguidas
    // (CLAUDE.md): `db.prepare` toma una conexión del pool por consulta y del
    // otro lado hay un pooler en modo transacción, así que dos llamadas no
    // tienen garantizada ni la misma conexión ni atomicidad. Y aquí sí
    // importa — a la mitad quedaría un equipo con dueño y sin miembros, que
    // es exactamente el estado que este paso vino a eliminar.
    //
    // DO UPDATE y no DO NOTHING: si quien reclama ya era miembro del equipo
    // con otro rol (un coach al que después le entregan el equipo), la entrega
    // lo asciende. Reclamar la entrega es lo más fuerte que hay.
    //
    // El WHERE de la subconsulta cubre al equipo sin `organization_id`: el
    // INSERT no corre y el UPDATE sí, que es el comportamiento de antes. No
    // debería pasar —db.js rellena esa columna en cada arranque— pero esta
    // ruta no es lugar para averiguarlo.
    await db.prepare(`
      WITH entregado AS (
        UPDATE teams SET owner_user_id = ? WHERE id = ?
        RETURNING organization_id
      )
      INSERT INTO organization_members (organization_id, user_id, role, status)
      SELECT organization_id, ?, 'owner', 'active'
        FROM entregado
       WHERE organization_id IS NOT NULL
      ON CONFLICT (organization_id, user_id)
      DO UPDATE SET role = 'owner', status = 'active'
    `).run(req.user.id, invite.team_id, req.user.id);
  } else if (invite.type === 'org_admin') {
    // A diferencia de 'team', aquí NO se reemplaza a nadie — se agrega a
    // quien reclama con el rol que la invitación diga (antes del paso 4
    // siempre era 'admin'; ahora lo eligió quien generó el link).
    //
    // El conflicto es real: la persona pudo ya ser miembro por otro lado. Se
    // resuelve poniendo el rol de la invitación, porque invitar es un acto
    // explícito y silenciarlo dejaría al coach de siempre creyendo que ya es
    // tesorero. La excepción es no degradar a un dueño: para eso está el
    // WHERE, y es la misma regla que impide quitar al último dueño en
    // DELETE /organizations/:id/members/:userId.
    await db.prepare(`
      INSERT INTO organization_members (organization_id, user_id, role, status)
      VALUES (?, ?, ?, 'active')
      ON CONFLICT (organization_id, user_id)
      DO UPDATE SET role = EXCLUDED.role, status = 'active'
      WHERE organization_members.role <> 'owner'
    `).run(invite.organization_id, req.user.id, role);
  }

  await db.prepare(`UPDATE invites SET used_by = ?, used_at = CURRENT_TIMESTAMP WHERE id = ?`).run(req.user.id, invite.id);

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

  let organization = null;
  if (invite.type === 'org_admin' && invite.organization_id) {
    organization = await db.prepare('SELECT * FROM organizations WHERE id = ?').get(invite.organization_id);

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
