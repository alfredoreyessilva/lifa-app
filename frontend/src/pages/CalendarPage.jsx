import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import Loading from '../components/Loading.jsx';

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

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
        <div className="match-list">
          {matches.map((m) => (
            <MatchRow key={m.id} match={m} isNext={nextMatch?.id === m.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function MatchRow({ match, isNext }) {
  const date = new Date(match.match_date);
  const day = date.getDate();
  const month = MESES[date.getMonth()];
  const time = date.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="match-card" style={isNext ? { borderLeft: '3px solid var(--flag)', paddingLeft: 13 } : {}}>
      <div className="match-date">
        <div className="day">{day}</div>
        <div className="month">{month}</div>
        <div className="time">{time}</div>
      </div>

      <div>
        <div className="match-teams">
          {match.home_team} <span className="vs">VS</span> {match.away_team}
          {match.status === 'finished' && match.home_score !== null && (
            <span className="score"> &nbsp;{match.home_score}–{match.away_score}</span>
          )}
        </div>
        <div className="match-meta">
          {isNext && <span className="tag" style={{ color: 'var(--flag)', borderColor: 'var(--flag)' }}>Próximo</span>}
          {match.week_label && <span>{/^\d+$/.test(match.week_label) ? `Jornada ${match.week_label}` : match.week_label}</span>}
          {match.venue && <span>{match.venue}</span>}
          {match.status === 'live' && <span className="tag live">En vivo</span>}
          {match.status === 'finished' && <span className="tag finished">Finalizado</span>}
        </div>
      </div>

      <div className="match-action">
        {match.stream_url ? (
          <a href={match.stream_url} target="_blank" rel="noopener noreferrer" className="btn btn-flag btn-sm">
            Ver el partido
          </a>
        ) : (
          <span className="btn btn-outline btn-sm" style={{ opacity: 0.5, cursor: 'default' }}>
            Sin transmisión
          </span>
        )}
      </div>
    </div>
  );
}