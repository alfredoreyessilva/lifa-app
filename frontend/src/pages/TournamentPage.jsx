import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import TeamCard from '../components/TeamCard.jsx';
import TeamInfoPanel from '../components/TeamInfoPanel.jsx';
import Loading from '../components/Loading.jsx';
import CalendarViewer from '../components/CalendarViewer.jsx';

// Pantalla pública de un Torneo específico. Misma idea visual que
// LeaguePage.jsx (portada, header, sección de contenido), pero solo con
// "Calendarios" (sin pestaña de Sedes, decidido a propósito) y, abajo, los
// equipos que jugaron el torneo (clicables, igual que en la Liga).
//
// La navegación a Categoría/Rama es "inteligente": si no hay nada que
// elegir en un nivel, se salta ese paso y la info queda como texto, no
// como clic. Ver comentarios junto a `mode` más abajo.
export default function TournamentPage() {
  const { tournamentId } = useParams();
  const [data, setData]   = useState(null);
  const [error, setError] = useState('');

  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [selectedBranchId,   setSelectedBranchId]   = useState(null);
  const [selectedTeam,       setSelectedTeam]       = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setData(null); setError('');
    setSelectedCategoryId(null); setSelectedBranchId(null); setSelectedTeam(null);
    api.getTournamentPublic(tournamentId).then(setData).catch((e) => setError(e.message));
  }, [tournamentId]);

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleTeamClick(team) {
    setSelectedTeam((prev) => (prev?.id === team.id ? null : team));
  }

  if (error) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No encontramos este torneo</h3>
          <p>{error}</p>
          <Link to="/" className="btn btn-outline" style={{ marginTop: 16 }}>Volver al inicio</Link>
        </div>
      </div>
    );
  }

  if (!data) return <div className="container"><Loading /></div>;

  const { tournament, matches, teams } = data;

  // --- Navegación inteligente: categorías y ramas que de verdad tienen
  // partidos publicados en este torneo (no todas las que existan en la BD).
  const categories = [];
  const seenCat = new Set();
  for (const m of matches) {
    if (!seenCat.has(m.category_id)) {
      seenCat.add(m.category_id);
      categories.push({ id: m.category_id, name: m.category_name });
    }
  }
  const branchesAll = [];
  const seenBranch = new Set();
  for (const m of matches) {
    if (m.branch_id && !seenBranch.has(m.branch_id)) {
      seenBranch.add(m.branch_id);
      branchesAll.push({ id: m.branch_id, name: m.branch_name, category_id: m.category_id });
    }
  }

  // `mode` decide qué se pinta: elegir categoría, elegir rama, o ya ir
  // directo al calendario. `infoLabel` es la categoría/rama como texto
  // informativo (se muestra siempre que se conozca, aunque se haya
  // saltado el paso de elegirla).
  let mode = 'calendar';
  let options = [];
  let matchesToShow = matches;
  let infoLabel = '';

  if (branchesAll.length <= 1) {
    // Un solo calendario en TODO el torneo: directo, sin pasos.
    const only = branchesAll[0];
    infoLabel = only ? `${categories.find((c) => c.id === only.category_id)?.name} · ${only.name}` : (categories[0]?.name || '');
  } else if (categories.length === 1) {
    // Una sola categoría: la categoría es info, se elige rama directo.
    infoLabel = categories[0].name;
    if (!selectedBranchId) {
      mode = 'pick-branch';
      options = branchesAll;
    } else {
      matchesToShow = matches.filter((m) => m.branch_id === selectedBranchId);
      const b = branchesAll.find((x) => x.id === selectedBranchId);
      infoLabel = `${categories[0].name} · ${b?.name || ''}`;
    }
  } else if (!selectedCategoryId) {
    mode = 'pick-category';
    options = categories;
  } else {
    const branchesHere = branchesAll.filter((b) => b.category_id === selectedCategoryId);
    const cat = categories.find((c) => c.id === selectedCategoryId);
    if (branchesHere.length <= 1) {
      matchesToShow = matches.filter((m) => m.category_id === selectedCategoryId);
      infoLabel = branchesHere[0] ? `${cat.name} · ${branchesHere[0].name}` : cat.name;
    } else if (!selectedBranchId) {
      mode = 'pick-branch';
      options = branchesHere;
      infoLabel = cat.name;
    } else {
      matchesToShow = matches.filter((m) => m.branch_id === selectedBranchId);
      const b = branchesHere.find((x) => x.id === selectedBranchId);
      infoLabel = `${cat.name} · ${b?.name || ''}`;
    }
  }

  function goBack() {
    if (categories.length === 1) {
      setSelectedBranchId(null);
    } else if (selectedBranchId && branchesAll.filter((b) => b.category_id === selectedCategoryId).length > 1) {
      setSelectedBranchId(null);
    } else {
      setSelectedCategoryId(null);
      setSelectedBranchId(null);
    }
  }

  return (
    <div className="container">
      <div className="crumb">
        <Link to="/">Inicio</Link>
        {tournament.league_slug && <> / <Link to={`/ligas/${tournament.league_slug}`}>{tournament.league_name}</Link></>}
        {' / '}{tournament.name}
      </div>

      <div className="league-header-panel">
        {tournament.logo_url && (
          <img src={tournament.logo_url} alt="" className="league-page-cover-img" />
        )}

        <div className="league-header-panel-body">
          <h1 style={{ fontSize: 'clamp(32px, 6vw, 56px)' }}>{tournament.name}</h1>
          <p style={{ color: 'var(--ink-dim)' }}>{tournament.year}</p>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            <button className="btn btn-outline btn-sm" onClick={copyLink}>
              {copied ? '✓ Link copiado' : 'Compartir este torneo'}
            </button>
          </div>
        </div>

        <div className="league-header-panel-body league-header-panel-body--content">
          <div className="section-head">
            <h2>Calendarios</h2>
          </div>

          {mode === 'pick-category' && (
            <div className="category-grid">
              {options.map((c) => (
                <button key={c.id} className="category-card" onClick={() => setSelectedCategoryId(c.id)}>
                  <div className="category-card-name">{c.name}</div>
                  <div className="category-card-arrow">→</div>
                </button>
              ))}
            </div>
          )}

          {mode === 'pick-branch' && (
            <>
              {categories.length > 1 && (
                <button className="filter-back" onClick={() => { setSelectedCategoryId(null); setSelectedBranchId(null); }}>
                  ← Todas las categorías
                </button>
              )}
              {infoLabel && <div className="filter-selected-title">{infoLabel}</div>}
              <div className="category-grid">
                {options.map((b) => (
                  <button key={b.id} className="category-card" onClick={() => setSelectedBranchId(b.id)}>
                    <div className="category-card-name">{b.name}</div>
                    <div className="category-card-arrow">→</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {mode === 'calendar' && (
            <>
              {branchesAll.length > 1 && (
                <button className="filter-back" onClick={goBack}>← Volver</button>
              )}
              <CalendarViewer
                matches={matchesToShow}
                title={infoLabel || tournament.name}
                shareText={tournament.name}
                emptyTitle="Calendario sin publicar"
                emptyText="Este torneo aún no tiene partidos programados."
              />
            </>
          )}
        </div>
      </div>

      {mode !== 'calendar' && (
        <>
          <div className="section-head" style={{ marginTop: 28 }}>
            <h2>Equipos</h2>
            <span className="count">{teams.length}</span>
          </div>
          {teams.length === 0 ? (
            <div className="empty-state">
              <h3>Sin equipos todavía</h3>
              <p>Todavía no hay equipos conectados a los partidos de este torneo.</p>
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
                <TeamInfoPanel
                  team={selectedTeam}
                  leagueId={tournament.league_id}
                  onClose={() => setSelectedTeam(null)}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
