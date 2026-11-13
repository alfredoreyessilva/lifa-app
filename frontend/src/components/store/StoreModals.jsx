import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import Modal from '../Modal.jsx';
import ConfirmDialog from '../ConfirmDialog.jsx';
import CharField from '../CharField.jsx';
import LogoField from '../LogoField.jsx';
import OrganizationProfileForm from '../OrganizationProfileForm.jsx';
import { PrizeCard } from '../MatchPrizes.jsx';
import { SearchBox, SectionLoading, Status } from '../admin/AdminKit.jsx';
import { MatchTime, MediaMatch } from '../media/MediaBits.jsx';
import { ProductPrice, ProductThumb } from './StoreProductBits.jsx';
import { matchesSearch } from '../../utils/adminPanel.js';
import { catalogPrice } from '../../utils/money.js';
import { imagenAjustada } from '../../utils/imagenes.js';
import { matchContext, scheduleDays } from '../../utils/mediaPanel.js';
import {
  DESCUENTO_MAXIMO, DESCUENTO_MINIMO, PREMIO_VACIO, VIGENCIAS, partidoDelPremio, payloadDePremio,
  productosParaPremiar, textoDelPremio, validarFormularioDePremio,
} from '../../utils/premios.js';
import {
  EMPTY_PRODUCT, isActive, productPayload, productToForm, validateProductForm,
} from '../../utils/storePanel.js';

// Las ventanas del panel de una tienda. Sobre el lienzo se ven con la piel oscura
// de admin.css (`body:has(.adm) .modal`), y league.css les pasa sus tokens verdes a
// los del lienzo (`body:has(.lws) .modal`), igual que en el panel de una liga.
//
// modal: { type: 'product', product? } | { type: 'delete-product', product } | { type: 'profile' }
//      | { type: 'prize' } | { type: 'withdraw-prize', prize }
export default function StoreModal({
  modal, store, org, products, token, onClose, onProductsChanged, onProfileSaved, onPrizesChanged,
}) {
  if (modal.type === 'prize') {
    return (
      <PrizeModal
        store={store}
        org={org}
        products={products}
        token={token}
        onClose={onClose}
        onSaved={async () => { await onPrizesChanged(); onClose(); }}
      />
    );
  }

  // Retirar no borra: el premio deja de salir y se queda en la base
  // (`withdrawn_at`). Se puede mientras se pueda votar; después el backend dice
  // que no, porque ya es una promesa a quien votó.
  if (modal.type === 'withdraw-prize') {
    const p = modal.prize;
    return (
      <ConfirmDialog
        title="Retirar premio"
        message={`¿Retirar «${textoDelPremio(p)}» de ${partidoDelPremio(p)}?`}
        warning="Deja de salir en la página del partido y nadie lo va a recibir. Se puede retirar mientras se pueda votar el partido; en cuanto empieza, ya no."
        confirmLabel="Retirar premio"
        danger
        onClose={onClose}
        onConfirm={async () => {
          await api.withdrawStorePrize(store.id, p.prize_id, token);
          await onPrizesChanged();
          onClose();
        }}
      />
    );
  }

  if (modal.type === 'product') {
    return (
      <ProductModal
        storeId={store.id}
        product={modal.product}
        token={token}
        onClose={onClose}
        onSaved={async () => { await onProductsChanged(); onClose(); }}
      />
    );
  }

  if (modal.type === 'delete-product') {
    const p = modal.product;
    return (
      <ConfirmDialog
        title="Borrar producto"
        message={`¿Borrar «${p.name}»? Sale de tu inventario y de tu vitrina, y no se puede deshacer.`}
        warning="Si solo dejaste de venderlo por un tiempo, mejor desactívalo: se queda guardado con su foto, su precio y sus tallas."
        confirmLabel="Borrar producto"
        danger
        onClose={onClose}
        onConfirm={async () => {
          await api.deleteProduct(p.id, token);
          await onProductsChanged();
          onClose();
        }}
      />
    );
  }

  if (modal.type === 'profile') {
    return (
      <Modal title="Editar perfil" onClose={onClose}>
        <OrganizationProfileForm
          org={org}
          token={token}
          onCancel={onClose}
          onSaved={async (saved) => { onProfileSaved(saved); onClose(); }}
        />
      </Modal>
    );
  }

  return null;
}

// Alta y edición de un producto, con la tarjeta tal como sale en la vitrina al
// lado: la tienda ve el precio, la talla y el recorte de su foto antes de
// guardar. La tarjeta usa las clases de la vitrina (`.storefront-product`), así
// que si la vitrina cambia, la vista previa cambia con ella.
function ProductModal({ storeId, product, token, onClose, onSaved }) {
  const editing = Boolean(product);
  const [form, setForm] = useState(() => (editing ? productToForm(product) : { ...EMPTY_PRODUCT }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function handleSubmit(e) {
    e.preventDefault();
    const problem = validateProductForm(form);
    if (problem) { setError(problem); return; }

    setSaving(true);
    setError('');
    try {
      const payload = productPayload(form);
      if (editing) await api.updateProduct(product.id, payload, token);
      else await api.createProduct(storeId, payload, token);
      await onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  // Un producto inactivo no sale en la vitrina aunque esté marcado: la vista
  // previa lo dice, en vez de prometer lo que no va a pasar.
  const sale = form.show_on_platform && (!editing || isActive(product));
  const currency = form.currency || 'MXN';

  return (
    <Modal title={editing ? 'Editar producto' : 'Nuevo producto'} onClose={onClose}>
      <form className="sws-product-form" onSubmit={handleSubmit} noValidate>
        <div className="sws-product-grid">
          <div className="sws-product-fields">
            <div className="field">
              <label htmlFor="sws-p-name">Nombre del producto</label>
              <CharField
                id="sws-p-name"
                max={80}
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="Jersey de visitante"
                autoFocus={!editing}
                style={{ width: '100%' }}
              />
            </div>

            <div className="field">
              <label htmlFor="sws-p-desc">Descripción</label>
              <CharField
                id="sws-p-desc"
                as="textarea"
                max={300}
                rows={3}
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                placeholder="Tela, bordado, para qué sirve…"
                style={{ width: '100%' }}
              />
            </div>

            <div className="sws-product-row">
              <div className="field">
                <label htmlFor="sws-p-price">Precio ({currency})</label>
                <input
                  id="sws-p-price"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => update('price', e.target.value)}
                  placeholder="850"
                />
              </div>
              <div className="field">
                <label htmlFor="sws-p-stock">Existencias</label>
                <input
                  id="sws-p-stock"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={form.stock}
                  onChange={(e) => update('stock', e.target.value)}
                  placeholder="10"
                />
              </div>
            </div>
            <p className="sws-field-hint">Sin precio, tu vitrina dice «Precio a consultar». Sin existencias, no se lleva la cuenta.</p>

            <div className="field">
              <label htmlFor="sws-p-variant">Tallas o variantes</label>
              <input
                id="sws-p-variant"
                value={form.size_variant}
                onChange={(e) => update('size_variant', e.target.value)}
                placeholder="S, M, L, XL"
              />
            </div>

            <LogoField value={form.image_url} onChange={(v) => update('image_url', v)} label="Foto del producto" />

            <label className="sws-check">
              <input
                type="checkbox"
                checked={form.show_on_platform}
                onChange={(e) => update('show_on_platform', e.target.checked)}
              />
              <span>
                Mostrar en mi vitrina de CFBAMX
                <em>Desmárcalo si no es de fútbol americano: no sale en tu vitrina, pero se queda en tu inventario.</em>
              </span>
            </label>
          </div>

          <aside className="sws-preview" aria-label="Así se ve en tu vitrina">
            <span className="sws-preview-label">Así se ve en tu vitrina</span>
            <div className={`sws-preview-paper${sale ? '' : ' is-off'}`}>
              <PreviewCard form={form} />
            </div>
            <p className="sws-preview-note">
              {sale ? 'Sale en tu vitrina en cuanto guardes.'
                : editing && !isActive(product) ? 'Está inactivo: no sale en tu vitrina. Actívalo desde su menú.'
                  : 'No sale en tu vitrina: la casilla está desmarcada.'}
            </p>
          </aside>
        </div>

        {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn btn-flag" disabled={saving}>
            {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Agregar producto'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Poner un premio (README, "Premios por acertar"): el partido, el producto, el
// descuento y cuánto dura, con el premio al lado tal como sale en la página del
// partido. Los partidos son los que el backend dice que se pueden premiar: de
// las ligas públicas, que todavía se pueden votar, de aquí a 30 días, sin
// amistosos. Los productos, los que están a la venta y en la vitrina: es lo que
// el backend vuelve a revisar al guardar.
function PrizeModal({ store, org, products, token, onClose, onSaved }) {
  const [matches, setMatches] = useState(null);
  const [matchesError, setMatchesError] = useState('');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState({ ...PREMIO_VACIO });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let vigente = true;
    api.getStorePrizeMatches(store.id, token)
      .then((data) => { if (vigente) setMatches(data.matches || []); })
      .catch((e) => {
        if (!vigente) return;
        setMatchesError(`No se pudieron cargar los partidos: ${e.message}`);
        setMatches([]);
      });
    return () => { vigente = false; };
  }, [store.id, token]);

  // Lo que se cambia quita el aviso de lo que faltaba: "Elige el partido" no se
  // puede quedar en pantalla con el partido ya elegido.
  const update = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setError('');
  };
  const productos = productosParaPremiar(products);
  const elegido = productos.find((p) => String(p.id) === String(form.product_id));
  const partido = (matches || []).find((m) => String(m.match_id) === String(form.match_id));
  const visibles = (matches || []).filter((m) => matchesSearch(query, [m.home_team, m.away_team, matchContext(m)]));
  const dias = scheduleDays(visibles);

  async function handleSubmit(e) {
    e.preventDefault();
    const problem = validarFormularioDePremio(form);
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError('');
    try {
      await api.createStorePrize(store.id, payloadDePremio(form), token);
      await onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const muestra = elegido ? {
    id: 0,
    discount_percent: Number(form.discount_percent) || 0,
    valid_days: Number(form.valid_days),
    product: { name: elegido.name, price: elegido.price, currency: elegido.currency, image_url: elegido.image_url },
    store: {
      id: store.id,
      name: org?.name ?? store.name,
      logo_url: org?.logo_url ?? store.logo_url,
      is_verified: org?.is_verified === true,
    },
  } : null;

  return (
    <Modal title="Poner un premio" onClose={onClose}>
      <form className="sws-prize-form" onSubmit={handleSubmit} noValidate>
        <div className="sws-prize-grid">
          <div className="sws-prize-fields">
            <fieldset className="sws-prize-step">
              <legend>El partido</legend>
              <p className="sws-field-hint">
                De las ligas públicas, de aquí a 30 días, mientras todavía se pueda votar. Lo puedes retirar hasta
                que empiece; después queda fijo.
              </p>
              {matches && matches.length > 0 && (
                <SearchBox value={query} onChange={setQuery} placeholder="Buscar por equipo o liga" />
              )}
              <div className="sws-pick-list" role="radiogroup" aria-label="Partido">
                {matches === null && <SectionLoading />}
                {matchesError && <div className="form-error">{matchesError}</div>}
                {matches && !matchesError && matches.length === 0 && (
                  <p className="sws-pick-empty">
                    No hay partidos que se puedan votar en las ligas públicas de aquí a 30 días. Aparecen en cuanto
                    las ligas los publican.
                  </p>
                )}
                {matches && matches.length > 0 && visibles.length === 0 && (
                  <p className="sws-pick-empty">Ningún partido coincide con lo que buscas.</p>
                )}
                {dias.map((day) => (
                  <div key={day.key} className="sws-pick-day">
                    <span className="sws-pick-day-label">{day.label}</span>
                    {day.rows.map((m) => {
                      const tiene = Boolean(m.prize_id);
                      const elegidoAqui = String(form.match_id) === String(m.match_id);
                      return (
                        <label
                          key={m.match_id}
                          className={`sws-pick${elegidoAqui ? ' is-on' : ''}${tiene ? ' is-taken' : ''}`}
                        >
                          <input
                            type="radio"
                            name="sws-prize-match"
                            value={m.match_id}
                            checked={elegidoAqui}
                            disabled={tiene}
                            onChange={() => update('match_id', String(m.match_id))}
                          />
                          <span className="sws-pick-main"><MediaMatch match={m} /></span>
                          <span className="sws-pick-side">
                            {tiene ? <Status>Ya tiene tu premio</Status> : <MatchTime match={m} />}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            </fieldset>

            <fieldset className="sws-prize-step">
              <legend>El producto</legend>
              {productos.length === 0 ? (
                <p className="sws-pick-empty">
                  Ningún producto está a la venta en tu vitrina. Un premio promete uno de ellos: agrégalo o muéstralo
                  en tu vitrina desde Productos.
                </p>
              ) : (
                <div className="sws-pick-list is-products" role="radiogroup" aria-label="Producto">
                  {productos.map((p) => {
                    const elegidoAqui = String(form.product_id) === String(p.id);
                    return (
                      <label key={p.id} className={`sws-pick is-product${elegidoAqui ? ' is-on' : ''}`}>
                        <input
                          type="radio"
                          name="sws-prize-product"
                          value={p.id}
                          checked={elegidoAqui}
                          onChange={() => update('product_id', String(p.id))}
                        />
                        <ProductThumb product={p} />
                        <span className="sws-pick-main">
                          <strong title={p.name}>{p.name}</strong>
                          <ProductPrice product={p} />
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>

            <div className="sws-product-row">
              <div className="field">
                <label htmlFor="sws-z-discount">Descuento (%)</label>
                <input
                  id="sws-z-discount"
                  type="number"
                  inputMode="numeric"
                  min={DESCUENTO_MINIMO}
                  max={DESCUENTO_MAXIMO}
                  step="1"
                  value={form.discount_percent}
                  onChange={(e) => update('discount_percent', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="sws-z-days">Cuánto dura</label>
                <select id="sws-z-days" value={form.valid_days} onChange={(e) => update('valid_days', e.target.value)}>
                  {VIGENCIAS.map((d) => <option key={d} value={String(d)}>{d} días después del partido</option>)}
                </select>
              </div>
            </div>
            <p className="sws-field-hint">
              De {DESCUENTO_MINIMO}% a {DESCUENTO_MAXIMO}%; con {DESCUENTO_MAXIMO}% es gratis. Quien acierte lo cobra
              contigo con su código mientras valga, y tú lo revisas en esta sección.
            </p>
          </div>

          <aside className="sws-preview" aria-label="Así se ve en la página del partido">
            <span className="sws-preview-label">Así se ve en la página del partido</span>
            {muestra ? (
              <ul className="mp-prize-list sws-prize-preview">
                <PrizeCard prize={muestra} preview />
              </ul>
            ) : (
              <p className="sws-preview-note">Elige un producto para verlo.</p>
            )}
            <p className="sws-preview-note">
              {partido
                ? `En ${partidoDelPremio(partido)}, debajo de «¿Quién gana?». Quien acierte lo recibe con su aviso del resultado.`
                : 'Sale en la página del partido, debajo de «¿Quién gana?».'}
            </p>
          </aside>
        </div>

        {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn btn-flag" disabled={saving}>
            {saving ? 'Guardando…' : 'Poner premio'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PreviewCard({ form }) {
  const precio = catalogPrice(String(form.price ?? '').trim());
  const description = String(form.description ?? '').trim();
  const variant = String(form.size_variant ?? '').trim();
  return (
    <div className="storefront-product">
      <div className="storefront-product-photo">
        {String(form.image_url ?? '').trim()
          ? <img src={imagenAjustada(form.image_url.trim(), 480)} alt="" />
          : <span className="storefront-product-nophoto">Sin foto</span>}
      </div>
      <h3>{String(form.name ?? '').trim() || 'Nombre del producto'}</h3>
      {description && <p className="storefront-product-description">{description}</p>}
      <div className="storefront-product-foot">
        {precio
          ? <span className="storefront-price">{precio} <small>{form.currency || 'MXN'}</small></span>
          : <span className="storefront-price is-ask">Precio a consultar</span>}
        {variant && <span className="storefront-variant">{variant}</span>}
      </div>
    </div>
  );
}
