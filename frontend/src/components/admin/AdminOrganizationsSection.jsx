import { useState } from 'react';
import { api } from '../../api/client.js';
import Modal from '../Modal.jsx';
import TeamInfoPanel from '../TeamInfoPanel.jsx';
import {
  ORGANIZATION_FILTERS, ORG_TYPE_LABELS, countFilters, isHandedOverTeam, matchesSearch, planStatus,
} from '../../utils/adminPanel.js';
import {
  Band, FilterScoreboard, Identity, NoResults, RowMenu, SearchBox, SectionError, SectionLoading,
  Status, TableFooter, Verified, formatDate, useSectionFilter, useTableView,
} from './AdminKit.jsx';

/* Medio, proveedor, tienda, clínica, marca, y los equipos que ya no administra una
   liga. Un equipo de liga sin entregar no sale: lo administra su liga desde su
   panel. Ver GET /admin/organizations. */
const typeLabel = (org) => (
  isHandedOverTeam(org) ? 'Equipo entregado' : ORG_TYPE_LABELS[org.type] || org.type
);

export default function AdminOrganizationsSection({ organizations, error, reload, token }) {
  const [modal, setModal] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState('');
  const [filter, setFilter] = useSectionFilter(ORGANIZATION_FILTERS, 'todas');

  const list = organizations ?? [];
  const active = ORGANIZATION_FILTERS.find((f) => f.key === filter);
  const view = useTableView((query) => list
    .filter(active.test)
    .filter((org) => matchesSearch(query, [org.name, typeLabel(org), org.country_name, org.league_name])), filter);

  const rows = view.page.rows;
  // La cola de trabajo: el filtro al que llega 'Revisar'. Ahí, verificar va a la vista,
  // a un clic; en la lista completa va en el menú, para que la tabla no sea una pared
  // de botones iguales.
  const inQueue = filter === 'sin_verificar';

  async function run(org, action) {
    setBusyId(org.id);
    setActionError('');
    try {
      await action();
      await reload();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  // Publicar y verificar son dos acciones, como en Ligas (README, "Organizaciones:
  // publicar y verificar"). Hasta el 2026-10-29 "Marcar verificada" también la
  // publicaba.
  const togglePublic = (org) => run(org, () => (
    org.is_public ? api.adminUnpublishOrganization(org.id, token) : api.adminPublishOrganization(org.id, token)
  ));
  const toggleVerified = (org) => run(org, () => (
    org.is_verified ? api.adminUnverifyOrganization(org.id, token) : api.adminVerifyOrganization(org.id, token)
  ));

  return (
    <>
      <Band title="Organizaciones">
        <FilterScoreboard
          label="Filtrar organizaciones"
          filters={countFilters(ORGANIZATION_FILTERS, list, filter)}
          active={filter}
          onChange={setFilter}
          loading={!organizations}
        />
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[error, actionError]} />

        {!organizations ? !error && <SectionLoading /> : (
          <>
            <div className="adm-toolbar">
              <SearchBox
                value={view.query}
                onChange={view.setQuery}
                placeholder="Buscar por nombre, tipo, país o liga"
              />
            </div>

            {rows.length === 0 ? (
              <NoResults onClear={filter !== 'todas' || view.query ? () => { view.setQuery(''); setFilter('todas'); } : null}>
                {list.length === 0 ? 'Todavía no hay organizaciones registradas.' : 'Ninguna organización coincide con lo que buscas.'}
              </NoResults>
            ) : (
              <div className="adm-table-box">
                <div className="table-wrap">
                  <table className="data-table adm-table">
                    <caption className="adm-sr-only">Organizaciones registradas</caption>
                    <thead>
                      <tr>
                        <th>Organización</th>
                        <th className="adm-col-owner" style={{ width: 184 }}>Tipo</th>
                        <th style={{ width: 160 }}>Estado</th>
                        <th className="adm-col-date" style={{ width: 108 }}>Alta</th>
                        <th className="col-actions" style={{ width: inQueue ? 268 : 112 }}>
                          <span className="adm-sr-only">Acciones</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((org) => (
                        <OrganizationRow
                          key={org.id}
                          org={org}
                          busy={busyId === org.id}
                          inQueue={inQueue}
                          onTogglePublic={() => togglePublic(org)}
                          onToggleVerified={() => toggleVerified(org)}
                          onPlan={() => setModal({ type: 'plan', org })}
                          onOpenTeam={() => setModal({ type: 'team', org })}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <TableFooter view={view} noun={view.page.total === 1 ? 'organización' : 'organizaciones'} />
              </div>
            )}
          </>
        )}
      </div>

      {modal?.type === 'team' && (
        <TeamInfoPanel
          team={{ ...modal.org.team, is_verified: modal.org.is_verified }}
          leagueId={modal.org.league_id}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.type === 'plan' && (
        <PlanModal
          org={modal.org}
          token={token}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); reload(); }}
        />
      )}
    </>
  );
}

// Un equipo independiente decide solo si sale en el home (show_on_platform): aquí se
// ve, pero no se toca. A uno entregado no le aplica: sale si su liga es pública.
function OrganizationVisibility({ org }) {
  if (isHandedOverTeam(org)) return <Status title="Sale si su liga es pública">Según su liga</Status>;
  if (org.type === 'team') {
    const title = 'Lo decide el equipo desde su panel';
    return org.show_on_platform
      ? <Status tone="on" title={title}>En el home</Status>
      : <Status title={title}>Fuera del home</Status>;
  }
  return org.is_public ? <Status tone="on">Pública</Status> : <Status>Privada</Status>;
}

function planLine(org) {
  if (org.type !== 'store') return null;
  const { active, expires } = planStatus(org);
  if (!active) return 'Sin plan activo';
  return expires ? `Plan Pro hasta ${formatDate(expires)}` : 'Plan Pro';
}

function OrganizationRow({ org, busy, inQueue, onTogglePublic, onToggleVerified, onPlan, onOpenTeam }) {
  const place = [org.country_name || 'Sin país', isHandedOverTeam(org) ? org.league_name : null]
    .filter(Boolean).join(', ');
  const plan = planLine(org);

  return (
    <tr className={busy ? 'is-busy' : undefined}>
      <td><Identity name={org.name} sub={place} logo={org.logo_url} /></td>
      <td className="adm-col-owner">
        <span className="adm-who-text">
          <span className="adm-who-name is-plain">{typeLabel(org)}</span>
          {plan && <span className="adm-who-sub">{plan}</span>}
        </span>
      </td>
      <td>
        <span className="adm-state">
          <OrganizationVisibility org={org} />
          <Verified on={org.is_verified} />
        </span>
      </td>
      <td className="adm-col-date adm-faint">{formatDate(org.created_at)}</td>
      <td className="col-actions">
        <div className="adm-row-actions">
          {inQueue && !org.is_verified && (
            <button type="button" className="btn btn-accent btn-sm" disabled={busy} onClick={onToggleVerified}>
              {busy ? 'Un momento…' : 'Marcar verificada'}
            </button>
          )}
          {/* El perfil de un equipo vive en `teams`, no en su organización:
              /panel/organizacion/:id le enseñaría lo que quedó ahí el día que nació. El
              link se queda para una organización sin equipo, que no tiene ficha que
              abrir (PD-42). */}
          {org.team ? (
            <button type="button" className="btn btn-ws btn-sm" onClick={onOpenTeam}>Ver</button>
          ) : (
            <a href={`/panel/organizacion/${org.id}`} target="_blank" rel="noopener noreferrer" className="btn btn-ws btn-sm">
              Ver
            </a>
          )}
          <RowMenu
            label={`Más acciones de ${org.name}`}
            disabled={busy}
            items={[
              org.type !== 'team' && { label: org.is_public ? 'Ocultar' : 'Publicar', onSelect: onTogglePublic },
              !inQueue && {
                label: org.is_verified ? 'Quitar verificación' : 'Marcar verificada',
                onSelect: onToggleVerified,
              },
              org.type === 'store' && { label: org.plan === 'pro' ? 'Plan Pro' : 'Activar Pro', onSelect: onPlan },
            ]}
          />
        </div>
      </td>
    </tr>
  );
}

// Modal para activar/renovar el plan Pro de una tienda y guardar los datos de su
// número de WhatsApp. Mientras no haya cobro automático, esto es lo que el admin
// llena a mano después de recibir el pago por fuera de la plataforma
// (transferencia/PayPal). "Días a agregar" suma a la fecha de vencimiento actual (o
// a hoy si no tenía una) en vez de pedir una fecha exacta, para que renovar un mes
// más sea un solo clic.
function PlanModal({ org, token, onClose, onSaved }) {
  const [plan, setPlan] = useState(org.plan || 'free');
  const [daysToAdd, setDaysToAdd] = useState(30);
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState(org.whatsapp_phone_number_id || '');
  const [whatsappDisplayNumber, setWhatsappDisplayNumber] = useState(org.whatsapp_display_number || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const { active: currentlyActive, expires: currentExpiry } = planStatus(org);

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      let plan_expires_at;
      if (plan === 'pro') {
        const base = currentExpiry && currentExpiry > new Date() ? currentExpiry : new Date();
        base.setDate(base.getDate() + Number(daysToAdd || 0));
        plan_expires_at = base.toISOString();
      } else {
        plan_expires_at = null;
      }

      await api.adminUpdateOrganizationPlan(org.id, {
        plan,
        plan_expires_at,
        whatsapp_phone_number_id: whatsappPhoneNumberId || null,
        whatsapp_display_number: whatsappDisplayNumber || null,
      }, token);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Plan de ${org.name}`} onClose={onClose}>
      {error && <div className="form-error">{error}</div>}

      <p className="adm-modal-note">
        Estado actual: {currentlyActive
          ? <strong className="is-on">Pro activo{currentExpiry ? ` hasta ${currentExpiry.toLocaleDateString('es-MX')}` : ''}</strong>
          : <strong>Sin plan activo</strong>}
      </p>

      <div className="field">
        <label>Plan</label>
        <select value={plan} onChange={(e) => setPlan(e.target.value)}>
          <option value="free">Gratis (sin bot)</option>
          <option value="pro">Pro (bot de WhatsApp con IA)</option>
        </select>
      </div>

      {plan === 'pro' && (
        <div className="field">
          <label>Días a agregar desde hoy (o desde el vencimiento actual)</label>
          <input type="number" min="1" value={daysToAdd} onChange={(e) => setDaysToAdd(e.target.value)} />
        </div>
      )}

      <div className="field">
        <label>WhatsApp Phone Number ID (de Meta for Developers)</label>
        <input value={whatsappPhoneNumberId} onChange={(e) => setWhatsappPhoneNumberId(e.target.value)} placeholder="1029384756..." />
      </div>

      <div className="field">
        <label>Número a mostrar en el perfil (ej. 52 55 1234 5678)</label>
        <input value={whatsappDisplayNumber} onChange={(e) => setWhatsappDisplayNumber(e.target.value)} placeholder="52 55 1234 5678" />
      </div>

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-accent" disabled={saving} onClick={handleSave}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  );
}
