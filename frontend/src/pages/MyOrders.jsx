import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import { imagenAjustada } from '../utils/imagenes.js';
import { catalogPrice } from '../utils/money.js';
import { ENTREGAS, conTalla, etiquetaDelEstado, tramosDeMisPedidos } from '../utils/compras.js';

// "Mis pedidos" (/pedidos): lo que compraste en las vitrinas con tu cuenta, y los
// pedidos sin cuenta que guardaste abriendo su link (README, "Compras en la
// vitrina" → "El pedido"). Es una pantalla del aficionado, como "Mis premios": va
// en la noche de la cancha. Cada tarjeta lleva a la página de su pedido.
const MX = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Mexico_City' };

export default function MyOrders() {
  const { token } = useAuth();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return undefined;
    let vigente = true;
    api.getMyOrders(token)
      .then((d) => { if (vigente) setOrders(d.orders || []); })
      .catch((e) => {
        if (!vigente) return;
        setError(e.offline ? 'Sin conexión: no se pudieron cargar tus pedidos.' : (e.message || 'No se pudieron cargar tus pedidos.'));
        setOrders((prev) => prev ?? []);
      });
    return () => { vigente = false; };
  }, [token]);

  const tramos = tramosDeMisPedidos(orders);
  const enCurso = tramos.find((t) => t.key === 'curso')?.rows.length ?? 0;
  let indice = 0;

  return (
    <div className="container">
      <div className="nt-page pz-page">
        <header className="nt-hero">
          <span className="nt-hero-eyebrow">En las tiendas</span>
          <h1 className="nt-hero-title">Mis pedidos</h1>
          <p className="nt-hero-sub">
            {orders === null && !error && 'Buscando tus pedidos…'}
            {orders && enCurso > 0 && <><strong>{enCurso}</strong> {enCurso === 1 ? 'pedido en curso' : 'pedidos en curso'}.</>}
            {orders && orders.length > 0 && enCurso === 0 && 'Ya se entregaron o se cerraron todos. Aquí quedan.'}
            {orders && orders.length === 0 && !error && 'Todavía no tienes pedidos.'}
          </p>
        </header>

        {error && <div className="nt-aviso">{error}</div>}

        {orders && orders.length === 0 && !error && (
          <div className="nt-empty">
            <div className="nt-empty-ball" aria-hidden="true">🛍️</div>
            <h3>Sin pedidos todavía</h3>
            <ul>
              <li><span aria-hidden="true">🏪</span> Algunas tiendas venden desde su vitrina: el producto lleva «Comprar».</li>
              <li><span aria-hidden="true">💳</span> Pagas con Mercado Pago y el dinero le llega directo a la tienda.</li>
              <li><span aria-hidden="true">🔗</span> Si compraste sin cuenta, abre el link de tu pedido con tu sesión y guárdalo aquí.</li>
            </ul>
          </div>
        )}

        {tramos.map((tramo) => (
          <section key={tramo.key} className="nt-day">
            <h2 className="nt-day-title"><span>{tramo.label}</span></h2>
            <div className="nt-list pz-list">
              {tramo.rows.map((o) => (
                <OrderCard key={o.id} order={o} indice={indice++} enCurso={tramo.key === 'curso'} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function OrderCard({ order, indice, enCurso }) {
  const primero = order.items[0];
  const piezas = order.items.reduce((s, i) => s + i.quantity, 0);
  return (
    <article
      className={`nt-card ${enCurso ? 'nt-card--oro' : 'nt-card--gris'} pz-card`}
      style={{ '--nt-i': Math.min(indice, 12) }}
    >
      <span className="pz-photo" aria-hidden="true">
        {primero?.image_url ? <img src={imagenAjustada(primero.image_url, 200)} alt="" /> : '🛍️'}
      </span>
      <div className="nt-card-main">
        <div className="nt-card-top">
          <span className="nt-card-label">{etiquetaDelEstado(order.status, order.delivery_method)}</span>
          <span className="nt-card-time">{new Date(order.created_at).toLocaleDateString('es-MX', MX)}</span>
        </div>
        <h3 className="nt-card-title">Pedido {order.id} · {order.store.name}</h3>
        <p className="nt-card-body">
          {primero ? conTalla(primero.name, primero.size) : ''}
          {piezas > 1 ? ` y ${piezas - 1} ${piezas - 1 === 1 ? 'pieza más' : 'piezas más'}` : ''}
          {` · ${ENTREGAS[order.delivery_method]?.short ?? ''}`}
        </p>
        <div className="nt-card-foot">
          <span className="notification-origin">{catalogPrice(order.total)} {order.currency}</span>
          <Link to={`/pedido/${order.token}`} className={enCurso ? 'nt-card-cta' : 'nt-prize-link'}>Ver pedido →</Link>
        </div>
      </div>
    </article>
  );
}
