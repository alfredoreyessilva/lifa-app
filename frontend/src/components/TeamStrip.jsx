import { useTeamPaint } from '../utils/useTeamPaint.js';
import { Casco } from './MatchField.jsx';

// Cada equipo en su franja de cancha, con su end zone a un lado. El casco va
// sobre el pasto y no sobre el color del equipo: un casco rojo sobre rojo
// desaparece. Todos llevan el mismo trato (README, "El calendario"). La comparten
// el filtro "Equipo" del calendario y la página de una liga.
export default function TeamStrip({ name, logo, color, verified = false, onClick, children }) {
  const pintura = useTeamPaint(logo, color, { alInstante: true });
  const zona = {
    '--home': pintura.fondo,
    '--home-ink': pintura.tinta,
    '--away': pintura.fondo,
    '--away-ink': pintura.tinta,
  };

  return (
    <button type="button" className="filter-team" style={zona} onClick={onClick}>
      <div className="mh-zone mh-zone--home" aria-hidden="true" />
      <div className="mh-field">
        <Casco lado="home" nombre={name} logo={logo} pintura={pintura} ancho={120} alt="" loading="lazy" />
        <div className="filter-team-text">
          <div className="filter-team-name">
            {name}
            {verified && (
              <span className="team-card-verified" title="Equipo verificado" aria-label="Equipo verificado">✓</span>
            )}
          </div>
          {children}
        </div>
      </div>
    </button>
  );
}
