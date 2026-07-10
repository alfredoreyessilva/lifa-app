import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import Loading from '../components/Loading.jsx';
import CrossLeagueMatchCard from '../components/CrossLeagueMatchCard.jsx';

// Agrupa los partidos por día (Hoy, Mañana, o fecha completa),
// usando la fecha del dispositivo de quien está viendo la página.
function getDayLabel(isoString) {
  const date     = new Date(isoString);
  const today    = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (date.toDateString() === today.toDateString())    return 'Hoy';
  if (date.toDateString() === tomorrow.toDateString())  return 'Mañana';

  return date.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
}

function groupByDay(matches) {
  const groups = [];
  const seen   = new Map();
  for (const m of matches) {
    const label = getDayLabel(m.match_date);
    if (!seen.has(label)) {
      const group = { label, matches: [] };
      seen.set(label, group);
      groups.push(group);
    }
    seen.get(label).matches.push(m);
  }
  return groups;
}

export default function UpcomingPage() {
  const [matches, setMatches] = useState(null);
  const [error, setError]     = useState('');

  useEffect(() => {
    api.getUpcomingMatches().then(setMatches).catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No pudimos cargar los partidos</h3>
          <p>{error}</p>
          <Link to="/" className="btn btn-outline" style={{ marginTop: 16 }}>Volver al inicio</Link>
        </div>
      </div>
    );
  }

  if (!matches) return <div className="container"><Loading /></div>;

  const groups = groupByDay(matches);

  return (
    <div className="container">
      <div className="crumb"><Link to="/">Inicio</Link> / Partidos</div>

      <div className="section-head">
        <h2>Próximos partidos</h2>
        <span className="count">{matches.length} en los próximos 7 días</span>
      </div>

      {matches.length === 0 ? (
        <div className="empty-state">
          <h3>No hay partidos programados por ahora</h3>
          <p>Vuelve pronto — aquí aparecerán los próximos partidos de todas las ligas.</p>
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.label} style={{ marginBottom: 32 }}>
            <div className="filter-selected-title">{group.label}</div>
            <div className="match-grid">
              {group.matches.map((m) => <CrossLeagueMatchCard key={m.id} match={m} />)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}