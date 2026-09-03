import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import MatchForm from '../components/MatchForm.jsx';
import MatchStatsModal from '../components/MatchStatsModal.jsx';
import Modal from '../components/Modal.jsx';
import OrgLogoBar from '../components/OrgLogoBar.jsx';

// Todos los partidos de un Torneo, sin importar de qué Categoría/Rama sean.
// Ruta: /panel/liga/:id/:year/torneo/:tournamentId/partidos
//
// Sirve para dos cosas a la vez: crear partidos a mano sin tener que
// navegar Categoría→Rama primero, y revisar/corregir/publicar los que
// lleguen de un Excel como borrador (Excel: siguiente paso).
export default function TournamentMatchesPanel() {
  const { id, year, tournamentId } = useParams();
  const { token } = useAuth();

  const [tournament, setTournament] = useState(null);
  const [matches, setMatches] = useState(null);
  const [leagueData, setLeagueData] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all' | 'draft' | 'published'
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { type: 'create'|'edit'|'delete', match? }
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [publishReport, setPublishReport] = useState(null);

  useEffect(() => {
    if (!token) return;
    api.getTournaments(id, year, token)
      .then((list) => setTournament(list.find((t) => String(t.id) === tournamentId) || null))
      .catch((e) => setError(e.message));
    api.getManageLeague(id, token).then(setLeagueData).catch((e) => setError(e.message));
  }, [id, year, tournamentId, token]);

  function refreshMatches() {
    api.getTournamentMatches(tournamentId, token).then(setMatches).catch((e) => setError(e.message));
  }

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setImportReport(null);
    setError('');
    try {
      const report = await api.importTournamentMatches(tournamentId, file, token);
      setImportReport(report);
      setFilter('draft');
      refreshMatches();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  async function handlePublishAll() {
    setPublishing(true);
    setPublishReport(null);
    setError('');
    try {
      const report = await api.publishAllDrafts(tournamentId, token);
      setPublishReport(report);
      refreshMatches();
    } catch (err) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  }

  useEffect(() => {
    if (token) refreshMatches();
  }, [tournamentId, token]);

  if (!token) {
    return <div className="container"><p>Necesitas iniciar sesión para ver esto.</p></div>;
  }

  const teams  = leagueData?.teams  || [];
  const venues = leagueData?.venues || [];
  const leagueTimezone = leagueData?.league?.timezone || 'America/Mexico_City';

  const visibleMatches = (matches || []).filter((m) => {
    if (filter === 'draft')     return m.is_draft;
    if (filter === 'published') return !m.is_draft;
    return true;
  });
  const draftCount = (matches || []).filter((m) => m.is_draft).length;

  return (
    <div className="container">
      <OrgLogoBar selectedKind="liga" selectedId={id} />
      <div className="crumb">
        <Link to={`/panel/liga/${id}/estructura`}>← Liga</Link>
      </div>

      <div className="dash-header">
        <div>
          <span className="eyebrow">{tournament ? tournament.name : 'Cargando…'}</span>
          <h1>Partidos del Torneo</h1>
        </div>
        <button className="btn btn-flag" onClick={() => setModal({ type: 'create' })}>+ Crear partido</button>
      </div>

      <div className="modal-actions" style={{ justifyContent: 'flex-start', marginBottom: 16 }}>
        <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
          {importing ? 'Subiendo…' : '⬆ Subir calendario (Excel)'}
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileUpload}
            disabled={importing}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      {importReport && (
        <div className="form-error" style={{ background: 'rgba(255,255,255,0.08)', color: 'inherit' }}>
          <p>
            <strong>{importReport.imported}</strong> partido(s) importado(s) como borrador.
            {importReport.skipped > 0 && <> <strong>{importReport.skipped}</strong> fila(s) rechazada(s).</>}
            {importReport.warnings > 0 && <> <strong>{importReport.warnings}</strong> aviso(s).</>}
          </p>
          {importReport.skippedRows?.length > 0 && (
            <ul>
              {importReport.skippedRows.map((s, i) => (
                <li key={i}>Fila {s.row}: {s.reason}</li>
              ))}
            </ul>
          )}
          {importReport.warningRows?.length > 0 && (
            <ul>
              {importReport.warningRows.map((w, i) => (
                <li key={i}>Fila {w.row}: {w.reason}</li>
              ))}
            </ul>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => setImportReport(null)}>Cerrar</button>
        </div>
      )}

      {error && <div className="form-error">{error}</div>}

      <div className="pill-group" style={{ marginBottom: 16 }}>
        <button type="button" className={`pill-btn${filter === 'all' ? ' pill-btn--active' : ''}`} onClick={() => setFilter('all')}>
          Todos
        </button>
        <button type="button" className={`pill-btn${filter === 'draft' ? ' pill-btn--active' : ''}`} onClick={() => setFilter('draft')}>
          Borradores {draftCount > 0 ? `(${draftCount})` : ''}
        </button>
        <button type="button" className="btn btn-flag btn-sm" disabled={publishing || draftCount === 0} onClick={handlePublishAll}>
          {publishing ? 'Publicando…' : 'Publicar todos'}
        </button>
        <button type="button" className={`pill-btn${filter === 'published' ? ' pill-btn--active' : ''}`} onClick={() => setFilter('published')}>
          Publicados
        </button>
      </div>

      {publishReport && (
        <div className="form-error" style={{ background: 'rgba(255,255,255,0.08)', color: 'inherit' }}>
          <p>
            <strong>{publishReport.published}</strong> partido(s) publicado(s).
            {publishReport.skipped > 0 && (
              <> <strong>{publishReport.skipped}</strong> se quedaron como borrador por necesitar revisión (categoría/rama "Sin clasificar").</>
            )}
          </p>
          <button type="button" className="btn btn-ghost" onClick={() => setPublishReport(null)}>Cerrar</button>
        </div>
      )}

      {matches === null && <p>Cargando…</p>}
      {matches && visibleMatches.length === 0 && (
        <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
          {filter === 'all' ? 'Este torneo todavía no tiene partidos.' : 'No hay partidos en este filtro.'}
        </p>
      )}
      {matches && visibleMatches.length > 0 && (
        <ul>
          {visibleMatches.map((m) => {
            const needsReview = m.category_needs_review || m.branch_needs_review;
            return (
              <li key={m.id} style={{ marginBottom: 10 }}>
                {m.is_draft && <strong style={{ color: 'var(--flag)' }}>[BORRADOR] </strong>}
                {m.category_name} / {m.branch_name || 'sin rama'} — {m.home_team} vs {m.away_team} — {new Date(m.match_date).toLocaleString()} — estado: <strong>{m.status}</strong>
                {needsReview && (
                  <strong style={{ color: 'var(--live)' }}> ⚠ Sin clasificar — edítalo para poder publicar</strong>
                )}
                {' '}
                <button className="btn btn-ghost" onClick={() => setModal({ type: 'edit', match: m })}>Editar</button>
                {' '}
                <button className="btn btn-ghost" onClick={() => setModal({ type: 'stats', match: m })}>Estadísticas</button>
                {' '}
                {m.is_draft && (
                  <button
                    className="btn btn-flag"
                    disabled={needsReview}
                    title={needsReview ? 'Asígnale una categoría y rama reales antes de publicarlo' : ''}
                    onClick={async () => { await api.updateMatch(m.id, { is_draft: false }, token); refreshMatches(); }}
                  >
                    Publicar
                  </button>
                )}
                {' '}
                <button className="btn btn-danger" onClick={() => setModal({ type: 'delete', match: m })}>Eliminar</button>
              </li>
            );
          })}
        </ul>
      )}

      {modal?.type === 'create' && (
        <Modal title="Nuevo partido" onClose={() => setModal(null)}>
          <MatchForm
            submitLabel="Crear partido"
            teams={teams}
            venues={venues}
            groups={[]}
            leagueTimezone={leagueTimezone}
            token={token}
            leagueId={id}
            tournamentId={tournamentId}
            pickCategoryAndBranch
            onVenueCreated={() => api.getManageLeague(id, token).then(setLeagueData)}
            onTeamCreated={() => api.getManageLeague(id, token).then(setLeagueData)}
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.createMatch(payload.category_id, payload, token);
              refreshMatches();
              setModal(null);
            }}
          />
        </Modal>
      )}

      {modal?.type === 'edit' && (
        <Modal title="Editar partido" onClose={() => setModal(null)}>
          <MatchForm
            initial={modal.match}
            submitLabel="Guardar cambios"
            teams={teams}
            venues={venues}
            groups={[]}
            leagueTimezone={leagueTimezone}
            token={token}
            leagueId={id}
            tournamentId={tournamentId}
            pickCategoryAndBranch
            onVenueCreated={() => api.getManageLeague(id, token).then(setLeagueData)}
            onTeamCreated={() => api.getManageLeague(id, token).then(setLeagueData)}
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.updateMatch(modal.match.id, payload, token);
              refreshMatches();
              setModal(null);
            }}
          />
        </Modal>
      )}

      {modal?.type === 'delete' && (
        <Modal title="Eliminar partido" onClose={() => setModal(null)}>
          <p>¿Seguro que quieres eliminar <strong>{modal.match.home_team} vs {modal.match.away_team}</strong>?</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={async () => { await api.deleteMatch(modal.match.id, token); refreshMatches(); setModal(null); }}>Eliminar</button>
          </div>
        </Modal>
      )}

      {modal?.type === 'stats' && (
        <MatchStatsModal match={modal.match} token={token} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
