export default function YearSelectPage() {
  const currentYear = 2026;
  const pastYears = [2025, 2024, 2023];

  return (
    <div className="container">
      <div className="section-head">
        <h2>Calendarios Football Americano México</h2>
      </div>

      <button type="button" className="year-current">
        <span className="year-current-label">Temporada</span>
        <span className="year-current-number">{currentYear}</span>
      </button>

      <div className="year-past-grid">
        {pastYears.map((year) => (
          <button key={year} type="button" className="year-past-card">
            <span className="year-past-number">{year}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
