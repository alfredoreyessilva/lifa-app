import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import LogoField from '../components/LogoField.jsx';
import CharField from '../components/CharField.jsx';
import Loading from '../components/Loading.jsx';
import OrganizationInfoPanel, { ContactoDeOrganizacion, RedesDeOrganizacion, redesDeOrganizacion } from '../components/OrganizationInfoPanel.jsx';
import { required, validEmail, validUrl, runValidations } from '../utils/validation.js';

// El panel de una organización (medio/tienda/clínica/marca), y la página
// pública de una tienda.
//
// Solo la TIENDA tiene vista pública aquí: es donde el público ve su catálogo
// y el botón de WhatsApp, que no caben en la ficha. Para ella, por defecto se
// muestra esa vista, sea o no tuya, y si es tuya un botón "Editar" cambia a
// edición sin cambiar de página; los enlaces de TU panel (OrgLogoBar,
// breadcrumb de inventario) agregan ?edit=1 para caer directo en edición.
//
// A un medio, una clínica o una marca el público lo ve en su ficha
// (OrganizationInfoPanel): el home y "También transmiten" la abren encima, y
// la vista pública que vivía aquí se borró el 2026-10-30 porque ya nadie
// llegaba a ella. Quien lo administra cae directo en edición, y "Ver como
// público" le abre la ficha. Quien llega por la URL sin administrarlo —el
// botón "Ver" del panel admin, un link viejo— ve la ficha.
export default function OrganizationDetailPage() {
  const { id } = useParams();
  const { token, organizations, refreshLeagues } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const isMine = (organizations || []).some((o) => String(o.id) === String(id));
  const [mode, setMode] = useState(searchParams.get('edit') === '1' ? 'edit' : 'view');
  const [showFicha, setShowFicha] = useState(false);

  const [org, setOrg] = useState(null);
  const [products, setProducts] = useState(null);
  const [countries, setCountries] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Las dos se piden CON la sesión: una organización privada no existe para el
  // público (404), y esta misma página es el panel de quien la administra
  // (README, "Organizaciones: publicar y verificar").
  useEffect(() => {
    load();
    api.getCountries().then((d) => setCountries(d.countries)).catch(() => setCountries([]));
    // Catálogo público (ya viene filtrado por el backend: is_active Y
    // show_on_platform). Se pide para cualquier tipo de organización sin
    // problema — si no es tienda, simplemente regresa un arreglo vacío.
    api.getPublicProducts(id, token).then((d) => setProducts(d.products)).catch(() => setProducts([]));
  }, [id, token]);

  async function load() {
    setError('');
    try {
      const data = await api.getOrganization(id, token);
      setOrg(data);
      setForm({
        name: data.name || '',
        country_id: data.country_id || '',
        logo_url: data.logo_url || '',
        description: data.description || '',
        website_url: data.website_url || '',
        cover_url: data.cover_url || '',
        facebook_url: data.facebook_url || '',
        instagram_url: data.instagram_url || '',
        youtube_url: data.youtube_url || '',
        tiktok_url: data.tiktok_url || '',
        contact_email: data.contact_email || '',
        contact_phone: data.contact_phone || '',
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
      () => validUrl(form.cover_url, 'La foto de portada'),
      () => validEmail(form.contact_email),
      () => validUrl(form.facebook_url, 'El enlace de Facebook'),
      () => validUrl(form.instagram_url, 'El enlace de Instagram'),
      () => validUrl(form.youtube_url, 'El enlace de YouTube'),
      () => validUrl(form.tiktok_url, 'El enlace de TikTok'),
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
        website_url: form.website_url.trim() || null,
        cover_url: form.cover_url.trim() || null,
        facebook_url: form.facebook_url.trim() || null,
        instagram_url: form.instagram_url.trim() || null,
        youtube_url: form.youtube_url.trim() || null,
        tiktok_url: form.tiktok_url.trim() || null,
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
      }, token);
      // El PUT regresa la fila sola, sin el nombre del país (lo trae el GET con
      // su JOIN): sin esto, la ficha de "Ver como público" perdía el país en
      // cuanto se guardaba.
      const country = (countries || []).find((c) => String(c.id) === String(updated.country_id));
      setOrg({ ...updated, country_name: country ? country.name : null });
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

  const tieneVistaPublica = org.type === 'store';

  // Medio, clínica o marca, visto por quien no lo administra: su ficha, que es
  // lo que el público ve de él. Cerrarla lleva al home, donde están los medios.
  if (!tieneVistaPublica && !isMine) {
    return <OrganizationInfoPanel org={org} onClose={() => navigate('/')} />;
  }

  // Vista pública de una tienda — por defecto, seas o no el dueño.
  if (tieneVistaPublica && (!isMine || mode === 'view')) {
    const redes = redesDeOrganizacion(org);
    return (
      <>
        {/* Bloque de perfil: angosto y centrado, igual que el resto de
            páginas de perfil de la app (jugador, cancha, etc). */}
        <div className="container" style={{ maxWidth: 520 }}>
          {/* Proporción de banner fija, recortada al centro: una foto
              cuadrada o vertical, a su altura natural, se comía la pantalla. */}
          {org.cover_url && (
            <img
              src={org.cover_url}
              alt=""
              style={{ display: 'block', width: '100%', aspectRatio: '3 / 1', objectFit: 'cover', borderRadius: 12, marginTop: 16 }}
            />
          )}
          <div className="player-hero">
            <div className="player-photo">
              {org.logo_url ? <img src={org.logo_url} alt={org.name} /> : <span>{org.name[0]}</span>}
            </div>
            <div>
              <div className="player-hero-eyebrow">{org.type}</div>
              <h1 className="player-hero-name" style={{ fontSize: 26 }}>{org.name}</h1>
              {org.country_name && <div className="player-hero-team"><span>{org.country_name}</span></div>}
              {org.is_verified && (
                <div style={{ marginTop: 8 }}>
                  <span className="pill is-ok">✓ Verificada</span>
                </div>
              )}
            </div>
          </div>

          {isMine && <EstadoDePublicacion org={org} />}

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
          {(org.contact_email || org.contact_phone) && (
            <div style={{ marginTop: 16 }}>
              <ContactoDeOrganizacion org={org} />
            </div>
          )}
          {redes.length > 0 && <RedesDeOrganizacion redes={redes} style={{ justifyContent: 'flex-start' }} />}
        </div>

        {/* Catálogo: usa el ancho estándar de la app (1080px, el mismo
            que las demás grillas) para que quepan 4 tarjetas del tamaño
            normal por fila, en vez del ancho angosto del perfil. */}
        {products && products.length > 0 && (
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
        {org.whatsapp_display_number && org.plan === 'pro' &&
          (!org.plan_expires_at || new Date(org.plan_expires_at) > new Date()) && (
          <div className="container" style={{ maxWidth: 520 }}>
            <a
              href={`https://wa.me/${org.whatsapp_display_number.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola, vi ${org.name} en CFBAMX y quiero preguntar por un producto`)}`}
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

  // Modo edición — solo llega aquí quien la administra: siempre, si es medio,
  // clínica o marca; si es tienda, cuando lo pidió (botón "Editar" o ?edit=1).
  // "Ver como público" lleva a lo que el público ve: la página de la tienda, o
  // la ficha de los demás, con lo ya guardado.
  return (
    <div className="container" style={{ maxWidth: 520 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Editar organización</h1>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => (tieneVistaPublica ? setMode('view') : setShowFicha(true))}
        >
          ← Ver como público
        </button>
      </div>
      {showFicha && <OrganizationInfoPanel org={org} onClose={() => setShowFicha(false)} />}
      <EstadoDePublicacion org={org} />
      {error && <div className="form-error">{error}</div>}

      {org.type === 'store' && (
        <p style={{ marginBottom: 16 }}>
          <Link to={`/panel/organizacion/${id}/inventario`} className="btn btn-outline">
            📦 Administrar inventario
          </Link>
        </p>
      )}

      {/* En la tarjeta negra, como los editores de equipo y de sede
          (.team-editor-preview, que también pasa los campos de verde a gris):
          sobre la cancha, un formulario así de largo no se despegaba del
          fondo. */}
      <form onSubmit={handleSave} className="team-editor-preview" style={{ padding: '24px 28px 28px' }}>
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

        <LogoField value={form.cover_url} onChange={(v) => update('cover_url', v)} label="Foto de portada" />

        <div className="field">
          <label>Descripción</label>
          <CharField as="textarea" max={400} value={form.description} onChange={(e) => update('description', e.target.value)} />
        </div>

        {/* Contacto y redes: lo llena la organización para que la encuentren,
            así que es público. Se dice aquí, porque quien pone un teléfono
            tiene que saber que cualquiera lo va a ver. */}
        <h3 style={{ marginTop: 20, marginBottom: 4 }}>Contacto y redes</h3>
        <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginTop: 0 }}>
          Todo lo de esta sección lo ve cualquiera que abra tu organización.
        </p>

        {/* minWidth 0 en las dos columnas: un input pide su ancho natural
            (~217 px) y dentro del panel cada columna mide menos. Sin esto el
            teléfono se salía por la derecha, con el contador cortado, y las
            dos columnas quedaban de distinto ancho. */}
        <div className="field-row">
          <div className="field" style={{ minWidth: 0 }}>
            <label>✉️ Correo electrónico</label>
            <input type="email" value={form.contact_email} onChange={(e) => update('contact_email', e.target.value)} />
          </div>
          <div className="field" style={{ minWidth: 0 }}>
            <label>📞 Número de contacto</label>
            <CharField max={20} value={form.contact_phone} onChange={(e) => update('contact_phone', e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>

        <div className="field">
          <label>Facebook</label>
          <input value={form.facebook_url} onChange={(e) => update('facebook_url', e.target.value)} placeholder="https://facebook.com/…" />
        </div>

        <div className="field">
          <label>Instagram</label>
          <input value={form.instagram_url} onChange={(e) => update('instagram_url', e.target.value)} placeholder="https://instagram.com/…" />
        </div>

        <div className="field">
          <label>YouTube</label>
          <input value={form.youtube_url} onChange={(e) => update('youtube_url', e.target.value)} placeholder="https://youtube.com/@…" />
        </div>

        <div className="field">
          <label>TikTok</label>
          <input value={form.tiktok_url} onChange={(e) => update('tiktok_url', e.target.value)} placeholder="https://tiktok.com/@…" />
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

// Lo que solo ve quien la administra: si la plataforma la muestra y, si es un
// medio, qué le pide para transmitir. Desde su sesión la página se ve igual
// sea pública o privada, así que sin esto no tendría cómo saber que nadie más
// la ve. Sin botón, a diferencia del aviso de una liga: a una organización la
// publica únicamente el admin de la plataforma. Liga y equipo no pasan por
// aquí (tienen su propio interruptor).
function EstadoDePublicacion({ org }) {
  if (org.type === 'league' || org.type === 'team') return null;
  const faltaParaTransmitir = org.type === 'media' && !(org.is_public && org.is_verified);
  return (
    <div
      className="form-error"
      style={{
        background: org.is_public ? 'rgba(58,141,63,0.12)' : 'rgba(255,210,63,0.12)',
        borderColor: org.is_public ? 'var(--field)' : 'var(--flag)',
        color: 'var(--ink)', marginTop: 14,
      }}
    >
      {org.is_public
        ? '✓ Es pública: aparece en el home y cualquiera puede ver esta página.'
        : 'Es privada por ahora: no aparece en el home y esta página solo la ven quienes la administran. La publica el equipo de CFBAMX.'}
      {faltaParaTransmitir && ' Para transmitir partidos, el medio tiene que estar publicado y verificado.'}
    </div>
  );
}
