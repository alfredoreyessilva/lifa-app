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
    if (card) document.title = `${card.player.first_name} ${card.player.last_name} · CFBAMX`;
    return () => { document.title = 'CFBAMX'; };
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

  // `team` es el equipo con el que juega hoy, o null si ya no está en ningún
  // roster. La tarjeta no trae su historial de equipos a propósito: es de una
  // temporada, no de una carrera (regla 7 de CLAUDE.md).
  const { player, team, stats, predictions, pools } = card;
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
          {team && (
            <div className="player-hero-team">
              {team.logo_url && <img src={team.logo_url} alt={team.name} />}
              <span>{team.name}</span>
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <PlayerShareButton player={player} team={team} stats={stats} />
          </div>
        </div>
      </div>

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
