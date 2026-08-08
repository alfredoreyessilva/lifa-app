import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import TournamentForm from '../components/TournamentForm.jsx';
import Modal from '../components/Modal.jsx';
import LeagueRoster from '../components/LeagueRoster.jsx';

// Lista y crea TODOS los Torneos de una liga (de cualquier año — el año se
// captura en el formulario de creación, no se elige antes), y también
// (pestaña aparte) el roster de equipos "de la casa" de la liga.
// Ruta: /panel/liga/:id/torneos
//
// Se llega aquí navegando de forma real: clic en el logo de la liga en
// /panel. Antes existía un paso intermedio para elegir año primero
// (LeagueYearPicker, /panel/liga/:id/anio) — se quitó porque no hacía
// falta; el archivo sigue en el proyecto por si se vuelve a necesitar,
// pero ya no tiene ruta que lo alcance.
export default function TournamentsYearPanel() {
  const { id } = useParams();
  const { token, leagues } = useAuth();
  const league = leagues.find((lg) => String(lg.id) === id);

  const [tab, setTab] = useState('torneos'); // 'torneos' | 'roster'

  const [tournaments, setTournaments] = useState(null);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  // Borrar torneo: destructivo e irreversible (borra en cascada categorías,
  // ramas, y TODOS sus partidos), así que se pide escribir el nombre del
  // torneo tal cual para confirmar, en vez de solo un "¿estás seguro?".
  const [deleteTarget, setDeleteTarget] = useState(null); // torneo a borrar, o null
  const [confirmInput, setConfirmInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  function refresh() {
    api.getTournaments(id, undefined, token).then(setTournaments).catch((e) => setError(e.message));
  }

  useEffect(() => {
    if (token) refresh();
  }, [id, token]);

  function openDelete(e, tournament) {
    e.preventDefault(); // la tarjeta es un <Link>; no navegar al hacer clic en el bote de basura
    e.stopPropagation();
    setDeleteTarget(tournament);
    setConfirmInput('');
    setDeleteError('');
  }

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError('');
    try {
      await api.deleteTournament(deleteTarget.id, token);
      setDeleteTarget(null);
      refresh();
    } catch (e) {
      setDeleteError(e.message);
    } finally {
      setDeleting(false);
    }
  }

  if (!token) {
    return <div className="container"><p>Necesitas iniciar sesión para ver esto.</p></div>;
  }

  if (!league) {
    return <div className="container"><p>No administras ninguna liga con ese id.</p></div>;
  }

  return (
    <div className="container">
      <div className="dash-header">
        <div>
          <span className="eyebrow">{league.name}</span>
          <h1>{tab === 'torneos' ? 'Torneos' : 'Equipos de la liga'}</h1>
        </div>
        {tab === 'torneos' && (
          <button className="btn btn-flag" onClick={() => setShowCreate(true)}>+ Crear torneo</button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button
          type="button"
          className={tab === 'torneos' ? 'btn btn-flag btn-sm' : 'btn btn-outline btn-sm'}
          onClick={() => setTab('torneos')}
        >
          Torneos
        </button>
        <button
          type="button"
          className={tab === 'roster' ? 'btn btn-flag btn-sm' : 'btn btn-outline btn-sm'}
          onClick={() => setTab('roster')}
        >
          Equipos de la liga
        </button>
      </div>

      {tab === 'torneos' && (
        <>
          {error && <div className="form-error">{error}</div>}

          {tournaments === null && <p>Cargando…</p>}
          {tournaments && tournaments.length === 0 && (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
              Todavía no has creado ningún torneo. Crea el primero para empezar.
            </p>
          )}
          {tournaments && tournaments.length > 0 && (
            <div className="league-grid">
              {tournaments.map((t) => (
                <div key={t.id} style={{ position: 'relative' }}>
                  <Link to={`/panel/liga/${id}/${t.year}/torneo/${t.id}`} className="league-card">
                    <h3>{t.name}</h3>
                    <span className="state">{t.year}</span>
                  </Link>
                  <button
                    type="button"
                    onClick={(e) => openDelete(e, t)}
                    title="Eliminar torneo"
                    style={{
                      position: 'absolute', top: 8, right: 8,
                      width: 28, height: 28, borderRadius: '50%',
                      border: '1px solid var(--line)', background: 'var(--card)',
                      color: 'var(--ink-dim)', cursor: 'pointer', fontSize: 14, lineHeight: 1,
                    }}
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          )}

          {showCreate && (
            <Modal title="Nuevo torneo" onClose={() => setShowCreate(false)}>
              <TournamentForm
                submitLabel="Crear torneo"
                onCancel={() => setShowCreate(false)}
                onSubmit={async (data) => {
                  await api.createTournament(id, data, token);
                  refresh();
                  setShowCreate(false);
                }}
              />
            </Modal>
          )}

          {deleteTarget && (
            <Modal title={`Eliminar "${deleteTarget.name}"`} onClose={() => setDeleteTarget(null)}>
              <p style={{ color: 'var(--ink-dim)', fontSize: 14, marginBottom: 16 }}>
                Esto borra el torneo <strong>{deleteTarget.name}</strong> ({deleteTarget.year}) y, junto con él,
                <strong> todas sus categorías, ramas y partidos</strong> — para siempre, sin poder deshacerlo.
              </p>
              {deleteError && <div className="form-error">{deleteError}</div>}
              <div className="field">
                <label>Escribe el nombre del torneo para confirmar: <strong>{deleteTarget.name}</strong></label>
                <input
                  type="text"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>Cancelar</button>
                <button
                  type="button"
                  className="btn btn-flag"
                  style={{ background: 'var(--flag)' }}
                  disabled={deleting || confirmInput !== deleteTarget.name}
                  onClick={confirmDelete}
                >
                  {deleting ? 'Eliminando…' : 'Eliminar torneo para siempre'}
                </button>
              </div>
            </Modal>
          )}
        </>
      )}

      {tab === 'roster' && (
        <LeagueRoster leagueId={id} token={token} />
      )}
    </div>
  );
}
