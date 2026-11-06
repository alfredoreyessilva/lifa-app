import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import LeagueHero from '../components/LeagueHero.jsx';
import TeamStrip from '../components/TeamStrip.jsx';
import TeamInfoPanel from '../components/TeamInfoPanel.jsx';
import VenueCard from '../components/VenueCard.jsx';
import VenueInfoPanel from '../components/VenueInfoPanel.jsx';
import Loading from '../components/Loading.jsx';
import { calendariosDeLiga, equiposEnOrden } from '../utils/leagueDisplay.js';
import { useTeamPaint } from '../utils/useTeamPaint.js';

// La página pública de una liga. A quien llega le contesta tres cosas sin tener
// que tocar nada: de quién es (el encabezado, con sus contactos), cuándo se
// juega (los calendarios) y quién juega (los equipos). README, "La página de
// una liga".

function Calendarios({ torneos }) {
  const { vigentes, anteriores } = calendariosDeLiga(torneos);

  if (vigentes.length === 0) {
    return <p className="lp-vacio">Esta liga aún no ha publicado sus calendarios.</p>;
  }

  return (
    <>
      <div className="lp-calendarios">
        {vigentes.map((t) => (
          <Link key={t.id} to={`/torneos/${t.id}`} className="filter-team lp-cal">
            <div className="mh-zone mh-zone--home" aria-hidden="true" />
            <div className="mh-field">
              <p className="lp-cal-name">{t.name} {t.year}</p>
              <span className="btn btn-flag btn-sm">Ver calendario</span>
            </div>
          </Link>
        ))}
      </div>

      {anteriores.length > 0 && (
        <div className="filter-grid lp-anteriores">
          {anteriores.map((t) => (
            <Link key={t.id} to={`/torneos/${t.id}`} className="filter-card">
              <span className="filter-card-label">{t.name}</span>
              <span className="filter-card-count">{t.year}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export default function LeaguePage() {
  const { slug } = useParams();
  const [league, setLeague]               = useState(null);
  const [teams,  setTeams]                = useState(null);
  const [venues, setVenues]               = useState(null);
  const [error,  setError]                = useState('');
  const [verSedes, setVerSedes]           = useState(false);
  const [selectedTeam,  setSelectedTeam]  = useState(null);
  const [selectedVenue, setSelectedVenue] = useState(null);
  // La end zone de la liga sale de su logo, igual que la de un equipo: nadie
  // captura un color, y si cambia de logo su página cambia sola.
  const pintura = useTeamPaint(league?.logo_url, null, { alInstante: true });

  useEffect(() => {
    setLeague(null); setTeams(null); setVenues(null); setError('');
    setVerSedes(false); setSelectedTeam(null); setSelectedVenue(null);
    api.getLeague(slug).then(setLeague).catch((e) => setError(e.message));
    api.getTeams(slug).then(setTeams).catch(() => setTeams([]));
    api.getVenues(slug).then(setVenues).catch(() => setVenues([]));
  }, [slug]);

  if (error) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No encontramos esta liga</h3>
          <p>{error}</p>
          <Link to="/" className="btn btn-outline" style={{ marginTop: 16 }}>Volver al inicio</Link>
        </div>
      </div>
    );
  }

  if (!league) return <div className="container"><Loading /></div>;

  // Sin sedes no hay nada que elegir, y una pestaña vacía solo le enseña al
  // visitante lo que a la liga le falta capturar.
  const haySedes = (venues || []).length > 0;
  const enSedes  = verSedes && haySedes;
  const zona = {
    '--home': pintura.fondo,
    '--home-ink': pintura.tinta,
    '--away': pintura.fondo,
    '--away-ink': pintura.tinta,
  };

  return (
    <div className="container">
      <div className="crumb"><Link to="/">Inicio</Link> / {league.name}</div>

      <div className="league-header-panel" style={zona}>
        <LeagueHero league={league} pintura={pintura} />

        <section className="lp-section">
          <div className="section-head">
            <h2>Calendarios</h2>
          </div>
          <Calendarios torneos={league.tournaments} />
        </section>

        <section className="lp-section">
          <div className="section-head">
            {haySedes ? (
              <h2 className="lp-tabs">
                <button type="button" aria-pressed={!enSedes} onClick={() => setVerSedes(false)}>Equipos</button>
                <button type="button" aria-pressed={enSedes} onClick={() => setVerSedes(true)}>Sedes</button>
              </h2>
            ) : (
              <h2>Equipos</h2>
            )}
            <span className="count">{enSedes ? venues.length : teams ? teams.length : ''}</span>
          </div>

          {enSedes ? (
            <div className="filter-grid">
              {venues.map((venue) => (
                <VenueCard key={venue.id} venue={venue} onClick={() => setSelectedVenue(venue)} />
              ))}
            </div>
          ) : !teams ? (
            <div className="loading">Cargando…</div>
          ) : teams.length === 0 ? (
            <p className="lp-vacio">Esta liga aún no ha publicado sus equipos.</p>
          ) : (
            <div className="filter-grid filter-grid--equipos">
              {equiposEnOrden(teams).map((team) => (
                <TeamStrip
                  key={team.id}
                  name={team.name}
                  logo={team.logo_url}
                  verified={team.is_verified}
                  onClick={() => setSelectedTeam(team)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {selectedTeam && (
        <TeamInfoPanel team={selectedTeam} leagueId={league.id} onClose={() => setSelectedTeam(null)} />
      )}
      {selectedVenue && (
        <VenueInfoPanel venue={selectedVenue} onClose={() => setSelectedVenue(null)} />
      )}
    </div>
  );
}
