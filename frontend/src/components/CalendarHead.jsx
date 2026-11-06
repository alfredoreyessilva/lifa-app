import { imagenAjustada } from '../utils/imagenes.js';

// El encabezado de un calendario: qué competencia es y de quién. `children` son
// sus acciones, a la derecha. Lo comparten TournamentPage y CalendarPage para que
// el calendario se vea igual sin importar por dónde se llegue.
export default function CalendarHead({ titulo, detalle, logo, children }) {
  return (
    <header className="cal-head">
      {logo && <img src={imagenAjustada(logo, 112)} alt="" className="cal-head-logo" width="56" height="56" />}
      <div className="cal-head-text">
        <h1>{titulo}</h1>
        {detalle && <p>{detalle}</p>}
      </div>
      {children}
    </header>
  );
}
