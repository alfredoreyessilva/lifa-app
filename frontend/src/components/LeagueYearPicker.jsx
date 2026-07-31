import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Selector de año dentro de "mi panel", para una liga específica.
// Ruta: /panel/liga/:id/anio
// Al elegir un año, navega a /panel/liga/:id/:year (Torneos de ese año).
export default function LeagueYearPicker() {
  const { id } = useParams();
  const { leagues } = useAuth();
  const navigate = useNavigate();
  const league = leagues.find((lg) => String(lg.id) === id);

  const currentYear = new Date().getFullYear();
  const pastYears = [currentYear - 1, currentYear - 2, currentYear - 3];

  function goToYear(year) {
    navigate(`/panel/liga/${id}/${year}`);
  }

  if (!league) {
    return <div className="container"><p>No administras ninguna liga con ese id.</p></div>;
  }

  return (
    <div className="container">
      <div className="section-head">
        <h2>{league.name} — ¿En qué año quieres trabajar?</h2>
      </div>

      <button type="button" className="year-current" onClick={() => goToYear(currentYear)}>
        <span className="year-current-label">Temporada</span>
        <span className="year-current-number">{currentYear}</span>
      </button>

      <div className="year-past-grid">
        {pastYears.map((year) => (
          <button key={year} type="button" className="year-past-card" onClick={() => goToYear(year)}>
            <span className="year-past-number">{year}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
