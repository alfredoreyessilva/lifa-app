import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import OrgAdminsPanel from '../components/OrgAdminsPanel.jsx';
import StoreWorkspace, { StoreEyebrow, storeSections } from '../components/store/StoreWorkspace.jsx';
import StoreOverviewSection from '../components/store/StoreOverviewSection.jsx';
import StoreProductsSection from '../components/store/StoreProductsSection.jsx';
import StoreProfileSection from '../components/store/StoreProfileSection.jsx';
import StoreModal from '../components/store/StoreModals.jsx';
import { Band } from '../components/admin/AdminKit.jsx';
import { organizationHref } from '../utils/dashboard.js';

// El panel de una tienda. Ruta: /panel/tienda/:id
//
// Una herramienta con secciones —Resumen, Productos, Perfil y Staff— en vez del
// formulario de "Editar organización" y la página aparte de "Inventario" que
// había hasta el 2026-11-08 (README, "El panel de una tienda"). La página pide la
// tienda y su inventario una vez y los reparte; cada acción abre su ventana aquí
// mismo y, al terminar, se vuelve a pedir solo lo que cambió, sin borrar lo
// anterior, para que nada parpadee.
//
// La sección va en `?seccion=` y el filtro de Productos en `?filtro=`, como en el
// panel de una liga: el ErrorBoundary de App.jsx lleva `key={location.pathname}`,
// y una ruta por sección desmontaría el panel en cada clic.
export default function StorePanel() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { token, organizations, refreshLeagues } = useAuth();
  // La tienda como la manda /auth/me: con tu rol y lo que puedes hacer.
  const store = (organizations || []).find((o) => String(o.id) === id);
  const isStore = store?.type === 'store';

  const [org, setOrg] = useState(null);
  const [orgError, setOrgError] = useState('');
  const [products, setProducts] = useState(null);
  const [productsError, setProductsError] = useState('');
  const [modal, setModal] = useState(null);

  // Con la sesión: una tienda privada no existe para el público (404), y el
  // inventario de gestión trae también lo inactivo.
  const loadOrg = useCallback(() => api.getOrganization(id, token)
    .then((data) => { setOrg(data); setOrgError(''); })
    .catch((e) => setOrgError(`No se pudo cargar tu tienda: ${e.message}`)), [id, token]);

  const loadProducts = useCallback(() => api.getManagedProducts(id, token)
    .then((data) => { setProducts(data.products); setProductsError(''); })
    .catch((e) => setProductsError(`No se pudo cargar tu inventario: ${e.message}`)), [id, token]);

  useEffect(() => {
    setOrg(null);
    setProducts(null);
    if (!token || !isStore) return;
    loadOrg();
    loadProducts();
  }, [token, isStore, loadOrg, loadProducts]);

  const sections = store ? storeSections(store) : [];
  const requested = params.get('seccion');
  const section = sections.some((s) => s.key === requested) ? requested : 'resumen';

  // App.jsx sube al inicio solo cuando cambia la ruta, y aquí cambia la búsqueda.
  useEffect(() => { window.scrollTo(0, 0); }, [section]);

  if (!store) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No administras ninguna tienda con ese id</h3>
          <Link to="/panel" className="btn btn-outline" style={{ marginTop: 16 }}>Volver a mi panel</Link>
        </div>
      </div>
    );
  }
  // Un medio tiene su panel; una clínica o una marca siguen con su formulario. La
  // organización de una liga o un equipo no se edita por aquí: su panel es otro.
  if (!isStore) {
    const destino = ['league', 'team'].includes(store.type) ? '/panel' : organizationHref(store);
    return <Navigate to={destino} replace />;
  }

  const shared = { store, org, products, orgError, productsError, setModal, token, loadProducts };

  return (
    <StoreWorkspace store={store} org={org} products={products} section={section}>
      {section === 'resumen' && <StoreOverviewSection {...shared} />}
      {section === 'productos' && <StoreProductsSection {...shared} />}
      {section === 'perfil' && <StoreProfileSection {...shared} />}
      {section === 'staff' && (
        <>
          <Band title="Staff" eyebrow={<StoreEyebrow store={store} />} />
          <div className="adm-canvas">
            <OrgAdminsPanel
              organizationId={store.id}
              organizationName={org?.name ?? store.name}
              organizationType="store"
              entidad={store}
              token={token}
              siempreAbierto
            />
          </div>
        </>
      )}

      {modal && (
        <StoreModal
          modal={modal}
          store={store}
          org={org}
          token={token}
          onClose={() => setModal(null)}
          onProductsChanged={loadProducts}
          // El nombre y el logo también viven en la sesión: la barra de esta
          // página, Mi panel y la barra de arriba los leen de ahí.
          onProfileSaved={(saved) => {
            setOrg(saved);
            refreshLeagues().catch(() => { /* lo de la sesión puede esperar a la próxima vuelta */ });
          }}
        />
      )}
    </StoreWorkspace>
  );
}
