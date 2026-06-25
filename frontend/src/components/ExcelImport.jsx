import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function ExcelImport({ categoryId, categoryName, onDone, onCancel }) {
  const { token } = useAuth();
  const fileRef   = useRef(null);
  const [result,   setResult]   = useState(null); // { imported, skipped, skippedRows }
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  // ── Descargar plantilla ──────────────────────────────────────────────────
  function downloadTemplate() {
    const headers = [
      'Fecha',
      'Hora',
      'Equipo Local',
      'Equipo Visitante',
      'Sede',
      'Jornada',
      'Link de transmisión',
    ];

    const example = [
      '15/09/2025',
      '18:00',
      'Mayas CDMX',
      'Fundidores MTY',
      'Estadio Azteca',
      '1',
      'https://youtube.com/...',
    ];

    const ws = XLSX.utils.aoa_to_sheet([headers, example]);

    // Forzar Fecha (A2) y Hora (B2) como texto para que Excel
    // no las convierta automáticamente a número o fecha serial.
    ['A2', 'B2'].forEach((cell) => {
      if (ws[cell]) {
        ws[cell].t = 's'; // tipo string
        ws[cell].z = '@'; // formato texto
      }
    });

    // Formato texto en toda la columna A y B (filas 1-200)
    if (!ws['!cols']) ws['!cols'] = [];
    ws['!cols'][0] = { wch: 14, z: '@' }; // Fecha → texto
    ws['!cols'][1] = { wch: 8,  z: '@' }; // Hora  → texto

    // Anchos de columna
    ws['!cols'] = [
      { wch: 14, z: '@' }, { wch: 8, z: '@' }, { wch: 22 }, { wch: 22 },
      { wch: 20 }, { wch: 14 }, { wch: 35 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Calendario');
    XLSX.writeFile(wb, `plantilla_calendario_${categoryName.replace(/\s+/g, '_')}.xlsx`);
  }

  // ── Subir archivo ────────────────────────────────────────────────────────
  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setResult(null);
    setLoading(true);

    try {
      const data = await api.importMatches(categoryId, file, token);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  }

  return (
    <div>
      {/* Aviso inicial */}
      {!result && (
        <div className="import-notice">
          ⚠️ En caso de ser detectado un error, la casilla quedará vacía pero podrás rellenarla manualmente desde el panel.
        </div>
      )}

      {error && <div className="form-error">{error}</div>}

      {/* Resultado de la importación */}
      {result && (
        <div className="import-result">
          <div className="import-result-ok">
            ✅ {result.imported} partido{result.imported !== 1 ? 's' : ''} importado{result.imported !== 1 ? 's' : ''} correctamente
          </div>

          {result.skipped > 0 && (
            <div className="import-result-warn">
              <strong>⚠️ {result.skipped} fila{result.skipped !== 1 ? 's' : ''} omitida{result.skipped !== 1 ? 's' : ''}:</strong>
              <ul className="import-skipped-list">
                {result.skippedRows.map((s, i) => (
                  <li key={i}>Fila {s.row}: {s.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Acciones */}
      {!result ? (
        <div className="import-actions">
          <div className="import-step">
            <span className="import-step-num">1</span>
            <div>
              <div className="import-step-label">Descarga la plantilla</div>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={downloadTemplate}
              >
                ⬇ Descargar plantilla .xlsx
              </button>
            </div>
          </div>

          <div className="import-step">
            <span className="import-step-num">2</span>
            <div>
              <div className="import-step-label">Llena el calendario y súbelo</div>
              <input
                type="file"
                accept=".xlsx,.xls"
                ref={fileRef}
                onChange={handleFile}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                className="btn btn-flag btn-sm"
                onClick={() => fileRef.current?.click()}
                disabled={loading}
              >
                {loading ? 'Importando…' : '⬆ Subir archivo Excel'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="import-actions" style={{ marginTop: 16 }}>
          {/* Permitir subir otro archivo si quieren */}
          <input
            type="file"
            accept=".xlsx,.xls"
            ref={fileRef}
            onChange={handleFile}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => { setResult(null); fileRef.current?.click(); }}
          >
            Subir otro archivo
          </button>
        </div>
      )}

      <div className="modal-actions" style={{ marginTop: 20 }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          {result ? 'Cerrar' : 'Cancelar'}
        </button>
        {result && result.imported > 0 && (
          <button type="button" className="btn btn-flag" onClick={onDone}>
            Ver partidos importados
          </button>
        )}
      </div>
    </div>
  );
}
