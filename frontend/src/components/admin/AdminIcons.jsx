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
