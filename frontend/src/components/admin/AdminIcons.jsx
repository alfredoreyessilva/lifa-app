// Los iconos del Panel Admin. Dibujados a mano, como las gráficas del proyecto y
// los de la página de un partido (MatchIcons.jsx): los emojis que había en estas
// tarjetas cambian de dibujo en cada teléfono y ninguno se parece a los demás.

function Icon({ size = 18, children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconOverview = () => (
  <Icon>
    <path d="M4 5h16v14H4z" />
    <path d="M4 10h16M10 10v9" />
  </Icon>
);
export const IconLeague = () => (
  <Icon>
    <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
    <path d="M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5" />
    <path d="M12 14v4M8 20h8" />
  </Icon>
);
export const IconOrganization = () => (
  <Icon>
    <path d="M4 20V6l8-3v17M12 9l8 2.5V20M2 20h20" />
    <path d="M8 8v.01M8 12v.01M8 16v.01M16 14v.01M16 17v.01" />
  </Icon>
);
export const IconUsers = () => (
  <Icon>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.3a6 6 0 0 1 3 5.7" />
  </Icon>
);
export const IconSponsor = () => (
  <Icon>
    <path d="M4 10v4l3 .5L17 19V5L7 9.5z" />
    <path d="M7 14.5 8 20h3l-.9-4.5M20 9.5a3.5 3.5 0 0 1 0 5" />
  </Icon>
);
export const IconClock = () => (
  <Icon>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7v5.2l3.2 1.8" />
  </Icon>
);
export const IconBell = () => (
  <Icon>
    <path d="M6 16.5v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </Icon>
);
export const IconSearch = () => (
  <Icon size={16}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.3-4.3" />
  </Icon>
);
export const IconMore = () => (
  <Icon size={18}>
    <circle cx="5" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="19" cy="12" r="1.2" fill="currentColor" />
  </Icon>
);
export const IconCheck = () => (
  <Icon size={14}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);
export const IconPlus = () => (
  <Icon size={20}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const IconChevronLeft = () => (
  <Icon size={16}>
    <path d="m14.5 6-6 6 6 6" />
  </Icon>
);
export const IconChevronRight = () => (
  <Icon size={16}>
    <path d="m9.5 6 6 6-6 6" />
  </Icon>
);

// Los que agregó el panel de una liga (2026-11-07), que se arma con estas mismas
// piezas.
export const IconShield = () => (
  <Icon>
    <path d="M12 3 4.5 6v5.5c0 4.4 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5.1 7.5-9.5V6z" />
  </Icon>
);
export const IconPin = () => (
  <Icon>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.4" />
  </Icon>
);
export const IconMoney = () => (
  <Icon>
    <rect x="3" y="6.5" width="18" height="11" rx="1.5" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M6.5 9.5v.01M17.5 14.5v.01" />
  </Icon>
);
export const IconProfile = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="11" r="2.2" />
    <path d="M5.8 16.2a3.4 3.4 0 0 1 6.4 0M14.5 10h4M14.5 13.5h3" />
  </Icon>
);
export const IconBack = () => (
  <Icon size={16}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);

// El de Productos, del panel de una tienda (2026-11-08): una etiqueta de precio.
export const IconTag = () => (
  <Icon>
    <path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1l8 8a1.4 1.4 0 0 1 0 2l-6.6 6.6a1.4 1.4 0 0 1-2 0z" />
    <circle cx="8.3" cy="8.3" r="1.5" />
  </Icon>
);
// "Ver mi página": sale a otra pantalla.
export const IconExternal = () => (
  <Icon size={15}>
    <path d="M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Icon>
);

// Los del panel de un medio (2026-11-08): Transmisiones, una cámara, y Partidos,
// un calendario.
export const IconBroadcast = () => (
  <Icon>
    <rect x="3" y="7" width="12.5" height="10" rx="1.6" />
    <path d="m15.5 10.6 5.5-3v8.8l-5.5-3" />
  </Icon>
);
export const IconCalendar = () => (
  <Icon>
    <rect x="3.5" y="5" width="17" height="15" rx="1.8" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Icon>
);
