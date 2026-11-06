import { IconoMapa } from './MatchIcons.jsx';

// Una sede en la lista de su liga: el mismo recuadro del filtro "Sede" del
// calendario. Pocas sedes tienen foto (7 de 33 en ONEFA), y una cuadrícula con
// unas fotos sueltas se ve dispareja: la foto se queda en su ficha.
export default function VenueCard({ venue, onClick }) {
  const donde = [venue.institution, venue.city].filter(Boolean).join(', ');

  return (
    <button type="button" className="filter-card" onClick={onClick}>
      <span className="filter-card-label"><IconoMapa />{venue.name}</span>
      {donde && <span className="filter-card-count">{donde}</span>}
    </button>
  );
}
