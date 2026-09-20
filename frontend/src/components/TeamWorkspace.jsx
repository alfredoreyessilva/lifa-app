import { NavLink } from 'react-router-dom';
import OrgLogoBar from './OrgLogoBar.jsx';
import { initials } from '../utils/matchDisplay.js';
import { useAccentColor } from '../utils/color.js';
import { puedeAlguno, etiquetaDeMiRol } from '../utils/permisos.js';

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

// Cada sección declara QUÉ PERMISO hace falta para que exista. `permisos` es
// "cualquiera de estos", no "todos": la pestaña del padrón la abren dos roles
// por razones distintas —el tesorero por las cuotas, el editor de roster por el
// roster de torneo— y adentro cada uno ve solo su mitad.
//
// Esconder no es proteger: el backend vuelve a decidir en cada petición. Lo que
// esto evita es enseñar una puerta que va a contestar 403.
const SECTIONS = [
  { to: '',                   label: 'Resumen',      end: true, permisos: ['ver'] },
  { to: '/finanzas',          label: 'Finanzas',     permisos: ['cuotas_club'] },
  // La ruta sigue siendo /jugadores a propósito: cambiarla rompería links
  // guardados y abriría una ventana de incompatibilidad al desplegar, que es
  // caro por una etiqueta. Lo que cambia es cómo se llama, no dónde vive.
  { to: '/jugadores',         label: 'Padrón',       permisos: ['cuotas_club', 'roster'] },
  { to: '/estado-de-cuenta',  label: 'Con la liga',  hideWhenIndependent: true, permisos: ['cobranza_liga'] },
  // El perfil lo VE todo el que puede ver el panel —un coach incluido— y lo
  // edita quien tiene 'perfil'. La pestaña no se esconde: lo que se apaga son
  // los campos, adentro. Esconderle a un coach el equipo entero le dejaría un
  // panel vacío, y ese rol existe justamente para mirar.
  { to: '/perfil',            label: 'Perfil',       permisos: ['ver'] },
  { to: '/administradores',   label: 'Administradores', permisos: ['miembros'] },
];

export default function TeamWorkspace({ team, children }) {
  // También en :root, para que el color llegue a los modales (portales).
  useAccentColor(team.brand_color);

  const base = `/panel/equipo/${team.id}`;
  const isIndependent = !team.league_id;
  const sections = SECTIONS.filter((s) => (
    !(s.hideWhenIndependent && isIndependent) && puedeAlguno(team, ...s.permisos)
  ));

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
            {/* Con qué rol entró quien mira. Sin esto, alguien que ve menos
                pestañas que su compañero no tiene forma de saber por qué. */}
            {etiquetaDeMiRol(team) && <span className="pill is-muted">{etiquetaDeMiRol(team)}</span>}
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
