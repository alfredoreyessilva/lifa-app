import { useState } from 'react';
import { required, maxLength, runValidations } from '../utils/validation.js';

export default function CategoryForm({ initial, onSubmit, onCancel, submitLabel }) {
  const [name, setName] = useState(initial?.name || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');

    const validationError = runValidations([
      () => required(name, 'El nombre de la categoría'),
      () => maxLength(name, 80, 'El nombre de la categoría'),
    ]);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      await onSubmit({ name: name.trim() });
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}
      <div className="field">
        <label>Nombre de la categoría</label>
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Varonil Mayor" />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-flag" disabled={loading}>{loading ? 'Guardando…' : submitLabel}</button>
      </div>
    </form>
  );
}