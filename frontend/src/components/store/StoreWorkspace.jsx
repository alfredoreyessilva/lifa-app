import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { etiquetaDeMiRol, puedeAlguno } from '../../utils/permisos.js';
import { formatNumber } from '../../utils/adminPanel.js';
import { initials } from '../../utils/matchDisplay.js';
import { imagenAjustada } from '../../utils/imagenes.js';
import { storeHref, storeTotals } from '../../utils/storePanel.js';
import { Status } from '../admin/AdminKit.jsx';
import { IconBack, IconGift, IconOverview, IconProfile, IconTag, IconUsers } from '../admin/AdminIcons.jsx';
import '../admin/admin.css';
import '../league/league.css';
import './store.css';

// El cascarón del panel de una tienda: la barra lateral con la tienda y sus
// secciones, y el lugar de la sección. Es el panel de una liga con la tienda
// adentro (README, "El panel de una tienda"): las piezas son las del Panel Admin
// (components/admin/), y la barra y la piel de Staff, las de la liga
// (`.lws`, components/league/league.css). Lo que es solo de la tienda va en
// store.css (`.sws`).
//
// Cada sección declara QUÉ PERMISO hace falta para que exista. Esconder no es
// proteger: el backend vuelve a decidir en cada petición. Hoy una tienda tiene
// dos roles, dueño y administrador, y los dos ven las cinco.
//
// Premios además necesita el interruptor (README, "Premios por acertar"): con los
// premios apagados en Panel Admin → Premios la sección no existe, y sus rutas
// contestan 404.
export const STORE_SECTIONS = [
  { key: 'resumen',   label: 'Resumen',   icon: IconOverview, permisos: ['ver'] },
  // El inventario lo maneja cualquier miembro (`isOrgMember`, routes/products.js).
  { key: 'productos', label: 'Productos', icon: IconTag,      permisos: ['ver'] },
  { key: 'premios',   label: 'Premios',   icon: IconGift,     permisos: ['premios'], interruptor: 'premios' },
  { key: 'perfil',    label: 'Perfil',    icon: IconProfile,  permisos: ['perfil'] },
  { key: 'staff',     label: 'Staff',     icon: IconUsers,    permisos: ['miembros'] },
];

// `encendidos` dice qué interruptores están prendidos: `{ premios: true }`.
// Mientras no se sabe, la sección no sale, y aparece sin recargar en cuanto
// llega la respuesta.
export const storeSections = (store, encendidos = {}) => STORE_SECTIONS.filter((s) => (
  puedeAlguno(store, ...s.permisos) && (!s.interruptor || encendidos[s.interruptor] === true)
));

// `store` es la tienda como la manda /auth/me (con tu rol y tus permisos), y
// `org` la fila completa de GET /organizations/:id, que llega después: mientras
// tanto, la barra usa el nombre y el logo de la sesión, y no brinca.
export default function StoreWorkspace({ store, org, products, section, encendidos, children }) {
  return (
    <div className="adm lws sws">
      <StoreRail store={store} org={org} products={products} section={section} encendidos={encendidos} />
      <div className="adm-main">{children}</div>
    </div>
  );
}

// El logo entero sobre una placa blanca, como en la vitrina: los logos de una
// tienda suelen ser un PNG pensado para fondo claro, y sobre el verde noche uno
// oscuro se perdía.
export function StoreMark({ store, size = 'md' }) {
  return store.logo_url ? (
    <img className={`lws-mark sws-mark is-${size}`} src={imagenAjustada(store.logo_url, 160)} alt="" />
  ) : (
    <span className={`lws-mark sws-mark is-${size} is-initials`} aria-hidden="true">{initials(store.name) || '–'}</span>
  );
}

// En el teléfono la barra pierde la tienda y queda en pestañas: el nombre pasa al
// renglón chico de arriba de cada sección, como en el panel de una liga.
export function StoreEyebrow({ store }) {
  return <span className="lws-eyebrow-league">{store.name}</span>;
}

function StoreRail({ store, org, products, section, encendidos }) {
  const current = useRef(null);
  const shown = org ? { ...store, name: org.name, logo_url: org.logo_url, is_public: org.is_public } : store;

  // En el teléfono la barra se desliza de lado: la sección elegida se trae a la
  // vista para que nunca quede escondida a la derecha.
  useEffect(() => {
    if (window.matchMedia('(max-width: 900px)').matches) {
      current.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }, [section]);

  const pending = products ? storeTotals(products).attention : 0;
  const role = etiquetaDeMiRol(store);

  return (
    <aside className="adm-rail">
      <div className="adm-rail-inner">
        <Link to="/panel" className="lws-back">
          <IconBack />
          <span>Mi panel</span>
        </Link>

        <div className="lws-id">
          <StoreMark store={shown} />
          <div className="lws-id-text">
            <strong title={shown.name}>{shown.name}</strong>
            <span>{role ? `Tienda · ${role}` : 'Tienda'}</span>
          </div>
        </div>
        <div className="lws-id-status">
          {shown.is_public
            ? <Status tone="on">Pública</Status>
            : <Status>Privada</Status>}
        </div>

        <nav className="adm-nav" aria-label="Secciones de la tienda">
          {storeSections(store, encendidos).map(({ key, label, icon: Icon }) => (
            <Link
              key={key}
              ref={key === section ? current : null}
              to={storeHref(store.id, key)}
              aria-current={key === section ? 'page' : undefined}
            >
              <Icon />
              <span>{label}</span>
              {key === 'productos' && pending > 0 && (
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
