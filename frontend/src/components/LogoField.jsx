import { useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function LogoField({ value, onChange }) {
  const { token } = useAuth();
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      const { url } = await api.uploadImage(file, token);
      const absoluteUrl = url.startsWith('http') ? url : `${import.meta.env.VITE_API_URL || ''}${url}`;
      onChange(absoluteUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="field">
      <label>Logo de la liga</label>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {value && (
          <div className="league-logo" style={{ width: 56, height: 56, fontSize: 14, flexShrink: 0 }}>
            <img src={value} alt="Vista previa del logo" />
          </div>
        )}

        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Subiendo…' : 'Subir imagen desde mi dispositivo'}
        </button>

        {value && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange('')}>
            Quitar
          </button>
        )}
      </div>

      {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}

      <input
        type="text"
        placeholder="o pega la URL de una imagen: https://…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ marginTop: 8 }}
      />
    </div>
  );
}
