import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import Modal from './Modal.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';

// Roster de un equipo en una rama (branch_id viene del contexto, la URL de la
// rama). Dos formas de armarlo: por plantilla de Excel (se descarga con el
// membrete de la liga y se vuelve a subir llena) o capturando jugador por
// jugador abajo.
//
// `teamSide` lo pasa el panel del EQUIPO y no el de la liga: es lo que decide
// si el interruptor de la foto se puede tocar. La liga ve el estado, porque es
// suya la decisión de arriba (la de la categoría), pero el veto sobre las caras
// de sus jugadores es del equipo y solo del equipo — quien lo intente desde el
// otro lado se topa con un 403, esto solo esconde el botón.
export default function BranchRosterModal({ branchId, team, token, teamSide = false, onClose }) {
  const [roster, setRoster] = useState(null);
  const [visibility, setVisibility] = useState(null);
  // El acumulado de asistencia, por jugador. Es lectura y va aparte del roster
  // porque no siempre se puede: un rol que administra el roster pero no alcanza
  // la asistencia simplemente no lo ve, y eso no es un error que pintar.
  const [asistencia, setAsistencia] = useState(null);
  const [photosBusy, setPhotosBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ first_name: '', last_name: '', position: '', jersey_number: '', curp: '' });
  const [saving, setSaving] = useState(false);

  const [tplBusy, setTplBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [photoBusyId, setPhotoBusyId] = useState(null);
  const [removing, setRemoving] = useState(null);
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
      setVisibility(data.visibility);
      api.getBranchTeamAttendance(branchId, team.id, token)
        .then(setAsistencia)
        .catch(() => setAsistencia(null));
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

  // El equipo solo puede APAGAR. Por eso la casilla manda `false` (no publico
  // fotos) o `null` (sigo a la categoría) y nunca `true`: encender no es una
  // operación que este lado tenga, y `null` ya significa "lo que diga la liga".
  async function handlePhotos(veto) {
    setPhotosBusy(true);
    setError('');
    try {
      const { visibility: next } = await api.setBranchTeamPhotos(branchId, team.id, veto ? false : null, token);
      setVisibility(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setPhotosBusy(false);
    }
  }

  // `hard` viene de la casilla del diálogo: apagada da de baja (queda el paso
  // por el equipo en el historial del jugador), prendida borra sin rastro.
  async function handleRemove(hard) {
    await api.removePlayerFromBranchRoster(branchId, team.id, removing.id, { hard }, token);
    setRemoving(null);
    await load();
  }

  // El acumulado no existe hasta que alguien pasa lista, y un equipo sin
  // partidos todavía no le debe nada a nadie: en los dos casos no se pinta
  // nada, en vez de una fila de ceros que se lee como "faltó a todos".
  function cuentaDe(playerId) {
    if (!asistencia || asistencia.matches === 0) return null;
    const fila = asistencia.players.find((p) => p.id === playerId);
    return fila && fila.convocables > 0 ? fila : null;
  }

  return (
    <Modal title={`Roster — ${team.name}`} onClose={onClose}>
      {error && <div className="form-error">{error}</div>}

      {/* ── En qué estado está la publicación de este roster ──
          Va arriba de todo porque cambia el significado de lo que sigue: subir
          una foto no es lo mismo si esa foto va a salir en una página abierta.
          Quien administra el roster tiene que saberlo ANTES de subirla, no
          después. */}
      {visibility && (
        <div className="roster-visibility">
          {!visibility.roster_public ? (
            <p className="roster-visibility-line">
              <strong>Roster privado.</strong> La liga no publica el roster de esta categoría:
              nada de lo que captures aquí sale en público.
            </p>
          ) : (
            <>
              <p className="roster-visibility-line">
                <strong>Roster público.</strong> De esta rama se publica el <strong>nombre, el
                número y la posición</strong> de cada jugador. La CURP y la fecha de nacimiento
                no salen nunca, y la asistencia tampoco.
              </p>
              <p className="roster-visibility-line">
                {!visibility.roster_photos
                  ? 'La categoría no permite fotos, así que ninguna sale en público.'
                  : visibility.photos_visible
                    ? 'La foto de tus jugadores sí sale en público.'
                    : 'Apagaste la foto para este roster: no sale, aunque la categoría la permita.'}
              </p>
              {teamSide && (
                <label className="roster-visibility-toggle">
                  <input
                    type="checkbox"
                    checked={visibility.show_photos === false}
                    disabled={photosBusy}
                    onChange={(e) => handlePhotos(e.target.checked)}
                  />
                  No publicar la foto de mis jugadores en este roster
                  {photosBusy ? ' — guardando…' : ''}
                </label>
              )}
            </>
          )}
        </div>
      )}

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
                  {/* Las tres cifras, separadas y sin porcentaje: la plataforma
                      entrega el conteo y el criterio de elegibilidad es de la
                      liga (regla 10 de CLAUDE.md). */}
                  {cuentaDe(p.id) && (
                    <div className="info roster-attendance">
                      {cuentaDe(p.id).presentes} presentes · {cuentaDe(p.id).ausentes} ausentes
                      {' '}· {cuentaDe(p.id).sin_marcar} sin pasar lista
                      {' '}<span style={{ opacity: 0.6 }}>de {cuentaDe(p.id).convocables}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="row-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => pickPhoto(p.id)} disabled={photoBusyId === p.id}>
                  {photoBusyId === p.id ? 'Subiendo…' : (p.photo_url ? 'Cambiar foto' : '+ Foto')}
                </button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => setRemoving(p)}>
                  Quitar
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
          <button type="submit" className="btn btn-accent" disabled={saving}>
            {saving ? 'Guardando…' : '+ Agregar al roster'}
          </button>
        </div>
      </form>

      {/* Va dentro del Modal en el árbol de React, pero Modal.jsx monta con
          createPortal en document.body, así que el diálogo sale encima y no
          anidado dentro de esta tarjeta. */}
      {removing && (
        <ConfirmDialog
          danger
          title="Quitar del roster"
          message={`${removing.first_name} ${removing.last_name} saldrá del roster de esta rama.`}
          detail="Solo afecta a esta rama. Si está dado de alta en otra rama o en otro equipo, ahí se queda."
          confirmLabel="Quitar del roster"
          checkboxLabel="Fue un error de captura"
          checkboxHint="Bórralo sin dejar rastro. Si no marcas esto, queda como baja y su paso por el equipo se sigue viendo en su historial de jugador."
          onConfirm={(_reason, hard) => handleRemove(hard)}
          onClose={() => setRemoving(null)}
        />
      )}
    </Modal>
  );
}
