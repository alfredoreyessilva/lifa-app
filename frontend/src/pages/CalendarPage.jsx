import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import Loading from '../components/Loading.jsx';

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const DEFAULT_TZ = 'America/Mexico_City';

const TZ_LABELS = {
  'America/Tijuana':                'Hora Pacífico MX',
  'America/Hermosillo':             'Hora Sonora',
  'America/Mazatlan':               'Hora Pacífico MX',
  'America/Chihuahua':              'Hora Chihuahua',
  'America/Mexico_City':            'Hora Centro MX',
  'America/Merida':                 'Hora Centro MX',
  'America/Cancun':                 'Hora Cancún',
  'America/Los_Angeles':            'Hora Pacífico EE.UU.',
  'America/Denver':                 'Hora Montaña EE.UU.',
  'America/Chicago':                'Hora Centro EE.UU.',
  'America/New_York':               'Hora Este EE.UU.',
  'America/Vancouver':              'Hora Pacífico CA',
  'America/Edmonton':               'Hora Montaña CA',
  'America/Winnipeg':               'Hora Centro CA',
  'America/Toronto':                'Hora Este CA',
  'America/Halifax':                'Hora Atlántico CA',
  'America/Guatemala':              'Hora Guatemala',
  'America/Belize':                 'Hora Belice',
  'America/Tegucigalpa':            'Hora Honduras',
  'America/Managua':                'Hora Nicaragua',
  'America/Costa_Rica':             'Hora Costa Rica',
  'America/Panama':                 'Hora Panamá',
  'America/Havana':                 'Hora Cuba',
  'America/Santo_Domingo':          'Hora R. Dominicana',
  'America/Puerto_Rico':            'Hora Puerto Rico',
  'America/Bogota':                 'Hora Colombia',
  'America/Lima':                   'Hora Perú',
  'America/Caracas':                'Hora Venezuela',
  'America/Guayaquil':              'Hora Ecuador',
  'America/La_Paz':                 'Hora Bolivia',
  'America/Santiago':               'Hora Chile',
  'America/Argentina/Buenos_Aires': 'Hora Argentina',
  'America/Montevideo':             'Hora Uruguay',
  'America/Asuncion':               'Hora Paraguay',
  'America/Sao_Paulo':              'Hora Brasil',
};

function getMatchParts(isoString, tz) {
  const zone = tz || DEFAULT_TZ;
  const date = new Date(isoString);
  const dayStr = date.toLocaleString('es-MX', { timeZone: zone, day: 'numeric' });
  const monthIndex = Number(date.toLocaleString('en-US', { timeZone: zone, month: 'numeric' })) - 1;
  const time = date.toLocaleTimeString('es-MX', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
  const tzLabel = TZ_LABELS[zone] || zone;
  return { day: dayStr, month: MESES[monthIndex], time, tzLabel };
}

function initials(name) {
  return (name || '')
    .split(' ')
    .filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚÑ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

// Extrae las jornadas únicas de los partidos
function getJornadas(matches) {
  const seen = new Set();
  return matches
    .filter((m) => m.week_label)
    .reduce((acc, m) => {
      const label = /^\d+$/.test(m.week_label) ? `Jornada ${m.week_label}` : m.week_label;
      const key = m.week_label;
      if (!seen.has(key)) { seen.add(key); acc.push({ key, label }); }
      return acc;
    }, [])
    .sort((a, b) => {
      const na = parseInt(a.key), nb = parseInt(b.key);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.label.localeCompare(b.label);
    });
}

// Extrae equipos únicos
function getEquipos(matches) {
  const seen = new Set();
  const equipos = [];
  for (const m of matches) {
    for (const { name, logo } of [
      { name: m.home_team, logo: m.home_logo_url },
      { name: m.away_team, logo: m.away_logo_url },
    ]) {
      if (!seen.has(name)) {
        seen.add(name);
        equipos.push({ name, logo });
      }
    }
  }
  return equipos.sort((a, b) => a.name.localeCompare(b.name));
}

// Extrae sedes únicas
function getSedes(matches) {
  const seen = new Set();
  return matches
    .filter((m) => m.venue)
    .reduce((acc, m) => {
      if (!seen.has(m.venue)) { seen.add(m.venue); acc.push(m.venue); }
      return acc;
    }, [])
    .sort((a, b) => a.localeCompare(b));
}

const VIEWS = ['completo', 'jornada', 'equipo', 'sede'];
const VIEW_LABELS = {
  completo: 'Calendario completo',
  jornada:  'Jornada',
  equipo:   'Equipo',
  sede:     'Sede',
};

export default function CalendarPage() {
  const { categoryId } = useParams();
  const [data, setData]       = useState(null);
  const [error, setError]     = useState('');
  const [copied, setCopied]   = useState(false);
  const [view, setView]       = useState('completo');
  const [selected, setSelected] = useState(null); // jornada/equipo/sede seleccionada

  useEffect(() => {
    api.getMatches(categoryId).then(setData).catch((e) => setError(e.message));
  }, [categoryId]);

  // Al cambiar de vista, limpiar la selección
  function changeView(v) {
    setView(v);
    setSelected(null);
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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
  const now = Date.now();
  const nextMatch = matches.find(m => m.status === 'scheduled' && new Date(m.match_date).getTime() > now);

  // Partidos filtrados según la vista y selección actual
  let filteredMatches = matches;
  if (view === 'jornada' && selected) {
    filteredMatches = matches.filter((m) => m.week_label === selected);
  } else if (view === 'equipo' && selected) {
    filteredMatches = matches.filter((m) => m.home_team === selected || m.away_team === selected);
  } else if (view === 'sede' && selected) {
    filteredMatches = matches.filter((m) => m.venue === selected);
  }

  const jornadas = getJornadas(matches);
  const equipos  = getEquipos(matches);
  const sedes    = getSedes(matches);

  return (
    <div className="container">
      <div className="crumb"><Link to="/">Inicio</Link> / {category.name}</div>

      {/* Header con título y filtros */}
      <div className="calendar-header">
        <h2>{category.name}</h2>
        <div className="calendar-view-bar">
          <span className="calendar-view-label">Ver por:</span>
          {VIEWS.map((v) => (
            <button
              key={v}
              className={`calendar-view-btn${view === v ? ' active' : ''}`}
              onClick={() => changeView(v)}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
      </div>

      {/* Contador y compartir */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <span className="count">{matches.length} partidos</span>
        <button className="btn btn-outline btn-sm" onClick={copyLink}>
          {copied ? '✓ Copiado' : 'Compartir'}
        </button>
      </div>

      {matches.length === 0 ? (
        <div className="empty-state">
          <h3>Calendario sin publicar</h3>
          <p>Esta categoría aún no tiene partidos programados.</p>
        </div>
      ) : (
        <>
          {/* VISTA: Calendario completo */}
          {view === 'completo' && (
            <MatchGrid matches={matches} nextMatch={nextMatch} />
          )}

          {/* VISTA: Jornada */}
          {view === 'jornada' && !selected && (
            <div className="filter-grid">
              {jornadas.length === 0 ? (
                <div className="empty-state"><p>Ningún partido tiene jornada asignada.</p></div>
              ) : jornadas.map((j) => {
                const count = matches.filter((m) => m.week_label === j.key).length;
                return (
                  <button key={j.key} className="filter-card" onClick={() => setSelected(j.key)}>
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
              <button className="filter-back" onClick={() => setSelected(null)}>
                ← Todas las jornadas
              </button>
              <div className="filter-selected-title">
                {/^\d+$/.test(selected) ? `Jornada ${selected}` : selected}
              </div>
              <MatchGrid matches={filteredMatches} nextMatch={nextMatch} />
            </>
          )}

          {/* VISTA: Equipo */}
          {view === 'equipo' && !selected && (
            <div className="filter-grid">
              {equipos.length === 0 ? (
                <div className="empty-state"><p>No hay equipos en este calendario.</p></div>
              ) : equipos.map((eq) => {
                const count = matches.filter((m) => m.home_team === eq.name || m.away_team === eq.name).length;
                return (
                  <button key={eq.name} className="filter-card" onClick={() => setSelected(eq.name)}>
                    <div className="filter-card-logo">
                      {eq.logo
                        ? <img src={eq.logo} alt={eq.name} />
                        : <span>{initials(eq.name)}</span>}
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
              <button className="filter-back" onClick={() => setSelected(null)}>
                ← Todos los equipos
              </button>
              <div className="filter-selected-title">{selected}</div>
              <MatchGrid matches={filteredMatches} nextMatch={nextMatch} />
            </>
          )}

          {/* VISTA: Sede */}
          {view === 'sede' && !selected && (
            <div className="filter-grid">
              {sedes.length === 0 ? (
                <div className="empty-state"><p>Ningún partido tiene sede asignada.</p></div>
              ) : sedes.map((sede) => {
                const count = matches.filter((m) => m.venue === sede).length;
                return (
                  <button key={sede} className="filter-card" onClick={() => setSelected(sede)}>
                    <div className="filter-card-icon">📍</div>
                    <div className="filter-card-label">{sede}</div>
                    <div className="filter-card-count">{count} partido{count !== 1 ? 's' : ''}</div>
                  </button>
                );
              })}
            </div>
          )}

          {view === 'sede' && selected && (
            <>
              <button className="filter-back" onClick={() => setSelected(null)}>
                ← Todas las sedes
              </button>
              <div className="filter-selected-title">📍 {selected}</div>
              <MatchGrid matches={filteredMatches} nextMatch={nextMatch} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ── Grid de partidos ── */
function MatchGrid({ matches, nextMatch }) {
  if (matches.length === 0) {
    return (
      <div className="empty-state">
        <p>No hay partidos en esta selección.</p>
      </div>
    );
  }
  return (
    <div className="match-grid">
      {matches.map((m) => (
        <MatchCard key={m.id} match={m} isNext={nextMatch?.id === m.id} />
      ))}
    </div>
  );
}

/* ── Tarjeta de partido ── */
function TeamBadge({ name, logoUrl }) {
  return (
    <div className="match-card-team">
      <div className="match-card-logo">
        {logoUrl
          ? <img src={logoUrl} alt={name} />
          : <span>{initials(name)}</span>}
      </div>
      <div className="match-card-team-name">{name}</div>
    </div>
  );
}

function MatchCard({ match, isNext }) {
  const { day, month, time, tzLabel } = getMatchParts(match.match_date, match.timezone);
  const isFinished = match.status === 'finished';
  const isLive     = match.status === 'live';

  return (
    <div className={`match-card-new${isNext ? ' match-card-new--next' : ''}`}>
      <div className="match-card-header">
        <div className="match-card-datetime">
          <span className="match-card-date">{day} {month}</span>
          <span className="match-card-time">{time}</span>
          <span className="match-card-tz">{tzLabel}</span>
        </div>
        <div className="match-card-status">
          {isNext     && <span className="tag" style={{ color: 'var(--flag)', borderColor: 'var(--flag)' }}>Próximo</span>}
          {isLive     && <span className="tag live">En vivo</span>}
          {isFinished && <span className="tag finished">Finalizado</span>}
        </div>
      </div>

      <div className="match-card-body">
        <TeamBadge name={match.home_team} logoUrl={match.home_logo_url} />
        <div className="match-card-score">
          {isFinished && match.home_score !== null
            ? <><span>{match.home_score}</span><span className="match-card-score-sep">—</span><span>{match.away_score}</span></>
            : <span className="match-card-score-vs">VS</span>}
        </div>
        <TeamBadge name={match.away_team} logoUrl={match.away_logo_url} />
      </div>

      {(match.venue || match.week_label) && (
        <div className="match-card-meta">
          {match.week_label && <span>{/^\d+$/.test(match.week_label) ? `Jornada ${match.week_label}` : match.week_label}</span>}
          {match.venue && <span>{match.venue}</span>}
        </div>
      )}

      {(match.stream_url || match.tickets_url) && (
        <div className="match-card-actions">
          {match.stream_url && (
            <a href={match.stream_url} target="_blank" rel="noopener noreferrer" className="btn btn-flag btn-sm">
              Ver partido
            </a>
          )}
          {match.tickets_url && (
            <a href={match.tickets_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
              Comprar boletos
            </a>
          )}
        </div>
      )}
    </div>
  );
}