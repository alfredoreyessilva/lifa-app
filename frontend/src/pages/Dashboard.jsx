import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Modal from '../components/Modal.jsx';
import CategoryForm from '../components/CategoryForm.jsx';
import MatchForm from '../components/MatchForm.jsx';
import LogoField from '../components/LogoField.jsx';
import TeamForm from '../components/TeamForm.jsx';
import VenueForm from '../components/VenueForm.jsx';
import ExcelImport from '../components/ExcelImport.jsx';
import CharField from '../components/CharField.jsx';
import TimezoneSelect from '../components/TimezoneSelect.jsx';
import { getTimezoneLabel } from '../utils/timezones.js';

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const DEFAULT_TZ = 'America/Mexico_City';

export default function Dashboard() {
  const { token, leagues, refreshLeagues } = useAuth();
  const [selectedLeagueId, setSelectedLeagueId] = useState(null);
  const [leagueData, setLeagueData] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);

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

  const currentTeams    = leagueData?.teams  || [];
  const currentVenues   = leagueData?.venues || [];
  const leagueTimezone  = leagueData?.league?.timezone || DEFAULT_TZ;

  return (
    <div className="container">
      <div className="dash-header">
        <div>
          <span className="eyebrow">Panel de representante</span>
          <h1>Administrar calendario</h1>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {leagues.length > 1 && (
            <select
              value={selectedLeagueId || ''}
              onChange={(e) => setSelectedLeagueId(Number(e.target.value))}
              style={{ background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '10px 12px', borderRadius: 4 }}
            >
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
          onImportMatches={(cat) => setModal({ type: 'import-matches', category: cat })}
          onAddTeam={() => setModal({ type: 'add-team' })}
          onEditTeam={(team) => setModal({ type: 'edit-team', team })}
          onDeleteTeam={(team) => setModal({ type: 'delete-team', team })}
          onAddVenue={() => setModal({ type: 'add-venue' })}
          onEditVenue={(venue) => setModal({ type: 'edit-venue', venue })}
          onDeleteVenue={(venue) => setModal({ type: 'delete-venue', venue })}
        />
      )}

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
          <CategoryForm submitLabel="Crear categoría" onCancel={() => setModal(null)}
            onSubmit={async (payload) => { await api.createCategory(leagueData.league.id, payload, token); refresh(); setModal(null); }} />
        </Modal>
      )}

      {modal?.type === 'edit-category' && (
        <Modal title="Editar categoría" onClose={() => setModal(null)}>
          <CategoryForm initial={modal.category} submitLabel="Guardar cambios" onCancel={() => setModal(null)}
            onSubmit={async (payload) => { await api.updateCategory(modal.category.id, payload, token); refresh(); setModal(null); }} />
        </Modal>
      )}

      {modal?.type === 'delete-category' && (
        <Modal title="Eliminar categoría" onClose={() => setModal(null)}>
          <p>¿Seguro que quieres eliminar <strong>{modal.category.name}</strong> y todos sus partidos?</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={async () => { await api.deleteCategory(modal.category.id, token); refresh(); setModal(null); }}>Eliminar</button>
          </div>
        </Modal>
      )}

      {modal?.type === 'add-match' && (
        <Modal title={`Nuevo partido — ${modal.category.name}`} onClose={() => setModal(null)}>
          <MatchForm submitLabel="Crear partido" teams={currentTeams} venues={currentVenues} leagueTimezone={leagueTimezone}
            token={token} leagueId={leagueData.league.id} onVenueCreated={refresh} onTeamCreated={refresh} onCancel={() => setModal(null)}
            onSubmit={async (payload) => { await api.createMatch(modal.category.id, payload, token); refresh(); setModal(null); }} />
        </Modal>
      )}

      {modal?.type === 'edit-match' && (
        <Modal title={`Editar partido — ${modal.category.name}`} onClose={() => setModal(null)}>
          <MatchForm initial={modal.match} submitLabel="Guardar cambios" teams={currentTeams} venues={currentVenues} leagueTimezone={leagueTimezone}
            token={token} leagueId={leagueData.league.id} onVenueCreated={refresh} onTeamCreated={refresh} onCancel={() => setModal(null)}
            onSubmit={async (payload) => { await api.updateMatch(modal.match.id, payload, token); refresh(); setModal(null); }} />
        </Modal>
      )}

      {modal?.type === 'delete-match' && (
        <Modal title="Eliminar partido" onClose={() => setModal(null)}>
          <p>¿Seguro que quieres eliminar <strong>{modal.match.home_team} vs {modal.match.away_team}</strong>?</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={async () => { await api.deleteMatch(modal.match.id, token); refresh(); setModal(null); }}>Eliminar</button>
          </div>
        </Modal>
      )}

      {modal?.type === 'import-matches' && (
        <Modal title={`Subir calendario — ${modal.category.name}`} onClose={() => setModal(null)}>
          <ExcelImport categoryId={modal.category.id} categoryName={modal.category.name}
            onCancel={() => setModal(null)} onDone={() => { refresh(); setModal(null); }} />
        </Modal>
      )}

      {modal?.type === 'add-team' && (
        <Modal title="Nuevo equipo" onClose={() => setModal(null)}>
          <TeamForm submitLabel="Crear equipo" onCancel={() => setModal(null)}
            onSubmit={async (payload) => { await api.createTeam(leagueData.league.id, payload, token); refresh(); setModal(null); }} />
        </Modal>
      )}

      {modal?.type === 'edit-team' && (
        <Modal title="Editar equipo" onClose={() => setModal(null)}>
          <TeamForm initial={modal.team} submitLabel="Guardar cambios" onCancel={() => setModal(null)}
            onSubmit={async (payload) => { await api.updateTeam(modal.team.id, payload, token); refresh(); setModal(null); }} />
        </Modal>
      )}

      {modal?.type === 'delete-team' && (
        <Modal title="Eliminar equipo" onClose={() => setModal(null)}>
          <p>¿Seguro que quieres eliminar <strong>{modal.team.name}</strong>?</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={async () => { await api.deleteTeam(modal.team.id, token); refresh(); setModal(null); }}>Eliminar</button>
          </div>
        </Modal>
      )}

      {modal?.type === 'add-venue' && (
        <Modal title="Nueva sede" onClose={() => setModal(null)}>
          <VenueForm submitLabel="Crear sede" onCancel={() => setModal(null)}
            onSubmit={async (payload) => { await api.createVenue(leagueData.league.id, payload, token); refresh(); setModal(null); }} />
        </Modal>
      )}

      {modal?.type === 'edit-venue' && (
        <Modal title="Editar sede" onClose={() => setModal(null)}>
          <VenueForm initial={modal.venue} submitLabel="Guardar cambios" onCancel={() => setModal(null)}
            onSubmit={async (payload) => { await api.updateVenue(modal.venue.id, payload, token); refresh(); setModal(null); }} />
        </Modal>
      )}

      {modal?.type === 'delete-venue' && (
        <Modal title="Eliminar sede" onClose={() => setModal(null)}>
          <p>¿Seguro que quieres eliminar <strong>{modal.venue.name}</strong>?</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={async () => { await api.deleteVenue(modal.venue.id, token); refresh(); setModal(null); }}>Eliminar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function LeaguePanel({
  data, onEditLeague, onAddCategory, onEditCategory, onDeleteCategory,
  onAddMatch, onEditMatch, onDeleteMatch, onImportMatches,
  onAddTeam, onEditTeam, onDeleteTeam,
  onAddVenue, onEditVenue, onDeleteVenue,
}) {
  const { league, categories, teams, venues } = data;
  const [expandedIds, setExpandedIds]       = useState(new Set());
  const [teamsExpanded, setTeamsExpanded]   = useState(false);
  const [venuesExpanded, setVenuesExpanded] = useState(false);

  function toggleCategory(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="league-panel">
      <div className="league-panel-head">
        <div>
          <h3>{league.name}</h3>
          {league.state && <span style={{ fontSize: 12, color: 'var(--ink-dim)' }}>{league.state}</span>}
          {league.timezone && (
            <span style={{ fontSize: 11, color: 'var(--ink-dim)', display: 'block', marginTop: 2 }}>
              🕐 {getTimezoneLabel(league.timezone)}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to={`/ligas/${league.slug}`} className="btn btn-outline btn-sm">Ver mi página</Link>
          <button className="btn btn-outline btn-sm" onClick={onEditLeague}>Editar liga</button>
          <button className="btn btn-outline btn-sm" onClick={onAddCategory}>+ Agregar categoría</button>
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

      <div className="category-block">
        <div className="category-block-head" onClick={() => setTeamsExpanded((prev) => !prev)} style={{ cursor: 'pointer' }}>
          <h4>
            <span style={{ display: 'inline-block', transition: 'transform 0.15s ease', transform: teamsExpanded ? 'rotate(90deg)' : 'rotate(0deg)', marginRight: 8 }}>▸</span>
            Equipos
            <span style={{ color: 'var(--ink-dim)', fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
              {teams.length === 0 ? 'sin equipos' : `${teams.length} equipo${teams.length === 1 ? '' : 's'}`}
            </span>
          </h4>
          <div onClick={(e) => e.stopPropagation()}>
            <button className="btn btn-ghost btn-sm" onClick={onAddTeam}>+ Equipo</button>
          </div>
        </div>

        {teamsExpanded && (
          teams.length === 0 ? (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Sin equipos. Agrega el primero.</p>
          ) : (
            teams.map((team) => (
              <div key={team.id} className="admin-match-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {team.logo_url && (
                    <div style={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
                      <img src={team.logo_url} alt={team.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  )}
                  <div>
                    <div className="who">{team.name}</div>
                    <div className="info">{team.location || 'Sin ubicación'} · {team.logo_url ? 'Con logo' : 'Sin logo'}</div>
                  </div>
                </div>
                <div className="row-actions">
                  <button className="btn btn-outline btn-sm" onClick={() => onEditTeam(team)}>Editar</button>
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--flag)' }} onClick={() => onDeleteTeam(team)}>Eliminar</button>
                </div>
              </div>
            ))
          )
        )}
      </div>

      <div className="category-block">
        <div className="category-block-head" onClick={() => setVenuesExpanded((prev) => !prev)} style={{ cursor: 'pointer' }}>
          <h4>
            <span style={{ display: 'inline-block', transition: 'transform 0.15s ease', transform: venuesExpanded ? 'rotate(90deg)' : 'rotate(0deg)', marginRight: 8 }}>▸</span>
            Sedes
            <span style={{ color: 'var(--ink-dim)', fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
              {venues.length === 0 ? 'sin sedes' : `${venues.length} sede${venues.length === 1 ? '' : 's'}`}
            </span>
          </h4>
          <div onClick={(e) => e.stopPropagation()}>
            <button className="btn btn-ghost btn-sm" onClick={onAddVenue}>+ Sede</button>
          </div>
        </div>

        {venuesExpanded && (
          venues.length === 0 ? (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Sin sedes. Agrega la primera.</p>
          ) : (
            venues.map((venue) => (
              <div key={venue.id} className="admin-match-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {venue.cover_url && (
                    <div style={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
                      <img src={venue.cover_url} alt={venue.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  )}
                  <div>
                    <div className="who">{venue.name}</div>
                    <div className="info">{venue.institution || 'Sin institución'}</div>
                  </div>
                </div>
                <div className="row-actions">
                  <button className="btn btn-outline btn-sm" onClick={() => onEditVenue(venue)}>Editar</button>
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--flag)' }} onClick={() => onDeleteVenue(venue)}>Eliminar</button>
                </div>
              </div>
            ))
          )
        )}
      </div>

      {categories.map((cat) => {
        const isOpen = expandedIds.has(cat.id);
        return (
          <div key={cat.id} className="category-block">
            <div className="category-block-head" onClick={() => toggleCategory(cat.id)} style={{ cursor: 'pointer' }}>
              <h4>
                <span style={{ display: 'inline-block', transition: 'transform 0.15s ease', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', marginRight: 8 }}>▸</span>
                {cat.name}
                <span style={{ color: 'var(--ink-dim)', fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
                  {cat.matches.length === 0 ? 'sin partidos' : `${cat.matches.length} partido${cat.matches.length === 1 ? '' : 's'}`}
                </span>
              </h4>
              <div style={{ display: 'flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-ghost btn-sm" onClick={() => onAddMatch(cat)}>+ Partido</button>
                <button className="btn btn-outline btn-sm" onClick={() => onImportMatches(cat)}>📥 Subir calendario</button>
                <button className="btn btn-ghost btn-sm" onClick={() => onEditCategory(cat)}>Renombrar</button>
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--flag)' }} onClick={() => onDeleteCategory(cat)}>Eliminar</button>
              </div>
            </div>

            {isOpen && (
              cat.matches.length === 0 ? (
                <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Sin partidos. Agrega el primero.</p>
              ) : (
                cat.matches.map((m) => (
                  <div key={m.id} className="admin-match-row">
                    <div>
                      <div className="who">{m.home_team} vs {m.away_team}</div>
                      <div className="info">
                        {formatDate(m.match_date, m.timezone || DEFAULT_TZ)}
                        {m.week_label ? ` · ${/^\d+$/.test(m.week_label) ? 'Jornada ' + m.week_label : m.week_label}` : ''}
                        {' · '}{m.stream_url ? 'Con transmisión' : 'Sin transmisión'}
                        {m.status === 'live' ? ' · En vivo' : m.status === 'finished' ? ' · Finalizado' : ''}
                      </div>
                    </div>
                    <div className="row-actions">
                      <button className="btn btn-outline btn-sm" onClick={() => onEditMatch(cat, m)}>Editar</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--flag)' }} onClick={() => onDeleteMatch(cat, m)}>Eliminar</button>
                    </div>
                  </div>
                ))
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

function EditLeagueForm({ league, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    name:          league.name,
    state:         league.state         || '',
    logo_url:      league.logo_url      || '',
    cover_url:     league.cover_url     || '',
    description:   league.description   || '',
    timezone:      league.timezone      || DEFAULT_TZ,
    facebook_url:  league.facebook_url  || '',
    instagram_url: league.instagram_url || '',
    twitter_url:   league.twitter_url   || '',
    youtube_url:   league.youtube_url   || '',
    tiktok_url:    league.tiktok_url    || '',
    website_url:   league.website_url   || '',
    whatsapp:      league.whatsapp      || '',
  });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  function update(key, value) { setForm((f) => ({ ...f, [key]: value })); }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try { await onSubmit(form); }
    catch (e) { setError(e.message); setLoading(false); }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}

      <div className="field">
        <label>Nombre</label>
        <CharField required max={40} uppercase value={form.name} onChange={(e) => update('name', e.target.value)} />
      </div>
      <div className="field">
        <label>Estado / Región</label>
        <CharField max={40} uppercase value={form.state} onChange={(e) => update('state', e.target.value)} />
      </div>
      <div className="field">
        <label>Descripción</label>
        <CharField as="textarea" rows={3} max={100} uppercase value={form.description} onChange={(e) => update('description', e.target.value)} />
      </div>

      <LogoField value={form.logo_url} onChange={(url) => update('logo_url', url)} />

      <div className="field">
        <label>Foto de portada (opcional)</label>
        <LogoField value={form.cover_url} onChange={(url) => update('cover_url', url)} />
      </div>

      <TimezoneSelect label="Zona horaria de la liga" value={form.timezone} onChange={(tz) => update('timezone', tz)} />

      <div style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--flag)', textTransform: 'uppercase', margin: '16px 0 12px', fontFamily: 'var(--font-eyebrow)' }}>
        Redes sociales y contacto
      </div>
      <div className="field">
        <label>WhatsApp</label>
        <input value={form.whatsapp} onChange={(e) => update('whatsapp', e.target.value)} placeholder="Ej. 5512345678 o https://wa.me/521..." />
      </div>
      <div className="field">
        <label>Facebook</label>
        <input value={form.facebook_url} onChange={(e) => update('facebook_url', e.target.value)} placeholder="https://facebook.com/..." />
      </div>
      <div className="field">
        <label>Instagram</label>
        <input value={form.instagram_url} onChange={(e) => update('instagram_url', e.target.value)} placeholder="https://instagram.com/..." />
      </div>
      <div className="field">
        <label>X / Twitter</label>
        <input value={form.twitter_url} onChange={(e) => update('twitter_url', e.target.value)} placeholder="https://x.com/..." />
      </div>
      <div className="field">
        <label>YouTube</label>
        <input value={form.youtube_url} onChange={(e) => update('youtube_url', e.target.value)} placeholder="https://youtube.com/..." />
      </div>
      <div className="field">
        <label>TikTok</label>
        <input value={form.tiktok_url} onChange={(e) => update('tiktok_url', e.target.value)} placeholder="https://tiktok.com/..." />
      </div>
      <div className="field">
        <label>Sitio web</label>
        <input value={form.website_url} onChange={(e) => update('website_url', e.target.value)} placeholder="https://..." />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-flag" disabled={loading}>{loading ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
    </form>
  );
}

function formatDate(iso, tz) {
  if (!iso) return 'Sin fecha';
  const d = new Date(iso);
  const dayStr     = d.toLocaleString('es-MX', { timeZone: tz, day: 'numeric' });
  const monthIndex = Number(d.toLocaleString('en-US', { timeZone: tz, month: 'numeric' })) - 1;
  const time       = d.toLocaleTimeString('es-MX', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  return `${dayStr} ${MESES[monthIndex]} · ${time}`;
}
