// Los iconos de la página de un partido. Dibujados a mano, como las gráficas del
// proyecto: los emojis que había en estos botones cambian de dibujo en cada
// teléfono y ninguno se parece a los demás.

function Icono({ children }) {
  return (
    <svg
      className="mp-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconoVer = () => <Icono><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></Icono>;
export const IconoBoleto = () => (
  <Icono>
    <path d="M3 9V6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5V9a3 3 0 0 0 0 6v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5V15a3 3 0 0 0 0-6z" />
    <path d="M14 5v2M14 11v2M14 17v2" />
  </Icono>
);
export const IconoMapa = () => (
  <Icono>
    <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Icono>
);
export const IconoHotel = () => (
  <Icono>
    <path d="M3 18V6M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5" />
    <circle cx="7" cy="10.5" r="1.5" />
  </Icono>
);
export const IconoVuelo = () => (
  <Icono>
    <path d="M21 3 10 14M21 3l-6.5 18-3.5-7-7-3.5z" />
  </Icono>
);
export const IconoCompartir = () => (
  <Icono>
    <circle cx="18" cy="5" r="2.5" />
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="19" r="2.5" />
    <path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" />
  </Icono>
);
export const IconoImagen = () => (
  <Icono>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="m21 16-5-5L6 20" />
  </Icono>
);
export const IconoEditar = () => (
  <Icono>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
    <path d="m13.5 6.5 4 4" />
  </Icono>
);
export const IconoEstadisticas = () => <Icono><path d="M5 20v-7M12 20V5M19 20v-11" /></Icono>;
export const IconoAnterior = () => <Icono><path d="m15 5-7 7 7 7" /></Icono>;
export const IconoSiguiente = () => <Icono><path d="m9 5 7 7-7 7" /></Icono>;
