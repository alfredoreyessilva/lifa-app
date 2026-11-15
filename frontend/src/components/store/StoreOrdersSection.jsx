import { Band, FilterScoreboard, NoResults, SectionError, SectionLoading, Status, useSectionFilter } from '../admin/AdminKit.jsx';
import { countFilters, pluralize } from '../../utils/adminPanel.js';
import { catalogPrice } from '../../utils/money.js';
import { ENTREGAS, ESTADOS, ORDER_FILTERS, etiquetaDelEstado } from '../../utils/compras.js';
import { StoreEyebrow } from './StoreWorkspace.jsx';

// Los pedidos de la tienda (README, "Compras en la vitrina" → "El panel de la
// tienda"): el marcador filtra la tabla, y "Por preparar" va en amarillo porque es
// lo que le toca. Cada fila abre su ventana, con quién compró, qué, cómo se entrega
// y el siguiente paso. Con las compras apagadas la sección sigue si ya hay pedidos:
// son ventas pagadas.
const MX = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' };
const TONO = { wait: 'ask', ok: 'on', off: 'off', bad: 'bad' };

export default function StoreOrdersSection({ store, orders, ordersError, sales, setModal }) {
  const [filter, setFilter] = useSectionFilter(ORDER_FILTERS, 'todos');
  const rows = orders || [];
  const active = ORDER_FILTERS.find((f) => f.key === filter) ?? ORDER_FILTERS[0];
  const visibles = rows.filter(active.test);
  const apagadas = sales && sales.enabled === false;

  return (
    <>
      <Band title="Pedidos" eyebrow={<StoreEyebrow store={store} />}>
        <FilterScoreboard
          label="Filtrar pedidos"
          filters={countFilters(ORDER_FILTERS, rows, filter)}
          active={filter}
          onChange={setFilter}
          loading={!orders}
        />
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[ordersError]} />
        {apagadas && (
          <p className="adm-note sws-orders-off">
            Las compras están apagadas en CFBAMX: nadie puede hacer pedidos nuevos, pero los que ya tienes se atienden aquí.
          </p>
        )}

        {!orders ? !ordersError && <SectionLoading /> : rows.length === 0 ? (
          <div className="adm-no-results">
            <p>
              Todavía no tienes pedidos. Cuando alguien compre en tu vitrina, aquí sale con su nombre, su WhatsApp, lo que
              compró y cómo lo quiere recibir; Mercado Pago, además, te avisa de cada pago.
            </p>
          </div>
        ) : visibles.length === 0 ? (
          <NoResults onClear={() => setFilter('todos')}>Ningún pedido está en ese estado.</NoResults>
        ) : (
          <div className="adm-table-box">
            <div className="table-wrap">
              <table className="data-table adm-table sws-orders">
                <caption className="adm-sr-only">Pedidos de la tienda</caption>
                <thead>
                  <tr>
                    <th style={{ width: 120 }}>Pedido</th>
                    <th>Quién y qué</th>
                    <th className="sws-col-delivery" style={{ width: 170 }}>Entrega</th>
                    <th className="adm-num" style={{ width: 110 }}>Total</th>
                    <th style={{ width: 190 }}>Estado</th>
                    <th className="col-actions" style={{ width: 80 }}><span className="adm-sr-only">Acciones</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((o) => (
                    <tr key={o.id} className={o.status === 'paid' ? 'is-attention' : undefined}>
                      <td>
                        <strong className="sws-order-id">{o.id}</strong>
                        <span className="adm-faint sws-order-when">{new Date(o.created_at).toLocaleString('es-MX', MX)}</span>
                      </td>
                      <td>
                        <span className="sws-order-who">{o.buyer_name}</span>
                        <span className="adm-faint sws-order-what" title={o.first_item}>
                          {o.first_item}{o.pieces > 1 ? ` · ${pluralize(o.pieces, 'pieza')}` : ''}
                        </span>
                      </td>
                      <td className="sws-col-delivery">
                        {ENTREGAS[o.delivery_method]?.short}
                        {o.delivery_method === 'match' && o.match_date && (
                          <span className="adm-faint sws-order-when">
                            {new Date(o.match_date).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'America/Mexico_City' })}
                          </span>
                        )}
                      </td>
                      <td className="adm-num">{catalogPrice(o.total)}</td>
                      <td>
                        <span className="adm-state">
                          <Status tone={TONO[ESTADOS[o.status]?.tone] ?? 'off'}>{etiquetaDelEstado(o.status, o.delivery_method)}</Status>
                          {o.stock_short && <span className="sws-order-flag">Sin existencias</span>}
                          {o.extra_payments > 0 && <span className="sws-order-flag">Pago repetido</span>}
                        </span>
                      </td>
                      <td className="col-actions">
                        <button type="button" className="btn btn-ws btn-sm" onClick={() => setModal({ type: 'order', orderId: o.id })}>
                          Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="adm-table-foot">
              <span>{pluralize(visibles.length, 'pedido')}</span>
            </footer>
          </div>
        )}
      </div>
    </>
  );
}
