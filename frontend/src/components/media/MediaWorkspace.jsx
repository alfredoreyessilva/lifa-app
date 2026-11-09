import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { etiquetaDeMiRol, puedeAlguno } from '../../utils/permisos.js';
import { formatNumber } from '../../utils/adminPanel.js';
import { initials } from '../../utils/matchDisplay.js';
import { imagenAjustada } from '../../utils/imagenes.js';
import { broadcastGate, mediaHref, pendingLinks } from '../../utils/mediaPanel.js';
import { Status } from '../admin/AdminKit.jsx';
import {
  IconBack, IconBroadcast, IconCalendar, IconOverview, IconProfile, IconUsers,
} from '../admin/AdminIcons.jsx';
import '../admin/admin.css';
import '../league/league.css';
import './media.css';

// El cascarón del panel de un medio: la barra lateral con el medio y sus
// secciones, y el lugar de la sección. Es el panel de una tienda con el medio
// adentro (README, "El panel de un medio"): las piezas son las del Panel Admin
// (components/admin/), y la barra y la piel de Staff, las de la liga (`.lws`,
// components/league/league.css). Lo que es solo del medio va en media.css
// (`.mws`).
//
// Cada sección declara QUÉ PERMISO hace falta para que exista. Esconder no es
// proteger: el backend vuelve a decidir en cada petición. Un medio tiene dos
// roles, dueño y administrador, y los dos ven las cinco; sumarse a un partido
// lo puede cualquier miembro (`isOrgMember`, routes/broadcasts.js).
export const MEDIA_SECTIONS = [
  { key: 'resumen',       label: 'Resumen',       icon: IconOverview,  permisos: ['ver'] },
  { key: 'transmisiones', label: 'Transmisiones', icon: IconBroadcast, permisos: ['ver'] },
  { key: 'partidos',      label: 'Partidos',      icon: IconCalendar,  permisos: ['ver'] },
  { key: 'perfil',        label: 'Perfil',        icon: IconProfile,   permisos: ['perfil'] },
  { key: 'staff',         label: 'Staff',         icon: IconUsers,     permisos: ['miembros'] },
];

export const mediaSections = (media) => MEDIA_SECTIONS.filter((s) => puedeAlguno(media, ...s.permisos));

// `media` es el medio como lo manda /auth/me (con tu rol y tus permisos), y `org`
// la fila de GET /organizations/:id, que llega después: mientras tanto, la barra
// usa el nombre, el logo y los dos interruptores de la sesión, y no brinca.
export default function MediaWorkspace({ media, org, broadcasts, section, children }) {
  return (
    <div className="adm lws mws">
      <MediaRail media={media} org={org} broadcasts={broadcasts} section={section} />
      <div className="adm-main">{children}</div>
    </div>
  );
}

// El logo sobre la placa neutra de la liga: los de un medio vienen para fondo
// claro y para fondo oscuro, y la placa no le gana a ninguno.
export function MediaMark({ media, size = 'md' }) {
  return media.logo_url ? (
    <img className={`lws-mark is-${size}`} src={imagenAjustada(media.logo_url, 160)} alt="" />
  ) : (
    <span className={`lws-mark is-${size} is-initials`} aria-hidden="true">{initials(media.name) || '–'}</span>
  );
}

// En el teléfono la barra pierde al medio y queda en pestañas: el nombre pasa al
// renglón chico de arriba de cada sección, como en el panel de una liga.
export function MediaEyebrow({ media }) {
  return <span className="lws-eyebrow-league">{media.name}</span>;
}

// Lo que el medio es en este momento, con lo más fresco que haya.
export const shownMedia = (media, org) => (org
  ? { ...media, name: org.name, logo_url: org.logo_url, is_public: org.is_public, is_verified: org.is_verified }
  : media);

function MediaRail({ media, org, broadcasts, section }) {
  const current = useRef(null);
  const shown = shownMedia(media, org);

  // En el teléfono la barra se desliza de lado: la sección elegida se trae a la
  // vista para que nunca quede escondida a la derecha.
  useEffect(() => {
    if (window.matchMedia('(max-width: 900px)').matches) {
      current.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }, [section]);

  const pending = pendingLinks(shown, broadcasts);
  const role = etiquetaDeMiRol(media);
  const gate = broadcastGate(shown);

  return (
    <aside className="adm-rail">
      <div className="adm-rail-inner">
        <Link to="/panel" className="lws-back">
          <IconBack />
          <span>Mi panel</span>
        </Link>

        <div className="lws-id">
          <MediaMark media={shown} />
          <div className="lws-id-text">
            <strong title={shown.name}>{shown.name}</strong>
            <span>{role ? `Medio · ${role}` : 'Medio'}</span>
          </div>
        </div>
        <div className="lws-id-status">
          <Status tone={gate.tone} title={gate.sub}>{gate.on ? 'Puede transmitir' : 'Todavía no transmite'}</Status>
        </div>

        <nav className="adm-nav" aria-label="Secciones del medio">
          {mediaSections(media).map(({ key, label, icon: Icon }) => (
            <Link
              key={key}
              ref={key === section ? current : null}
              to={mediaHref(media.id, key)}
              aria-current={key === section ? 'page' : undefined}
            >
              <Icon />
              <span>{label}</span>
              {key === 'transmisiones' && pending > 0 && (
                <span className="adm-nav-badge" aria-label={`${pending} sin link`}>
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
