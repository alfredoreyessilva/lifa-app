import { NavLink } from 'react-router-dom';
import OrgLogoBar from './OrgLogoBar.jsx';
import { initials } from '../utils/matchDisplay.js';
import { useAccentColor } from '../utils/color.js';

// Cascarón común de todas las secciones del panel de un equipo.
//
// Antes, /panel/equipo/:id era una sola pantalla: el editor del perfil. Todo
// lo demás que un club necesita (roster, estado de cuenta, administradores)
// ya existía pero vivía en otras rutas — el roster ni siquiera tenía pantalla
// propia, solo se abría desde el panel de la liga. Esto las junta bajo una
// navegación única para que se lea como una herramienta y no como una
// colección de pantallas sueltas.
//
// El acento lo pone el club con su brand_color; ver utils/color.js.

const SECTIONS = [
  { to: '',                   label: 'Resumen',         end: true },
  { to: '/finanzas',          label: 'Finanzas' },
  { to: '/jugadores',         label: 'Jugadores' },
  { to: '/estado-de-cuenta',  label: 'Con la liga', hideWhenIndependent: true },
  { to: '/perfil',            label: 'Perfil' },
  { to: '/administradores',   label: 'Administradores' },
];

export default function TeamWorkspace({ team, children }) {
  // También en :root, para que el color llegue a los modales (portales).
  useAccentColor(team.brand_color);

  const base = `/panel/equipo/${team.id}`;
  const isIndependent = !team.league_id;
  const sections = SECTIONS.filter((s) => !(s.hideWhenIndependent && isIndependent));

  return (
    <div className="ws">
      <OrgLogoBar selectedKind="equipo" selectedId={String(team.id)} />

      <div className="ws-head">
        {team.logo_url ? (
          <img className="ws-head-logo" src={team.logo_url} alt={team.name} />
        ) : (
          <div className="ws-head-logo ws-head-logo-fallback">{initials(team.name)}</div>
        )}

        <div className="ws-head-text">
          <span className="eyebrow">Panel del club</span>
          <h1>{team.name}</h1>
          <div className="ws-head-meta">
            <span>{isIndependent ? 'Equipo independiente' : team.league_name}</span>
            {team.is_verified && <span className="pill is-ok">✓ Verificado</span>}
          </div>
        </div>
      </div>

      <nav className="ws-nav">
        {sections.map((s) => (
          <NavLink
            key={s.to}
            to={`${base}${s.to}`}
            end={s.end}
            className={({ isActive }) => `ws-nav-link${isActive ? ' active' : ''}`}
          >
            {s.label}
          </NavLink>
        ))}
      </nav>

      {children}
    </div>
  );
}
