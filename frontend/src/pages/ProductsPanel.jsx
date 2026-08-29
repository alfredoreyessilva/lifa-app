import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import CharField from '../components/CharField.jsx';
import LogoField from '../components/LogoField.jsx';
import Loading from '../components/Loading.jsx';

const EMPTY_FORM = {
  name: '',
  description: '',
  price: '',
  currency: 'MXN',
  stock: '',
  size_variant: '',
  image_url: '',
  show_on_platform: true,
};

// Panel de inventario de una tienda (organización type='store').
// Ruta: /panel/organizacion/:id/inventario
//
// Esta es la "base de conocimiento" que más adelante alimenta al bot de
// WhatsApp: lo que la tienda carga aquí es exactamente lo que la IA usará
// para responder dudas de stock/precio/talla. Por eso el formulario pide
// justo esos campos y nada más — no es un catálogo de e-commerce completo.
export default function ProductsPanel() {
  const { id } = useParams();
  const { token, organizations } = useAuth();
  const navigate = useNavigate();

  const [org, setOrg] = useState(null);
  const [products, setProducts] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const isMine = (organizations || []).some((o) => String(o.id) === String(id));

  useEffect(() => {
    if (!token) return;
    api.getOrganization(id).then(setOrg).catch((e) => setError(e.message));
    refreshProducts();
  }, [id, token]);

  function refreshProducts() {
    api.getManagedProducts(id, token).then((d) => setProducts(d.products)).catch((e) => setError(e.message));
  }

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startEdit(product) {
    setEditingId(product.id);
    setForm({
      name: product.name || '',
      description: product.description || '',
      price: product.price ?? '',
      currency: product.currency || 'MXN',
      stock: product.stock ?? '',
      size_variant: product.size_variant || '',
      image_url: product.image_url || '',
      show_on_platform: product.show_on_platform !== false,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('El nombre del producto es obligatorio'); return; }

    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description || null,
        price: form.price === '' ? null : Number(form.price),
        currency: form.currency || 'MXN',
        stock: form.stock === '' ? null : Number(form.stock),
        size_variant: form.size_variant || null,
        image_url: form.image_url || null,
        show_on_platform: form.show_on_platform,
      };
      if (editingId) {
        await api.updateProduct(editingId, payload, token);
      } else {
        await api.createProduct(id, payload, token);
      }
      cancelEdit();
      refreshProducts();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(product) {
    setError('');
    try {
      await api.updateProduct(product.id, { is_active: !product.is_active }, token);
      refreshProducts();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(product) {
    if (!window.confirm(`¿Borrar "${product.name}"? Esta acción no se puede deshacer.`)) return;
    setError('');
    try {
      await api.deleteProduct(product.id, token);
      refreshProducts();
    } catch (e) {
      setError(e.message);
    }
  }

  if (!token) {
    return <div className="container"><p>Necesitas iniciar sesión para ver esto.</p></div>;
  }

  if (!isMine) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No tienes permiso para ver este panel</h3>
          <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={() => navigate('/panel')}>Volver a mi panel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="crumb">
        <Link to={`/panel/organizacion/${id}?edit=1`}>← {org ? org.name : 'Organización'}</Link>
      </div>

      <div className="dash-header">
        <div>
          <span className="eyebrow">{org ? org.name : 'Cargando…'}</span>
          <h1>Inventario</h1>
        </div>
      </div>

      <p style={{ color: 'var(--ink-dim)', fontSize: 13, marginTop: -8, marginBottom: 20 }}>
        Lo que cargues aquí es lo que verán los aficionados en tu perfil, y más adelante lo que
        usará tu asistente de WhatsApp para responder dudas de stock y precio.
      </p>

      {error && <div className="form-error">{error}</div>}

      <form onSubmit={handleSubmit} style={{ marginBottom: 28 }}>
        <div className="field">
          <label>Nombre del producto</label>
          <CharField max={80} value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Jersey Auténticos Tigres" />
        </div>

        <div className="field">
          <label>Descripción</label>
          <CharField as="textarea" max={300} value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="Réplica oficial, bordado, ..." />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>Precio (MXN)</label>
            <input type="number" min="0" step="0.01" value={form.price} onChange={(e) => update('price', e.target.value)} placeholder="850" />
          </div>
          <div className="field">
            <label>Stock</label>
            <input type="number" min="0" step="1" value={form.stock} onChange={(e) => update('stock', e.target.value)} placeholder="5" />
          </div>
          <div className="field">
            <label>Talla / variante</label>
            <input value={form.size_variant} onChange={(e) => update('size_variant', e.target.value)} placeholder="M, L, XL…" />
          </div>
        </div>

        <LogoField value={form.image_url} onChange={(v) => update('image_url', v)} label="Foto del producto" />

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '12px 0' }}>
          <input
            type="checkbox"
            checked={form.show_on_platform}
            onChange={(e) => update('show_on_platform', e.target.checked)}
          />
          Mostrar en LIFA App (déjalo desmarcado si este producto no es del nicho de fútbol americano —
          seguirá disponible en tu bot de WhatsApp para todos tus clientes de todas formas)
        </label>

        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <button type="submit" className="btn btn-flag" disabled={saving}>
            {saving ? 'Guardando…' : editingId ? 'Guardar cambios' : '+ Agregar producto'}
          </button>
          {editingId && (
            <button type="button" className="btn btn-outline" onClick={cancelEdit}>Cancelar edición</button>
          )}
        </div>
      </form>

      {products === null && <Loading />}
      {products && products.length === 0 && (
        <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
          Todavía no tienes productos cargados. Agrega el primero arriba.
        </p>
      )}
      {products && products.length > 0 && (
        <div className="league-grid">
          {products.map((p) => (
            <div key={p.id} className="league-card" style={{ opacity: p.is_active ? 1 : 0.5 }}>
              {p.image_url && <img src={p.image_url} alt={p.name} style={{ width: '100%', borderRadius: 8, marginBottom: 8 }} />}
              <h3>{p.name}</h3>
              <p style={{ fontSize: 13, color: 'var(--ink-dim)' }}>
                {p.price != null ? `$${Number(p.price).toLocaleString('es-MX')} ${p.currency}` : 'Sin precio'}
                {p.size_variant ? ` · ${p.size_variant}` : ''}
                {p.stock != null ? ` · Stock: ${p.stock}` : ''}
              </p>
              {!p.is_active && <p style={{ fontSize: 12, color: 'var(--flag)' }}>Inactivo (oculto del perfil público)</p>}
              {p.is_active && !p.show_on_platform && (
                <p style={{ fontSize: 12, color: 'var(--ink-dim)' }}>
                  🔒 Solo visible en tu bot de WhatsApp (oculto del directorio de LIFA App)
                </p>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-outline" onClick={() => startEdit(p)}>Editar</button>
                <button type="button" className="btn btn-outline" onClick={() => toggleActive(p)}>
                  {p.is_active ? 'Desactivar' : 'Activar'}
                </button>
                <button type="button" className="btn btn-outline" onClick={() => handleDelete(p)}>Borrar</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
