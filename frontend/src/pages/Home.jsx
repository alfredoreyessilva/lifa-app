import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Loading from '../components/Loading.jsx';
import CrossLeagueMatchCard from '../components/CrossLeagueMatchCard.jsx';

export default function Home() {
  const [leagues, setLeagues] = useState(null);
  const [error, setError] = useState('');
  const [upcoming, setUpcoming] = useState(null);
  const { token, leagues: myLeagues } = useAuth();

  useEffect(() => {
    api.getLeagues().then(setLeagues).catch((e) => setError(e.message));
    api.getUpcomingMatches().then(setUpcoming).catch(() => setUpcoming([]));
  }, []);

  const preview = (upcoming || []).slice(0, 4);

  return (
    <div className="container">
      <section className="hero">
        <span className="eyebrow">Temporada en curso</span>
        <h1>Todo el football<br />americano de México<br />en un solo lugar</h1>
        <p>Encuentra los calendarios, categorías y transmisiones de las ligas de fútbol americano de todo el país.</p>
        <div className="hero-actions">
          <a href="#ligas" className="btn btn-flag">Ver ligas</a>
          {token ? (
            <Link
              to={myLeagues?.[0] ? `/ligas/${myLeagues[0].slug}` : '/panel'}
              className="btn btn-outline"
            >
              Ver mi página pública
            </Link>
          ) : (
            <Link to="/crear-cuenta" className="btn btn-outline">Registrar el calendario de mi liga</Link>
          )}
        </div>
      </section>

      {preview.length > 0 && (
        <>
          <div className="section-head">
            <h2>Próximos partidos</h2>
            <Link to="/partidos" className="btn btn-outline btn-sm">Ver todos →</Link>
          </div>
          <div className="match-grid">
            {preview.map((m) => <CrossLeagueMatchCard key={m.id} match={m} />)}
          </div>
        </>
      )}

      <div className="section-head" id="ligas">
        <h2>Ligas</h2>
        {leagues && <span className="count">{leagues.length} registradas</span>}
      </div>

      {error && <div className="form-error">{error}</div>}

      {!leagues && !error && <Loading message="Cargando ligas…" />}

      {leagues && leagues.length === 0 && (
        <div className="empty-state">
          <h3>Todavía no hay ligas registradas</h3>
          <p>Sé la primera liga en publicar su calendario.</p>
          <div style={{ marginTop: 16 }}>
            <Link to="/crear-cuenta" className="btn btn-flag">Registrar mi liga</Link>
          </div>
        </div>
      )}

      {leagues && leagues.length > 0 && (
        <div className="league-grid">
          {leagues.map((lg) => (
            <Link key={lg.id} to={`/ligas/${lg.slug}`} className="league-card">
              <div className="league-logo">
                {lg.logo_url
                  ? <img src={lg.logo_url} alt={lg.name} />
                  : initials(lg.name)}
              </div>
              <h3>{lg.name}</h3>
              {lg.state && <span className="state">{lg.state}</span>}
            </Link>
          ))}
        </div>
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