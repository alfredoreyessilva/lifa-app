import { Link } from 'react-router-dom';
import SubscribeButton from './SubscribeButton.jsx';
import TeamMark from './TeamMark.jsx';
import { imagenAjustada } from '../utils/imagenes.js';

const REDES = [
  ['facebook_url', 'Facebook'],
  ['instagram_url', 'Instagram'],
  ['twitter_url', 'X'],
  ['website_url', 'Sitio web'],
];

// La ficha de un equipo en la página del partido. De 58 equipos, 1 tiene ciudad
// y 1 institución, así que la ficha se arma con lo que haya y no guarda lugar
// para lo que falta: la anterior decía "Este equipo no ha agregado información
// de contacto" y dejaba un recuadro vacío en la pantalla más vista de la app.
//
// `rosterUrl` llega solo si la categoría publica su roster. Se abre desde el
// partido y no desde un link suelto: es el mismo botón que abre el pase de lista
// para quien tiene permiso, y la asistencia es a un partido (README, "Roster
// público y pase de lista").
//
// El botón de seguir se amarra a este equipo DE ESTA LIGA, para que no se cruce
// con otro del mismo nombre en otra liga.
export default function MatchTeamCard({ team, lado, logo, rosterUrl }) {
  const lugar = [team.institution, team.city].filter(Boolean);
  const redes = REDES.filter(([campo]) => team[campo]);
  const contacto = [
    team.contact_phone && { key: 'tel', texto: team.contact_phone },
    team.contact_email && { key: 'correo', texto: team.contact_email, href: `mailto:${team.contact_email}` },
    team.maps_url && { key: 'mapa', texto: 'Ver en Google Maps', href: team.maps_url, externo: true },
  ].filter(Boolean);

  return (
    <article className={`mp-team mp-team--${lado}`}>
      <div
        className={`mp-team-cover${team.cover_url ? ' mp-team-cover--foto' : ''}`}
        style={team.cover_url ? { backgroundImage: `url(${imagenAjustada(team.cover_url, 900)})` } : undefined}
      />

      <div className="mp-team-body">
        <div className="mp-team-head">
          <TeamMark name={team.name} logoUrl={logo} size={72} />
          <div>
            <p className="mp-team-role">{lado === 'home' ? 'Local' : 'Visitante'}</p>
            <h3 className="mp-team-name">
              {team.name}
              {team.is_verified && <span className="mp-team-check" title="Equipo verificado" aria-label="Equipo verificado">✓</span>}
            </h3>
          </div>
        </div>

        {lugar.length > 0 && <p className="mp-team-line">{lugar.join(', ')}</p>}

        {contacto.length > 0 && (
          <ul className="mp-team-contact">
            {contacto.map((c) => (
              <li key={c.key}>
                {c.href
                  ? <a href={c.href} {...(c.externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{c.texto}</a>
                  : c.texto}
              </li>
            ))}
          </ul>
        )}

        {redes.length > 0 && (
          <p className="mp-team-links">
            {redes.map(([campo, etiqueta]) => (
              <a key={campo} href={team[campo]} target="_blank" rel="noopener noreferrer">{etiqueta}</a>
            ))}
          </p>
        )}

        <div className="mp-team-actions">
          {rosterUrl && <Link to={rosterUrl} className="btn btn-outline btn-sm">Ver roster</Link>}
          <SubscribeButton
            leagueId={team.league_id}
            teamName={team.name}
            label={`Seguir a ${team.name}`}
            targetName={`Partidos de ${team.name}`}
          />
        </div>
      </div>
    </article>
  );
}
