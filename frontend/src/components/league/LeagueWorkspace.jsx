import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { etiquetaDeMiRol, puede, puedeAlguno } from '../../utils/permisos.js';
import { formatNumber } from '../../utils/adminPanel.js';
import { VISIBILITY, attentionCount, visibilityOf } from '../../utils/leaguePanel.js';
import { initials } from '../../utils/matchDisplay.js';
import { Status } from '../admin/AdminKit.jsx';
import {
  IconBack, IconLeague, IconMoney, IconOverview, IconPin, IconProfile, IconShield, IconUsers,
} from '../admin/AdminIcons.jsx';
import '../admin/admin.css';
import './league.css';

// El cascarón del panel de una liga: la barra lateral con la liga y sus
// secciones, y el lugar de la sección. Se arma con las piezas del Panel Admin
// (components/admin/), que ya resolvieron cómo se ve una herramienta y no una
// página: README, "El panel de una liga".
//
// Cada sección declara QUÉ PERMISO hace falta para que exista, y basta con uno de
// la lista. Esconder no es proteger: el backend vuelve a decidir en cada
// petición. Lo que esto evita es enseñar una puerta que va a contestar 403.
export const LEAGUE_SECTIONS = [
  { key: 'resumen',  label: 'Resumen',  icon: IconOverview, permisos: ['ver'] },
  { key: 'torneos',  label: 'Torneos',  icon: IconLeague,   permisos: ['estructura'] },
  { key: 'equipos',  label: 'Equipos',  icon: IconShield,   permisos: ['estructura'] },
  { key: 'sedes',    label: 'Sedes',    icon: IconPin,      permisos: ['estructura'] },
  // Cobranza tiene su propia ruta desde antes (/panel/liga/:id/cobranza) y la
  // conserva: viaja en los avisos de la bandeja.
  { key: 'cobranza', label: 'Cobranza', icon: IconMoney,    permisos: ['cobranza_liga'] },
  // "Staff" como en el panel de un equipo: ahí están todos los roles, no solo
  // quien administra.
  { key: 'staff',    label: 'Staff',    icon: IconUsers,    permisos: ['miembros'] },
  { key: 'perfil',   label: 'Perfil',   icon: IconProfile,  permisos: ['perfil'] },
];

export const leagueSections = (league) => LEAGUE_SECTIONS.filter((s) => puedeAlguno(league, ...s.permisos));

// La sección vive en `?seccion=` y no en la ruta, igual que en /admin: el
// ErrorBoundary de App.jsx lleva `key={location.pathname}`, y una ruta por
// sección desmontaría el panel —y su árbol— en cada clic.
export function sectionHref(leagueId, key) {
  if (key === 'cobranza') return `/panel/liga/${leagueId}/cobranza`;
  if (key === 'resumen') return `/panel/liga/${leagueId}/estructura`;
  return `/panel/liga/${leagueId}/estructura?seccion=${key}`;
}

// `tree` es el árbol que ya pidió la página. La de Cobranza no lo pide para
// nada suyo, así que el cascarón lo trae por su cuenta para el aviso de la
// barra: sin eso, "Torneos" perdía su número al pasar a Cobranza.
export default function LeagueWorkspace({ league, tree, section, children }) {
  const { token } = useAuth();
  const [ownTree, setOwnTree] = useState(null);
  const needsOwnTree = tree === undefined && puede(league, 'estructura');

  useEffect(() => {
    if (!needsOwnTree || !token) return undefined;
    let alive = true;
    api.getLeagueTree(league.id, token)
      .then((t) => { if (alive) setOwnTree(t); })
      .catch(() => { /* el aviso de la barra puede esperar */ });
    return () => { alive = false; };
  }, [needsOwnTree, league.id, token]);

  return (
    <div className="adm lws">
      <LeagueRail league={league} tree={tree ?? ownTree} section={section} />
      <div className="adm-main">{children}</div>
    </div>
  );
}

// El escudo de la liga sobre una placa neutra: el logo manda, el fondo no compite.
export function LeagueMark({ league, size = 'md' }) {
  return league.logo_url ? (
    <img className={`lws-mark is-${size}`} src={league.logo_url} alt="" />
  ) : (
    <span className={`lws-mark is-${size} is-initials`} aria-hidden="true">{initials(league.name) || '–'}</span>
  );
}

// En el teléfono la barra pierde la liga y queda en pestañas: el nombre pasa al
// renglón chico de arriba de cada sección (ver `.lws-eyebrow-league`).
export function LeagueEyebrow({ league, children }) {
  return (
    <>
      <span className="lws-eyebrow-league">{league.name}</span>
      {children && <span className="lws-eyebrow-path">{children}</span>}
    </>
  );
}

function LeagueRail({ league, tree, section }) {
  const current = useRef(null);

  // En el teléfono la barra se desliza de lado: la sección elegida se trae a la
  // vista para que nunca quede escondida a la derecha.
  useEffect(() => {
    if (window.matchMedia('(max-width: 900px)').matches) {
      current.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }, [section]);

  const pending = tree ? attentionCount(tree) : 0;
  const visibility = visibilityOf(tree?.league);
  const role = etiquetaDeMiRol(league);

  return (
    <aside className="adm-rail">
      <div className="adm-rail-inner">
        <Link to="/panel" className="lws-back">
          <IconBack />
          <span>Mi panel</span>
        </Link>

        <div className="lws-id">
          <LeagueMark league={league} />
          <div className="lws-id-text">
            <strong title={league.name}>{league.name}</strong>
            {role && <span>{role}</span>}
          </div>
        </div>
        {visibility && (
          <div className="lws-id-status">
            <Status tone={VISIBILITY[visibility].tone}>{VISIBILITY[visibility].label}</Status>
          </div>
        )}

        <nav className="adm-nav" aria-label="Secciones de la liga">
          {leagueSections(league).map(({ key, label, icon: Icon }) => (
            <Link
              key={key}
              ref={key === section ? current : null}
              to={sectionHref(league.id, key)}
              aria-current={key === section ? 'page' : undefined}
            >
              <Icon />
              <span>{label}</span>
              {key === 'torneos' && pending > 0 && (
                <span className="adm-nav-badge" aria-label={`${pending} por atender`}>
                  {formatNumber(pending)}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </div>
    </aside>
  );
}
