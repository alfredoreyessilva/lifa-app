import express from 'express';
import crypto from 'crypto';
import db from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { teamLeagueOwnerRequired, organizationAdminRequired } from '../middleware/ownership.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

function generateToken() {
  return crypto.randomBytes(12).toString('hex'); // ej. "a1b2c3d4e5f6…"
}

/* ===================== GENERAR INVITACIÓN DE EQUIPO ===================== */
// Solo el representante de la liga (o un admin) puede generar esto — ver
// teamLeagueOwnerRequired. Si ya había una invitación sin usar para este
// equipo, se elimina primero para que solo quede una vigente a la vez.
router.post('/teams/:teamId', authRequired, teamLeagueOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare(`DELETE FROM invites WHERE team_id = ? AND used_at IS NULL`).run(req.team.id);

  const token = generateToken();
  await db.prepare(`
    INSERT INTO invites (token, type, team_id, created_by)
    VALUES (?, 'team', ?, ?)
  `).run(token, req.team.id, req.user.id);

  res.status(201).json({ token });
}));

/* ===================== QUITAR REPRESENTANTE DE UN EQUIPO ===================== */
router.delete('/teams/:teamId/owner', authRequired, teamLeagueOwnerRequired, asyncHandler(async (req, res) => {
  await db.prepare(`UPDATE teams SET owner_user_id = NULL WHERE id = ?`).run(req.team.id);
  // Limpiamos también cualquier invitación pendiente que hubiera quedado sin usar.
  await db.prepare(`DELETE FROM invites WHERE team_id = ? AND used_at IS NULL`).run(req.team.id);
  res.json({ ok: true });
}));

/* ===================== GENERAR INVITACIÓN DE ADMINISTRADOR ===================== */
// A diferencia de la de arriba (que REEMPLAZA al representante de un
// equipo), esta AGREGA a quien la reclame como un administrador más de la
// organización — liga o equipo, misma ruta para ambas, porque los dos ya
// tienen su organización propia (leagues.organization_id / teams.organization_id).
// Igual que con las de equipo, solo queda una invitación vigente a la vez.
router.post('/organizations/:organizationId/admins', authRequired, organizationAdminRequired, asyncHandler(async (req, res) => {
  await db.prepare(`DELETE FROM invites WHERE organization_id = ? AND type = 'org_admin' AND used_at IS NULL`).run(req.organization.id);

  const token = generateToken();
  await db.prepare(`
    INSERT INTO invites (token, type, organization_id, created_by)
    VALUES (?, 'org_admin', ?, ?)
  `).run(token, req.organization.id, req.user.id);

  res.status(201).json({ token });
}));

/* ===================== VER INFO PÚBLICA DE UNA INVITACIÓN ===================== */
// Pública (sin sesión) — para mostrarle a la persona qué va a reclamar antes
// de pedirle que inicie sesión o se registre.
router.get('/:token', asyncHandler(async (req, res) => {
  const invite = await db.prepare(`
    SELECT
      i.token, i.type, i.used_at,
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

  res.json(invite);
}));

/* ===================== RECLAMAR UNA INVITACIÓN ===================== */
// Requiere sesión iniciada (el frontend manda a la persona a iniciar sesión
// o crear una cuenta primero si hace falta).
router.post('/:token/claim', authRequired, asyncHandler(async (req, res) => {
  const invite = await db.prepare(`SELECT * FROM invites WHERE token = ?`).get(req.params.token);
  if (!invite) return res.status(404).json({ error: 'Esta invitación no existe o ya no es válida' });
  if (invite.used_at) return res.status(410).json({ error: 'Esta invitación ya fue utilizada' });

  if (invite.type === 'team') {
    await db.prepare(`UPDATE teams SET owner_user_id = ? WHERE id = ?`).run(req.user.id, invite.team_id);
  } else if (invite.type === 'org_admin') {
    // A diferencia de 'team', aquí NO se reemplaza a nadie — se agrega a
    // quien reclama como un administrador más, con el mismo acceso que los
    // demás (ver organization_members.role: 'owner'/'admin'/'editor' no se
    // distinguen todavía en isOrgMember). DO NOTHING por si la persona ya
    // era miembro de esa organización por otro lado (ej. ya era su dueña).
    await db.prepare(`
      INSERT INTO organization_members (organization_id, user_id, role)
      VALUES (?, ?, 'admin')
      ON CONFLICT (organization_id, user_id) DO NOTHING
    `).run(invite.organization_id, req.user.id);
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
        `${req.user.name} ahora administra ${organization.name}`,
        'Aceptó la invitación y ya tiene el mismo acceso que el resto de los administradores.',
        JSON.stringify({ organization_id: organization.id, user_id: req.user.id, user_name: req.user.name })
      );
    }
  }

  res.json({ ok: true, team, organization });
}));

export default router;
