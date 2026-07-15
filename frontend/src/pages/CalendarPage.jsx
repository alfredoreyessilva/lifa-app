import { useEffect, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import Loading from '../components/Loading.jsx';
import { getMatchStatus } from '../utils/matchStatus.js';
import { getMatchParts, initials } from '../utils/matchDisplay.js';
import { shareLink } from '../utils/share.js';
import SubscribeButton from '../components/SubscribeButton.jsx';

function getJornadas(matches) {
  const seen = new Set();
  return matches
    .filter((m) => m.week_label)
    .reduce((acc, m) => {
      const label = /^\d+$/.test(m.week_label) ? `Jornada ${m.week_label}` : m.week_label;
      const key   = m.week_label;
      if (!seen.has(key)) { seen.add(key); acc.push({ key, label }); }
      return acc;
    }, [])
    .sort((a, b) => {
      const na = parseInt(a.key), nb = parseInt(b.key);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.label.localeCompare(b.label);
    });
}

function getEquipos(matches) {
  const seen    = new Set();
  const equipos = [];
  for (const m of matches) {
    for (const { name, logo } of [
      { name: m.home_team, logo: m.home_logo_url },
      { name: m.away_team, logo: m.away_logo_url },
    ]) {
      if (!seen.has(name)) { seen.add(name); equipos.push({ name, logo }); }
    }
  }
  return equipos.sort((a, b) => a.name.localeCompare(b.name));
}

// Solo toma en cuenta sedes reales (creadas desde el panel y asignadas a un
// partido vía venue_id) — el texto libre viejo (m.venue) ya no se usa aquí,
// así se eliminan los duplicados causados por escribir la misma sede distinto.
function getSedes(matches) {
  const seen = new Map();
  for (const m of matches) {
    if (m.venue_id && !seen.has(m.venue_id)) {
      seen.set(m.venue_id, m.venue_name);
    }
  }
  return Array.from(seen, ([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Texto del botón "Compartir" según la vista y selección actuales.
// Devuelve null cuando el botón debe estar oculto.
function getShareLabel(view, selected) {
  if (view === 'completo') return 'Compartir calendario completo';
  if (!selected) return null; // Oculto: estás viendo la lista de opciones (equipos/sedes/jornadas) sin elegir ninguna
  if (view === 'jornada') {
    const label = /^\d+$/.test(selected) ? `Jornada ${selected}` : selected;
    return `Compartir calendario de la ${label}`;
  }
  if (view === 'equipo') return `Compartir calendario de ${selected}`;
  if (view === 'sede')   return `Compartir calendario de ${selected}`;
  return null;
}

const VIEWS       = ['completo', 'jornada', 'equipo', 'sede'];
const VIEW_LABELS = { completo: 'Calendario completo', jornada: 'Jornada', equipo: 'Equipo', sede: 'Sede' };

export default function CalendarPage() {
  const { categoryId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  // La vista y la selección se inicializan desde la URL, para que un link
  // compartido abra directamente en el mismo filtro que tenía quien lo compartió.
  const initialView = VIEWS.includes(searchParams.get('view')) ? searchParams.get('view') : 'completo';
  const initialSel  = searchParams.get('sel') || null;

  const [data, setData]         = useState(null);
  const [error, setError]       = useState('');
  const [copied, setCopied]     = useState(false);
  const [view, setView]         = useState(initialView);
  const [selected, setSelected] = useState(initialSel);
  const [now, setNow]           = useState(Date.now());

  useEffect(() => {
    api.getMatches(categoryId).then(setData).catch((e) => setError(e.message));
  }, [categoryId]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Mantiene la URL sincronizada con el filtro activo (vista + selección),
  // así el link que se comparte siempre refleja lo que se está viendo.
  useEffect(() => {
    const params = {};
    if (view !== 'completo') params.view = view;
    if (selected) params.sel = selected;
    setSearchParams(params, { replace: true });
  }, [view, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeView(v) { setView(v); setSelected(null); setCopied(false); }

  function selectFilter(value) { setSelected(value); setCopied(false); }

  function clearSelection() { setSelected(null); setCopied(false); }

  // Usa la misma ventanita nativa de compartir (WhatsApp, Mensajes, etc.)
  // que ya usa el botón de compartir partido, en vez de solo copiar el link.
  async function handleShareCalendar(shareLabel) {
    const result = await shareLink(
      window.location.href,
      shareLabel,
      `Mira el calendario de ${category.name} en LIFA`
    );
    if (result === 'copied') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (error) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No encontramos este calendario</h3>
          <p>{error}</p>
          <Link to="/" className="btn btn-outline" style={{ marginTop: 16 }}>Volver al inicio</Link>
        </div>
      </div>
    );
  }

  if (!data) return <div className="container"><Loading /></div>;

  const { category, matches } = data;
  const nextMatch = matches.find(m => getMatchStatus(m) === 'scheduled');

  let filteredMatches = matches;
  if (view === 'jornada' && selected) filteredMatches = matches.filter((m) => m.week_label === selected);
  else if (view === 'equipo' && selected) filteredMatches = matches.filter((m) => m.home_team === selected || m.away_team === selected);
  else if (view === 'sede'   && selected) filteredMatches = matches.filter((m) => String(m.venue_id) === selected);

  const jornadas = getJornadas(matches);
  const equipos  = getEquipos(matches);
  const sedes    = getSedes(matches);

  // Para "sede" lo seleccionado en la URL es el id de la sede; buscamos su
  // nombre real para mostrarlo en los títulos y en el botón de compartir.
  const selectedSedeName = view === 'sede' && selected
    ? (sedes.find((s) => String(s.id) === selected)?.name || null)
    : null;
  const shareLabel = getShareLabel(view, view === 'sede' ? selectedSedeName : selected);

  return (
    <div className="container">
      <div className="crumb"><Link to="/">Inicio</Link> / {category.name}</div>

      <div className="calendar-header">
        <h2>{category.name}</h2>
        <div className="calendar-view-bar">
          <span className="calendar-view-label">Ver por:</span>
          {VIEWS.map((v) => (
            <button key={v} className={`calendar-view-btn${view === v ? ' active' : ''}`} onClick={() => changeView(v)}>
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <span className="count">{matches.length} partidos</span>
        {shareLabel && (
          <button className="btn btn-outline btn-sm" onClick={() => handleShareCalendar(shareLabel)}>
            {copied ? '✓ Link copiado' : shareLabel}
          </button>
        )}
      </div>

      {matches.length === 0 ? (
        <div className="empty-state">
          <h3>Calendario sin publicar</h3>
          <p>Esta categoría aún no tiene partidos programados.</p>
        </div>
      ) : (
        <>
          {view === 'completo' && <MatchGrid matches={matches} nextMatch={nextMatch} now={now} />}

          {view === 'jornada' && !selected && (
            <div className="filter-grid">
              {jornadas.length === 0
                ? <div className="empty-state"><p>Ningún partido tiene jornada asignada.</p></div>
                : jornadas.map((j) => {
                    const count = matches.filter((m) => m.week_label === j.key).length;
                    return (
                      <button key={j.key} className="filter-card" onClick={() => selectFilter(j.key)}>
                        <div className="filter-card-num">{j.key.replace(/\D/g, '') || j.key}</div>
                        <div className="filter-card-label">{j.label}</div>
                        <div className="filter-card-count">{count} partido{count !== 1 ? 's' : ''}</div>
                      </button>
                    );
                  })}
            </div>
          )}
          {view === 'jornada' && selected && (
            <>
              <button className="filter-back" onClick={clearSelection}>← Todas las jornadas</button>
              <div className="filter-selected-title">{/^\d+$/.test(selected) ? `Jornada ${selected}` : selected}</div>
              <MatchGrid matches={filteredMatches} nextMatch={nextMatch} now={now} />
            </>
          )}

          {view === 'equipo' && !selected && (
            <div className="filter-grid">
              {equipos.length === 0
                ? <div className="empty-state"><p>No hay equipos en este calendario.</p></div>
                : equipos.map((eq) => {
                    const count = matches.filter((m) => m.home_team === eq.name || m.away_team === eq.name).length;
                    return (
                      <button key={eq.name} className="filter-card" onClick={() => selectFilter(eq.name)}>
                        <div className="filter-card-logo">
                          {eq.logo ? <img src={eq.logo} alt={eq.name} /> : <span>{initials(eq.name)}</span>}
                        </div>
                        <div className="filter-card-label">{eq.name}</div>
                        <div className="filter-card-count">{count} partido{count !== 1 ? 's' : ''}</div>
                      </button>
                    );
                  })}
            </div>
          )}
          {view === 'equipo' && selected && (
            <>
              <button className="filter-back" onClick={clearSelection}>← Todos los equipos</button>
              <div className="filter-selected-title">{selected}</div>
              <MatchGrid matches={filteredMatches} nextMatch={nextMatch} now={now} />
            </>
          )}

          {view === 'sede' && !selected && (
            <div className="filter-grid">
              {sedes.length === 0
                ? <div className="empty-state"><p>Ningún partido tiene una sede registrada asignada todavía.</p></div>
                : sedes.map((sede) => {
                    const count = matches.filter((m) => m.venue_id === sede.id).length;
                    return (
                      <button key={sede.id} className="filter-card" onClick={() => selectFilter(String(sede.id))}>
                        <div className="filter-card-icon">📍</div>
                        <div className="filter-card-label">{sede.name}</div>
                        <div className="filter-card-count">{count} partido{count !== 1 ? 's' : ''}</div>
                      </button>
                    );
                  })}
            </div>
          )}
          {view === 'sede' && selected && (
            <>
              <button className="filter-back" onClick={clearSelection}>← Todas las sedes</button>
              <div className="filter-selected-title">📍 {selectedSedeName}</div>
              <MatchGrid matches={filteredMatches} nextMatch={nextMatch} now={now} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function MatchGrid({ matches, nextMatch, now }) {
  if (matches.length === 0) return <div className="empty-state"><p>No hay partidos en esta selección.</p></div>;
  return (
    <div className="match-grid">
      {matches.map((m) => <MatchCard key={m.id} match={m} isNext={nextMatch?.id === m.id} now={now} />)}
    </div>
  );
}

function TeamBadge({ name, logoUrl }) {
  return (
    <div className="match-card-team">
      <div className="match-card-logo">
        {logoUrl ? <img src={logoUrl} alt={name} /> : <span>{initials(name)}</span>}
      </div>
      <div className="match-card-team-name">{name}</div>
    </div>
  );
}

function MatchCard({ match, isNext, now }) {
  const { day, month, time, tzLabel } = getMatchParts(match.match_date, match.timezone);
  const status      = getMatchStatus(match);
  const isFinished  = status === 'finished';
  const isLive      = status === 'live';
  const isScheduled = status === 'scheduled';
  const [shareState, setShareState] = useState('idle');

  // Preferimos la sede real (registrada en el panel); si el partido es viejo
  // y todavía no se le ha asignado una, mostramos el texto libre de respaldo.
  const venueLabel = match.venue_name || match.venue;

  async function handleShare() {
    const url = `${window.location.origin}/partidos/${match.id}`;
    const result = await shareLink(
      url,
      `${match.home_team} vs ${match.away_team}`,
      'Mira este partido en LIFA'
    );
    if (result === 'copied') {
      setShareState('copied');
      setTimeout(() => setShareState('idle'), 2000);
    }
  }

  return (
    <div className={`match-card-new${isNext ? ' match-card-new--next' : ''}${isLive ? ' match-card-new--live' : ''}`}>
      <div className="match-card-header">
        <div className="match-card-datetime">
          <span className="match-card-date">{day} {month}</span>
          <span className="match-card-time">{time}</span>
          <span className="match-card-tz">{tzLabel}</span>
        </div>
        <div className="match-card-status">
          {isNext && !isLive && <span className="tag" style={{ color: 'var(--flag)', borderColor: 'var(--flag)' }}>Próximo</span>}
          {isLive     && <span className="tag live">🔴 En vivo</span>}
          {isFinished && <span className="tag finished">Finalizado</span>}
        </div>
      </div>

      <div className="match-card-body">
        <TeamBadge name={match.home_team} logoUrl={match.home_logo_url} />
        <div className="match-card-score">
          {isFinished && match.home_score !== null
            ? <><span>{match.home_score}</span><span className="match-card-score-sep">—</span><span>{match.away_score}</span></>
            : isLive
              ? <span className="match-card-score-live">EN VIVO</span>
              : <span className="match-card-score-vs">VS</span>}
        </div>
        <TeamBadge name={match.away_team} logoUrl={match.away_logo_url} />
      </div>

      {(venueLabel || match.week_label) && (
        <div className="match-card-meta">
          {match.week_label && <span>{/^\d+$/.test(match.week_label) ? `Jornada ${match.week_label}` : match.week_label}</span>}
          {venueLabel && <span>{venueLabel}</span>}
        </div>
      )}

      <div className="match-card-actions">
        {match.stream_url && (
          <a href={match.stream_url} target="_blank" rel="noopener noreferrer" className="btn btn-flag btn-sm">
            {isLive ? '🔴 Ver en vivo' : 'Ver partido'}
          </a>
        )}
        {match.tickets_url && (
          <a href={match.tickets_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
            Comprar boletos
          </a>
        )}
        <button className="btn btn-outline btn-sm" type="button" onClick={handleShare}>
          {shareState === 'copied' ? '✓ Link copiado' : '🔗 Compartir'}
        </button>
      </div>

      {/* Botón de notificación solo para partidos programados */}
      {isScheduled && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <SubscribeButton matchId={match.id} label="Avisarme de este partido" />
        </div>
      )}
    </div>
  );
}