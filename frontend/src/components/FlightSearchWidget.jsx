import { useEffect, useRef, useState } from 'react';
import { iataForCity } from '../utils/matchServices.js';

// Código base del widget "Flights Search Form" de Travelpayouts (Programa
// Aviasales → Tools → Search Forms). Incluye tu marker (shmarker=769609),
// moneda, idioma y todo el diseño (colores, bordes) que se configuró en su
// panel. Si algún día cambias el diseño desde ahí, actualiza esta constante
// con el nuevo código completo.
//
// A propósito NO incluye "destination" — ese se agrega dinámicamente según
// el partido (ver buildWidgetSrc). "origin" se deja sin especificar a
// propósito: Aviasales lo detecta solo por la IP del usuario, así que no
// hace falta pedírselo.
const AVIASALES_WIDGET_BASE_SRC =
  'https://tpwdg.com/content?currency=mxn&trs=566269&shmarker=769609&show_hotels=true' +
  '&powered_by=true&locale=es&searchUrl=www.aviasales.es%2Fsearch' +
  '&primary_override=%2306AA06ff&color_button=%23F0E90Aff&color_icons=%23E9F0E9ff' +
  '&dark=%23F6F6F3ff&light=%2308750Aff&secondary=%23078130ff&special=%23D4E603ff' +
  '&color_focused=%233FA207ff&border_radius=13&no_labels=&plain=false' +
  '&promo_id=7879&campaign_id=100';

function buildWidgetSrc(destinationIata) {
  return `${AVIASALES_WIDGET_BASE_SRC}&destination=${destinationIata}`;
}

// Este widget (a diferencia de "destination") no acepta fecha por
// default — se probó en el configurador de Travelpayouts y no hay campo
// para eso en este tipo de widget. Como alternativa honesta, mostramos un
// aviso con la fecha del partido justo arriba del formulario, para que el
// usuario ajuste ahí mismo el calendario con un clic, en vez de fingir que
// quedó preconfigurado cuando no es así.
function formatMatchDateHint(match) {
  const tz = match?.timezone || match?.league_timezone || 'America/Mexico_City';
  const matchDate = new Date(match?.match_date);
  if (Number.isNaN(matchDate.getTime())) return null;

  const label = new Intl.DateTimeFormat('es-MX', {
    timeZone: tz,
    day: 'numeric',
    month: 'long',
  }).format(matchDate);

  return `El partido es el ${label} — ajusta las fechas de ida y vuelta en el buscador de abajo alrededor de esa fecha.`;
}

// Botón "✈️ Vuelo" para MatchPage. Al hacer clic, despliega el formulario
// de búsqueda de Aviasales embebido (no una pestaña nueva) con el destino
// ya puesto en la ciudad de la sede — el usuario nunca lo escribe.
//
// Si la ciudad de la sede no resuelve a un código IATA conocido
// (iataForCity), el componente no se renderiza — nunca mostramos un botón
// que de todos modos abriría un widget sin destino válido.
export default function FlightSearchWidget({ match }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const destinationIata = iataForCity(match?.venue_city);
  const dateHint = formatMatchDateHint(match);

  // El script de Travelpayouts busca su propio <script> en el DOM para
  // saber dónde insertar el widget, así que hay que crearlo con
  // document.createElement (pegarlo como HTML de React no lo ejecuta) y
  // limpiarlo al cerrar, para poder volver a abrirlo sin arrastrar
  // instancias viejas del widget.
  useEffect(() => {
    if (!open || !destinationIata || !containerRef.current) return;

    const script = document.createElement('script');
    script.async = true;
    script.charset = 'utf-8';
    script.src = buildWidgetSrc(destinationIata);
    containerRef.current.appendChild(script);

    return () => {
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, [open, destinationIata]);

  if (!destinationIata) return null;

  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen((v) => !v)}>
        ✈️ Vuelo
      </button>
      {open && (
        <div style={{ width: '100%', marginTop: 16 }}>
          {dateHint && (
            <p style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>📅 {dateHint}</p>
          )}
          <div ref={containerRef} />
        </div>
      )}
    </>
  );
}
