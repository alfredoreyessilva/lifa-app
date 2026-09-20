import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { puede } from '../utils/permisos.js';
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
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [modal, setModal] = useState(null);

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
        </>
      )}

      {modal?.type === 'invite' && (
        <InviteAdminModal
          organizationId={organizationId}
          organizationName={organizationName}
          organizationType={organizationType}
          token={token}
          onClose={() => setModal(null)}
          onDone={() => { load(); setExpanded(true); setModal(null); }}
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
