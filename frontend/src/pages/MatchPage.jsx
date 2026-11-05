import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Loading from '../components/Loading.jsx';
import Modal from '../components/Modal.jsx';
import MatchForm from '../components/MatchForm.jsx';
import SubscribeButton from '../components/SubscribeButton.jsx';
import MatchHero from '../components/MatchHero.jsx';
import MatchPoll from '../components/MatchPoll.jsx';
import MatchCompare from '../components/MatchCompare.jsx';
import MatchVenue, { esLink } from '../components/MatchVenue.jsx';
import MatchWeek from '../components/MatchWeek.jsx';
import MatchTeamCard from '../components/MatchTeamCard.jsx';
import { IconoBoleto, IconoCompartir, IconoEditar, IconoEstadisticas, IconoVer } from '../components/MatchIcons.jsx';
import { getMatchStatus } from '../utils/matchStatus.js';
import { getMatchParts, plataformaDe } from '../utils/matchDisplay.js';
import { shareLink } from '../utils/share.js';
import { useTeamPaint } from '../utils/useTeamPaint.js';
import ShareImageButton from '../components/ShareImageButton.jsx';
import MatchBroadcasters from '../components/MatchBroadcasters.jsx';
import MediaBroadcastControl from '../components/MediaBroadcastControl.jsx';
import { buildHotelSearchUrl } from '../utils/matchServices.js';
import { puede } from '../utils/permisos.js';

// La página de un partido (README, "La página de un partido"). La ordenan las
// tres preguntas de quien llega a ella: quién llega mejor, cómo lo veo y cómo
// llego. Arriba va lo que importa en este momento del partido —la hora antes, el
// marcador durante y después— con el único botón amarillo de la pantalla.
export default function MatchPage() {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const { leagues, token, user } = useAuth();
  const [match, setMatch]         = useState(null);
  const [contexto, setContexto]   = useState(null);
  const [error, setError]         = useState('');
  const [shareState, setShareState] = useState('idle');
  const [isSharing, setIsSharing] = useState(false);
  const [broadcastVersion, setBroadcastVersion] = useState(0);
  const [editing, setEditing]     = useState(false);
  const [manageData, setManageData] = useState(null);
  const [manageError, setManageError] = useState('');

  // El partido no espera a su contexto: va en otra llamada porque calcular las
  // tablas cuesta, y si falla solo faltan esas secciones. Lo mismo pasa durante
  // un despliegue, cuando Vercel ya terminó y Render todavía no tiene la ruta.
  useEffect(() => {
    let vigente = true;
    setMatch(null);
    setContexto(null);
    setError('');
    api.getMatch(matchId)
      .then((m) => { if (vigente) setMatch(m); })
      .catch((e) => { if (vigente) setError(e.message); });
    api.getMatchContext(matchId)
      .then((c) => { if (vigente) setContexto(c); })
      .catch(() => {});
    return () => { vigente = false; };
  }, [matchId]);

  const pinturaLocal  = useTeamPaint(match?.home_logo_url, match?.home_team_details?.brand_color);
  const pinturaVisita = useTeamPaint(match?.away_logo_url, match?.away_team_details?.brand_color);

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
      document.title = `${match.home_team} vs ${match.away_team} · CFBAMX`;
    }
    return () => { document.title = 'CFBAMX'; };
  }, [match]);

  async function handleShare() {
    if (isSharing) return; // candado: evita doble clic mientras hay un share en curso
    setIsSharing(true);
    try {
      const result = await shareLink(
        window.location.href,
        `${match.home_team} vs ${match.away_team}`,
        'Mira este partido en CFBAMX'
      );
      if (result === 'copied') {
        setShareState('copied');
        setTimeout(() => setShareState('idle'), 2000);
      }
    } finally {
      setIsSharing(false);
    }
  }

  // Carga lo que necesita la ventana de edición solo cuando se abre — así el
  // partido se puede editar sin salir de la vista pública, en vez de mandarlo
  // al panel (que reemplazaba de fondo esta pantalla por "Mi panel"). Quien
  // define el partido carga la estructura de la liga (equipos, sedes, grupos);
  // el visor no la lee —pide `estructura`—, y a su ventana le basta la lista de
  // sedes, que pide con su mismo permiso.
  async function loadManageData() {
    setManageError('');
    try {
      const data = editsWholeMatch
        ? await api.getManageLeague(match.league_id, token)
        : { venues: await api.getMatchVenues(match.id, token) };
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

  const parts = getMatchParts(match.match_date, match.timezone || match.league_timezone);
  const status      = getMatchStatus(match);
  const isFinished  = status === 'finished';
  const isLive      = status === 'live';
  const isScheduled = status === 'scheduled';
  const hotelUrl    = buildHotelSearchUrl(match);

  // Lo que quien mira puede hacer en la liga de este partido. `leagues` trae
  // TODAS las ligas donde tiene un rol —dueño, admin, tesorero o visor—, así
  // que estar ahí no alcanza: se pregunta por el permiso. El admin de la
  // plataforma pasa todas las guardas del backend.
  const myLeague        = leagues.find((lg) => lg.id === match.league_id);
  const isPlatformAdmin = user?.role === 'admin';
  // "Editar partido" lo ve quien puede guardar: `marcadores`, que tienen el
  // dueño, el administrador y el visor (`matchScoreRequired`). Antes bastaba
  // con ser de la liga, y al tesorero le salía un botón que solo abría "No
  // tienes permiso sobre esta liga".
  const canEditMatch = isPlatformAdmin || puede(myLeague, 'marcadores');
  // La ventana completa —equipos, jornada, grupo, fase— es de quien define el
  // partido, y carga la estructura de la liga. El visor abre la misma ventana
  // con solo lo del día del partido (README, "Los roles").
  const editsWholeMatch = isPlatformAdmin
    || (puede(myLeague, 'estructura') && puede(myLeague, 'partidos'));
  // Quién captura las estadísticas de este partido: la misma pregunta que hace
  // `matchStatsRequired` en el backend, el permiso `estadisticas`.
  const canCaptureStats = isPlatformAdmin || puede(myLeague, 'estadisticas');

  // ── Estadísticas ──
  // Cualquiera ve el box score —es el resultado deportivo, que es justo lo que
  // un torneo publica— y quien tiene `estadisticas` ve además el panel de
  // captura. Al público se le pinta solo cuando ya hay algo que ver
  // (`has_box_score`): antes, el botón llevaba a una página que decía "Todavía
  // no hay estadísticas". A quien captura se le pinta siempre, aunque el partido
  // no se haya jugado, y a propósito: tiene que poder entrar ANTES para presionar
  // "Preparar partido" y llevárselo a una cancha sin señal. A los dos les hacen
  // falta la rama y los dos equipos — sin eso no hay roster al que colgarle una
  // jugada, que es la misma condición del pase de lista.
  //
  // `has_box_score` en undefined es el backend viejo durante un despliegue
  // (Vercel termina antes que Render), y se lee como antes: se pinta. Es el
  // mismo criterio de `puede()` — ver utils/permisos.js.
  const showStatsButton = canCaptureStats || match.has_box_score !== false;
  const statsUrl = match.branch_id && match.home_team_id && match.away_team_id && showStatsButton
    ? `/partidos/${match.id}/estadisticas`
    : null;

  // ── Roster ──
  // Aparece solo si la categoría publica su roster. Un partido creado por
  // nombre y nunca sincronizado no sabe de qué equipo habla (home_team_id /
  // away_team_id son nullable), así que ahí no hay roster que abrir y el botón
  // no se pinta. Conectarlos es trabajo de la liga, no del visitante.
  const rosterDe = (teamId) => (match.roster_public && match.branch_id && teamId
    ? `/partidos/${match.id}/equipos/${teamId}/roster`
    : null);

  // Los botones de la portada, en orden de lo que más se busca en este momento.
  // Solo el primero va en amarillo. Boletos deja de ofrecerse cuando el partido
  // terminó, y el link de transmisión ya es para volver a verlo.
  const verEtiqueta = isLive ? 'Ver en vivo por' : isFinished ? 'Ver repetición en' : 'Ver partido en';
  const acciones = [
    ...(match.stream_links || []).map((url) => ({
      key: `ver-${url}`,
      href: url,
      icono: <IconoVer />,
      texto: `${verEtiqueta} ${plataformaDe(url)}`,
    })),
    ...(isFinished ? [] : (match.ticket_links || []).map((url) => ({
      key: `boletos-${url}`,
      href: url,
      icono: <IconoBoleto />,
      texto: match.ticket_links.length > 1 ? `Comprar boletos en ${plataformaDe(url)}` : 'Comprar boletos',
    }))),
    ...(statsUrl ? [{ key: 'estadisticas', to: statsUrl, icono: <IconoEstadisticas />, texto: 'Estadísticas' }] : []),
  ];

  const venueLabel = [match.venue_name || match.venue, match.venue_city].filter(Boolean).join(', ');
  const venueUrl = esLink(match.venue_address) ? match.venue_address : null;

  const hayEquipos = match.home_team_details || match.away_team_details;
  const pinturas = { home: pinturaLocal, away: pinturaVisita };
  const coloresDelPartido = {
    '--home': pinturaLocal.fondo,
    '--home-ink': pinturaLocal.tinta,
    '--away': pinturaVisita.fondo,
    '--away-ink': pinturaVisita.tinta,
  };

  return (
    <div className="mp" style={coloresDelPartido}>
      <MatchHero
        match={match}
        status={status}
        parts={parts}
        pinturas={pinturas}
        contexto={contexto}
        venueLabel={venueLabel}
        venueUrl={venueUrl}
        prevId={prevId}
        nextId={nextId}
        onPrev={goPrev}
        onNext={goNext}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {acciones.length > 0 && (
          <div className="mh-cta">
            {acciones.map((a, i) => {
              const clase = `btn ${i === 0 ? 'btn-flag' : 'btn-outline'}`;
              return a.href ? (
                <a key={a.key} href={a.href} target="_blank" rel="noopener noreferrer" className={clase}>
                  {a.icono} {a.texto}
                </a>
              ) : (
                <Link key={a.key} to={a.to} className={clase}>{a.icono} {a.texto}</Link>
              );
            })}
          </div>
        )}
      </MatchHero>

      <div className="mp-plate">
        <div className="mp-wrap">
          <div className="mp-tools">
            {isScheduled && (
              <SubscribeButton
                matchId={match.id}
                label="Seguir este partido"
                targetName={`${match.home_team} vs ${match.away_team}`}
              />
            )}
            <button className="btn btn-outline btn-sm" type="button" onClick={handleShare} disabled={isSharing}>
              <IconoCompartir />
              {shareState === 'copied' ? 'Link copiado' : isSharing ? 'Compartiendo…' : 'Compartir'}
            </button>
            <ShareImageButton match={match} dateParts={parts} matchStatus={status} />
            {canEditMatch && (
              <button type="button" className="btn btn-outline btn-sm mp-tools-end" onClick={openEdit}>
                <IconoEditar /> Editar partido
              </button>
            )}
          </div>

          <div className="mp-grid">
            <div className="mp-main">
              <MatchPoll match={match} abierta={isScheduled} />
              <MatchCompare match={match} contexto={contexto} terminado={isFinished} />
            </div>

            <aside className="mp-rail">
              <MatchBroadcasters matchId={match.id} key={broadcastVersion} />
              <MediaBroadcastControl matchId={match.id} onChange={() => setBroadcastVersion((v) => v + 1)} />
              <MatchVenue match={match} terminado={isFinished} hotelUrl={hotelUrl} />
              <MatchWeek match={match} contexto={contexto} />
            </aside>
          </div>

          {/* Solo aparecen cuando el partido ya está enlazado con equipos reales
              (home_team_details / away_team_details vienen del backend). */}
          {hayEquipos && (
            <section className="mp-sec">
              <h2 className="mp-title">Los equipos</h2>
              <div className="mp-teams">
                {match.home_team_details && (
                  <MatchTeamCard
                    team={match.home_team_details}
                    lado="home"
                    logo={match.home_logo_url}
                    rosterUrl={rosterDe(match.home_team_id)}
                  />
                )}
                {match.away_team_details && (
                  <MatchTeamCard
                    team={match.away_team_details}
                    lado="away"
                    logo={match.away_logo_url}
                    rosterUrl={rosterDe(match.away_team_id)}
                  />
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      {editing && (
        <Modal title="Editar partido" onClose={() => setEditing(false)}>
          {manageError && <div className="form-error">{manageError}</div>}
          {!manageData ? (
            <div className="loading">Cargando…</div>
          ) : (
            <MatchForm
              initial={match}
              submitLabel="Guardar cambios"
              limitToMarcadores={!editsWholeMatch}
              teams={manageData.teams}
              venues={manageData.venues}
              groups={manageData.categories?.find((c) => c.id === match.category_id)?.groups || []}
              leagueTimezone={manageData.league?.timezone || match.league_timezone}
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
                api.getMatchContext(matchId).then(setContexto).catch(() => {});
                setEditing(false);
              }}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
