import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import LogoField from '../components/LogoField.jsx';
import CharField from '../components/CharField.jsx';
import Loading from '../components/Loading.jsx';
import { required, validUrl, runValidations } from '../utils/validation.js';

// Vista + edición de una organización (medio/proveedor/tienda/clínica/marca).
// Por defecto SIEMPRE se muestra la vista pública, sea o no tuya — igual
// que ver tu propio perfil en cualquier red social. Si es tuya, aparece un
// botón "Editar" que cambia a modo edición sin cambiar de página. Los
// enlaces que vienen de TU panel (OrgLogoBar, breadcrumb de inventario)
// agregan ?edit=1 para saltarse ese paso y caer directo en edición, porque
// ahí la intención siempre es administrar, no visitar.
export default function OrganizationDetailPage() {
  const { id } = useParams();
  const { token, organizations, refreshLeagues } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const isMine = (organizations || []).some((o) => String(o.id) === String(id));
  const [mode, setMode] = useState(searchParams.get('edit') === '1' ? 'edit' : 'view');

  const [org, setOrg] = useState(null);
  const [products, setProducts] = useState(null);
  const [countries, setCountries] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
    api.getCountries().then((d) => setCountries(d.countries)).catch(() => setCountries([]));
    // Catálogo público (ya viene filtrado por el backend: is_active Y
    // show_on_platform). Se pide para cualquier tipo de organización sin
    // problema — si no es tienda, simplemente regresa un arreglo vacío.
    api.getPublicProducts(id).then((d) => setProducts(d.products)).catch(() => setProducts([]));
  }, [id]);

  async function load() {
    setError('');
    try {
      const data = await api.getOrganization(id);
      setOrg(data);
      setForm({
        name: data.name || '',
        country_id: data.country_id || '',
        logo_url: data.logo_url || '',
        description: data.description || '',
        website_url: data.website_url || '',
      });
    } catch (e) {
      setError(e.message);
    }
  }

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    const validationError = runValidations([
      () => required(form.name, 'El nombre'),
      () => validUrl(form.logo_url, 'El logo'),
      () => validUrl(form.website_url, 'El sitio web'),
    ]);
    if (validationError) { setError(validationError); return; }

    setSaving(true);
    setError('');
    try {
      const updated = await api.updateOrganization(id, {
        name: form.name.trim(),
        country_id: form.country_id || null,
        logo_url: form.logo_url || null,
        description: form.description || null,
        website_url: form.website_url || null,
      }, token);
      setOrg(updated);
      await refreshLeagues();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (error && !org) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No encontramos esta organización</h3>
          <p>{error}</p>
          <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={() => navigate('/panel')}>Volver a mi panel</button>
        </div>
      </div>
    );
  }

  if (!org || !form) return <Loading />;

  // Vista pública — se muestra siempre por defecto, seas o no el dueño.
  if (!isMine || mode === 'view') {
    return (
      <>
        {/* Bloque de perfil: angosto y centrado, igual que el resto de
            páginas de perfil de la app (jugador, cancha, etc). */}
        <div className="container" style={{ maxWidth: 520 }}>
          <div className="player-hero">
            <div className="player-photo">
              {org.logo_url ? <img src={org.logo_url} alt={org.name} /> : <span>{org.name[0]}</span>}
            </div>
            <div>
              <div className="player-hero-eyebrow">{org.type}</div>
              <h1 className="player-hero-name" style={{ fontSize: 26 }}>{org.name}</h1>
              {org.country_name && <div className="player-hero-team"><span>{org.country_name}</span></div>}
            </div>
          </div>

          {isMine && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{ marginTop: 14 }}
              onClick={() => setMode('edit')}
            >
              ✏️ Editar organización
            </button>
          )}

          {org.description && <p style={{ marginTop: 16 }}>{org.description}</p>}
          {org.website_url && (
            <p style={{ marginTop: 10 }}>
              <a href={org.website_url} target="_blank" rel="noopener noreferrer">{org.website_url}</a>
            </p>
          )}
        </div>

        {/* Catálogo: usa el ancho estándar de la app (1080px, el mismo
            que las demás grillas) para que quepan 4 tarjetas del tamaño
            normal por fila, en vez del ancho angosto del perfil. */}
        {org.type === 'store' && products && products.length > 0 && (
          <div className="container">
            <div style={{ marginTop: 24 }}>
              <h3 style={{ marginBottom: 12 }}>Catálogo</h3>
              <div className="catalog-grid">
                {products.map((p) => (
                  <div key={p.id} className="league-card">
                    {p.image_url && (
                      <img src={p.image_url} alt={p.name} style={{ width: '100%', borderRadius: 8, marginBottom: 8 }} />
                    )}
                    <h3>{p.name}</h3>
                    {p.description && <p style={{ fontSize: 13, color: 'var(--ink-dim)' }}>{p.description}</p>}
                    <p style={{ fontSize: 13, fontWeight: 600 }}>
                      {p.price != null ? `$${Number(p.price).toLocaleString('es-MX')} ${p.currency}` : 'Precio a consultar'}
                      {p.size_variant ? ` · ${p.size_variant}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Botón del bot de WhatsApp con IA — solo aparece si la tienda
            tiene el plan Pro activo (no vencido) y ya tiene su número
            configurado desde el Admin Panel. Igual que el resto del flujo,
            "activo" significa plan === 'pro' Y (sin fecha de vencimiento
            O la fecha todavía no pasó). */}
        {org.type === 'store' && org.whatsapp_display_number && org.plan === 'pro' &&
          (!org.plan_expires_at || new Date(org.plan_expires_at) > new Date()) && (
          <div className="container" style={{ maxWidth: 520 }}>
            <a
              href={`https://wa.me/${org.whatsapp_display_number.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola, vi ${org.name} en LIFA App y quiero preguntar por un producto`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-flag"
              style={{ marginTop: 16, display: 'inline-block' }}
            >
              💬 Consultar por WhatsApp
            </a>
          </div>
        )}
      </>
    );
  }

  // Modo edición — solo llega aquí el owner/admin, y solo si lo pidió
  // explícitamente (botón "Editar" o entrando con ?edit=1).
  return (
    <div className="container" style={{ maxWidth: 520 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Editar organización</h1>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('view')}>
          ← Ver como público
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}

      {org.type === 'store' && (
        <p style={{ marginBottom: 16 }}>
          <Link to={`/panel/organizacion/${id}/inventario`} className="btn btn-outline">
            📦 Administrar inventario
          </Link>
        </p>
      )}

      <form onSubmit={handleSave}>
        <div className="field">
          <label>Nombre</label>
          <CharField max={80} value={form.name} onChange={(e) => update('name', e.target.value)} />
        </div>

        <div className="field">
          <label>País</label>
          <select value={form.country_id} onChange={(e) => update('country_id', e.target.value)}>
            <option value="">Selecciona…</option>
            {(countries || []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <LogoField value={form.logo_url} onChange={(v) => update('logo_url', v)} label="Logo" />

        <div className="field">
          <label>Descripción</label>
          <CharField as="textarea" max={400} value={form.description} onChange={(e) => update('description', e.target.value)} />
        </div>

        <div className="field">
          <label>Sitio web</label>
          <input value={form.website_url} onChange={(e) => update('website_url', e.target.value)} placeholder="https://…" />
        </div>

        <button type="submit" className="btn btn-flag" disabled={saving} style={{ marginTop: 10 }}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </form>
    </div>
  );
}
