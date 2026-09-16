export default function TeamCard({ team, isSelected, onClick }) {
  return (
    <button
      className={`team-card${isSelected ? ' team-card--selected' : ''}`}
      onClick={onClick}
    >
      <div className="league-logo">
        {team.logo_url
          ? <img src={team.logo_url} alt={team.name} />
          : initials(team.name)}
      </div>
      <h4>
        {team.name}
        {/* La tarjeta es chica y va en cuadrícula, así que aquí el verificado
            es solo la palomita; la pastilla completa "✓ Verificado" se ve al
            abrir la ficha (TeamInfoPanel). El title/aria-label es lo que le da
            el significado a quien pase el cursor o use lector de pantalla. */}
        {team.is_verified && (
          <span
            className="team-card-verified"
            title="Equipo verificado"
            aria-label="Equipo verificado"
          >
            ✓
          </span>
        )}
      </h4>
    </button>
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
