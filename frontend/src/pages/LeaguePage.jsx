import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import TeamCard from '../components/TeamCard.jsx';
import TeamInfoPanel from '../components/TeamInfoPanel.jsx';
import Loading from '../components/Loading.jsx';

export default function LeaguePage() {
  const { slug } = useParams();
  const [league, setLeague]           = useState(null);
  const [teams, setTeams]             = useState(null);
  const [error, setError]             = useState('');
  const [tab, setTab]                 = useState('categorias');
  const [copied, setCopied]           = useState(false);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const navigate = useNavigate();

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleTeamClick(team) {
    setSelectedTeam((prev) => (prev?.id === team.id ? null : team));
  }

  useEffect(() => {
    setLeague(null);
    setTeams(null);
    setError('');
    setTab('categorias');
    setSelectedTeam(null);
    api.getLeague(slug).then(setLeague).catch((e) => setError(e.message));
    api.getTeams(slug).then(setTeams).catch(() => setTeams([]));
  }, [slug]);

  if (error) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No encontramos esta liga</h3>
          <p>{error}</p>
          <Link to="/" className="btn btn-outline" style={{ marginTop: 16 }}>Volver al inicio</Link>
        </div>
      </div>
    );
  }

  if (!league) return <div className="container"><Loading /></div>;

  return (
    <div className="container">
      <div className="crumb"><Link to="/">Inicio</Link> / {league.name}</div>

      <section className="hero" style={{ paddingTop: 40, paddingBottom: 24 }}>
        <div className="league-logo" style={{ width: 96, height: 96, margin: '0 auto 20px', fontSize: 30 }}>
          {league.logo_url ? <img src={league.logo_url} alt={league.name} /> : initials(league.name)}
        </div>
        <h1 style={{ fontSize: 'clamp(32px, 6vw, 56px)' }}>{league.name}</h1>
        {league.description && <p>{league.description}</p>}
        <button className="btn btn-outline btn-sm" onClick={copyLink} style={{ marginTop: 8 }}>
          {copied ? '✓ Link copiado' : 'Compartir esta liga'}
        </button>
      </section>

      <div className="tab-bar">
        <button className={`tab-btn ${tab === 'categorias' ? 'active' : ''}`} onClick={() => setTab('categorias')}>
          Categorías
        </button>
        <button className={`tab-btn ${tab === 'equipos' ? 'active' : ''}`} onClick={() => setTab('equipos')}>
          Equipos
        </button>
      </div>

      {tab === 'categorias' && (
        <>
          <div className="section-head">
            <h2>Categorías</h2>
            <span className="count">{league.categories.length}</span>
          </div>

          {league.categories.length === 0 ? (
            <div className="empty-state">
              <h3>Sin categorías todavía</h3>
              <p>Esta liga aún no ha publicado sus categorías.</p>
            </div>
          ) : (
            <div className="category-grid">
              {league.categories.map((cat) => (
                <button
                  key={cat.id}
                  className="category-card"
                  onClick={() => navigate(`/categorias/${cat.id}/calendario`)}
                >
                  <div className="category-card-name">{cat.name}</div>
                  {(cat.season || cat.year) && (
                    <div className="category-card-sub">
                      {[cat.season, cat.year].filter(Boolean).join(' ')}
                    </div>
                  )}
                  <div className="category-card-arrow">→</div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'equipos' && (
        <>
          <div className="section-head">
            <h2>Equipos</h2>
            <span className="count">{teams ? teams.length : ''}</span>
          </div>

          {!teams ? (
            <div className="loading">Cargando…</div>
          ) : teams.length === 0 ? (
            <div className="empty-state">
              <h3>Sin equipos todavía</h3>
              <p>Esta liga aún no ha publicado sus equipos.</p>
            </div>
          ) : (
            <>
              <div className="team-grid">
                {teams.map((team) => (
                  <TeamCard
                    key={team.id}
                    team={team}
                    isSelected={selectedTeam?.id === team.id}
                    onClick={() => handleTeamClick(team)}
                  />
                ))}
              </div>
              {selectedTeam && (
                <TeamInfoPanel team={selectedTeam} onClose={() => setSelectedTeam(null)} />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function initials(name) {
  return name
    .split(' ')
    .filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚÑ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}