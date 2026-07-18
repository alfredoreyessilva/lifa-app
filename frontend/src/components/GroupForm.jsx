import { useState } from 'react';
import { required, maxLength, runValidations } from '../utils/validation.js';
import CharField from './CharField.jsx';

export default function GroupForm({ initial, onSubmit, onCancel, submitLabel }) {
  const [form, setForm] = useState({
    name:        initial?.name        || '',
    description: initial?.description || '',
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
      () => required(form.name,       'El nombre del grupo'),
      () => maxLength(form.name, 60,  'El nombre del grupo'),
    ]);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      await onSubmit({
        ...form,
        name:        form.name.trim(),
        description: form.description.trim(),
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
        <label>Nombre del grupo</label>
        <input
          required
          value={form.name}
          onChange={(e) => update('name', e.target.value.toUpperCase())}
          placeholder="Ej. Conferencia 14 Grandes"
        />
      </div>

      <div className="field">
        <label>Descripción (opcional)</label>
        <CharField
          as="textarea"
          rows={3}
          max={200}
          value={form.description}
          onChange={(e) => update('description', e.target.value)}
          placeholder="Ej. Grupo único, todos contra todos, con un campeón directo"
        />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-flag" disabled={loading}>{loading ? 'Guardando…' : submitLabel}</button>
      </div>
    </form>
  );
}
