import { useState } from 'react';
import { api } from '../../api/client.js';
import Modal from '../Modal.jsx';
import ConfirmDialog from '../ConfirmDialog.jsx';
import CharField from '../CharField.jsx';
import LogoField from '../LogoField.jsx';
import OrganizationProfileForm from '../OrganizationProfileForm.jsx';
import { catalogPrice } from '../../utils/money.js';
import { imagenAjustada } from '../../utils/imagenes.js';
import {
  EMPTY_PRODUCT, isActive, productPayload, productToForm, validateProductForm,
} from '../../utils/storePanel.js';

// Las ventanas del panel de una tienda. Sobre el lienzo se ven con la piel oscura
// de admin.css (`body:has(.adm) .modal`), y league.css les pasa sus tokens verdes a
// los del lienzo (`body:has(.lws) .modal`), igual que en el panel de una liga.
//
// modal: { type: 'product', product? } | { type: 'delete-product', product } | { type: 'profile' }
export default function StoreModal({ modal, store, org, token, onClose, onProductsChanged, onProfileSaved }) {
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
