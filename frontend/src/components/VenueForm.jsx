import { useState, useRef } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { required, maxLength, validEmail, validUrl, runValidations } from '../utils/validation.js';
import CharField from './CharField.jsx';

// Botón de subida de imagen reutilizable dentro del formulario (idéntico al de TeamForm)
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
export default function VenueForm({ initial, onSubmit, onCancel, submitLabel }) {
  const [form, setForm] = useState({
    name:          initial?.name          || '',
    institution:   initial?.institution   || '',
    cover_url:     initial?.cover_url     || '',
    address:       initial?.address       || '',
    contact_phone: initial?.contact_phone || '',
    contact_email: initial?.contact_email || '',
  });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setError('');

    const validationError = runValidations([
      () => required(form.name,      'El nombre de la sede'),
      () => maxLength(form.name, 80, 'El nombre de la sede'),
      () => validEmail(form.contact_email),
      () => validUrl(form.cover_url, 'La imagen de portada'),
    ]);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      await onSubmit({
        ...form,
        name:          form.name.trim(),
        institution:   form.institution.trim(),
        address:       form.address.trim(),
        contact_phone: form.contact_phone.trim(),
        contact_email: form.contact_email.trim(),
      });
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  const hasContact = form.address || form.contact_phone || form.contact_email;

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}

      {/* ── PREVIEW CARD (idéntica a VenueInfoPanel) ── */}
      <div className="team-editor-preview">

        {/* PORTADA */}
        <div className="team-profile-banner team-editor-banner">
          {form.cover_url && (
            <img src={form.cover_url} alt="Portada" className="team-editor-cover-img" />
          )}
          <div className="team-editor-banner-overlay" />
          <div className="team-editor-banner-actions">
            <UploadButton
              label={form.cover_url ? '📷 Cambiar foto' : '📷 Subir foto (opcional)'}
              onUploaded={(url) => update('cover_url', url)}
              disabled={loading}
            />
            {form.cover_url && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => update('cover_url', '')}>
                Quitar
              </button>
            )}
          </div>
        </div>

        {/* CUERPO */}
        <div className="team-profile-body" style={{ paddingTop: 24 }}>

          {/* Nombre */}
          <div className="field" style={{ marginBottom: 16 }}>
            <label style={{ textAlign: 'center', display: 'block', fontSize: 11, letterSpacing: '0.15em', color: 'var(--ink-dim)', textTransform: 'uppercase' }}>
              Nombre del campo o estadio
            </label>
            <input
              required
              value={form.name}
              onChange={(e) => update('name', e.target.value.toUpperCase())}
              placeholder="Ej. Estadio Azteca"
              style={{ textAlign: 'center', fontSize: 20, fontFamily: 'var(--font-display)' }}
            />
          </div>

          {/* Institución */}
          <div className="field" style={{ marginBottom: 16 }}>
            <label>🏫 Institución (opcional)</label>
            <CharField max={80} uppercase value={form.institution} onChange={(e) => update('institution', e.target.value)} placeholder="Ej. Universidad Autónoma de México" />
          </div>

          {/* Información de contacto */}
          <div className="team-profile-section" style={{ textAlign: 'left', marginBottom: 16 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--flag)', textTransform: 'uppercase', marginBottom: 10, fontFamily: 'var(--font-eyebrow)' }}>
              Ubicación y contacto
            </div>

            <div className="field">
              <label>📍 Dirección o link de Google Maps</label>
              <input value={form.address} onChange={(e) => update('address', e.target.value)} placeholder="Dirección o https://maps.app.goo.gl/…" />
            </div>
            <div className="field-row" style={{ marginTop: 8 }}>
              <div className="field">
                <label>📞 Teléfono</label>
                <CharField max={20} uppercase value={form.contact_phone} onChange={(e) => update('contact_phone', e.target.value)} />
              </div>
              <div className="field">
                <label>✉️ Correo</label>
                <input type="email" value={form.contact_email} onChange={(e) => update('contact_email', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Preview de cómo se verá en público */}
          {hasContact && (
            <>
              <div style={{ fontSize: 11, color: 'var(--ink-dim)', textAlign: 'center', marginBottom: 8, fontFamily: 'var(--font-eyebrow)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Así se verá en la vista pública
              </div>
              <div className="team-profile-section" style={{ pointerEvents: 'none', opacity: 0.7 }}>
                {form.address       && <div className="team-info-row">📍 {form.address}</div>}
                {form.contact_phone && <div className="team-info-row">📞 {form.contact_phone}</div>}
                {form.contact_email && <div className="team-info-row">✉️ {form.contact_email}</div>}
              </div>
            </>
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
