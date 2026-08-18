import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import Modal from './Modal.jsx';

// Primera versión, deliberadamente simple: ver el roster activo de un
// equipo y agregar jugadores nuevos. No incluye edición ni traspasos desde
// aquí todavía — eso puede sumarse cuando haga falta, sin romper esto.
export default function TeamRosterModal({ team, token, onClose }) {
  const [roster, setRoster] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ first_name: '', last_name: '', position: '', jersey_number: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, [team.id]);

  async function load() {
    setError('');
    try {
      const data = await api.getTeamRoster(team.id, token);
      setRoster(data.roster);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError('Nombre y apellido son obligatorios');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.addPlayerToRoster(team.id, {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        position: form.position.trim() || null,
        jersey_number: form.jersey_number ? Number(form.jersey_number) : null,
      }, token);
      setForm({ first_name: '', last_name: '', position: '', jersey_number: '' });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Roster — ${team.name}`} onClose={onClose}>
      {error && <div className="form-error">{error}</div>}

      {!roster ? (
        <div className="loading">Cargando…</div>
      ) : roster.length === 0 ? (
        <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Todavía no hay jugadores en el roster. Agrega el primero abajo.</p>
      ) : (
        <div style={{ marginBottom: 20 }}>
          {roster.map((p) => (
            <div key={p.membership_id} className="admin-match-row">
              <div>
                <div className="who">
                  {p.jersey_number != null ? `#${p.jersey_number} · ` : ''}{p.first_name} {p.last_name}
                </div>
                <div className="info">{p.position || 'Sin posición'}{p.season ? ` · Temporada ${p.season}` : ''}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAdd}>
        <div style={{ fontSize: 12, letterSpacing: '0.15em', color: 'var(--flag)', textTransform: 'uppercase', marginBottom: 10 }}>
          Agregar jugador
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div className="field">
            <label>Nombre</label>
            <input
              value={form.first_name}
              onChange={(e) => setForm({ ...form, first_name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Apellido</label>
            <input
              value={form.last_name}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Posición (ej. QB)</label>
            <input
              value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Número</label>
            <input
              type="number"
              value={form.jersey_number}
              onChange={(e) => setForm({ ...form, jersey_number: e.target.value })}
            />
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>
          <button type="submit" className="btn btn-flag" disabled={saving}>
            {saving ? 'Guardando…' : '+ Agregar al roster'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
