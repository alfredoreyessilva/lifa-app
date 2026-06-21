import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Modal from '../components/Modal.jsx';
import CategoryForm from '../components/CategoryForm.jsx';
import MatchForm from '../components/MatchForm.jsx';
import LogoField from '../components/LogoField.jsx';
import TeamForm from '../components/TeamForm.jsx';

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

export default function Dashboard() {
  const { token, leagues, refreshLeagues } = useAuth();
  const [selectedLeagueId, setSelectedLeagueId] = useState(null);
  const [leagueData, setLeagueData] = useState(null);
  const [error, setError] = useState('');

  // Modal state
  const [modal, setModal] = useState(null); // { type, ... }

  useEffect(() => {
    if (leagues.length > 0 && !selectedLeagueId) {
      setSelectedLeagueId(leagues[0].id);
    }
  }, [leagues, selectedLeagueId]);

  useEffect(() => {
    if (!selectedLeagueId) return;
    loadLeagueData(selectedLeagueId);
  }, [selectedLeagueId]);

  async function loadLeagueData(leagueId) {
    setError('');
    try {
      const data = await api.getManageLeague(leagueId, token);
      setLeagueData(data);
    } catch (e) {
      setError(e.message);
    }
  }

  function refresh() {
    if (selectedLeagueId) loadLeagueData(selectedLeagueId);
  }

  if (leagues.length === 0) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>Aún no tienes ligas registradas</h3>
          <p>Registra tu liga para comenzar a publicar su calendario.</p>
          <div style={{ marginTop: 16 }}>
            <Link to="/registrar-liga" className="btn btn-flag">Registrar mi liga</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="dash-header">
        <div>
          <span className="eyebrow">Panel de representante</span>
          <h1>Administrar calendario</h1>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {leagues.length > 1 && (
            <select value={selectedLeagueId || ''} onChange={(e) => setSelectedLeagueId(Number(e.target.value))}
              style={{ background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '10px 12px', borderRadius: 4 }}>
              {leagues.map((lg) => <option key={lg.id} value={lg.id}>{lg.name}</option>)}
            </select>
          )}
          <Link to="/registrar-liga" className="btn btn-outline btn-sm">+ Nueva liga</Link>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {!leagueData ? (
        <div className="loading">Cargando…</div>
      ) : (
        <LeaguePanel
          data={leagueData}
          token={token}
          onChange={refresh}
          onEditLeague={() => setModal({ type: 'edit-league' })}
          onAddCategory={() => setModal({ type: 'add-category' })}
          onEditCategory={(cat) => setModal({ type: 'edit-category', category: cat })}
          onDeleteCategory={(cat) => setModal({ type: 'delete-category', category: cat })}
          onAddMatch={(cat) => setModal({ type: 'add-match', category: cat })}
          onEditMatch={(cat, match) => setModal({ type: 'edit-match', category: cat, match })}
          onDeleteMatch={(cat, match) => setModal({ type: 'delete-match', category: cat, match })}
          onAddTeam={() => setModal({ type: 'add-team' })}
          onEditTeam={(team) => setModal({ type: 'edit-team', team })}
          onDeleteTeam={(team) => setModal({ type: 'delete-team', team })}
        />
      )}

      {/* ---- Modals ---- */}

      {modal?.type === 'edit-league' && (
        <Modal title="Editar liga" onClose={() => setModal(null)}>
          <EditLeagueForm
            league={leagueData.league}
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.updateLeague(leagueData.league.id, payload, token);
              await refreshLeagues();
              refresh();
              setModal(null);
            }}
          />
        </Modal>
      )}

      {modal?.type === 'add-category' && (
        <Modal title="Nueva categoría" onClose={() => setModal(null)}>
          <CategoryForm
            submitLabel="Crear categoría"
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.createCategory(leagueData.league.id, payload, token);
              refresh();
              setModal(null);
            }}
          />
        </Modal>
      )}

      {modal?.type === 'edit-category' && (
        <Modal title="Editar categoría" onClose={() => setModal(null)}>
          <CategoryForm
            initial={modal.category}
            submitLabel="Guardar cambios"
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.updateCategory(modal.category.id, payload, token);
              refresh();
              setModal(null);
            }}
          />
        </Modal>
      )}

      {modal?.type === 'delete-category' && (
        <Modal title="Eliminar categoría" onClose={() => setModal(null)}>
          <p>¿Seguro que quieres eliminar <strong>{modal.category.name}</strong> y todos sus partidos? Esta acción no se puede deshacer.</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={async () => {
              await api.deleteCategory(modal.category.id, token);
              refresh();
              setModal(null);
            }}>Eliminar</button>
          </div>
        </Modal>
      )}

      {modal?.type === 'add-match' && (
        <Modal title={`Nuevo partido — ${modal.category.name}`} onClose={() => setModal(null)}>
          <MatchForm
            submitLabel="Crear partido"
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.createMatch(modal.category.id, payload, token);
              refresh();
              setModal(null);
            }}
          />
        </Modal>
      )}

      {modal?.type === 'edit-match' && (
        <Modal title={`Editar partido — ${modal.category.name}`} onClose={() => setModal(null)}>
          <MatchForm
            initial={modal.match}
            submitLabel="Guardar cambios"
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.updateMatch(modal.match.id, payload, token);
              refresh();
              setModal(null);
            }}
          />
        </Modal>
      )}

      {modal?.type === 'delete-match' && (
        <Modal title="Eliminar partido" onClose={() => setModal(null)}>
          <p>¿Seguro que quieres eliminar <strong>{modal.match.home_team} vs {modal.match.away_team}</strong>?</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={async () => {
              await api.deleteMatch(modal.match.id, token);
              refresh();
              setModal(null);
            }}>Eliminar</button>
          </div>
        </Modal>
      )}

      {modal?.type === 'add-team' && (
        <Modal title="Nuevo equipo" onClose={() => setModal(null)}>
          <TeamForm
            submitLabel="Crear equipo"
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.createTeam(leagueData.league.id, payload, token);
              refresh();
              setModal(null);
            }}
          />
        </Modal>
      )}

      {modal?.type === 'edit-team' && (
        <Modal title="Editar equipo" onClose={() => setModal(null)}>
          <TeamForm
            initial={modal.team}
            submitLabel="Guardar cambios"
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.updateTeam(modal.team.id, payload, token);
              refresh();
              setModal(null);
            }}
          />
        </Modal>
      )}

      {modal?.type === 'delete-team' && (
        <Modal title="Eliminar equipo" onClose={() => setModal(null)}>
          <p>¿Seguro que quieres eliminar <strong>{modal.team.name}</strong>?</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={async () => {
              await api.deleteTeam(modal.team.id, token);
              refresh();
              setModal(null);
            }}>Eliminar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function LeaguePanel({ data, onEditLeague, onAddCategory, onEditCategory, onDeleteCategory, onAddMatch, onEditMatch, onDeleteMatch, onAddTeam, onEditTeam, onDeleteTeam }) {
  const { league, categories, teams } = data;

  return (
    <div className="league-panel">
      <div className="league-panel-head">
        <div>
          <h3>{league.name}</h3>
          {league.state && <span style={{ fontSize: 12, color: 'var(--ink-dim)' }}>{league.state}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to={`/ligas/${league.slug}`} className="btn btn-outline btn-sm">Ver mi página</Link>
          <button className="btn btn-outline btn-sm" onClick={onEditLeague}>Editar liga</button>
        </div>
      </div>

      {categories.length === 0 && (
        <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Esta liga no tiene categorías. Agrega la primera para empezar a publicar el calendario.</p>
      )}
{teams.length === 0 && (
        <div className="form-error" style={{ background: 'rgba(255, 210, 63, 0.1)', borderColor: 'rgba(255, 210, 63, 0.3)', color: 'var(--flag)', marginBottom: 16 }}>
          Crea tus equipos para que sus logos aparezcan en sus partidos programados.
        </div>
      )}
      {categories.map((cat) => (
        <div key={cat.id} className="category-block">
          <div className="category-block-head">
            <h4>{cat.name}</h4>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => onAddMatch(cat)}>+ Partido</button>
              <button className="btn btn-ghost btn-sm" onClick={() => onEditCategory(cat)}>Renombrar</button>
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--live)' }} onClick={() => onDeleteCategory(cat)}>Eliminar</button>
            </div>
          </div>

          {cat.matches.length === 0 ? (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Sin partidos. Agrega el primero.</p>
          ) : (
            cat.matches.map((m) => (
              <div key={m.id} className="admin-match-row">
                <div>
                  <div className="who">{m.home_team} vs {m.away_team}</div>
                  <div className="info">
                    {formatDate(m.match_date)}
                    {m.week_label ? ` · ${m.week_label}` : ''}
                    {' · '}
                    {m.stream_url ? 'Con link de transmisión' : 'Sin link de transmisión'}
                    {m.status === 'live' ? ' · En vivo' : m.status === 'finished' ? ' · Finalizado' : ''}
                  </div>
                </div>
                <div className="row-actions">
                  <button className="btn btn-outline btn-sm" onClick={() => onEditMatch(cat, m)}>Editar</button>
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--live)' }} onClick={() => onDeleteMatch(cat, m)}>Eliminar</button>
                </div>
              </div>
            ))
          )}
        </div>
      ))}

      <div style={{ marginTop: 16 }}>
        <button className="btn btn-outline btn-sm" onClick={onAddCategory}>+ Agregar categoría</button>
      </div>

      <div className="category-block">
        <div className="category-block-head">
          <h4>Equipos</h4>
          <button className="btn btn-ghost btn-sm" onClick={onAddTeam}>+ Equipo</button>
        </div>

        {teams.length === 0 ? (
          <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Sin equipos. Agrega el primero para que aparezcan en la sección "Equipos" pública.</p>
        ) : (
          teams.map((team) => (
            <div key={team.id} className="admin-match-row">
              <div>
                <div className="who">{team.name}</div>
                <div className="info">
                  {team.location || 'Sin ubicación'}
                  {' · '}
                  {team.logo_url ? 'Con logo' : 'Sin logo'}
                </div>
              </div>
              <div className="row-actions">
                <button className="btn btn-outline btn-sm" onClick={() => onEditTeam(team)}>Editar</button>
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--live)' }} onClick={() => onDeleteTeam(team)}>Eliminar</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function EditLeagueForm({ league, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    name: league.name,
    state: league.state || '',
    logo_url: league.logo_url || '',
    description: league.description || '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
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
        <label>Nombre</label>
        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="field">
        <label>Estado / Región</label>
        <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
      </div>
      <LogoField value={form.logo_url} onChange={(url) => setForm({ ...form, logo_url: url })} />
      <div className="field">
        <label>Descripción</label>
        <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-flag" disabled={loading}>{loading ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
    </form>
  );
}

function formatDate(iso) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
  return `${d.getDate()} ${MESES[d.getMonth()]} · ${time}`;
}
