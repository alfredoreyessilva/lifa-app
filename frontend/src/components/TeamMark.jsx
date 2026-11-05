import { imagenAjustada } from '../utils/imagenes.js';
import { initials } from '../utils/matchDisplay.js';

// El escudo chico de un equipo en las listas de la página de un partido. El
// ancho que se le pide a Cloudinary es el doble del que se pinta, para que se
// vea bien en un teléfono: el original de un casco pesa cien veces más.
export default function TeamMark({ name, logoUrl, size = 28 }) {
  return (
    <span className="mp-mark" style={{ '--mark': `${size}px` }}>
      {logoUrl
        ? <img src={imagenAjustada(logoUrl, size * 2)} alt="" loading="lazy" />
        : <span>{initials(name)}</span>}
    </span>
  );
}
