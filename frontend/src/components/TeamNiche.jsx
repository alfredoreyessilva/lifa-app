import { useTeamPaint } from '../utils/useTeamPaint.js';
import { Casco } from './MatchField.jsx';

// Un equipo en el muro de cascos del home: su casco en su propio nicho, encendido
// con su color, y su nombre en la placa (README, "El home"). A diferencia de la
// franja de una liga (TeamStrip), aquí el equipo no es un renglón de una lista.
export default function TeamNiche({ team, isSelected, onClick }) {
  const pintura = useTeamPaint(team.logo_url, team.brand_color, { alInstante: true });

  return (
    <button
      type="button"
      className={`hm-nicho${pintura.listo ? ' is-encendido' : ''}${isSelected ? ' is-activo' : ''}`}
      style={pintura.listo ? { '--eq': pintura.fondo } : undefined}
      onClick={onClick}
    >
      <Casco lado="home" nombre={team.name} logo={team.logo_url} pintura={pintura} ancho={320} alt="" loading="lazy" />
      <span className="hm-nicho-placa">
        <span>
          {team.name}
          {team.is_verified && (
            <span className="team-card-verified" title="Equipo verificado" aria-label="Equipo verificado">✓</span>
          )}
        </span>
      </span>
    </button>
  );
}
