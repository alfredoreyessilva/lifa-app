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

  const count = members?.length;

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
            Todas las personas listadas aquí tienen el mismo acceso a este panel.
          </p>
          {members === null ? (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Cargando…</p>
          ) : members.length === 0 ? (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Sin administradores todavía.</p>
          ) : (
            members.map((m) => (
              <div key={m.id} className="admin-match-row">
                <div>
                  <div className="who">{m.name}{m.user_id === user?.id ? ' (tú)' : ''}</div>
                  <div className="info">{m.email}</div>
                </div>
                <div className="row-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--flag)' }}
                    disabled={members.length <= 1}
                    title={members.length <= 1 ? 'Invita a alguien más antes de quitar a este administrador' : undefined}
                    onClick={() => setModal({ type: 'remove', member: m })}
                  >
                    Quitar
                  </button>
                </div>
              </div>
            ))
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
    </div>
  );
}
