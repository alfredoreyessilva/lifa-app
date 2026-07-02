import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import TeamCard from '../components/TeamCard.jsx';
import Loading from '../components/Loading.jsx';

function initials(name) {
  return (name || '')
    .split(' ')
    .filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚÑ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/* ── Tarjeta de información de la liga ── */
function LeagueInfoPanel({ league, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const teams   = league.teams || [];
  const socials = [
    { key: 'whatsapp',      label: 'WhatsApp',   href: league.whatsapp?.startsWith('http') ? league.whatsapp : league.whatsapp ? `https://wa.me/${league.whatsapp.replace(/\D/g, '')}` : null },
    { key: 'facebook_url',  label: 'Facebook',   href: league.facebook_url },
    { key: 'instagram_url', label: 'Instagram',  href: league.instagram_url },
    { key: 'twitter_url',   label: 'X / Twitter', href: league.twitter_url },
    { key: 'youtube_url',   label: 'YouTube',    href: league.youtube_url },
    { key: 'tiktok_url',    label: 'TikTok',     href: league.tiktok_url },
    { key: 'website_url',   label: 'Sitio web',  href: league.website_url },
  ].filter((s) => s.href);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="league-info-panel" onClick={(e) => e.stopPropagation()}>

        {/* Banner / portada */}
        <div
          className="league-info-banner"
          style={league.cover_url ? {
            backgroundImage: `url(${league.cover_url})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          } : {}}
        >
          <button className="team-profile-close" onClick={onClose}>✕</button>
        </div>

        {/* Logo sobre el banner */}
        <div className="league-info-logo-wrap">
          <div className="league-logo" style={{ width: 72, height: 72, fontSize: 22, border: '3px solid var(--field)', flexShrink: 0 }}>
            {league.logo_url
              ? <img src={league.logo_url} alt={league.name} />
              : initials(league.name)}
          </div>
        </div>

        {/* Cuerpo */}
        <div className="league-info-body">
          <h3 className="league-info-name">{league.name}</h3>
          {league.state && <p style={{ fontSize: 13, color: 'var(--flag)', margin: '0 0 8px', fontFamily: 'var(--font-eyebrow)', letterSpacing: '0.08em' }}>{league.state}</p>}
          {league.description && <p style={{ fontSize: 13, color: 'var(--ink-dim)', margin: '0 0 16px', lineHeight: 1.5 }}>{league.description}</p>}

          {/* Redes sociales */}
          {socials.length > 0 && (
            <div className="league-info-section">
              <div className="league-info-section-title">Contacto y redes</div>
              <div className="team-info-links">
                {socials.map((s) => (
                  <a key={s.key} href={s.href} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
                    {s.label}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Equipos */}
          {teams.length > 0 && (
            <div className="league-info-section">
              <div className="league-info-section-title">Equipos registrados</div>
              <div className="league-info-teams">
                {teams.map((team) => (
                  <div key={team.id} className="league-info-team">
                    <div className="league-logo" style={{ width: 44, height: 44, fontSize: 13, flexShrink: 0 }}>
                      {team.logo_url
                        ? <img src={team.logo_url} alt={team.name} />
                        : initials(team.name)}
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--ink-dim)', textAlign: 'center', lineHeight: 1.3, maxWidth: 60 }}>{team.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {socials.length === 0 && teams.length === 0 && (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13, textAlign: 'center' }}>Esta liga aún no ha agregado información de contacto.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Página principal de la liga ── */
export default function LeaguePage() {
  const { slug } = useParams();
  const [league, setLeague]           = useState(null);
  const [teams,  setTeams]            = useState(null);
  const [error,  setError]            = useState('');
  const [tab,    setTab]              = useState('categorias');
  const [copied, setCopied]           = useState(false);
  const [showLeagueInfo, setShowLeagueInfo] = useState(false);
  const [selectedTeam, setSelectedTeam]     = useState(null);
  const navigate = useNavigate();

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  useEffect(() => {
    setLeague(null); setTeams(null); setError('');
    setTab('categorias'); setSelectedTeam(null); setShowLeagueInfo(false);
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

  // Liga con equipos incluidos para la tarjeta
  const leagueWithTeams = { ...league, teams: teams || [] };

  return (
    <div className="container">
      <div className="crumb"><Link to="/">Inicio</Link> / {league.name}</div>

      <section className="hero" style={{ paddingTop: 40, paddingBottom: 24 }}>
        {/* Logo clickeable */}
        <button
          className="league-logo-btn"
          onClick={() => setShowLeagueInfo(true)}
          title="Ver información de la liga"
          style={{ width: 96, height: 96, margin: '0 auto 20px', fontSize: 30 }}
        >
          <div className="league-logo" style={{ width: '100%', height: '100%', fontSize: 30 }}>
            {league.logo_url ? <img src={league.logo_url} alt={league.name} /> : initials(league.name)}
          </div>
        </button>

        <h1 style={{ fontSize: 'clamp(32px, 6vw, 56px)' }}>{league.name}</h1>
        {league.description && <p>{league.description}</p>}
        <button className="btn btn-outline btn-sm" onClick={copyLink} style={{ marginTop: 8 }}>
          {copied ? '✓ Link copiado' : 'Compartir esta liga'}
        </button>
      </section>

      <div className="tab-bar">
        <button className={`tab-btn ${tab === 'categorias' ? 'active' : ''}`} onClick={() => setTab('categorias')}>Categorías</button>
        <button className={`tab-btn ${tab === 'equipos'    ? 'active' : ''}`} onClick={() => setTab('equipos')}>Equipos</button>
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
                <button key={cat.id} className="category-card" onClick={() => navigate(`/categorias/${cat.id}/calendario`)}>
                  <div className="category-card-name">{cat.name}</div>
                  {(cat.season || cat.year) && (
                    <div className="category-card-sub">{[cat.season, cat.year].filter(Boolean).join(' ')}</div>
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
            <div className="team-grid">
              {teams.map((team) => (
                <TeamCard key={team.id} team={team} isSelected={selectedTeam?.id === team.id} onClick={() => setSelectedTeam((prev) => prev?.id === team.id ? null : team)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Tarjeta de información de la liga */}
      {showLeagueInfo && (
        <LeagueInfoPanel league={leagueWithTeams} onClose={() => setShowLeagueInfo(false)} />
      )}
    </div>
  );
}