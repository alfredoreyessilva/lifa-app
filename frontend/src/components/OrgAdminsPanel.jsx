import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { puede } from '../utils/permisos.js';
import { caducaEn, linkDeInvitacion, enlaceWhatsApp, mensajeDeInvitacion } from '../utils/invitaciones.js';
import Modal from './Modal.jsx';
import InviteAdminModal from './InviteAdminModal.jsx';

// Quién tiene acceso hoy a esta liga/equipo y con QUÉ ROL, más el botón para
// invitar a alguien más. Vive igual en el panel de la liga y en el del equipo:
// los dos tienen su propia organización (leagues.organization_id /
// teams.organization_id) y cada uno su propio catálogo de roles.
//
// `entidad` es la liga o el equipo tal como los devuelve /auth/me, y se usa
// solo para saber qué puede hacer QUIEN MIRA (`my_permissions`). Esconder no
// es proteger: el backend vuelve a decidir en cada petición — ver
// `utils/permisos.js`.
export default function OrgAdminsPanel({ organizationId, organizationName, organizationType, entidad, token }) {
  const { user } = useAuth();
  const [members, setMembers] = useState(null);
  const [pendientes, setPendientes] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [modal, setModal] = useState(null);
  const [copiado, setCopiado] = useState(null);

  // Los dos permisos que gobiernan esta pantalla. `miembros` es repartir
  // acceso; `duenos` es repartir el puesto de dueño, y es lo único que un
  // administrador no puede hacer.
  const puedeInvitar = puede(entidad, 'miembros');
  const puedeTocarDuenos = puede(entidad, 'duenos');

  function load() {
    setError('');
    api.getOrganizationMembers(organizationId, token)
      .then((d) => setMembers(d.members))
      .catch((e) => setError(e.message));
    // Los links con rol que nadie ha usado. Se piden solo si quien mira puede
    // invitar: a los demás el backend les contesta 403 de todos modos. Si la
    // ruta no existe (los minutos entre el despliegue de Vercel y el de
    // Render), la sección simplemente no aparece.
    if (puedeInvitar) {
      api.getOrganizationInvites(organizationId, token)
        .then((d) => setPendientes(d.invites))
        .catch(() => setPendientes([]));
    }
  }

  async function cancelarInvitacion(invite) {
    setError('');
    try {
      await api.cancelOrganizationInvite(organizationId, invite.id, token);
      load();
      setModal(null);
    } catch (e) {
      setError(e.message);
      setModal(null);
    }
  }

  async function copiarInvitacion(invite) {
    try {
      await navigator.clipboard.writeText(linkDeInvitacion(invite.token));
      setCopiado(invite.id);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      // Si el navegador no deja copiar, queda el botón de WhatsApp.
    }
  }

  useEffect(() => {
    if (expanded && members === null) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, organizationId]);

  async function removeMember(member) {
    setError('');
    try {
      await api.removeOrganizationMember(organizationId, member.user_id, token);
      load();
      setModal(null);
    } catch (e) {
      setError(e.message);
    }
  }

  async function transferOwner(member) {
    setError('');
    try {
      await api.transferOrganizationOwner(organizationId, member.user_id, token);
      load();
      setModal(null);
    } catch (e) {
      setError(e.message);
    }
  }

  const count = members?.length;
  const soyDueno = members?.some((m) => m.user_id === user?.id && m.role === 'owner');

  return (
    <div className="category-block">
      <div className="category-block-head" onClick={() => setExpanded((prev) => !prev)} style={{ cursor: 'pointer' }}>
        <h4>
          <span style={{ display: 'inline-block', transition: 'transform 0.15s ease', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', marginRight: 8 }}>▸</span>
          Quién tiene acceso
          <span style={{ color: 'var(--ink-dim)', fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
            {count === undefined ? '' : `${count} persona${count === 1 ? '' : 's'}`}
          </span>
        </h4>
        {/* Sin el permiso de repartir acceso, el botón no existe — no se pinta
            deshabilitado. Un botón muerto no explica nada y promete algo que
            el backend va a negar con un 403. */}
        {puedeInvitar && (
          <div onClick={(e) => e.stopPropagation()}>
            <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'invite' })}>
              + Invitar
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <>
          {error && <div className="form-error">{error}</div>}
          <p style={{ color: 'var(--ink-dim)', fontSize: 12, margin: '0 0 8px' }}>
            Cada persona entra con un rol y el rol decide qué puede hacer — no todas ven lo mismo.
            {organizationType === 'team' && ' El padrón y las cuotas del club solo los ven el dueño, el administrador y el tesorero.'}
          </p>
          {members === null ? (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Cargando…</p>
          ) : members.length === 0 ? (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Nadie todavía.</p>
          ) : (
            members.map((m) => {
              const esDueno = m.role === 'owner';
              const soyYo = m.user_id === user?.id;
              const solo = members.length <= 1;
              return (
                <div key={m.id} className="admin-match-row">
                  <div>
                    <div className="who">
                      {m.name}{soyYo ? ' (tú)' : ''}
                      {/* La etiqueta del rol viene resuelta del backend: cambia
                          según el tipo de organización, y `editor` nunca se lee
                          "editor" a secas sino "Editor de partidos (Visor)". */}
                      <span
                        style={{
                          marginLeft: 8, fontSize: 11, fontWeight: 600,
                          color: 'var(--ink-dim)', textTransform: 'none',
                        }}
                      >
                        · {m.role_label || m.role}
                      </span>
                    </div>
                    <div className="info">{m.email}</div>
                  </div>
                  <div className="row-actions">
                    {/* Cambiar el rol: a cualquiera que no sea dueño, con el
                        permiso de repartir acceso. No se ofrece sobre uno
                        mismo: bajarse el rol por un clic deja a esa persona
                        sin poder volver a subirlo. Antes esto se hacía
                        mandándole otra invitación; ya no se puede, porque un
                        link es solo para quien todavía no está. */}
                    {puedeInvitar && !esDueno && !soyYo && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setModal({ type: 'role', member: m })}
                      >
                        Cambiar rol
                      </button>
                    )}
                    {/* Ceder el puesto principal: solo lo ofrece quien es dueño,
                        y solo sobre quien todavía no lo es. Es el paso previo
                        obligado para poder retirarse siendo dueño. */}
                    {puedeTocarDuenos && soyDueno && !esDueno && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setModal({ type: 'transfer', member: m })}
                      >
                        Hacer principal
                      </button>
                    )}
                    {!esDueno && (puedeInvitar || soyYo) && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--flag)' }}
                        disabled={solo}
                        title={solo ? 'Invita a alguien más antes de quitar este acceso' : undefined}
                        onClick={() => setModal({ type: soyYo ? 'retire' : 'remove', member: m })}
                      >
                        {soyYo ? 'Retirarme' : 'Quitar'}
                      </button>
                    )}
                    {esDueno && soyYo && (
                      <span style={{ color: 'var(--ink-dim)', fontSize: 12 }}>
                        {solo
                          ? 'Invita a alguien y cédele el puesto para poder retirarte'
                          : 'Cede el puesto para poder retirarte'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* Los links con rol que nadie ha usado todavía. Puede haber muchos
              del mismo rol a la vez (uno por persona), así que cada uno se ve
              por su nota de "para quién". El de dueño le llega sin link a
              quien no puede invitar dueños: copiarlo y usarlo sería
              ascenderse solo. */}
          {puedeInvitar && pendientes?.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-dim)', margin: '0 0 6px' }}>
                Invitaciones pendientes · {pendientes.length}
              </div>
              {pendientes.map((inv) => (
                <div key={`inv${inv.id}`} className="admin-match-row">
                  <div>
                    <div className="who">
                      {inv.note || <span style={{ color: 'var(--ink-dim)', fontWeight: 400 }}>Sin nota</span>}
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--ink-dim)' }}>
                        · {inv.role_label || inv.role}
                      </span>
                    </div>
                    <div className="info">
                      {inv.created_by_name ? `Lo generó ${inv.created_by_name} · ` : ''}{caducaEn(inv.seconds_left)}
                    </div>
                  </div>
                  <div className="row-actions">
                    {inv.token ? (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={() => copiarInvitacion(inv)}>
                          {copiado === inv.id ? '✓ Copiado' : 'Copiar'}
                        </button>
                        <a
                          className="btn btn-ghost btn-sm"
                          href={enlaceWhatsApp(
                            mensajeDeInvitacion(organizationName, inv.role_label || inv.role),
                            linkDeInvitacion(inv.token),
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          WhatsApp
                        </a>
                      </>
                    ) : (
                      <span style={{ color: 'var(--ink-dim)', fontSize: 12 }}>Solo un dueño ve este link</span>
                    )}
                    {inv.can_cancel && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--flag)' }}
                        onClick={() => setModal({ type: 'cancel-invite', invite: inv })}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Se recarga también al cerrar con la X: pudo haber generado varios
          links antes de cerrar, y la lista de pendientes tiene que traerlos. */}
      {modal?.type === 'invite' && (
        <InviteAdminModal
          organizationId={organizationId}
          organizationName={organizationName}
          organizationType={organizationType}
          token={token}
          onClose={() => { load(); setExpanded(true); setModal(null); }}
          onDone={() => { load(); setExpanded(true); setModal(null); }}
        />
      )}

      {modal?.type === 'cancel-invite' && (
        <Modal title="Cancelar invitación" onClose={() => setModal(null)}>
          <p>
            El link {modal.invite.note ? <>para <strong>{modal.invite.note}</strong></> : 'sin nota'} (
            {modal.invite.role_label || modal.invite.role}) va a dejar de servir. Si ya se lo mandaste a
            alguien, al abrirlo va a ver que no es válido.
          </p>
          <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
            Los demás links pendientes no cambian.
          </p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>No, dejarlo</button>
            <button className="btn btn-danger" onClick={() => cancelarInvitacion(modal.invite)}>Cancelar invitación</button>
          </div>
        </Modal>
      )}

      {modal?.type === 'role' && (
        <CambiarRolModal
          organizationId={organizationId}
          organizationName={organizationName}
          member={modal.member}
          token={token}
          onClose={() => setModal(null)}
          onDone={() => { load(); setModal(null); }}
        />
      )}

      {modal?.type === 'remove' && (
        <Modal title="Quitar acceso" onClose={() => setModal(null)}>
          <p>
            ¿Seguro que quieres quitarle el acceso a <strong>{modal.member.name}</strong> ({modal.member.role_label || modal.member.role})
            sobre {organizationName}? Puedes volver a invitarla más adelante, con el rol que quieras.
          </p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={() => removeMember(modal.member)}>Quitar acceso</button>
          </div>
        </Modal>
      )}

      {modal?.type === 'retire' && (
        <Modal title="Retirarme" onClose={() => setModal(null)}>
          <p>
            Vas a dejar de tener acceso a <strong>{organizationName}</strong>. Pierdes este panel y
            todo lo que tu rol alcanzaba.
          </p>
          <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
            Quien siga administrando puede volver a invitarte cuando haga falta.
          </p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={() => removeMember(modal.member)}>Retirarme</button>
          </div>
        </Modal>
      )}

      {modal?.type === 'transfer' && (
        <Modal title="Hacer administrador principal" onClose={() => setModal(null)}>
          <p>
            <strong>{modal.member.name}</strong> va a quedar como administrador principal de{' '}
            {organizationName}, y tú pasas a ser administrador normal.
          </p>
          <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
            No pierdes el acceso al panel con esto — lo que cambia es quién puede ceder el
            puesto. Después de cederlo sí vas a poder retirarte, si eso es lo que buscas.
          </p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={() => transferOwner(modal.member)}>
              Hacer principal
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Cambiar el rol de alguien que ya está adentro. Los roles salen del mismo
// catálogo que el selector de invitar (`getOrganizationRoles`), ya sabiendo
// cuáles puede repartir quien pregunta: un administrador ve el de dueño pero
// no lo puede elegir, igual que al invitar.
function CambiarRolModal({ organizationId, organizationName, member, token, onClose, onDone }) {
  const [roles, setRoles] = useState(null);
  const [rol, setRol] = useState(member.role);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.getOrganizationRoles(organizationId, token)
      .then((d) => setRoles(d.roles))
      .catch((e) => setError(e.message));
  }, [organizationId]);

  async function guardar() {
    setError('');
    setGuardando(true);
    try {
      await api.updateOrganizationMemberRole(organizationId, member.user_id, rol, token);
      onDone();
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <Modal title={`Cambiar el rol de ${member.name}`} onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginTop: 0 }}>
        Hoy es <strong>{member.role_label || member.role}</strong> en {organizationName}. El cambio es
        inmediato: lo que puede ver y hacer cambia en cuanto guardes.
      </p>
      {roles === null ? (
        <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Cargando roles…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {roles.map((r) => (
            <label
              key={r.value}
              style={{
                display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px',
                border: '1px solid var(--line)', borderRadius: 8,
                borderColor: rol === r.value ? 'var(--flag)' : 'var(--line)',
                opacity: r.grantable ? 1 : 0.5,
                cursor: r.grantable ? 'pointer' : 'not-allowed',
              }}
              title={r.grantable ? undefined : 'Solo un dueño puede nombrar a otro dueño'}
            >
              <input
                type="radio"
                name="rol-miembro"
                value={r.value}
                checked={rol === r.value}
                disabled={!r.grantable}
                onChange={() => setRol(r.value)}
              />
              <span style={{ fontWeight: 600 }}>{r.label}</span>
              {r.value === member.role && (
                <span style={{ fontSize: 11, color: 'var(--ink-dim)' }}>— el de hoy</span>
              )}
            </label>
          ))}
        </div>
      )}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button
          className="btn btn-primary"
          onClick={guardar}
          disabled={!roles || guardando || rol === member.role}
        >
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  );
}
