import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Loading from '../components/Loading.jsx';
import Modal from '../components/Modal.jsx';
import MatchForm from '../components/MatchForm.jsx';
import SubscribeButton from '../components/SubscribeButton.jsx';
import PredictionWidget from '../components/PredictionWidget.jsx';
import { getMatchStatus } from '../utils/matchStatus.js';
import { getMatchParts, initials } from '../utils/matchDisplay.js';
import { shareLink } from '../utils/share.js';
import ShareImageButton from '../components/ShareImageButton.jsx';
import MatchBroadcasters from '../components/MatchBroadcasters.jsx';
import MediaBroadcastControl from '../components/MediaBroadcastControl.jsx';
import { buildHotelSearchUrl } from '../utils/matchServices.js';
import FlightSearchWidget from '../components/FlightSearchWidget.jsx';
import TeamInfoPanel from '../components/TeamInfoPanel.jsx';

// Convierte una URL en una etiqueta corta y legible (ej. "youtube.com"),
// para diferenciar los botones cuando hay más de un link del mismo tipo.
function linkHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'link';
  }
}

export default function MatchPage() {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const { leagues, token } = useAuth();
  const [match, setMatch]         = useState(null);
  const [error, setError]         = useState('');
  const [shareState, setShareState] = useState('idle');
  const [isSharing, setIsSharing] = useState(false);
  const [broadcastVersion, setBroadcastVersion] = useState(0);
  const [editing, setEditing]     = useState(false);
  const [manageData, setManageData] = useState(null);
  const [manageError, setManageError] = useState('');

  useEffect(() => {
    setMatch(null);
    setError('');
    api.getMatch(matchId).then(setMatch).catch((e) => setError(e.message));
  }, [matchId]);

  const prevId = match?.prev_match_id || null;
  const nextId = match?.next_match_id || null;
  const goPrev = () => { if (prevId) navigate(`/partidos/${prevId}`); };
  const goNext = () => { if (nextId) navigate(`/partidos/${nextId}`); };

  // Navegación con teclado (flechas ← →) entre partidos del mismo calendario.
  useEffect(() => {
    function onKey(e) {
      const el = e.target;
      if (el instanceof Element && el.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'ArrowLeft')  goPrev();
      if (e.key === 'ArrowRight') goNext();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [prevId, nextId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Swipe horizontal en celular: arrastrar hacia la izquierda = siguiente
  // partido, hacia la derecha = anterior. Se ignora si el gesto es más
  // vertical que horizontal (el usuario está haciendo scroll).
  const touch = useRef(null);
  function onTouchStart(e) {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e) {
    if (!touch.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) goNext();
    else goPrev();
  }

  useEffect(() => {
    if (match) {
      document.title = `${match.home_team} vs ${match.away_team} · LIFA`;
    }
    return () => { document.title = 'LIFA'; };
  }, [match]);

  async function handleShare() {
    if (isSharing) return; // candado: evita doble clic mientras hay un share en curso
    setIsSharing(true);
    try {
      const result = await shareLink(
        window.location.href,
        `${match.home_team} vs ${match.away_team}`,
        'Mira este partido en LIFA'
      );
      if (result === 'copied') {
        setShareState('copied');
        setTimeout(() => setShareState('idle'), 2000);
      }
    } finally {
      setIsSharing(false);
    }
  }

  // Carga los datos de gestión de la liga (equipos, sedes, grupos) solo
  // cuando el dueño de la liga abre el modal de edición — así el partido
  // se puede editar sin salir de la vista pública, en vez de mandarlo al
  // panel (que reemplazaba de fondo esta pantalla por "Mi panel").
  async function loadManageData() {
    setManageError('');
    try {
      const data = await api.getManageLeague(match.league_id, token);
      setManageData(data);
    } catch (e) {
      setManageError(e.message);
    }
  }

  function openEdit() {
    setEditing(true);
    if (!manageData) loadManageData();
  }

  if (error) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No encontramos este partido</h3>
          <p>{error}</p>
          <Link to="/" className="btn btn-outline" style={{ marginTop: 16 }}>Volver al inicio</Link>
        </div>
      </div>
    );
  }

  if (!match) return <div className="container"><Loading /></div>;

  const { day, month, time, tzLabel } = getMatchParts(match.match_date, match.timezone || match.league_timezone);
  const status        = getMatchStatus(match);
  const isFinished     = status === 'finished';
  const isLive         = status === 'live';
  const isScheduled    = status === 'scheduled';
  const categoryLabel  = [match.season, match.year].filter(Boolean).join(' ');
  const hotelUrl       = buildHotelSearchUrl(match);
  // El usuario ve "Editar" solo si es dueño de la liga de este partido —
  // "leagues" en AuthContext ya viene filtrado a las ligas de las que es
  // owner_user_id (ver /auth/me), así que basta con buscar el id ahí.
  const isLeagueOwner  = leagues.some((lg) => lg.id === match.league_id);

  return (
    <div className="container">
      {/* El breadcrumb solo puede "colgar" del nivel más alto que ya se
          conoce: si el partido pertenece a un Torneo, el siguiente nivel
          clicable es el Torneo (nunca la Categoría) — es la propia
          TournamentPage la que decide, con su navegación inteligente, si
          hace falta pedir categoría/rama o si puede ir directo al
          calendario. Poner aquí un link directo a "Categoría" reintroducía
          esa sección como un paso navegable siempre, incluso en un torneo
          de una sola categoría, rompiendo el diseño que evita justamente
          eso. Solo en el modelo viejo (categoría sin torneo) el destino
          final sigue siendo el calendario plano de la categoría. */}
      <div className="crumb">
        <Link to="/">Inicio</Link>
        {match.league_slug && <> / <Link to={`/ligas/${match.league_slug}`}>{match.league_name}</Link></>}
        {match.tournament_id ? (
          <> / <Link to={`/torneos/${match.tournament_id}`}>{match.tournament_name}</Link></>
        ) : (
          match.category_id && <> / <Link to={`/categorias/${match.category_id}/calendario`}>{match.category_name}</Link></>
        )}
        {' '}/ {match.home_team} vs {match.away_team}
      </div>

      {/* Flechas a los lados para saltar al partido anterior / siguiente del
          mismo calendario (en celular las flechas se ocultan y el salto se
          hace deslizando el dedo — ver onTouchStart/onTouchEnd). */}
      <div className="match-nav" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <button
          type="button"
          className="match-nav-arrow match-nav-arrow--prev"
          onClick={goPrev}
          disabled={!prevId}
          aria-label="Partido anterior"
        >
          ‹
        </button>

        <div
          className={`match-card-new${isLive ? ' match-card-new--live' : ''}`}
          style={{ maxWidth: 520, width: '100%' }}
        >
        <div className="match-card-header">
          <div className="match-card-datetime">
            <span className="match-card-date">{day} {month}</span>
            <span className="match-card-time">{time}</span>
            <span className="match-card-tz">{tzLabel}</span>
          </div>
          <div className="match-card-status">
            {isLive      && <span className="tag live">🔴 En vivo</span>}
            {isFinished  && <span className="tag finished">Finalizado</span>}
            {isScheduled && !isLive && <span className="tag">Programado</span>}
          </div>
        </div>

        <div className="match-card-body">
          <div className="match-card-team">
            <div className="match-card-logo" style={{ width: 64, height: 64 }}>
              {match.home_logo_url ? <img src={match.home_logo_url} alt={match.home_team} /> : <span>{initials(match.home_team)}</span>}
            </div>
            <div className="match-card-team-name">{match.home_team}</div>
          </div>
          <div className="match-card-score">
            {isFinished && match.home_score !== null
              ? <><span>{match.home_score}</span><span className="match-card-score-sep">—</span><span>{match.away_score}</span></>
              : isLive
                ? <span className="match-card-score-live">EN VIVO</span>
                : <span className="match-card-score-vs">VS</span>}
          </div>
          <div className="match-card-team">
            <div className="match-card-logo" style={{ width: 64, height: 64 }}>
              {match.away_logo_url ? <img src={match.away_logo_url} alt={match.away_team} /> : <span>{initials(match.away_team)}</span>}
            </div>
            <div className="match-card-team-name">{match.away_team}</div>
          </div>
        </div>

        {(match.venue_name || match.week_label || categoryLabel) && (
          <div className="match-card-meta">
            {match.week_label && <span>{/^\d+$/.test(match.week_label) ? `Jornada ${match.week_label}` : match.week_label}</span>}
            {match.venue_name && <span>{match.venue_name}</span>}
            {categoryLabel && <span>{categoryLabel}</span>}
          </div>
        )}

        {isScheduled && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
            <PredictionWidget matchId={match.id} homeTeam={match.home_team} awayTeam={match.away_team} weekLabel={match.week_label} />
          </div>
        )}

        <div className="match-card-actions" style={{ marginTop: 16 }}>
          {isLeagueOwner && (
            <button type="button" className="btn btn-flag btn-sm" onClick={openEdit}>
              ✎ Editar partido
            </button>
          )}
          {(match.stream_links || []).map((url, i) => (
            <a key={`stream-${i}`} href={url} target="_blank" rel="noopener noreferrer" className="btn btn-flag btn-sm">
              {isLive ? '🔴 Ver en vivo' : 'Ver partido'}
              {match.stream_links.length > 1 ? ` — ${linkHost(url)}` : ''}
            </a>
          ))}
          {(match.ticket_links || []).map((url, i) => (
            <a key={`tickets-${i}`} href={url} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
              🎟️ Comprar boletos
              {match.ticket_links.length > 1 ? ` — ${linkHost(url)}` : ''}
            </a>
          ))}
          {hotelUrl && (
            <a href={hotelUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
              🏨 Hotel
            </a>
          )}
          <FlightSearchWidget match={match} />
          {match.venue_address && (
            <a href={match.venue_address} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
              Maps
            </a>
          )}
          <button
            className="btn btn-outline btn-sm"
            type="button"
            onClick={handleShare}
            disabled={isSharing}
          >
            {shareState === 'copied' ? '✓ Link copiado' : isSharing ? 'Compartiendo…' : '🔗 Compartir partido'}
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <ShareImageButton match={match} dateParts={{ day, month, time, tzLabel }} matchStatus={status} />
        </div>

        {isScheduled && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
            <SubscribeButton
              matchId={match.id}
              label="Avisarme de este partido"
              targetName={`${match.home_team} vs ${match.away_team}`}
            />
          </div>
        )}

        {/* Mismo criterio que el breadcrumb: si hay Torneo, el botón manda
            ahí (y es esa pantalla la que decide si hace falta elegir
            categoría/rama, o si salta directo al calendario). Solo el
            modelo viejo sin torneo sigue yendo directo al calendario plano
            de la categoría. */}
        {match.tournament_id ? (
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <Link to={`/torneos/${match.tournament_id}`} className="btn btn-outline btn-sm">
              Ver calendario completo →
            </Link>
          </div>
        ) : match.category_id && (
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <Link to={`/categorias/${match.category_id}/calendario`} className="btn btn-outline btn-sm">
              Ver calendario completo →
            </Link>
          </div>
        )}

        <MatchBroadcasters matchId={match.id} key={broadcastVersion} />
        <MediaBroadcastControl matchId={match.id} onChange={() => setBroadcastVersion((v) => v + 1)} />
        </div>

        <button
          type="button"
          className="match-nav-arrow match-nav-arrow--next"
          onClick={goNext}
          disabled={!nextId}
          aria-label="Partido siguiente"
        >
          ›
        </button>
      </div>

      {/* Fichas de los dos equipos que juegan, mostradas directamente (no en
          modal): local a la izquierda, visitante a la derecha, cada una a
          ancho completo de su columna. En celular quedan una arriba de la
          otra. Solo aparecen cuando el partido ya está enlazado con equipos
          reales del roster (home_team_details / away_team_details vienen del
          backend). */}
      {(match.home_team_details || match.away_team_details) && (
        <div className="match-teams">
          {match.home_team_details && (
            <TeamInfoPanel
              inline
              roleLabel="Local"
              team={match.home_team_details}
              leagueId={match.home_team_details.league_id}
            />
          )}
          {match.away_team_details && (
            <TeamInfoPanel
              inline
              roleLabel="Visitante"
              team={match.away_team_details}
              leagueId={match.away_team_details.league_id}
            />
          )}
        </div>
      )}

      {editing && (
        <Modal title="Editar partido" onClose={() => setEditing(false)}>
          {manageError && <div className="form-error">{manageError}</div>}
          {!manageData ? (
            <div className="loading">Cargando…</div>
          ) : (
            <MatchForm
              initial={match}
              submitLabel="Guardar cambios"
              teams={manageData.teams}
              venues={manageData.venues}
              groups={manageData.categories.find((c) => c.id === match.category_id)?.groups || []}
              leagueTimezone={manageData.league?.timezone}
              token={token}
              leagueId={match.league_id}
              categoryId={match.category_id}
              onVenueCreated={loadManageData}
              onTeamCreated={loadManageData}
              onGroupCreated={loadManageData}
              onCancel={() => setEditing(false)}
              onSubmit={async (payload) => {
                await api.updateMatch(match.id, payload, token);
                const updated = await api.getMatch(matchId);
                setMatch(updated);
                setEditing(false);
              }}
            />
          )}
        </Modal>
      )}
    </div>
  );
}