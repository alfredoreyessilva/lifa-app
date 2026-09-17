import { useState } from 'react';
import { maxLength, validEmail, runValidations } from '../utils/validation.js';
import LogoField from './LogoField.jsx';

const STATUS_LABELS = {
  activo: 'Activo — se le cobra normal',
  beca: 'Becado — entra en los cargos con monto 0',
  baja: 'Baja — ya no se le genera cargo',
};

// Alta y edición de alguien del padrón del club.
//
// Esto NO es el roster de torneo. El roster lo arma la liga por rama y sirve
// para elegibilidad; esto es la gente que entrena con el club y a la que el
// club le cobra. Un equipo sin liga tiene padrón igual, y uno con liga puede
// tener aquí a gente que no está inscrita en ninguna rama (el que llegó a
// media temporada, el que solo entrena). Por eso no se piden ni rama ni
// categoría de la liga: la agrupación la decide el club.
export default function ClubMemberForm({ member, statuses, onSubmit, onCancel }) {
  const isEdit = !!member;
  const [form, setForm] = useState({
    display_name: member?.display_name || '',
    birth_date: member?.birth_date ? String(member.birth_date).slice(0, 10) : '',
    position: member?.position || '',
    jersey_number: member?.jersey_number != null ? String(member.jersey_number) : '',
    photo_url: member?.photo_url || '',
    curp: member?.curp || '',
    group_label: member?.group_label || '',
    monthly_amount: member?.monthly_amount != null ? String(member.monthly_amount) : '',
    status: member?.status || 'activo',
    tutor_name: member?.tutor_name || '',
    tutor_phone: member?.tutor_phone || '',
    tutor_email: member?.tutor_email || '',
    note: member?.note || '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setError('');

    if (!form.display_name.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    const validationError = runValidations([
      () => maxLength(form.group_label, 40, 'La categoría'),
      () => maxLength(form.tutor_name, 80, 'El nombre del tutor'),
      () => maxLength(form.tutor_phone, 20, 'El teléfono'),
      () => (form.tutor_email ? validEmail(form.tutor_email) : null),
    ]);
    if (validationError) { setError(validationError); return; }

    if (form.monthly_amount !== '' && Number(form.monthly_amount) < 0) {
      setError('La cuota no puede ser negativa.');
      return;
    }

    setLoading(true);
    try {
      await onSubmit({
        display_name: form.display_name.trim(),
        birth_date: form.birth_date || null,
        position: form.position.trim() || null,
        jersey_number: form.jersey_number === '' ? null : Number(form.jersey_number),
        photo_url: form.photo_url || null,
        curp: form.curp.trim().toUpperCase() || null,
        group_label: form.group_label.trim() || null,
        monthly_amount: form.monthly_amount === '' ? null : Number(form.monthly_amount),
        status: form.status,
        tutor_name: form.tutor_name.trim() || null,
        tutor_phone: form.tutor_phone.trim() || null,
        tutor_email: form.tutor_email.trim() || null,
        note: form.note.trim() || null,
      });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}

      <div className="ws-section-title" style={{ marginTop: 0 }}>Quién es</div>

      <div className="field">
        <label>Nombre</label>
        <input value={form.display_name} onChange={(e) => update('display_name', e.target.value)}
          placeholder="Juan Pérez" />
        <small style={{ color: 'var(--ws-ink-faint)' }}>
          Como le dicen en el equipo. Si a alguien se le conoce por su apodo, va el apodo:
          es el nombre que verás en la lista de cobro y el que lee su papá en el estado de cuenta.
        </small>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Categoría del club</label>
          <input value={form.group_label} onChange={(e) => update('group_label', e.target.value)} placeholder="U17" />
        </div>
        <div className="field">
          <label>Número</label>
          <input type="number" min="0" max="999" value={form.jersey_number}
            onChange={(e) => update('jersey_number', e.target.value)} placeholder="7" />
        </div>
        <div className="field">
          <label>Posición</label>
          <input value={form.position} onChange={(e) => update('position', e.target.value)} placeholder="QB" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Fecha de nacimiento (opcional)</label>
          <input type="date" value={form.birth_date} onChange={(e) => update('birth_date', e.target.value)} />
        </div>
        <div className="field">
          <label>CURP (opcional)</label>
          <input value={form.curp} onChange={(e) => update('curp', e.target.value.toUpperCase())} maxLength={18} />
        </div>
      </div>

      <LogoField value={form.photo_url} onChange={(v) => update('photo_url', v)} label="Foto (opcional)" />

      <div className="ws-section-title">Cuánto paga</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Cuota mensual (MXN)</label>
          <input type="number" min="0" step="0.01" value={form.monthly_amount}
            onChange={(e) => update('monthly_amount', e.target.value)} placeholder="800" />
        </div>
        <div className="field">
          <label>Situación</label>
          <select value={form.status} onChange={(e) => update('status', e.target.value)}>
            {(statuses || Object.keys(STATUS_LABELS)).map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="ws-section-title">A quién se le cobra</div>

      <div className="field">
        <label>Nombre del tutor o responsable de pago (opcional)</label>
        <input value={form.tutor_name} onChange={(e) => update('tutor_name', e.target.value)}
          placeholder="Mamá, papá o el jugador mismo" />
      </div>

      <div className="field">
        <label>WhatsApp del tutor</label>
        <input value={form.tutor_phone} onChange={(e) => update('tutor_phone', e.target.value)}
          placeholder="5215512345678" />
        <small style={{ color: 'var(--ws-ink-faint)' }}>
          Con lada de país, sin espacios ni guiones. Es lo que hace que el botón de recordatorio
          abra WhatsApp con el mensaje y el link ya escritos.
        </small>
      </div>

      <div className="field">
        <label>Correo del tutor (opcional)</label>
        <input type="email" value={form.tutor_email} onChange={(e) => update('tutor_email', e.target.value)} />
      </div>

      <div className="field">
        <label>Nota interna (opcional)</label>
        <input value={form.note} onChange={(e) => update('note', e.target.value)} placeholder="Solo la ves tú" />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-accent" disabled={loading}>
          {loading ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Agregar al padrón'}
        </button>
      </div>
    </form>
  );
}
