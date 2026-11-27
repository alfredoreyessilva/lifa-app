import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import Modal from '../Modal.jsx';
import { caducaEn, enlaceWhatsApp } from '../../utils/invitaciones.js';
import {
  accessMessage, addMemberNotice, formatNumber, handoverWarning, membershipsLine, organizationKind, organizationOptions,
} from '../../utils/adminPanel.js';
import { Identity, SearchBox } from './AdminKit.jsx';

/* Usuarios → "Agregar a una organización": a una cuenta que ya existe se le da un rol
   en una organización, sin link y sin que tenga que aceptar (README, "Sin link: el
   Panel Admin agrega a una cuenta que ya existe"). Pasa de dónde-y-con-qué-rol a lo
   que queda después en la misma ventana: avisarle, y los links que ya no hacen falta.

   Lo que se puede y lo que no lo decide el backend: cada organización llega con los
   roles que ahí se dan, si agregar es su entrega y el rol que la persona ya tiene. */
export default function AdminAddMemberModal({ user, token, onClose, onAdded }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [orgId, setOrgId] = useState(null);
  const [role, setRole] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    let alive = true;
    api.adminGetUserOrganizations(user.id, token)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setLoadError(e.message); });
    return () => { alive = false; };
  }, [user.id, token]);

  const organizations = data?.organizations ?? [];
  const org = organizations.find((o) => o.id === orgId) ?? null;
  const view = organizationOptions(organizations, query);
  const roleLabel = org?.roles.find((r) => r.value === role)?.label ?? '';

  function choose(option) {
    if (option.member_role) return;
    setOrgId(option.id);
    // Los roles de una liga no son los de un equipo: se vuelve a elegir. En la
    // entrega hay uno solo, y se elige solo.
    setRole(option.roles.length === 1 ? option.roles[0].value : null);
    setError('');
  }

  async function confirm() {
    setSaving(true);
    setError('');
    try {
      const added = await api.adminAddOrganizationMember(org.id, user.id, role, token);
      setDone({ org, roleLabel: added.role_label || roleLabel, handover: Boolean(added.handover) });
      onAdded?.(added);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  if (done) return <AddedStep user={user} done={done} token={token} onClose={onClose} />;

  const today = data ? membershipsLine(data.memberships) : '';

  return (
    <Modal title={`Agregar a ${user.name} a una organización`} onClose={onClose}>
      <div className="adm-add-member">
        <p className="adm-modal-note adm-add-who">
          <span className="adm-add-email">{user.email}</span>
          {data && <span>{today ? `Hoy: ${today}` : 'Hoy no está en ninguna organización.'}</span>}
        </p>

        {loadError && <div className="form-error">{loadError}</div>}

        {!data ? !loadError && <p className="adm-modal-note">Cargando organizaciones…</p> : (
          <>
            <div className="adm-add-step">
              <span className="adm-add-label" id="adm-add-org-label">Organización</span>
              <SearchBox value={query} onChange={setQuery} placeholder="Buscar liga, equipo, medio o tienda" />
              {view.rows.length === 0 ? (
                <p className="adm-pick-foot">
                  {organizations.length === 0 ? 'Todavía no hay organizaciones.' : `Ninguna coincide con «${query}».`}
                </p>
              ) : (
                <div className="adm-pick-list" role="radiogroup" aria-labelledby="adm-add-org-label">
                  {view.rows.map((option) => {
                    const taken = Boolean(option.member_role);
                    const selected = option.id === orgId;
                    return (
                      <label
                        key={option.id}
                        className={`adm-pick${selected ? ' is-selected' : ''}${taken ? ' is-disabled' : ''}`}
                        title={taken ? `Su rol se cambia desde el panel de ${option.name}` : undefined}
                      >
                        <input
                          type="radio"
                          name="adm-add-org"
                          value={option.id}
                          checked={selected}
                          disabled={taken}
                          onChange={() => choose(option)}
                        />
                        <Identity name={option.name} sub={organizationKind(option)} logo={option.logo_url} />
                        {taken && <span className="adm-pick-state">Ya es {option.member_role_label}</span>}
                      </label>
                    );
                  })}
                </div>
              )}
              {view.total > view.rows.length && (
                <p className="adm-pick-foot">
                  {formatNumber(view.rows.length)} de {formatNumber(view.total)}. Escribe para encontrar la que buscas.
                </p>
              )}
            </div>

            {org && (
              <div className="adm-add-step">
                <span className="adm-add-label" id="adm-add-role-label">Rol en {org.name}</span>
                <div className="adm-roles" role="radiogroup" aria-labelledby="adm-add-role-label">
                  {org.roles.map((r) => (
                    <label key={r.value} className={`adm-role${role === r.value ? ' is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="adm-add-role"
                        value={r.value}
                        checked={role === r.value}
                        onChange={() => { setRole(r.value); setError(''); }}
                      />
                      <span>{r.label}</span>
                    </label>
                  ))}
                </div>
                {org.handover && <p className="adm-add-handover">{handoverWarning(org)}</p>}
                <p className="adm-modal-note adm-add-notice">
                  Entra en cuanto confirmes, sin link y sin que tenga que aceptar nada. {addMemberNotice(org, user.name)}
                </p>
              </div>
            )}
          </>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button
            type="button"
            className={`btn ${org?.handover ? 'btn-danger' : 'btn-accent'}`}
            onClick={confirm}
            disabled={!org || !role || saving}
          >
            {saving ? 'Un momento…' : org?.handover ? `Entregar ${org.name}` : role ? `Agregar como ${roleLabel}` : 'Agregar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Lo que queda después: decirle a la persona —la app no le avisa nada— y los links
// sin usar de esa organización. La app no sabe a quién se mandó cada uno, así que no
// los cancela sola; si alguno era para esta persona, ya no hace falta.
function AddedStep({ user, done, token, onClose }) {
  const { org, roleLabel, handover } = done;
  const [pending, setPending] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [error, setError] = useState('');

  // En una entrega no hay links con rol que revisar: a un equipo sin entregar no se
  // le pueden generar, y su link de entrega ya no sirve.
  useEffect(() => {
    if (handover) return;
    let alive = true;
    api.getOrganizationInvites(org.id, token)
      .then((d) => { if (alive) setPending(d.invites ?? []); })
      .catch(() => { if (alive) setPending([]); });
    return () => { alive = false; };
  }, [org.id, handover, token]);

  async function cancel(invite) {
    setCancelling(invite.id);
    setError('');
    try {
      await api.cancelOrganizationInvite(org.id, invite.id, token);
      setPending((list) => list.filter((i) => i.id !== invite.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setCancelling(null);
    }
  }

  const whatsapp = enlaceWhatsApp(
    accessMessage({ orgName: org.name, roleLabel, email: user.email }),
    `${window.location.origin}/panel`,
  );

  return (
    <Modal title="Listo" onClose={onClose}>
      <div className="adm-add-member">
        <p className="adm-add-done">
          <strong>{user.name}</strong> ya es <strong>{roleLabel}</strong> de <strong>{org.name}</strong>.
          {handover && ' El equipo ya se administra solo.'}
        </p>
        <p className="adm-modal-note">
          La app no le avisa: lo va a ver en Mi panel la próxima vez que entre, o al recargar si ya la tenía abierta.
        </p>
        <a className="btn btn-ws btn-sm" href={whatsapp} target="_blank" rel="noopener noreferrer">
          Avisarle por WhatsApp
        </a>

        {pending?.length > 0 && (
          <div className="adm-add-step adm-add-pending">
            <span className="adm-add-label">
              {org.name} tiene {pending.length === 1 ? '1 link sin usar' : `${pending.length} links sin usar`}
            </span>
            <p className="adm-modal-note">
              La app no sabe a quién se mandó cada uno. Si alguno era para {user.name}, ya no hace falta.
            </p>
            <ul className="adm-pending-list">
              {pending.map((invite) => (
                <li key={invite.id}>
                  <span className="adm-who-text">
                    <span className="adm-who-name">
                      {invite.note || 'Sin nota'} · {invite.role_label || invite.role}
                    </span>
                    <span className="adm-who-sub">
                      {invite.created_by_name ? `Lo generó ${invite.created_by_name} · ` : ''}{caducaEn(invite.seconds_left)}
                    </span>
                  </span>
                  {invite.can_cancel && (
                    <button
                      type="button"
                      className="btn btn-ws btn-sm adm-danger-text"
                      disabled={cancelling === invite.id}
                      onClick={() => cancel(invite)}
                    >
                      {cancelling === invite.id ? 'Cancelando…' : 'Cancelar link'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn btn-accent" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </Modal>
  );
}
