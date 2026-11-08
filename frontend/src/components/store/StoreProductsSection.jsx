import { useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import {
  Band, FilterScoreboard, NoResults, RowMenu, SearchBox, SectionError, SectionLoading, TableFooter,
  useSectionFilter, useTableView,
} from '../admin/AdminKit.jsx';
import { countFilters, matchesSearch } from '../../utils/adminPanel.js';
import { PRODUCT_FILTERS, inShowcase, isActive, needsAttention, sortProducts } from '../../utils/storePanel.js';
import { StoreEyebrow } from './StoreWorkspace.jsx';
import { ProductIdentity, ProductPlacement, ProductPrice, ProductStock } from './StoreProductBits.jsx';

// El inventario de la tienda: lo que el público ve en su vitrina, y lo que el
// asistente de WhatsApp va a leer para contestar (README, "Tiendas y bot de
// WhatsApp"). Las celdas del marcador filtran la tabla, como en /admin.
export default function StoreProductsSection({ store, products, productsError, setModal, token, loadProducts }) {
  const [filter, setFilter] = useSectionFilter(PRODUCT_FILTERS, 'todos');
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState('');

  const rows = useMemo(() => sortProducts(products), [products]);
  const active = PRODUCT_FILTERS.find((f) => f.key === filter);
  const view = useTableView((query) => rows
    .filter(active.test)
    .filter((p) => matchesSearch(query, [p.name, p.size_variant, p.description])), filter);

  // Activar, desactivar, sacar o meter a la vitrina: se deshace con el mismo
  // menú, así que no pide confirmación. La fila se apaga mientras tanto.
  async function change(product, patch) {
    setBusy(product.id);
    setActionError('');
    try {
      await api.updateProduct(product.id, patch, token);
      await loadProducts();
    } catch (e) {
      setActionError(`No se pudo cambiar «${product.name}»: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Band
        title="Productos"
        eyebrow={<StoreEyebrow store={store} />}
        actions={(
          <button type="button" className="btn btn-flag btn-sm" onClick={() => setModal({ type: 'product' })}>
            + Producto
          </button>
        )}
      >
        <FilterScoreboard
          label="Filtrar productos"
          filters={countFilters(PRODUCT_FILTERS, rows, filter)}
          active={filter}
          onChange={setFilter}
          loading={!products}
        />
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[productsError, actionError]} />

        {!products ? !productsError && <SectionLoading /> : (
          <>
            {/* Con el inventario vacío no hay nada que buscar. */}
            {rows.length > 0 && (
              <div className="adm-toolbar">
                <SearchBox value={view.query} onChange={view.setQuery} placeholder="Buscar por nombre, talla o descripción" />
              </div>
            )}

            {view.page.rows.length === 0 ? (
              rows.length === 0 ? (
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
                <NoResults onClear={() => { view.setQuery(''); setFilter('todos'); }}>
                  {filter === 'agotados' && !view.query
                    ? 'Ningún producto activo está agotado.'
                    : 'Ningún producto coincide con lo que buscas.'}
                </NoResults>
              )
            ) : (
              <div className="adm-table-box">
                <div className="table-wrap">
                  <table className="data-table adm-table sws-products">
                    <caption className="adm-sr-only">Productos de la tienda</caption>
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th className="sws-col-price" style={{ width: 132 }}>Precio</th>
                        <th className="sws-col-stock" style={{ width: 132 }}>Existencias</th>
                        <th style={{ width: 168 }}>Estado</th>
                        <th className="col-actions" style={{ width: 120 }}><span className="adm-sr-only">Acciones</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.page.rows.map((p) => (
                        <ProductRow
                          key={p.id}
                          product={p}
                          busy={busy === p.id}
                          onEdit={() => setModal({ type: 'product', product: p })}
                          onChange={(patch) => change(p, patch)}
                          onDelete={() => setModal({ type: 'delete-product', product: p })}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <TableFooter view={view} noun={view.page.total === 1 ? 'producto' : 'productos'} />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

// Una fila, un botón: Editar a la vista, y lo demás en "⋯", con borrar al final y
// en rojo. Lo que le toca atender —agotado, o en la vitrina sin foto— lleva el
// filo amarillo, como lo pendiente en el panel de una liga.
function ProductRow({ product: p, busy, onEdit, onChange, onDelete }) {
  const className = [busy && 'is-busy', needsAttention(p) && 'is-attention'].filter(Boolean).join(' ');
  return (
    <tr className={className || undefined}>
      <td><ProductIdentity product={p} /></td>
      <td className="sws-col-price"><ProductPrice product={p} /></td>
      <td className="sws-col-stock"><ProductStock product={p} /></td>
      <td className="sws-col-state"><ProductPlacement product={p} /></td>
      <td className="col-actions">
        <div className="adm-row-actions">
          <button type="button" className="btn btn-ws btn-sm" disabled={busy} onClick={onEdit}>Editar</button>
          <RowMenu
            label={`Más acciones de ${p.name}`}
            disabled={busy}
            items={[
              // Sacar de la vitrina solo tiene sentido en lo que se vende: un
              // producto inactivo no sale en ningún lado.
              isActive(p) && {
                label: inShowcase(p) ? 'Quitar de la vitrina' : 'Mostrar en la vitrina',
                onSelect: () => onChange({ show_on_platform: !inShowcase(p) }),
              },
              {
                label: isActive(p) ? 'Desactivar' : 'Activar',
                onSelect: () => onChange({ is_active: !isActive(p) }),
              },
              { divider: true, key: 'peligro' },
              { label: 'Borrar producto', danger: true, onSelect: onDelete },
            ]}
          />
        </div>
      </td>
    </tr>
  );
}
