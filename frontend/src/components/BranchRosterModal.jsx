import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import Modal from './Modal.jsx';

// Roster de un equipo en una rama (branch_id viene del contexto, la URL de la
// rama). Dos formas de armarlo: por plantilla de Excel (se descarga con el
// membrete de la liga y se vuelve a subir llena) o capturando jugador por
// jugador abajo.
export default function BranchRosterModal({ branchId, team, token, onClose }) {
  const [roster, setRoster] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ first_name: '', last_name: '', position: '', jersey_number: '', curp: '' });
  const [saving, setSaving] = useState(false);

  const [tplBusy, setTplBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [photoBusyId, setPhotoBusyId] = useState(null);
  const fileRef = useRef(null);
  const photoRef = useRef(null);
  const photoPlayerId = useRef(null);

  useEffect(() => {
    load();
  }, [branchId, team.id]);

  async function load() {
    setError('');
    try {
      const data = await api.getBranchTeamRoster(branchId, team.id, token);
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
      await api.addPlayerToBranchRoster(branchId, team.id, {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        position: form.position.trim() || null,
        jersey_number: form.jersey_number ? Number(form.jersey_number) : null,
        curp: form.curp.trim() || null,
      }, token);
      setForm({ first_name: '', last_name: '', position: '', jersey_number: '', curp: '' });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadTemplate() {
    setTplBusy(true);
    setError('');
    try {
      await api.downloadBranchRosterTemplate(branchId, team.id, token);
    } catch (e) {
      setError(e.message);
    } finally {
      setTplBusy(false);
    }
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setTplBusy(true);
    setError('');
    setImportResult(null);
    try {
      const result = await api.importBranchRoster(branchId, team.id, file, token);
      setImportResult(result);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setTplBusy(false);
    }
  }

  function pickPhoto(playerId) {
    photoPlayerId.current = playerId;
    photoRef.current?.click();
  }

  async function handlePhotoFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const playerId = photoPlayerId.current;
    if (!file || !playerId) return;
    setPhotoBusyId(playerId);
    setError('');
    try {
      const { url } = await api.uploadImage(file, token);
      await api.updateBranchRosterPlayer(branchId, team.id, playerId, { photo_url: url }, token);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setPhotoBusyId(null);
    }
  }

  return (
    <Modal title={`Roster — ${team.name}`} onClose={onClose}>
      {error && <div className="form-error">{error}</div>}

      {/* ── Subir por plantilla de Excel ── */}
      <div className="import-actions" style={{ marginBottom: 20 }}>
        <div className="import-step">
          <span className="import-step-num">1</span>
          <div>
            <div className="import-step-label">Descarga la plantilla con el membrete de la liga</div>
            <button type="button" className="btn btn-outline btn-sm" onClick={handleDownloadTemplate} disabled={tplBusy}>
              {tplBusy ? 'Generando…' : '⬇ Descargar plantilla .xlsx'}
            </button>
          </div>
        </div>
        <div className="import-step">
          <span className="import-step-num">2</span>
          <div>
            <div className="import-step-label">Sube la plantilla ya llena (solo agrega los que falten)</div>
            <input type="file" accept=".xlsx,.xls" ref={fileRef} onChange={handleImportFile} style={{ display: 'none' }} />
            <button type="button" className="btn btn-flag btn-sm" onClick={() => fileRef.current?.click()} disabled={tplBusy}>
              {tplBusy ? 'Procesando…' : '⬆ Subir plantilla llena'}
            </button>
          </div>
        </div>
      </div>

      {importResult && (
        <div className="import-result" style={{ marginBottom: 20 }}>
          <div className="import-result-ok">
            ✅ {importResult.imported} jugador{importResult.imported !== 1 ? 'es' : ''} agregado{importResult.imported !== 1 ? 's' : ''}
          </div>
          {importResult.warnings > 0 && (
            <div className="import-result-warn">
              <strong>ℹ️ {importResult.warnings} aviso{importResult.warnings !== 1 ? 's' : ''}:</strong>
              <ul className="import-skipped-list">
                {importResult.warningRows.map((w, i) => <li key={i}>Fila {w.row}: {w.reason}</li>)}
              </ul>
            </div>
          )}
          {importResult.skipped > 0 && (
            <div className="import-result-warn">
              <strong>⚠️ {importResult.skipped} fila{importResult.skipped !== 1 ? 's' : ''} omitida{importResult.skipped !== 1 ? 's' : ''}:</strong>
              <ul className="import-skipped-list">
                {importResult.skippedRows.map((s, i) => <li key={i}>Fila {s.row}: {s.reason}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <input type="file" accept="image/*" ref={photoRef} onChange={handlePhotoFile} style={{ display: 'none' }} />

      {!roster ? (
        <div className="loading">Cargando…</div>
      ) : roster.length === 0 ? (
        <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Todavía no hay jugadores en el roster de esta rama. Súbelos con la plantilla o agrégalos abajo.</p>
      ) : (
        <div style={{ marginBottom: 20 }}>
          {roster.map((p) => (
            <div key={p.membership_id} className="admin-match-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {p.photo_url
                  ? <img src={p.photo_url} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  : <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--line)', flexShrink: 0, display: 'inline-block' }} />}
                <div>
                  <div className="who">
                    {p.jersey_number != null ? `#${p.jersey_number} · ` : ''}
                    <Link to={`/jugador/${p.id}`} target="_blank" rel="noopener noreferrer">
                      {p.first_name} {p.last_name}
                    </Link>
                  </div>
                  <div className="info">
                    {p.position || 'Sin posición'}
                    {p.curp ? ` · ${p.curp}` : ''}
                    {p.season ? ` · Temporada ${p.season}` : ''}
                  </div>
                </div>
              </div>
              <div className="row-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => pickPhoto(p.id)} disabled={photoBusyId === p.id}>
                  {photoBusyId === p.id ? 'Subiendo…' : (p.photo_url ? 'Cambiar foto' : '+ Foto')}
                </button>
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
            <input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          </div>
          <div className="field">
            <label>Apellido</label>
            <input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          </div>
          <div className="field">
            <label>Posición (ej. QB)</label>
            <input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
          </div>
          <div className="field">
            <label>Número</label>
            <input type="number" value={form.jersey_number} onChange={(e) => setForm({ ...form, jersey_number: e.target.value })} />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>CURP / identificación (opcional)</label>
            <input value={form.curp} onChange={(e) => setForm({ ...form, curp: e.target.value })} />
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
