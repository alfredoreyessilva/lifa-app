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
      <h4>{team.name}</h4>
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