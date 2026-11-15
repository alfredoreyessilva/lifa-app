import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import OrgAdminsPanel from '../components/OrgAdminsPanel.jsx';
import StoreWorkspace, { StoreEyebrow, storeSections } from '../components/store/StoreWorkspace.jsx';
import StoreOverviewSection from '../components/store/StoreOverviewSection.jsx';
import StoreProductsSection from '../components/store/StoreProductsSection.jsx';
import StoreProfileSection from '../components/store/StoreProfileSection.jsx';
import StorePrizesSection from '../components/store/StorePrizesSection.jsx';
import StoreOrdersSection from '../components/store/StoreOrdersSection.jsx';
import StoreSalesSection from '../components/store/StoreSalesSection.jsx';
import { OrderModal, StandModal } from '../components/store/StoreSalesModals.jsx';
import StoreModal from '../components/store/StoreModals.jsx';
import { Band } from '../components/admin/AdminKit.jsx';
import { organizationHref } from '../utils/dashboard.js';
import { puedeAlguno } from '../utils/permisos.js';

// El panel de una tienda. Ruta: /panel/tienda/:id
//
// Una herramienta con secciones —Resumen, Productos, Premios (solo con el
// interruptor de los premios prendido), Perfil y Staff— en vez del
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
  // Premios por acertar (README, "Premios por acertar"): la sección existe solo
  // con el interruptor del backend prendido, y para quien tiene el permiso.
  const [prizesOn, setPrizesOn] = useState(null);
  const [prizes, setPrizes] = useState(null);
  const [prizesError, setPrizesError] = useState('');
  const [canAward, setCanAward] = useState(null);
  const canPrize = Boolean(store) && puedeAlguno(store, 'premios');

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

  useEffect(() => {
    let vigente = true;
    api.getPrizesStatus()
      .then((s) => { if (vigente) setPrizesOn(Boolean(s.enabled)); })
      .catch(() => { if (vigente) setPrizesOn(false); });
    return () => { vigente = false; };
  }, []);

  // `can_award` lo decide el backend: publicada y verificada.
  const loadPrizes = useCallback(() => api.getStorePrizes(id, token)
    .then((data) => { setPrizes(data.prizes); setCanAward(data.can_award === true); setPrizesError(''); })
    .catch((e) => setPrizesError(`No se pudieron cargar tus premios: ${e.message}`)), [id, token]);

  useEffect(() => {
    setPrizes(null);
    setCanAward(null);
    if (!token || !isStore || prizesOn !== true || !canPrize) return;
    loadPrizes();
  }, [token, isStore, prizesOn, canPrize, loadPrizes]);

  // Las compras en la vitrina (README, "Compras en la vitrina"): lo de vender y los
  // pedidos, para quien tiene el permiso. Pedidos sale también con las compras
  // apagadas si la tienda ya tiene pedidos: son ventas pagadas.
  const canSell = Boolean(store) && puedeAlguno(store, 'pedidos');
  const [sales, setSales] = useState(null);
  const [salesError, setSalesError] = useState('');
  const [orders, setOrders] = useState(null);
  const [ordersError, setOrdersError] = useState('');

  const loadSales = useCallback(() => api.getStoreSales(id, token)
    .then((data) => { setSales(data); setSalesError(''); })
    .catch((e) => setSalesError(`No se pudo cargar cómo vende tu tienda: ${e.message}`)), [id, token]);

  const loadOrders = useCallback(() => api.getStoreOrders(id, token)
    .then((data) => { setOrders(data.orders); setOrdersError(''); })
    .catch((e) => setOrdersError(`No se pudieron cargar tus pedidos: ${e.message}`)), [id, token]);

  useEffect(() => {
    setSales(null);
    if (!token || !isStore || !canSell) return;
    loadSales();
  }, [token, isStore, canSell, loadSales]);

  const pedidosVisibles = sales?.enabled === true || (sales?.orders_count ?? 0) > 0;
  useEffect(() => {
    setOrders(null);
    if (!token || !isStore || !canSell || !pedidosVisibles) return;
    loadOrders();
  }, [token, isStore, canSell, pedidosVisibles, loadOrders]);

  const encendidos = { premios: prizesOn === true, compras: sales?.enabled === true, pedidos: pedidosVisibles };
  const sections = store ? storeSections(store, encendidos) : [];
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

  const porPreparar = (orders || []).filter((o) => o.status === 'paid').length || (sales?.to_prepare ?? 0);

  return (
    <StoreWorkspace store={store} org={org} products={products} section={section} encendidos={encendidos} porPreparar={porPreparar}>
      {section === 'resumen' && <StoreOverviewSection {...shared} sales={sales} porPreparar={porPreparar} />}
      {section === 'productos' && <StoreProductsSection {...shared} />}
      {section === 'pedidos' && (
        <StoreOrdersSection {...shared} orders={orders} ordersError={ordersError} sales={sales} />
      )}
      {section === 'cobro' && (
        <StoreSalesSection {...shared} sales={sales} salesError={salesError} loadSales={loadSales} />
      )}
      {section === 'premios' && (
        <StorePrizesSection
          {...shared}
          prizes={prizes}
          prizesError={prizesError}
          canAward={canAward}
          loadPrizes={loadPrizes}
        />
      )}
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

      {modal?.type === 'order' && (
        <OrderModal
          store={org ? { ...store, name: org.name } : store}
          orderId={modal.orderId}
          token={token}
          onClose={() => setModal(null)}
          onChanged={() => { loadOrders(); loadSales(); }}
        />
      )}
      {modal?.type === 'stand' && (
        <StandModal
          store={store}
          token={token}
          onClose={() => setModal(null)}
          onSaved={async () => { await loadSales(); setModal(null); }}
        />
      )}
      {modal && !['order', 'stand'].includes(modal.type) && (
        <StoreModal
          modal={modal}
          store={store}
          org={org}
          products={products}
          token={token}
          onClose={() => setModal(null)}
          onProductsChanged={loadProducts}
          onPrizesChanged={loadPrizes}
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
