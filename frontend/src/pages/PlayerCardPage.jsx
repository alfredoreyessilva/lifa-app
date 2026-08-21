import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import Loading from '../components/Loading.jsx';
import PlayerShareButton from '../components/PlayerShareButton.jsx';

// Traduce las claves de "stats" (camelCase, del backend) a lo que se ve en
// pantalla. Solo se muestra un bloque si al menos una de sus stats tiene
// algo capturado — así un jugador puramente defensivo no ve un bloque de
// "Pase" vacío en su tarjeta.
const STAT_GROUPS = [
  {
    label: 'Pase',
    fields: [
      ['passCompletions', 'COMP'],
      ['passAttempts', 'INT.'],
      ['passYards', 'YDS'],
      ['passTd', 'TD'],
      ['interceptionsThrown', 'INT'],
    ],
  },
  {
    label: 'Carrera',
    fields: [
      ['rushAttempts', 'ACAR'],
      ['rushYards', 'YDS'],
      ['rushTd', 'TD'],
    ],
  },
  {
    label: 'Recepción',
    fields: [
      ['receptions', 'REC'],
      ['receivingYards', 'YDS'],
      ['receivingTd', 'TD'],
    ],
  },
  {
    label: 'Defensa',
    fields: [
      ['tackles', 'TKL'],
      ['sacks', 'SACK'],
      ['interceptionsDef', 'INT'],
    ],
  },
  {
    label: 'Especiales',
    fields: [
      ['fieldGoalsMade', 'FG'],
      ['extraPointsMade', 'PAT'],
    ],
  },
];

function groupHasData(stats, group) {
  return group.fields.some(([key]) => stats[key] > 0);
}

export default function PlayerCardPage() {
  const { playerId } = useParams();
  const [card, setCard] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setCard(null);
    setError('');
    api.getPlayerCard(playerId).then(setCard).catch((e) => setError(e.message));
  }, [playerId]);

  useEffect(() => {
    if (card) document.title = `${card.player.first_name} ${card.player.last_name} · LIFA`;
    return () => { document.title = 'LIFA'; };
  }, [card]);

  if (error) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No encontramos este jugador</h3>
          <p>{error}</p>
          <Link to="/" className="btn btn-outline" style={{ marginTop: 16 }}>Volver al inicio</Link>
        </div>
      </div>
    );
  }

  if (!card) return <Loading />;

  const { player, trajectory, stats, predictions, pools } = card;
  const currentTeam = trajectory.find((t) => !t.end_date);
  const visibleGroups = STAT_GROUPS.filter((g) => groupHasData(stats, g));

  return (
    <div className="container player-card-page">
      <div className="player-hero">
        <div className="player-photo">
          {player.photo_url
            ? <img src={player.photo_url} alt={`${player.first_name} ${player.last_name}`} />
            : <span>{player.first_name[0]}{player.last_name[0]}</span>}
        </div>
        <div>
          <div className="player-hero-eyebrow">
            {player.jersey_number != null ? `#${player.jersey_number}` : 'Jugador'}
            {player.position ? ` · ${player.position}` : ''}
          </div>
          <h1 className="player-hero-name">{player.first_name} {player.last_name}</h1>
          {currentTeam && (
            <div className="player-hero-team">
              {currentTeam.team_logo_url && <img src={currentTeam.team_logo_url} alt={currentTeam.team_name} />}
              <span>{currentTeam.team_name}</span>
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <PlayerShareButton player={player} currentTeam={currentTeam} stats={stats} />
          </div>
        </div>
      </div>

      <section className="player-section">
        <h2>Trayectoria</h2>
        {trajectory.length === 0 ? (
          <p className="player-empty-note">Todavía no hay historial de equipos registrado.</p>
        ) : (
          <div className="player-trajectory">
            {trajectory.map((t) => (
              <div key={t.membership_id} className="player-trajectory-row">
                <div className="player-trajectory-team">
                  {t.team_logo_url && <img src={t.team_logo_url} alt={t.team_name} />}
                  <span>{t.team_name}</span>
                </div>
                <div className="player-trajectory-meta">
                  {t.season ? `Temporada ${t.season}` : ''}
                  {!t.end_date && <span className="player-badge-active">Activo</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="player-section">
        <h2>Estadísticas {stats.gamesPlayed > 0 && <span className="player-games">· {stats.gamesPlayed} partido{stats.gamesPlayed === 1 ? '' : 's'}</span>}</h2>
        {visibleGroups.length === 0 ? (
          <p className="player-empty-note">Todavía no hay estadísticas capturadas.</p>
        ) : (
          visibleGroups.map((group) => (
            <div key={group.label} className="player-stat-group">
              <div className="player-stat-group-label">{group.label}</div>
              <div className="player-stat-row">
                {group.fields.map(([key, label]) => (
                  <div key={key} className="player-stat">
                    <div className="player-stat-value">{stats[key]}</div>
                    <div className="player-stat-label">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      {predictions && (
        <section className="player-section">
          <h2>Predicciones</h2>
          <div className="player-stat-row">
            <div className="player-stat">
              <div className="player-stat-value">{predictions.total}</div>
              <div className="player-stat-label">Hechas</div>
            </div>
            <div className="player-stat">
              <div className="player-stat-value">{predictions.correct}</div>
              <div className="player-stat-label">Aciertos</div>
            </div>
            <div className="player-stat">
              <div className="player-stat-value">{predictions.accuracyPct != null ? `${predictions.accuracyPct}%` : '—'}</div>
              <div className="player-stat-label">Efectividad</div>
            </div>
          </div>
        </section>
      )}

      {pools && pools.participations > 0 && (
        <section className="player-section">
          <h2>Quinielas</h2>
          <div className="player-stat-row">
            <div className="player-stat">
              <div className="player-stat-value">{pools.participations}</div>
              <div className="player-stat-label">Participaciones</div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
