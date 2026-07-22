import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Loading from '../components/Loading.jsx';

export default function Home() {
  const [leagues, setLeagues] = useState(null);
  const [error, setError] = useState('');
  const { token, leagues: myLeagues } = useAuth();

  useEffect(() => {
    api.getLeagues().then(setLeagues).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="container">
      <section className="hero">
        <span className="eyebrow">Temporada en curso</span>
        <h1>Conectando al football<br />americano de México</h1>
        <p>Encuentra los calendarios, categorías y transmisiones de las ligas de fútbol americano de todo el país.</p>
        <div className="hero-actions">
          <a href="#ligas" className="btn btn-flag">Ver ligas</a>
          {token && (
            <Link
              to={myLeagues?.[0] ? `/ligas/${myLeagues[0].slug}` : '/panel'}
              className="btn btn-outline"
            >
              Ver mi página pública
            </Link>
          )}
        </div>
      </section>

      <div className="section-head" id="ligas">
        <h2>Ligas</h2>
        {leagues && <span className="count">{leagues.length} registradas</span>}
      </div>

      {error && <div className="form-error">{error}</div>}

      {!leagues && !error && <Loading message="Cargando ligas…" />}

      {leagues && leagues.length === 0 && (
        <div className="empty-state">
          <h3>Todavía no hay ligas registradas</h3>
          <p>Muy pronto vas a encontrar aquí los calendarios de las ligas de fútbol americano de México.</p>
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
