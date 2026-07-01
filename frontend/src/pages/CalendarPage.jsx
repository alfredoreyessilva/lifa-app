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

export default function CalendarPage() {
  const { categoryId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getMatches(categoryId).then(setData).catch((e) => setError(e.message));
  }, [categoryId]);

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

  return (
    <div className="container">
      <div className="crumb"><Link to="/">Inicio</Link> / {category.name}</div>

      <div className="section-head" style={{ marginTop: 24 }}>
        <h2>{category.name}</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="count">{matches.length} partidos</span>
          <button className="btn btn-outline btn-sm" onClick={copyLink}>
            {copied ? '✓ Copiado' : 'Compartir'}
          </button>
        </div>
      </div>

      {matches.length === 0 ? (
        <div className="empty-state">
          <h3>Calendario sin publicar</h3>
          <p>Esta categoría aún no tiene partidos programados.</p>
        </div>
      ) : (
        <div className="match-grid">
          {matches.map((m) => (
            <MatchCard key={m.id} match={m} isNext={nextMatch?.id === m.id} />
          ))}
        </div>
      )}
    </div>
  );
}

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

      {/* Cabecera: fecha + estado */}
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

      {/* Equipos y marcador */}
      <div className="match-card-body">
        <TeamBadge name={match.home_team} logoUrl={match.home_logo_url} />

        <div className="match-card-score">
          {isFinished && match.home_score !== null
            ? <><span>{match.home_score}</span><span className="match-card-score-sep">—</span><span>{match.away_score}</span></>
            : <span className="match-card-score-vs">VS</span>
          }
        </div>

        <TeamBadge name={match.away_team} logoUrl={match.away_logo_url} />
      </div>

      {/* Info secundaria */}
      {(match.venue || match.week_label) && (
        <div className="match-card-meta">
          {match.week_label && <span>{/^\d+$/.test(match.week_label) ? `Jornada ${match.week_label}` : match.week_label}</span>}
          {match.venue && <span>{match.venue}</span>}
        </div>
      )}

      {/* Botones */}
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