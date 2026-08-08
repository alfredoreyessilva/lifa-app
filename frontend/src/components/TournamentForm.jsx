import CharField from './CharField.jsx';
import LogoField from './LogoField.jsx';
import { useState } from 'react';
import { required, maxLength, minValue, runValidations } from '../utils/validation.js';

export default function TournamentForm({ initial, onSubmit, onCancel, submitLabel }) {
  const [name,     setName]     = useState(initial?.name     || '');
  const [year,     setYear]     = useState(initial?.year     || new Date().getFullYear());
  const [logoUrl,  setLogoUrl]  = useState(initial?.logo_url  || '');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');

    const validationError = runValidations([
      () => required(name, 'El nombre del torneo'),
      () => maxLength(name, 80, 'El nombre del torneo'),
      () => required(year, 'El año'),
      () => minValue(year, 2000, 'El año'),
    ]);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      await onSubmit({
        name: name.trim(),
        year: parseInt(year),
        logo_url: logoUrl.trim() || null,
      });
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}

      <div className="field">
        <label>Nombre del torneo</label>
        <CharField
          required
          max={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej. Copa Fundadores 2026"
        />
      </div>

      <div className="field">
        <label>Año</label>
        <input
          type="number"
          required
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder={String(new Date().getFullYear())}
        />
      </div>

      <LogoField value={logoUrl} onChange={setLogoUrl} label="Logo del torneo" />

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-flag" disabled={loading}>
          {loading ? 'Guardando…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
