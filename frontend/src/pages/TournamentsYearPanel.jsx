import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import TournamentForm from '../components/TournamentForm.jsx';
import Modal from '../components/Modal.jsx';
import LeagueRoster from '../components/LeagueRoster.jsx';
import OrgLogoBar from '../components/OrgLogoBar.jsx';
import EditLeagueForm from '../components/EditLeagueForm.jsx';
import VenueForm from '../components/VenueForm.jsx';

// Lista y crea TODOS los Torneos de una liga (de cualquier año — el año se
// captura en el formulario de creación, no se elige antes); también trae
// (pestañas aparte) el roster de equipos "de la casa" de la liga, y la
// pestaña "Liga" — todo lo que antes solo vivía en la pantalla vieja
// (/panel/liga/:id, hoy sin ningún link que la alcance): solicitar
// publicación, editar info de la liga, y sedes con todos sus datos.
// Ruta: /panel/liga/:id/torneos
export default function TournamentsYearPanel() {
  const { id } = useParams();
  const { token, leagues, refreshLeagues } = useAuth();
  const league = leagues.find((lg) => String(lg.id) === id);

  const [tab, setTab] = useState('torneos'); // 'torneos' | 'roster' | 'liga'

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

  // Pestaña "Liga": info completa (para publicar/editar) + sedes.
  const [leagueData, setLeagueData] = useState(null);
  const [leagueDataError, setLeagueDataError] = useState('');
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [ligaModal, setLigaModal] = useState(null); // { type: 'edit-league' | 'add-venue' | 'edit-venue' | 'delete-venue', venue? }

  function refresh() {
    api.getTournaments(id, undefined, token).then(setTournaments).catch((e) => setError(e.message));
  }

  useEffect(() => {
    if (token) refresh();
  }, [id, token]);

  function refreshLeagueData() {
    api.getManageLeague(id, token).then(setLeagueData).catch((e) => setLeagueDataError(e.message));
  }

  useEffect(() => {
    if (token) refreshLeagueData();
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

  async function requestPublish() {
    setVisibilityBusy(true);
    try { await api.requestPublishLeague(id, token); refreshLeagueData(); }
    catch (e) { setLeagueDataError(e.message); }
    finally { setVisibilityBusy(false); }
  }
  async function cancelRequest() {
    setVisibilityBusy(true);
    try { await api.cancelPublishRequest(id, token); refreshLeagueData(); }
    catch (e) { setLeagueDataError(e.message); }
    finally { setVisibilityBusy(false); }
  }
  async function unpublish() {
    setVisibilityBusy(true);
    try { await api.unpublishOwnLeague(id, token); refreshLeagueData(); }
    catch (e) { setLeagueDataError(e.message); }
    finally { setVisibilityBusy(false); }
  }

  if (!token) {
    return <div className="container"><p>Necesitas iniciar sesión para ver esto.</p></div>;
  }

  if (!league) {
    return <div className="container"><p>No administras ninguna liga con ese id.</p></div>;
  }

  const isPublic = leagueData?.league?.is_public;
  const publishRequested = leagueData?.league?.publish_requested;
  const venues = leagueData?.venues || [];

  return (
    <div className="container">
      <OrgLogoBar selectedKind="liga" selectedId={id} />
      <div className="dash-header">
        <div>
          <span className="eyebrow">{league.name}</span>
          <h1>{tab === 'torneos' ? 'Torneos' : tab === 'roster' ? 'Equipos de la liga' : 'Liga'}</h1>
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
        <button
          type="button"
          className={tab === 'liga' ? 'btn btn-flag btn-sm' : 'btn btn-outline btn-sm'}
          onClick={() => setTab('liga')}
        >
          Liga
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

      {tab === 'liga' && (
        <>
          {leagueDataError && <div className="form-error">{leagueDataError}</div>}

          {!leagueData ? (
            <p>Cargando…</p>
          ) : (
            <>
              <div
                className="form-error"
                style={{
                  background: isPublic ? 'rgba(58,141,63,0.12)' : 'rgba(255,210,63,0.12)',
                  borderColor: isPublic ? 'var(--field)' : 'var(--flag)',
                  color: 'var(--ink)', display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
                }}
              >
                <span>
                  {isPublic
                    ? '✓ Tu liga es pública — cualquiera puede verla en el sitio.'
                    : publishRequested
                      ? '⏳ Ya solicitaste aparecer en el panel de ligas. Un administrador va a revisarlo.'
                      : 'Tu liga es privada por ahora — puedes usar todas las herramientas sin que nadie más la vea.'}
                </span>
                <span style={{ display: 'flex', gap: 8 }}>
                  {isPublic && (
                    <button className="btn btn-ghost btn-sm" disabled={visibilityBusy} onClick={unpublish}>
                      Ocultar mi liga
                    </button>
                  )}
                  {!isPublic && !publishRequested && (
                    <button className="btn btn-flag btn-sm" disabled={visibilityBusy} onClick={requestPublish}>
                      Solicitar aparecer en el panel de ligas
                    </button>
                  )}
                  {!isPublic && publishRequested && (
                    <button className="btn btn-ghost btn-sm" disabled={visibilityBusy} onClick={cancelRequest}>
                      Cancelar solicitud
                    </button>
                  )}
                </span>
              </div>

              <div className="section-head" style={{ marginTop: 24 }}>
                <h2>Información de la liga</h2>
                <button className="btn btn-outline btn-sm" onClick={() => setLigaModal({ type: 'edit-league' })}>
                  Editar
                </button>
              </div>
              <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
                Nombre, logo, portada, descripción, zona horaria y redes sociales.
              </p>

              <div className="section-head" style={{ marginTop: 28 }}>
                <h2>Sedes</h2>
                <button className="btn btn-outline btn-sm" onClick={() => setLigaModal({ type: 'add-venue' })}>
                  + Agregar sede
                </button>
              </div>
              {venues.length === 0 ? (
                <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
                  Todavía no tienes sedes registradas. Agrega la primera arriba.
                </p>
              ) : (
                venues.map((v) => (
                  <div key={v.id} className="admin-match-row">
                    <div>
                      <div className="who">{v.name}</div>
                      <div className="info">{v.institution || v.address || 'Sin más detalles'}</div>
                    </div>
                    <div className="row-actions">
                      <button className="btn btn-outline btn-sm" onClick={() => setLigaModal({ type: 'edit-venue', venue: v })}>Editar</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--flag)' }} onClick={() => setLigaModal({ type: 'delete-venue', venue: v })}>Eliminar</button>
                    </div>
                  </div>
                ))
              )}
            </>
          )}

          {ligaModal?.type === 'edit-league' && (
            <Modal title="Editar liga" onClose={() => setLigaModal(null)}>
              <EditLeagueForm
                league={leagueData.league}
                onCancel={() => setLigaModal(null)}
                onSubmit={async (payload) => {
                  await api.updateLeague(id, payload, token);
                  await refreshLeagues();
                  refreshLeagueData();
                  setLigaModal(null);
                }}
              />
            </Modal>
          )}

          {ligaModal?.type === 'add-venue' && (
            <Modal title="Nueva sede" onClose={() => setLigaModal(null)}>
              <VenueForm
                submitLabel="Crear sede"
                onCancel={() => setLigaModal(null)}
                onSubmit={async (payload) => {
                  await api.createVenue(id, payload, token);
                  refreshLeagueData();
                  setLigaModal(null);
                }}
              />
            </Modal>
          )}

          {ligaModal?.type === 'edit-venue' && (
            <Modal title="Editar sede" onClose={() => setLigaModal(null)}>
              <VenueForm
                initial={ligaModal.venue}
                submitLabel="Guardar cambios"
                onCancel={() => setLigaModal(null)}
                onSubmit={async (payload) => {
                  await api.updateVenue(ligaModal.venue.id, payload, token);
                  refreshLeagueData();
                  setLigaModal(null);
                }}
              />
            </Modal>
          )}

          {ligaModal?.type === 'delete-venue' && (
            <Modal title="Eliminar sede" onClose={() => setLigaModal(null)}>
              <p>¿Seguro que quieres eliminar <strong>{ligaModal.venue.name}</strong>?</p>
              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={() => setLigaModal(null)}>Cancelar</button>
                <button
                  className="btn btn-danger"
                  onClick={async () => {
                    await api.deleteVenue(ligaModal.venue.id, token);
                    refreshLeagueData();
                    setLigaModal(null);
                  }}
                >
                  Eliminar
                </button>
              </div>
            </Modal>
          )}
        </>
      )}
    </div>
  );
}
