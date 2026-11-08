import { Link } from 'react-router-dom';
import {
  Band, ScoreCell, Scoreboard, SectionError, SectionLoading, Status,
} from '../admin/AdminKit.jsx';
import { IconChevronRight } from '../admin/AdminIcons.jsx';
import { formatNumber, pluralize } from '../../utils/adminPanel.js';
import { catalogPrice } from '../../utils/money.js';
import { imagenAjustada } from '../../utils/imagenes.js';
import {
  inShowcase, isActive, recentlyChanged, showcaseLead, stockOf, storeAttention, storeHref, storeTotals, whatsappStatus,
} from '../../utils/storePanel.js';
import { StoreEyebrow } from './StoreWorkspace.jsx';
import { ProductPrice, ProductStock, ProductThumb } from './StoreProductBits.jsx';

// La primera pantalla del panel de una tienda contesta, en este orden: qué te
// toca resolver, qué moviste al último y qué ve el público. Es lo que abre quien
// acaba de vender la última talla M: el producto está a un clic de aquí.
export default function StoreOverviewSection({ store, org, products, orgError, productsError, setModal }) {
  const totals = products ? storeTotals(products) : null;
  const ready = Boolean(org && products);
  const isPublic = org ? org.is_public : store.is_public;

  return (
    <>
      <Band
        title="Resumen"
        eyebrow={<StoreEyebrow store={store} />}
        actions={(
          <button type="button" className="btn btn-flag btn-sm" onClick={() => setModal({ type: 'product' })}>
            + Producto
          </button>
        )}
      >
        <Scoreboard label="La tienda en cifras">
          <ScoreCell
            label="En venta"
            value={formatNumber(totals?.active)}
            sub={totals?.inactive ? `de ${pluralize(totals.total, 'producto')}` : null}
            loading={!totals}
          />
          <ScoreCell
            label="En tu vitrina"
            value={formatNumber(totals?.showcase)}
            sub={totals?.hidden ? `${formatNumber(totals.hidden)} ${totals.hidden === 1 ? 'oculto' : 'ocultos'}` : null}
            loading={!totals}
          />
          <ScoreCell
            label="Existencias"
            value={totals?.tracked ? formatNumber(totals.pieces) : '—'}
            sub={totals ? piecesLine(totals) : null}
            loading={!totals}
          />
          <ScoreCell
            label="Agotados"
            value={formatNumber(totals?.soldOut)}
            attention={totals?.soldOut > 0}
            loading={!totals}
          />
          <ScoreCell
            label="En el sitio"
            small
            value={isPublic ? <Status tone="on">Pública</Status> : <Status>Privada</Status>}
          />
        </Scoreboard>
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[orgError, productsError]} />

        {!ready ? !(orgError || productsError) && <SectionLoading /> : (
          <>
            <Attention items={storeAttention(org, products)} />

            {products.length === 0 ? (
              <div className="adm-no-results">
                <p>
                  Tu inventario está vacío. Lo que cargues aquí es lo que ve el público en tu vitrina, con su foto,
                  su precio y sus tallas.
                </p>
                <button type="button" className="btn btn-flag btn-sm" onClick={() => setModal({ type: 'product' })}>
                  + Agregar el primero
                </button>
              </div>
            ) : (
              <div className="adm-board sws-board">
                <section className="adm-cell">
                  <h2>Lo más reciente</h2>
                  <p className="adm-cell-sub">Los productos que se cambiaron al último</p>
                  <ul className="sws-feed">
                    {recentlyChanged(products, 5).map((p) => (
                      <li key={p.id} className="sws-feed-row">
                        <ProductThumb product={p} />
                        <span className="sws-feed-main">
                          <span className="sws-feed-name" title={p.name}>{p.name}</span>
                          <span className="sws-feed-meta">
                            <ProductPrice product={p} />
                            <span aria-hidden="true">·</span>
                            <ProductStock product={p} />
                            {!isActive(p) && <><span aria-hidden="true">·</span><span className="adm-faint">Inactivo</span></>}
                            {isActive(p) && !inShowcase(p) && <><span aria-hidden="true">·</span><span className="adm-faint">Oculto</span></>}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="btn btn-ws btn-sm"
                          onClick={() => setModal({ type: 'product', product: p })}
                          aria-label={`Editar ${p.name}`}
                        >
                          Editar
                        </button>
                      </li>
                    ))}
                  </ul>
                  <Link to={storeHref(store.id, 'productos')} className="sws-more">
                    {products.length === 1 ? 'Ver el producto' : `Ver los ${formatNumber(products.length)} productos`}
                    <IconChevronRight />
                  </Link>
                </section>

                <Showcase store={store} org={org} products={products} totals={totals} />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function piecesLine(totals) {
  if (!totals.tracked) return totals.active ? 'Sin registrar' : null;
  const word = totals.pieces === 1 ? 'pieza' : 'piezas';
  return totals.untracked ? `${word} · ${formatNumber(totals.untracked)} sin registrar` : word;
}

function Attention({ items }) {
  if (items.length === 0) return null;
  return (
    <section className="adm-attention" aria-label="Lo que te toca">
      {items.map((item) => (
        <Link key={item.key} to={item.to} className="adm-attention-row is-ask">
          <span className="adm-status-dot" aria-hidden="true" />
          <span className="adm-attention-text">
            {item.text}
            {item.where && <span className="lws-attention-where">{item.where}</span>}
          </span>
          <span className="adm-attention-go">Revisar <IconChevronRight /></span>
        </Link>
      ))}
    </section>
  );
}

// Lo primero que ve quien abre la vitrina, en chico y en su blanco: las fotos de
// los primeros productos, en el orden en que salen allá.
function Showcase({ store, org, products, totals }) {
  const lead = showcaseLead(products, 4);
  const whatsapp = whatsappStatus(org);
  return (
    <section className="adm-cell">
      <h2>Tu vitrina</h2>
      <p className="adm-cell-sub">Lo primero que ve quien abre tu tienda</p>
      {lead.length > 0 ? (
        <ul className="sws-lead" aria-label="Los primeros productos de tu vitrina">
          {lead.map((p) => {
            const precio = catalogPrice(p.price);
            const agotado = stockOf(p).kind === 'out';
            return (
              <li key={p.id} className="sws-lead-item">
                <span className="sws-lead-photo">
                  {p.image_url
                    ? <img src={imagenAjustada(p.image_url, 240)} alt="" loading="lazy" decoding="async" />
                    : <span>Sin foto</span>}
                </span>
                <span className="sws-lead-name" title={p.name}>{p.name}</span>
                <span className="sws-lead-price">
                  {precio || 'A consultar'}
                  {agotado && <span className="sws-lead-out"> · Agotado</span>}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="sws-lead-empty">
          Ningún producto sale en tu vitrina. Sale lo que está activo y marcado con «Mostrar en mi vitrina».
        </p>
      )}
      <dl className="adm-facts lws-facts">
        <div>
          <dt>A la vista</dt>
          <dd>{pluralize(totals.showcase, 'producto')}</dd>
        </div>
        <div>
          <dt>Botón de WhatsApp</dt>
          <dd title={whatsapp.sub}><Status tone={whatsapp.tone}>{whatsapp.label}</Status></dd>
        </div>
      </dl>
      <div className="sws-cell-actions">
        <Link to={`/panel/organizacion/${store.id}`} className="btn btn-ws btn-sm">Ver mi página</Link>
      </div>
    </section>
  );
}
