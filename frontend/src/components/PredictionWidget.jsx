import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import AuthModal from './AuthModal.jsx';

const EMPTY_SUMMARY = { home: 0, away: 0, tie: 0, total: 0, myPick: null };

// Los votos de un partido y cómo votar. Lo usan las dos caras de "¿quién gana?":
// el widget de las tarjetas (abajo) y MatchPoll, en la página del partido.
export function usePrediction(matchId) {
  const { token } = useAuth();
  const [summary, setSummary] = useState(null);
  const [working, setWorking] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingPick, setPendingPick] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getPredictionsSummary([matchId], token)
      .then((data) => { if (!cancelled) setSummary(data[matchId] || EMPTY_SUMMARY); })
      .catch(() => { if (!cancelled) setSummary(EMPTY_SUMMARY); });
    return () => { cancelled = true; };
  }, [matchId, token]);

  async function submitVote(pick, authToken) {
    setWorking(true);
    try {
      await api.submitPrediction(matchId, pick, authToken);
      setSummary((s) => ({ ...s, [pick]: s[pick] + 1, total: s.total + 1, myPick: pick }));
    } catch (e) {
      alert(e.message || 'No se pudo registrar tu voto');
    } finally {
      setWorking(false);
    }
  }

  function pick(value) {
    if (working || summary?.myPick) return;
    if (!token) { setPendingPick(value); setShowAuthModal(true); return; }
    submitVote(value, token);
  }

  const authModal = showAuthModal ? (
    <AuthModal
      title="Inicia sesión para votar"
      onClose={() => setShowAuthModal(false)}
      onSuccess={(newToken) => {
        setShowAuthModal(false);
        if (pendingPick) submitVote(pendingPick, newToken);
      }}
    />
  ) : null;

  return { summary, working, pick, authModal };
}

// "¿Quién gana?" en la tarjeta de un partido (MatchCard). Mismos votos y misma
// regla que MatchPoll, en la página del partido: el resultado se ve hasta después
// de votar, para que no empuje el voto de nadie. Y el mismo dibujo, con el color
// de cada equipo, que la tarjeta deja en --home y --away.
//
// Mientras llegan los votos los botones ya ocupan su lugar, apagados: sin esto
// cada tarjeta crecía al llegar su respuesta y la lista brincaba bajo el dedo.
export default function PredictionWidget({ matchId, homeTeam, awayTeam, weekLabel }) {
  const { summary, working, pick, authModal } = usePrediction(matchId);

  if (summary?.myPick) {
    const pct = (n) => (summary.total === 0 ? 0 : Math.round((n / summary.total) * 100));
    const opciones = [
      { key: 'home', etiqueta: homeTeam, pct: pct(summary.home) },
      { key: 'tie', etiqueta: 'Empate', pct: pct(summary.tie) },
      { key: 'away', etiqueta: awayTeam, pct: pct(summary.away) },
    ];
    const miVoto = opciones.find((o) => o.key === summary.myPick);

    return (
      <div className="mc-vote">
        <div
          className="mp-poll-bar"
          role="img"
          aria-label={opciones.map((o) => `${o.etiqueta} ${o.pct}%`).join(', ')}
        >
          {opciones.filter((o) => o.pct > 0).map((o) => (
            <i key={o.key} className={`mp-poll-seg mp-poll-seg--${o.key}`} style={{ flexGrow: o.pct }} />
          ))}
        </div>
        <ul className="mp-poll-legend">
          {opciones.map((o) => (
            <li key={o.key} className={`mp-poll-item mp-poll-item--${o.key}`}>
              <b>{o.pct}%</b>
              <span>{o.etiqueta}</span>
            </li>
          ))}
        </ul>
        <p className="mc-vote-note">
          {summary.total} {summary.total === 1 ? 'voto' : 'votos'}.
          {' '}Votaste por {miVoto.key === 'tie' ? 'el empate' : miVoto.etiqueta}.
        </p>
        {authModal}
      </div>
    );
  }

  return (
    <div className="mc-vote mc-vote--open">
      <p className="mc-vote-title">¿Quién gana?</p>
      <div className={`mc-picks${working ? ' is-working' : ''}`}>
        <button type="button" className="mc-pick mc-pick--home" disabled={working || !summary} onClick={() => pick('home')}>
          {homeTeam}
        </button>
        <button type="button" className="mc-pick mc-pick--tie" disabled={working || !summary} onClick={() => pick('tie')}>
          Empate
        </button>
        <button type="button" className="mc-pick mc-pick--away" disabled={working || !summary} onClick={() => pick('away')}>
          {awayTeam}
        </button>
      </div>
      {weekLabel === 'SCRIMMAGE' && <p className="mc-vote-note">Es un scrimmage: no cuenta para el ranking.</p>}
      {authModal}
    </div>
  );
}
