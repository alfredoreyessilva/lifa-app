import { useState } from 'react';

// Copia jugadores de un roster de torneo al padrón del club.
//
// Es un atajo de captura, no un enlace: se copian los nombres una vez y de ahí
// en adelante los dos padrones viven cada uno por su lado. Si la liga después
// da de baja a alguien de su roster, el club lo sigue teniendo (y cobrándole)
// sin enterarse — que es justo lo que se quiere.
export default function ImportRosterModal({ branches, onCancel, onSubmit }) {
  const [branchId, setBranchId] = useState(branches[0]?.branch_id || '');
  const [groupLabel, setGroupLabel] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const selected = branches.find((b) => String(b.branch_id) === String(branchId));

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!branchId) { setError('Elige de qué rama quieres copiar.'); return; }

    setLoading(true);
    try {
      const r = await onSubmit({
        branch_id: Number(branchId),
        group_label: groupLabel.trim() || null,
      });
      setResult(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <div>
        <div className="form-success">
          Se agregaron {result.imported} al padrón
          {result.skipped > 0 && <>; {result.skipped} ya estaban y se saltaron</>}.
        </div>
        <p style={{ fontSize: 13, color: 'var(--ws-ink-dim)' }}>
          Ahora ponles su cuota para que entren en el cobro del mes.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-accent" onClick={onCancel}>Listo</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}

      <p style={{ fontSize: 13, color: 'var(--ws-ink-dim)', marginTop: 0 }}>
        Copia los nombres del roster con el que juegan, para no volverlos a teclear. Es una
        copia de una sola vez: después, tu padrón y el roster de la liga son independientes.
      </p>

      <div className="field">
        <label>Copiar de</label>
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {branches.map((b) => (
            <option key={b.branch_id} value={b.branch_id}>
              {b.tournament_name || 'Sin torneo'} · {b.category_name} · {b.branch_name} ({b.roster_count})
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Ponerlos en la categoría (opcional)</label>
        <input value={groupLabel} onChange={(e) => setGroupLabel(e.target.value)} placeholder="U17" />
        <small style={{ color: 'var(--ws-ink-faint)' }}>
          Tu propia agrupación para cobrarles juntos. No tiene que llamarse igual que la rama.
        </small>
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-accent" disabled={loading}>
          {loading ? 'Copiando…' : `Copiar ${selected ? selected.roster_count : ''} jugadores`.replace('  ', ' ')}
        </button>
      </div>
    </form>
  );
}
