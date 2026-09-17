import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Modal from './Modal.jsx';
import InviteAdminModal from './InviteAdminModal.jsx';

// Lista de quién administra hoy esta liga/equipo (organization_members) más
// el botón para invitar a alguien más con el mismo acceso — la versión
// "varios administradores" de InviteTeamModal (que solo permite UNO y se lo
// quita a quien lo tenía). Vive en el panel de trabajo de la liga y en el
// del equipo por igual: ambos ya tienen su propia organización
// (leagues.organization_id / teams.organization_id).
export default function OrgAdminsPanel({ organizationId, organizationName, token }) {
  const { user } = useAuth();
  const [members, setMembers] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [modal, setModal] = useState(null);

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
  // Quién es el principal hoy, y si ese soy yo. De esto dependen las dos
  // acciones nuevas: solo el principal puede ceder el puesto, y nadie puede
  // quitarlo (ni él mismo) mientras lo tenga.
  const principal = members?.find((m) => m.role === 'owner');
  const soyPrincipal = principal?.user_id === user?.id;

  return (
    <div className="category-block">
      <div className="category-block-head" onClick={() => setExpanded((prev) => !prev)} style={{ cursor: 'pointer' }}>
        <h4>
          <span style={{ display: 'inline-block', transition: 'transform 0.15s ease', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', marginRight: 8 }}>▸</span>
          Administradores
          <span style={{ color: 'var(--ink-dim)', fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
            {count === undefined ? '' : `${count} administrador${count === 1 ? '' : 'es'}`}
          </span>
        </h4>
        <div onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'invite' })}>
            + Invitar administrador
          </button>
        </div>
      </div>

      {expanded && (
        <>
          {error && <div className="form-error">{error}</div>}
          <p style={{ color: 'var(--ink-dim)', fontSize: 12, margin: '0 0 8px' }}>
            Todas las personas listadas aquí tienen el mismo acceso a este panel,
            incluida la cobranza. Al administrador principal no se le puede quitar
            el acceso: primero tiene que cederle el puesto a alguien más.
          </p>
          {members === null ? (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Cargando…</p>
          ) : members.length === 0 ? (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Sin administradores todavía.</p>
          ) : (
            members.map((m) => {
              const esPrincipal = m.role === 'owner';
              const soyYo = m.user_id === user?.id;
              const solo = members.length <= 1;
              return (
                <div key={m.id} className="admin-match-row">
                  <div>
                    <div className="who">
                      {m.name}{soyYo ? ' (tú)' : ''}
                      {esPrincipal && (
                        <span
                          style={{
                            marginLeft: 8, fontSize: 11, fontWeight: 600,
                            color: 'var(--ink-dim)', textTransform: 'none',
                          }}
                          title="Tiene el puesto principal: es quien puede cedérselo a alguien más. El acceso al panel es el mismo para todos."
                        >
                          · admin principal
                        </span>
                      )}
                    </div>
                    <div className="info">{m.email}</div>
                  </div>
                  <div className="row-actions">
                    {/* Ceder el puesto: solo lo ofrece quien lo tiene, y solo
                        sobre los demás. Es el paso previo obligado para poder
                        retirarse siendo principal. */}
                    {soyPrincipal && !esPrincipal && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setModal({ type: 'transfer', member: m })}
                      >
                        Hacer principal
                      </button>
                    )}
                    {/* Al principal no se le ofrece "Quitar" en vez de
                        ofrecerlo deshabilitado: el botón muerto no explica nada
                        y antes prometía algo que el backend no cumplía. */}
                    {!esPrincipal && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--flag)' }}
                        disabled={solo}
                        title={solo ? 'Invita a alguien más antes de quitar a este administrador' : undefined}
                        onClick={() => setModal({ type: soyYo ? 'retire' : 'remove', member: m })}
                      >
                        {soyYo ? 'Retirarme' : 'Quitar'}
                      </button>
                    )}
                    {esPrincipal && soyYo && (
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
          token={token}
          onClose={() => setModal(null)}
          onDone={() => { load(); setExpanded(true); setModal(null); }}
        />
      )}

      {modal?.type === 'remove' && (
        <Modal title="Quitar administrador" onClose={() => setModal(null)}>
          <p>
            ¿Seguro que quieres quitarle el acceso a <strong>{modal.member.name}</strong> sobre {organizationName}?
            Puedes volver a invitarla más adelante si hace falta.
          </p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={() => removeMember(modal.member)}>Quitar administrador</button>
          </div>
        </Modal>
      )}

      {modal?.type === 'retire' && (
        <Modal title="Retirarme como administrador" onClose={() => setModal(null)}>
          <p>
            Vas a dejar de administrar <strong>{organizationName}</strong>. Pierdes el acceso a
            este panel y a su cobranza — incluidos los movimientos de dinero.
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
