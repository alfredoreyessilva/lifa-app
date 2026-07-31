import CharField from './CharField.jsx';
import { useState } from 'react';
import { required, maxLength, runValidations } from '../utils/validation.js';

export default function CategoryForm({ initial, onSubmit, onCancel, submitLabel }) {
  const [name,   setName]   = useState(initial?.name   || '');
  const [autoStatusEnabled, setAutoStatusEnabled] = useState(initial?.auto_status_enabled || false);
  const [autoStatusHours,   setAutoStatusHours]   = useState(initial?.auto_status_window_hours || '');
  const [error,  setError]  = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');

    const validationError = runValidations([
      () => required(name, 'El nombre de la categoría'),
      () => maxLength(name, 80, 'El nombre de la categoría'),
      () => {
        if (autoStatusEnabled && !autoStatusHours) {
          return 'Elige cuántas horas (1, 2 o 3) para el cálculo automático, o apaga esa opción.';
        }
        return null;
      },
    ]);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      await onSubmit({
        name: name.trim(),
        auto_status_enabled: autoStatusEnabled,
        auto_status_window_hours: autoStatusEnabled ? Number(autoStatusHours) : null,
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

      <div className="field" style={{ background: 'rgba(255,255,255,0.06)', padding: '12px 16px', borderRadius: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={autoStatusEnabled}
            onChange={(e) => setAutoStatusEnabled(e.target.checked)}
          />
          Activar cálculo automático de estado del partido
        </label>
        <p style={{ fontSize: 13, opacity: 0.75, marginTop: 6 }}>
          Si la dejas apagada, tú controlas cuándo un partido inicia y termina, sin límite de tiempo.
          Si la activas, el sistema lo marca solo como finalizado después de las horas que elijas —
          solo aplica a los partidos que nadie haya iniciado o finalizado manualmente.
        </p>

        {autoStatusEnabled && (
          <div style={{ marginTop: 10 }}>
            <label>¿Cuántas horas después de la hora programada?</label>
            <div className="pill-group">
              {[1, 2, 3].map((h) => (
                <button
                  key={h}
                  type="button"
                  className={`pill-btn${Number(autoStatusHours) === h ? ' pill-btn--active' : ''}`}
                  onClick={() => setAutoStatusHours(h)}
                >
                  {h} {h === 1 ? 'hora' : 'horas'}
                </button>
              ))}
            </div>
          </div>
        )}
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
