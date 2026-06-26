import { useState, useRef } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { required, maxLength, validEmail, validUrl, runValidations } from '../utils/validation.js';

// ─── helpers ────────────────────────────────────────────────────────────────
function initials(name) {
  return (name || '')
    .split(' ')
    .filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚÑ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

// Botón de subida de imagen reutilizable dentro del formulario
function UploadButton({ onUploaded, label, disabled }) {
  const { token } = useAuth();
  const ref = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  async function handleChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');
    setUploading(true);
    try {
      const { url } = await api.uploadImage(file, token);
      const absolute = url.startsWith('http') ? url : `${import.meta.env.VITE_API_URL || ''}${url}`;
      onUploaded(absolute);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
      // reset para poder subir el mismo archivo de nuevo si quieren
      e.target.value = '';
    }
  }

  return (
    <div>
      <input type="file" accept="image/*" ref={ref} onChange={handleChange} style={{ display: 'none' }} />
      <button
        type="button"
        className="btn btn-outline btn-sm"
        onClick={() => ref.current?.click()}
        disabled={uploading || disabled}
      >
        {uploading ? 'Subiendo…' : label}
      </button>
      {uploadError && <div className="form-error" style={{ marginTop: 6 }}>{uploadError}</div>}
    </div>
  );
}

// ─── componente principal ────────────────────────────────────────────────────
export default function TeamForm({ initial, onSubmit, onCancel, submitLabel }) {
  const [form, setForm] = useState({
    name:          initial?.name          || '',
    logo_url:      initial?.logo_url      || '',
    cover_url:     initial?.cover_url     || '',
    location:      initial?.location      || '',
    contact_email: initial?.contact_email || '',
    contact_phone: initial?.contact_phone || '',
    facebook_url:  initial?.facebook_url  || '',
    instagram_url: initial?.instagram_url || '',
    twitter_url:   initial?.twitter_url   || '',
    website_url:   initial?.website_url   || '',
  });
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setError('');

    const validationError = runValidations([
      () => required(form.name,          'El nombre del equipo'),
      () => maxLength(form.name, 80,     'El nombre del equipo'),
      () => validEmail(form.contact_email),
      () => validUrl(form.facebook_url,  'El enlace de Facebook'),
      () => validUrl(form.instagram_url, 'El enlace de Instagram'),
      () => validUrl(form.twitter_url,   'El enlace de X / Twitter'),
      () => validUrl(form.website_url,   'El sitio web'),
      () => validUrl(form.cover_url,     'La imagen de portada'),
    ]);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      await onSubmit({
        ...form,
        name:          form.name.trim(),
        location:      form.location.trim(),
        contact_email: form.contact_email.trim(),
        contact_phone: form.contact_phone.trim(),
        facebook_url:  form.facebook_url.trim(),
        instagram_url: form.instagram_url.trim(),
        twitter_url:   form.twitter_url.trim(),
        website_url:   form.website_url.trim(),
        cover_url:     form.cover_url.trim(),
      });
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  const hasContact = form.location || form.contact_email || form.contact_phone;
  const hasLinks   = form.facebook_url || form.instagram_url || form.twitter_url || form.website_url;

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}

      {/* ── PREVIEW CARD (idéntica a TeamInfoPanel) ── */}
      <div className="team-editor-preview">

        {/* BANNER */}
        <div className="team-profile-banner team-editor-banner">
          {form.cover_url && (
            <img src={form.cover_url} alt="Portada" className="team-editor-cover-img" />
          )}
          {/* overlay oscuro para que los botones se lean */}
          <div className="team-editor-banner-overlay" />

          {/* botones de edición sobre el banner */}
          <div className="team-editor-banner-actions">
            <UploadButton
              label={form.cover_url ? '📷 Cambiar portada' : '📷 Subir portada'}
              onUploaded={(url) => update('cover_url', url)}
              disabled={loading}
            />
            {form.cover_url && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => update('cover_url', '')}
              >
                Quitar
              </button>
            )}
          </div>
        </div>

        {/* LOGO + botones de edición */}
        <div className="team-profile-logo-wrap">
          <div className="team-editor-logo-wrap">
            <div className="team-profile-logo">
              {form.logo_url
                ? <img src={form.logo_url} alt={form.name || 'Logo'} />
                : <span>{initials(form.name) || '?'}</span>}
            </div>
            <div className="team-editor-logo-actions">
              <UploadButton
                label="📷 Logo"
                onUploaded={(url) => update('logo_url', url)}
                disabled={loading}
              />
              {form.logo_url && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => update('logo_url', '')}>
                  Quitar
                </button>
              )}
            </div>
          </div>
        </div>

        {/* CUERPO */}
        <div className="team-profile-body">

          {/* Nombre */}
          <div className="field" style={{ marginBottom: 16 }}>
            <label style={{ textAlign: 'center', display: 'block', fontSize: 11, letterSpacing: '0.15em', color: 'var(--ink-dim)', textTransform: 'uppercase' }}>
              Nombre del equipo
            </label>
            <input
              required
              value={form.name}
              onChange={(e) => update('name', e.target.value.toUpperCase())}
              placeholder="Ej. Mayas CDMX"
              style={{ textAlign: 'center', fontSize: 20, fontFamily: 'var(--font-display)' }}
            />
          </div>

          {/* Información de contacto */}
          <div className="team-profile-section" style={{ textAlign: 'left', marginBottom: 16 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--flag)', textTransform: 'uppercase', marginBottom: 10, fontFamily: 'var(--font-eyebrow)' }}>
              Información de contacto
            </div>

            <div className="field">
              <label>📍 Ubicación</label>
              <input value={form.location} onChange={(e) => update('location', e.target.value.toUpperCase())} placeholder="Ej. Ciudad de México" />
            </div>
            <div className="field-row" style={{ marginTop: 8 }}>
              <div className="field">
                <label>✉️ Correo</label>
                <input type="email" value={form.contact_email} onChange={(e) => update('contact_email', e.target.value)} />
              </div>
              <div className="field">
                <label>📞 Teléfono</label>
                <input value={form.contact_phone} onChange={(e) => update('contact_phone', e.target.value.toUpperCase())} />
              </div>
            </div>
          </div>

          {/* Redes sociales */}
          <div className="team-profile-section" style={{ textAlign: 'left', marginBottom: 16 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--flag)', textTransform: 'uppercase', marginBottom: 10, fontFamily: 'var(--font-eyebrow)' }}>
              Redes y sitio web
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
              <label>X / Twitter</label>
              <input value={form.twitter_url} onChange={(e) => update('twitter_url', e.target.value)} placeholder="https://x.com/…" />
            </div>
            <div className="field">
              <label>Sitio web</label>
              <input value={form.website_url} onChange={(e) => update('website_url', e.target.value)} placeholder="https://…" />
            </div>
          </div>

          {/* Preview de cómo se verá en público */}
          {(hasContact || hasLinks) && (
            <div style={{ fontSize: 11, color: 'var(--ink-dim)', textAlign: 'center', marginBottom: 8, fontFamily: 'var(--font-eyebrow)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Así se verá en la vista pública
            </div>
          )}

          {hasContact && (
            <div className="team-profile-section" style={{ pointerEvents: 'none', opacity: 0.7 }}>
              {form.location      && <div className="team-info-row">📍 {form.location}</div>}
              {form.contact_email && <div className="team-info-row">✉️ {form.contact_email}</div>}
              {form.contact_phone && <div className="team-info-row">📞 {form.contact_phone}</div>}
            </div>
          )}

          {hasLinks && (
            <div className="team-info-links" style={{ pointerEvents: 'none', opacity: 0.7 }}>
              {form.facebook_url  && <span className="btn btn-outline btn-sm">Facebook</span>}
              {form.instagram_url && <span className="btn btn-outline btn-sm">Instagram</span>}
              {form.twitter_url   && <span className="btn btn-outline btn-sm">X / Twitter</span>}
              {form.website_url   && <span className="btn btn-outline btn-sm">Sitio web</span>}
            </div>
          )}

        </div>
      </div>
      {/* ── FIN PREVIEW ── */}

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-flag" disabled={loading}>{loading ? 'Guardando…' : submitLabel}</button>
      </div>
    </form>
  );
}
