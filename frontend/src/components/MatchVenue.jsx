import FlightSearchWidget from './FlightSearchWidget.jsx';
import { IconoHotel, IconoMapa } from './MatchIcons.jsx';
import { imagenAjustada } from '../utils/imagenes.js';

export function esLink(valor) {
  try {
    return Boolean(valor) && Boolean(new URL(valor));
  } catch {
    return false;
  }
}

// "¿Cómo llego?": la sede, junto con lo que hace falta para ir. Antes eran una
// ficha al final de la página y tres botones sueltos en la tarjeta del partido.
//
// Hotel y Vuelo dejan de ofrecerse cuando el partido terminó: el link de hotel
// se arma con la fecha del juego, y ahí ya sería una reservación en el pasado.
//
// `match.venue` es el texto libre de cuando un partido no tiene sede registrada.
// Es lo único que tiene la LFA: sin ese respaldo, la final del Tazón México no
// decía dónde se jugó, aunque el dato estuviera ahí.
export default function MatchVenue({ match, terminado, hotelUrl }) {
  const nombre = match.venue_name || match.venue;
  if (!nombre) return null;

  const direccion = match.venue_address;
  const direccionEsLink = esLink(direccion);
  const lugar = [match.venue_institution, match.venue_city].filter(Boolean);

  return (
    <section className="mp-sec">
      <h2 className="mp-title">{terminado ? 'La sede' : 'Cómo llegar'}</h2>

      {match.venue_cover_url && (
        <img
          className="mp-venue-cover"
          src={imagenAjustada(match.venue_cover_url, 720)}
          alt={`Foto de ${nombre}`}
          loading="lazy"
        />
      )}

      <p className="mp-venue-name">{nombre}</p>
      {lugar.map((l) => <p className="mp-venue-line" key={l}>{l}</p>)}
      {direccion && !direccionEsLink && <p className="mp-venue-line">{direccion}</p>}

      <div className="mp-venue-actions">
        {direccionEsLink && (
          <a href={direccion} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
            <IconoMapa /> Abrir en Maps
          </a>
        )}
        {!terminado && hotelUrl && (
          <a href={hotelUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
            <IconoHotel /> Hotel
          </a>
        )}
        {!terminado && <FlightSearchWidget match={match} />}
      </div>

      {(match.venue_contact_phone || match.venue_contact_email) && (
        <p className="mp-venue-contact">
          {match.venue_contact_phone && <span>{match.venue_contact_phone}</span>}
          {match.venue_contact_email && <a href={`mailto:${match.venue_contact_email}`}>{match.venue_contact_email}</a>}
        </p>
      )}
    </section>
  );
}
