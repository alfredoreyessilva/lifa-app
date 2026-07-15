export default function VenueCard({ venue, isSelected, onClick }) {
  return (
    <button
      className={`team-card${isSelected ? ' team-card--selected' : ''}`}
      onClick={onClick}
    >
      <div className="league-logo">
        {venue.cover_url
          ? <img src={venue.cover_url} alt={venue.name} />
          : '📍'}
      </div>
      <h4>{venue.name}</h4>
      {venue.institution && (
        <div style={{ fontSize: 11, color: 'var(--ink-dim)', marginTop: 2 }}>{venue.institution}</div>
      )}
    </button>
  );
}
