import { getMatchParts } from './matchDisplay.js';

// Cómo se dice cada aviso de "Mis notificaciones" (README, "Notificaciones: la
// bandeja y el push").
//
// Los de las organizaciones traen su texto guardado. Los de lo que sigues se
// arman AQUÍ, al leer, con los datos de hoy del partido: si se corrige un
// marcador o se mueve la fecha otra vez, el aviso dice lo que vale ahora.
//
// Los cuatro tipos son los dos de `match_events` (config/db.js) más los dos
// que el backend calcula con la hora del partido (utils/bandeja.js). Un tipo
// nuevo se agrega en los tres lados o en ninguno (regla 6).

// La pantalla de notificaciones lo dispara en cuanto marca la bandeja como
// vista, para que el balón de la barra de arriba se ponga en cero sin volver a
// preguntar.
export const EVENTO_NOTIFICACIONES_VISTAS = 'cfbamx:notificaciones-vistas';

// Lo que enseña el balón de la barra de arriba.
export function etiquetaDelContador(n) {
  const num = Number(n) || 0;
  if (num <= 0) return '';
  return num > 9 ? '9+' : String(num);
}

function cuandoEs(match) {
  if (!match?.match_date) return '';
  const { day, month, time, tzLabel } = getMatchParts(match.match_date, match.timezone);
  return `${day} ${month} · ${time} (${tzLabel})`;
}

export function textoDeSeguimiento(aviso) {
  const m = aviso?.match || {};
  const cruce = `${m.home_team} vs ${m.away_team}`;
  const cuando = cuandoEs(m);

  switch (aviso?.type) {
    case 'upcoming':
      return { title: `Próximo — ${cruce}`, body: cuando ? `Empieza el ${cuando}.` : 'Empieza en una hora.' };
    case 'live':
      return { title: `En vivo — ${cruce}`, body: 'El partido ya comenzó.' };
    case 'final_score': {
      const hayMarcador = m.home_score != null && m.away_score != null;
      return {
        title: `Marcador final — ${cruce}`,
        body: hayMarcador
          ? `${m.home_team} ${m.home_score} · ${m.away_team} ${m.away_score}`
          : 'Mira el resultado en la página del partido.',
      };
    }
    case 'schedule_change': {
      const d = aviso.data || {};
      const que = d.date_changed && d.venue_changed ? 'Cambiaron la fecha y la sede.'
        : d.venue_changed ? 'Cambió la sede.'
        : 'Cambió la fecha u hora.';
      return { title: `Cambio de programación — ${cruce}`, body: cuando ? `${que} Ahora: ${cuando}.` : que };
    }
    default:
      return { title: cruce, body: '' };
  }
}
