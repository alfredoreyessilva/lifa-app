import { useEffect, useState, useRef } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Modal from '../components/Modal.jsx';

export default function AdminPanel() {
  const { token } = useAuth();
  const [tab, setTab] = useState('stats');

  return (
    <div className="container">
      <div className="dash-header">
        <div>
          <span className="eyebrow">Administrador</span>
          <h1>Panel de control</h1>
        </div>
      </div>

      <div className="tab-bar" style={{ marginBottom: 24 }}>
        {[
          { key: 'stats',    label: 'Estadísticas' },
          { key: 'sponsors', label: 'Patrocinadores' },
          { key: 'leagues',  label: 'Ligas' },
          { key: 'organizations', label: 'Organizaciones' },
          { key: 'users',    label: 'Usuarios' },
        ].map((t) => (
          <button
            key={t.key}
            className={`tab-btn ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'stats'    && <StatsTab    token={token} />}
      {tab === 'sponsors' && <SponsorsTab token={token} />}
      {tab === 'leagues'  && <LeaguesTab  token={token} />}
      {tab === 'organizations' && <OrganizationsTab token={token} />}
      {tab === 'users'    && <UsersTab    token={token} />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ESTADÍSTICAS
══════════════════════════════════════════════════════════════ */
function StatsTab({ token }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.adminGetStats(token).then(setStats).catch((e) => setError(e.message));
  }, [token]);

  if (error) return <div className="form-error">{error}</div>;
  if (!stats) return <div className="loading">Cargando…</div>;

  const items = [
    { label: 'Ligas registradas', value: stats.leagues,  icon: '🏟️' },
    { label: 'Usuarios',          value: stats.users,    icon: '👤' },
    { label: 'Partidos',          value: stats.matches,  icon: '🏈' },
    { label: 'Equipos',           value: stats.teams,    icon: '⛹️' },
    { label: 'Visitas a Home',    value: stats.homeViews?.total ?? 0, icon: '👁️' },
  ];

  const last30Days = stats.homeViews?.last30Days ?? [];
  const maxDayCount = Math.max(1, ...last30Days.map((d) => d.count));

  return (
    <>
      <div className="admin-stats-grid">
        {items.map((item) => (
          <div key={item.label} className="admin-stat-card">
            <div className="admin-stat-icon">{item.icon}</div>
            <div className="admin-stat-value">{item.value}</div>
            <div className="admin-stat-label">{item.label}</div>
          </div>
        ))}
      </div>

      <h3>Visitas a Home — últimos 30 días</h3>
      {last30Days.length === 0 ? (
        <p className="admin-stat-label">Todavía no hay visitas registradas en este periodo.</p>
      ) : (
        <div className="admin-bar-chart">
          {last30Days.map((d) => (
            <div key={d.day} className="admin-bar-chart-col" title={`${d.day}: ${d.count} visitas`}>
              <div
                className="admin-bar-chart-bar"
                style={{ height: `${(d.count / maxDayCount) * 100}%` }}
              />
              <div className="admin-bar-chart-value">{d.count}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   PATROCINADORES
══════════════════════════════════════════════════════════════ */
function SponsorsTab({ token }) {
  const [sponsors, setSponsors] = useState([]);
  const [error, setError]       = useState('');
  const [modal, setModal]       = useState(null);

  async function load() {
    try {
      const data = await api.getSponsors();
      setSponsors(data);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="section-head">
        <h2>Patrocinadores <span className="count">{sponsors.length}/4</span></h2>
        {sponsors.length < 4 && (
          <button className="btn btn-flag btn-sm" onClick={() => setModal({ type: 'add' })}>
            + Agregar patrocinador
          </button>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {sponsors.length === 0 ? (
        <div className="empty-state">
          <h3>Sin patrocinadores</h3>
          <p>Agrega hasta 4 logos que aparecerán en la barra lateral del sitio.</p>
        </div>
      ) : (
        <div className="admin-sponsor-list">
          {sponsors.map((s) => (
            <div key={s.id} className="admin-sponsor-row">
              <div className="admin-sponsor-logo">
                <img src={s.logo_url} alt={s.name || 'Patrocinador'} />
              </div>
              <div className="admin-sponsor-info">
                <div className="who">{s.name || 'Sin nombre'}</div>
                <div className="info">{s.link_url || 'Sin enlace'}</div>
              </div>
              <div className="row-actions">
                <button className="btn btn-outline btn-sm" onClick={() => setModal({ type: 'edit', sponsor: s })}>
                  Editar
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--flag)' }}
                  onClick={() => setModal({ type: 'delete', sponsor: s })}
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal?.type === 'add' && (
        <Modal title="Nuevo patrocinador" onClose={() => setModal(null)}>
          <SponsorForm
            submitLabel="Agregar"
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.adminCreateSponsor(payload, token);
              load();
              setModal(null);
            }}
          />
        </Modal>
      )}

      {modal?.type === 'edit' && (
        <Modal title="Editar patrocinador" onClose={() => setModal(null)}>
          <SponsorForm
            initial={modal.sponsor}
            submitLabel="Guardar"
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.adminUpdateSponsor(modal.sponsor.id, payload, token);
              load();
              setModal(null);
            }}
          />
        </Modal>
      )}

      {modal?.type === 'delete' && (
        <Modal title="Eliminar patrocinador" onClose={() => setModal(null)}>
          <p>¿Seguro que quieres eliminar <strong>{modal.sponsor.name || 'este patrocinador'}</strong>?</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={async () => {
              await api.adminDeleteSponsor(modal.sponsor.id, token);
              load();
              setModal(null);
            }}>Eliminar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SponsorForm({ initial, onSubmit, onCancel, submitLabel }) {
  const { token } = useAuth();
  const fileRef   = useRef(null);
  const [form, setForm]       = useState({ name: initial?.name || '', logo_url: initial?.logo_url || '', link_url: initial?.link_url || '' });
  const [uploading, setUploading] = useState(false);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await api.uploadImage(file, token);
      setForm((f) => ({ ...f, logo_url: url.startsWith('http') ? url : `${import.meta.env.VITE_API_URL || ''}${url}` }));
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.logo_url) { setError('El logo es obligatorio'); return; }
    setError('');
    setLoading(true);
    try {
      await onSubmit(form);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}

      <div className="field">
        <label>Nombre del patrocinador (opcional)</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Coca-Cola" />
      </div>

      <div className="field">
        <label>Logo</label>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {form.logo_url && (
            <div className="admin-sponsor-logo">
              <img src={form.logo_url} alt="preview" />
            </div>
          )}
          <input type="file" accept="image/*" ref={fileRef} onChange={handleFile} style={{ display: 'none' }} />
          <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? 'Subiendo…' : '📷 Subir logo'}
          </button>
          {form.logo_url && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ ...form, logo_url: '' })}>Quitar</button>
          )}
        </div>
        <input
          type="text"
          placeholder="o pega URL: https://…"
          value={form.logo_url}
          onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
          style={{ marginTop: 8 }}
        />
      </div>

      <div className="field">
        <label>Enlace (opcional)</label>
        <input type="url" value={form.link_url} onChange={(e) => setForm({ ...form, link_url: e.target.value })} placeholder="https://…" />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-flag" disabled={loading}>{loading ? 'Guardando…' : submitLabel}</button>
      </div>
    </form>
  );
}

/* ══════════════════════════════════════════════════════════════
   LIGAS
══════════════════════════════════════════════════════════════ */
function LeaguesTab({ token }) {
  const [leagues, setLeagues] = useState([]);
  const [error, setError]     = useState('');
  const [modal, setModal]     = useState(null);
  const [busyId, setBusyId]   = useState(null);

  async function load() {
    try {
      const data = await api.adminGetLeagues(token);
      // Las que solicitaron publicación van primero, para atenderlas sin buscarlas
      const sorted = [...data].sort((a, b) => {
        if (a.publish_requested && !b.publish_requested) return -1;
        if (!a.publish_requested && b.publish_requested) return 1;
        return 0;
      });
      setLeagues(sorted);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  const requestedCount = leagues.filter((lg) => lg.publish_requested && !lg.is_public).length;

  async function togglePublic(lg) {
    setBusyId(lg.id);
    try {
      if (lg.is_public) {
        await api.adminUnpublishLeague(lg.id, token);
      } else {
        await api.adminPublishLeague(lg.id, token);
      }
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleVerified(lg) {
    setBusyId(lg.id);
    try {
      if (lg.is_verified) {
        await api.adminUnverifyLeague(lg.id, token);
      } else {
        await api.adminVerifyLeague(lg.id, token);
      }
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="section-head">
        <h2>
          Ligas <span className="count">{leagues.length}</span>
          {requestedCount > 0 && (
            <span className="tag" style={{ marginLeft: 8, color: 'var(--live)', borderColor: 'var(--live)' }}>
              {requestedCount} solicitud{requestedCount !== 1 ? 'es' : ''} de publicación
            </span>
          )}
        </h2>
      </div>

      {error && <div className="form-error">{error}</div>}

      {leagues.length === 0 ? (
        <div className="empty-state"><h3>Sin ligas registradas</h3></div>
      ) : (
        leagues.map((lg) => (
          <div key={lg.id} className="admin-match-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {lg.logo_url && (
                <div style={{ width: 36, height: 36, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
                  <img src={lg.logo_url} alt={lg.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}
              <div>
                <div className="who">
                  {lg.name}
                  <span className="tag" style={{ marginLeft: 8, color: lg.is_public ? 'var(--field)' : 'var(--ink-dim)', borderColor: lg.is_public ? 'var(--field)' : 'var(--line-strong)' }}>
                    {lg.is_public ? 'Pública' : 'Privada'}
                  </span>
                  {lg.is_verified && (
                    <span className="tag" style={{ marginLeft: 8, color: 'var(--field)', borderColor: 'var(--field)' }}>
                      ✓ Verificada
                    </span>
                  )}
                  {!lg.is_public && lg.publish_requested && (
                    <span className="tag" style={{ marginLeft: 8, color: 'var(--live)', borderColor: 'var(--live)' }}>
                      Solicitó publicarse
                    </span>
                  )}
                </div>
                <div className="info">
                  {lg.state && `${lg.state} · `}
                  {lg.owner_name ? `${lg.owner_name} (${lg.owner_email})` : 'Sin propietario'}
                </div>
              </div>
            </div>
            <div className="row-actions">
              <button
                className={`btn btn-sm ${lg.is_public ? 'btn-outline' : 'btn-flag'}`}
                disabled={busyId === lg.id}
                onClick={() => togglePublic(lg)}
              >
                {busyId === lg.id ? 'Un momento…' : lg.is_public ? 'Ocultar liga' : 'Publicar liga'}
              </button>
              <button
                className="btn btn-outline btn-sm"
                disabled={busyId === lg.id}
                onClick={() => toggleVerified(lg)}
              >
                {busyId === lg.id ? 'Un momento…' : lg.is_verified ? 'Quitar verificación' : 'Marcar verificada'}
              </button>
              <a href={`/ligas/${lg.slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
                Ver
              </a>
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--flag)' }}
                onClick={() => setModal({ type: 'delete-league', league: lg })}
              >
                Eliminar
              </button>
            </div>
          </div>
        ))
      )}

      {modal?.type === 'delete-league' && (
        <Modal title="Eliminar liga" onClose={() => setModal(null)}>
          <p>¿Seguro que quieres eliminar <strong>{modal.league.name}</strong> y todos sus datos? Esta acción no se puede deshacer.</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={async () => {
              await api.adminDeleteLeague(modal.league.id, token);
              load();
              setModal(null);
            }}>Eliminar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ORGANIZACIONES (medio, proveedor, tienda, clínica, marca)
══════════════════════════════════════════════════════════════ */
const ORG_TYPE_LABELS = {
  media: 'Medio de comunicación',
  store: 'Tienda / proveedor',
  clinic: 'Clínica',
  brand: 'Marca',
};

function OrganizationsTab({ token }) {
  const [orgs, setOrgs] = useState([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [modal, setModal] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setOrgs(await api.adminGetOrganizations(token));
    } catch (e) {
      setError(e.message);
    }
  }

  async function toggleVerified(org) {
    setBusyId(org.id);
    try {
      if (org.is_verified) {
        await api.adminUnverifyOrganization(org.id, token);
      } else {
        await api.adminVerifyOrganization(org.id, token);
      }
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const unverifiedCount = orgs.filter((o) => !o.is_verified).length;

  return (
    <div>
      <div className="section-head">
        <h2>
          Organizaciones <span className="count">{orgs.length}</span>
          {unverifiedCount > 0 && (
            <span className="tag" style={{ marginLeft: 8, color: 'var(--live)', borderColor: 'var(--live)' }}>
              {unverifiedCount} sin verificar
            </span>
          )}
        </h2>
      </div>

      {error && <div className="form-error">{error}</div>}

      {orgs.length === 0 ? (
        <div className="empty-state"><h3>Sin organizaciones registradas</h3></div>
      ) : (
        orgs.map((org) => (
          <div key={org.id} className="admin-match-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {org.logo_url && (
                <div style={{ width: 36, height: 36, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
                  <img src={org.logo_url} alt={org.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}
              <div>
                <div className="who">
                  {org.name}
                  <span className="tag" style={{ marginLeft: 8 }}>
                    {ORG_TYPE_LABELS[org.type] || org.type}
                  </span>
                  {org.is_verified && (
                    <span className="tag" style={{ marginLeft: 8, color: 'var(--field)', borderColor: 'var(--field)' }}>
                      ✓ Verificada
                    </span>
                  )}
                </div>
                <div className="info">{org.country_name || 'Sin país'}</div>
              </div>
            </div>
            <div className="row-actions">
              <button
                className="btn btn-outline btn-sm"
                disabled={busyId === org.id}
                onClick={() => toggleVerified(org)}
              >
                {busyId === org.id ? 'Un momento…' : org.is_verified ? 'Quitar verificación' : 'Marcar verificada'}
              </button>
              {org.type === 'store' && (
                <button
                  className={`btn btn-sm ${org.plan === 'pro' ? 'btn-outline' : 'btn-flag'}`}
                  onClick={() => setModal({ type: 'plan-org', org })}
                >
                  {org.plan === 'pro' ? '⚙️ Plan Pro' : 'Activar Pro'}
                </button>
              )}
              <a href={`/panel/organizacion/${org.id}`} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
                Ver
              </a>
            </div>
          </div>
        ))
      )}

      {modal?.type === 'plan-org' && (
        <PlanModal
          org={modal.org}
          token={token}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}

// Modal para activar/renovar el plan Pro de una tienda y guardar los datos
// de su número de WhatsApp. Mientras no haya cobro automático, esto es lo
// que el admin llena a mano después de recibir el pago por fuera de la
// plataforma (transferencia/PayPal). "Días a agregar" suma a la fecha de
// vencimiento actual (o a hoy si no tenía una) en vez de pedir una fecha
// exacta, para que renovar un mes más sea un solo clic.
function PlanModal({ org, token, onClose, onSaved }) {
  const [plan, setPlan] = useState(org.plan || 'free');
  const [daysToAdd, setDaysToAdd] = useState(30);
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState(org.whatsapp_phone_number_id || '');
  const [whatsappDisplayNumber, setWhatsappDisplayNumber] = useState(org.whatsapp_display_number || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const currentExpiry = org.plan_expires_at ? new Date(org.plan_expires_at) : null;
  const currentlyActive = org.plan === 'pro' && (!currentExpiry || currentExpiry > new Date());

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

      <p style={{ fontSize: 13, color: 'var(--ink-dim)' }}>
        Estado actual: {currentlyActive
          ? <strong style={{ color: 'var(--field)' }}>Pro activo{currentExpiry ? ` hasta ${currentExpiry.toLocaleDateString('es-MX')}` : ''}</strong>
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
        <button className="btn btn-flag" disabled={saving} onClick={handleSave}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  );
}


function UsersTab({ token }) {
  const [users, setUsers]   = useState([]);
  const [error, setError]   = useState('');
  const [modal, setModal]   = useState(null);
  const { user: me }        = useAuth();

  async function load() {
    try {
      const data = await api.adminGetUsers(token);
      setUsers(data);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="section-head">
        <h2>Usuarios <span className="count">{users.length}</span></h2>
      </div>

      {error && <div className="form-error">{error}</div>}

      {users.length === 0 ? (
        <div className="empty-state"><h3>Sin usuarios</h3></div>
      ) : (
        users.map((u) => (
          <div key={u.id} className="admin-match-row">
            <div>
              <div className="who">
                {u.name}
                {u.role === 'admin' && <span className="tag" style={{ marginLeft: 8, color: 'var(--flag)', borderColor: 'var(--flag)' }}>Admin</span>}
              </div>
              <div className="info">
                {u.email} · {u.league_count} liga{u.league_count !== 1 ? 's' : ''}
              </div>
            </div>
            {u.role !== 'admin' && u.id !== me?.id && (
              <div className="row-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--flag)' }}
                  onClick={() => setModal({ type: 'delete-user', user: u })}
                >
                  Eliminar
                </button>
              </div>
            )}
          </div>
        ))
      )}

      {modal?.type === 'delete-user' && (
        <Modal title="Eliminar usuario" onClose={() => setModal(null)}>
          <p>¿Seguro que quieres eliminar a <strong>{modal.user.name}</strong> ({modal.user.email})? Se eliminarán también sus ligas y todos sus datos.</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={async () => {
              await api.adminDeleteUser(modal.user.id, token);
              load();
              setModal(null);
            }}>Eliminar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
