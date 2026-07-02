import CharField from './CharField.jsx';
import { useState } from 'react';
import { required, maxLength, runValidations } from '../utils/validation.js';

const SEASON_SUGGESTIONS = [
  'PRIMAVERA',
  'VERANO',
  'OTOÑO',
  'INVIERNO',
  'PRIMAVERA - VERANO',
  'VERANO - OTOÑO',
  'OTOÑO - INVIERNO',
  'INVIERNO - PRIMAVERA',
  'APERTURA',
  'CLAUSURA',
];

export default function CategoryForm({ initial, onSubmit, onCancel, submitLabel }) {
  const [name,   setName]   = useState(initial?.name   || '');
  const [season, setSeason] = useState(initial?.season || '');
  const [year,   setYear]   = useState(initial?.year   ? String(initial.year) : '');
  const [error,  setError]  = useState('');
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const filtered = SEASON_SUGGESTIONS.filter((s) =>
    s.includes((season || '').toUpperCase())
  );

  async function submit(e) {
    e.preventDefault();
    setError('');

    const validationError = runValidations([
      () => required(name, 'El nombre de la categoría'),
      () => maxLength(name, 80, 'El nombre de la categoría'),
      () => {
        if (year && (isNaN(Number(year)) || Number(year) < 2000 || Number(year) > 2100)) {
          return 'El año debe ser un número válido (ej. 2026)';
        }
        return null;
      },
    ]);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      await onSubmit({
        name:   name.trim(),
        season: season.trim() || null,
        year:   year ? parseInt(year) : null,
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
        <label>Categoría</label>
        <CharField
          required
          max={40}
          uppercase
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej. BANTAM, VARSITY, FEMENIL"
        />
      </div>

      <div className="field" style={{ position: 'relative' }}>
        <label>Temporada (opcional)</label>
        <input
          type="text"
          value={season}
          placeholder="Ej. PRIMAVERA, INVIERNO, APERTURA"
          autoComplete="off"
          onChange={(e) => { setSeason(e.target.value.toUpperCase()); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        />
        {showSuggestions && filtered.length > 0 && (
          <ul className="season-suggestions">
            {filtered.map((s) => (
              <li
                key={s}
                className="season-suggestion-item"
                onMouseDown={() => { setSeason(s); setShowSuggestions(false); }}
              >
                {s}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="field">
        <label>Año (opcional)</label>
        <input
          type="number"
          min="2000"
          max="2100"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder="Ej. 2026"
          style={{ width: 120 }}
        />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-flag" disabled={loading}>
          {loading ? 'Guardando…' : submitLabel}
        </button>
      </div>
    </form>
  );
}