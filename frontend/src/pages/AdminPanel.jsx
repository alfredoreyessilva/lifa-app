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
  ];

  return (
    <div className="admin-stats-grid">
      {items.map((item) => (
        <div key={item.label} className="admin-stat-card">
          <div className="admin-stat-icon">{item.icon}</div>
          <div className="admin-stat-value">{item.value}</div>
          <div className="admin-stat-label">{item.label}</div>
        </div>
      ))}
    </div>
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

  async function load() {
    try {
      const data = await api.adminGetLeagues(token);
      setLeagues(data);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="section-head">
        <h2>Ligas <span className="count">{leagues.length}</span></h2>
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
                <div className="who">{lg.name}</div>
                <div className="info">
                  {lg.state && `${lg.state} · `}
                  {lg.owner_name ? `${lg.owner_name} (${lg.owner_email})` : 'Sin propietario'}
                </div>
              </div>
            </div>
            <div className="row-actions">
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
   USUARIOS
══════════════════════════════════════════════════════════════ */
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
