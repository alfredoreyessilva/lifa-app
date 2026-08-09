import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import { ALL_TIMEZONES } from '../utils/timezones.js';
import CategoryForm from '../components/CategoryForm.jsx';
import Modal from '../components/Modal.jsx';

// Lista y crea las Categorías de un Torneo específico.
// Ruta: /panel/liga/:id/:year/torneo/:tournamentId
//
// El manejo de Partidos/Grupos/Excel de cada categoría TODAVÍA no vive
// aquí — por ahora esta pantalla solo crea/lista categorías. Mientras eso
// se construye, la pantalla vieja (/panel/liga/:id) sigue siendo el único
// lugar real para subir partidos.
export default function CategoriesPanel() {
  const { id, year, tournamentId } = useParams();
  const { token } = useAuth();

  const [tournament, setTournament] = useState(null);
  const [categories, setCategories] = useState(null);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);

  // Descarga la plantilla de calendario de TODO el torneo (todas sus
  // categorías y ramas en un solo archivo). A propósito, esta función
  // todavía no sube nada — solo genera y descarga el Excel, con las
  // Categorías/Ramas/Equipos/Sedes ya existentes como referencia, para que
  // el organizador copie los nombres exactos al llenarlo.
  async function downloadTournamentTemplate() {
    setDownloadingTemplate(true);
    setError('');
    try {
      // Cada categoría trae sus propias ramas — se consultan todas antes de
      // armar el archivo, para que la hoja de referencia quede completa.
      const cats = categories || [];
      const branchesByCategory = await Promise.all(
        cats.map((c) => api.getBranches(c.id, token))
      );

      const league = await api.getManageLeague(id, token);
      const teamNames  = (league.teams  || []).map((t) => t.name);
      const venueNames = (league.venues || []).map((v) => v.name);

      const headers = [
        'Categoría',
        'Rama',
        'Fecha',
        'Hora',
        'Equipo Local',
        'Equipo Visitante',
        'Sede',
        'Conferencia (opcional)',
        'Grupo (opcional)',
        'Jornada',
        'Link de transmisión',
        'Link de boletos',
        'Zona horaria (código)',
        'Marcador Local',
        'Marcador Visitante',
      ];

      const example = [
        cats[0]?.name || 'BANTAM',
        branchesByCategory[0]?.[0]?.name || 'Varonil',
        '15/09/2025',
        '18:00',
        'Mayas CDMX',
        'Fundidores MTY',
        'Estadio Azteca',
        '',
        '',
        '1',
        'https://youtube.com/...',
        'https://boletos.com/...',
        'America/Mexico_City',
        '',
        '',
      ];

      const ws = XLSX.utils.aoa_to_sheet([headers, example]);
      ['C2', 'D2'].forEach((cell) => {
        if (ws[cell]) { ws[cell].t = 's'; ws[cell].z = '@'; }
      });
      ws['!cols'] = [
        { wch: 16 }, { wch: 14 }, { wch: 14, z: '@' }, { wch: 8, z: '@' },
        { wch: 22 }, { wch: 22 }, { wch: 20 }, { wch: 20 }, { wch: 16 },
        { wch: 14 }, { wch: 35 }, { wch: 35 }, { wch: 24 }, { wch: 14 }, { wch: 16 },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Calendario');

      // Hoja de referencia: qué Categorías existen, y qué Ramas tiene cada
      // una — escritas juntas ("Categoría / Rama") para que quede claro cuál
      // rama pertenece a cuál categoría al copiar y pegar.
      const categoryBranchPairs = [];
      cats.forEach((c, i) => {
        const branches = branchesByCategory[i] || [];
        if (branches.length === 0) {
          categoryBranchPairs.push(`${c.name}  (sin ramas todavía)`);
        } else {
          branches.forEach((b) => categoryBranchPairs.push(`${c.name} / ${b.name}`));
        }
      });
      const tzOptions = ALL_TIMEZONES.map((tz) => `${tz.value}  —  ${tz.label}`);
      const maxLen = Math.max(categoryBranchPairs.length, teamNames.length, venueNames.length, tzOptions.length, 1);

      const refRows = [[
        'Categoría / Rama (copia el nombre exacto de cada columna por separado)',
        'Equipos registrados',
        'Sedes registradas',
        'Zonas horarias válidas (copia solo el código antes del —)',
      ]];
      for (let i = 0; i < maxLen; i++) {
        refRows.push([categoryBranchPairs[i] || '', teamNames[i] || '', venueNames[i] || '', tzOptions[i] || '']);
      }
      const refWs = XLSX.utils.aoa_to_sheet(refRows);
      refWs['!cols'] = [{ wch: 34 }, { wch: 24 }, { wch: 24 }, { wch: 50 }];
      XLSX.utils.book_append_sheet(wb, refWs, 'Referencia');

      XLSX.writeFile(wb, `plantilla_calendario_${(tournament?.name || 'torneo').replace(/\s+/g, '_')}.xlsx`);
    } catch (e) {
      setError(e.message);
    } finally {
      setDownloadingTemplate(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    api.getTournaments(id, year, token)
      .then((list) => setTournament(list.find((t) => String(t.id) === tournamentId) || null))
      .catch((e) => setError(e.message));
  }, [id, year, tournamentId, token]);

  function refreshCategories() {
    api.getCategoriesForTournament(tournamentId, token).then(setCategories).catch((e) => setError(e.message));
  }

  useEffect(() => {
    if (token) refreshCategories();
  }, [tournamentId, token]);

  if (!token) {
    return <div className="container"><p>Necesitas iniciar sesión para ver esto.</p></div>;
  }

  return (
    <div className="container">
      <div className="crumb">
        <Link to={`/panel/liga/${id}/torneos`}>← Torneos</Link>
      </div>

      <div className="dash-header">
        <div>
          <span className="eyebrow">{tournament ? tournament.name : 'Cargando…'}</span>
          <h1>Categorías</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to={`/panel/liga/${id}/${year}/torneo/${tournamentId}/partidos`} className="btn btn-ghost">
            Partidos del Torneo →
          </Link>
          <button className="btn btn-flag" onClick={() => setShowCreate(true)}>+ Crear categoría</button>
        </div>
      </div>

      {categories && categories.length > 0 && (
        <div className="modal-actions" style={{ justifyContent: 'flex-start', marginBottom: 16 }}>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={downloadingTemplate}
            onClick={downloadTournamentTemplate}
          >
            {downloadingTemplate ? 'Generando…' : '⬇ Descargar plantilla de calendario (todo el torneo)'}
          </button>
        </div>
      )}

      {error && <div className="form-error">{error}</div>}

      {categories === null && <p>Cargando…</p>}
      {categories && categories.length === 0 && (
        <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
          Este torneo todavía no tiene categorías. Crea la primera para empezar.
        </p>
      )}
      {categories && categories.length > 0 && (
        <div className="league-grid">
          {categories.map((c) => (
            <Link
              key={c.id}
              to={`/panel/liga/${id}/${year}/torneo/${tournamentId}/categoria/${c.id}`}
              className="league-card"
            >
              <h3>{c.name}</h3>
              {c.auto_status_enabled && (
                <span className="state">Auto: {c.auto_status_window_hours}h</span>
              )}
            </Link>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="Nueva categoría" onClose={() => setShowCreate(false)}>
          <CategoryForm
            submitLabel="Crear categoría"
            onCancel={() => setShowCreate(false)}
            onSubmit={async (data) => {
              await api.createCategoryForTournament(tournamentId, data, token);
              refreshCategories();
              setShowCreate(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
