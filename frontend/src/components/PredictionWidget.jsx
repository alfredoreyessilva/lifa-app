import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import AuthModal from './AuthModal.jsx';

const EMPTY_SUMMARY = { home: 0, away: 0, tie: 0, total: 0, myPick: null };

// Widget de "¿quién gana?" — se usa tanto en las tarjetas de las listas de
// partidos (dentro de CalendarViewer, que a su vez está adentro de un
// <Link> que navega al partido) como en MatchPage (suelto, sin Link
// alrededor). En los dos casos paramos la propagación de los clics, para
// que votar no dispare de rebote la navegación de la tarjeta.
export default function PredictionWidget({ matchId, homeTeam, awayTeam }) {
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

  function handlePick(pick, e) {
    e.preventDefault();
    e.stopPropagation();
    if (working || summary?.myPick) return;
    if (!token) { setPendingPick(pick); setShowAuthModal(true); return; }
    submitVote(pick, token);
  }

  function stop(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  if (!summary) return null;

  const pct = (n) => (summary.total === 0 ? 0 : Math.round((n / summary.total) * 100));

  return (
    <div className="prediction-widget" onClick={stop}>
      <div className="prediction-widget-label">¿Quién gana?</div>

      {summary.myPick ? (
        <div className="prediction-widget-results">
          <PredictionBar label={homeTeam} pct={pct(summary.home)} highlight={summary.myPick === 'home'} />
          <PredictionBar label="Empate"  pct={pct(summary.tie)}  highlight={summary.myPick === 'tie'} />
          <PredictionBar label={awayTeam} pct={pct(summary.away)} highlight={summary.myPick === 'away'} />
          <div className="prediction-widget-total">{summary.total} {summary.total === 1 ? 'voto' : 'votos'}</div>
        </div>
      ) : (
        <div className="prediction-widget-buttons">
          <button className="btn btn-outline btn-sm" disabled={working} onClick={(e) => handlePick('home', e)}>
            {homeTeam}
          </button>
          <button className="btn btn-outline btn-sm" disabled={working} onClick={(e) => handlePick('tie', e)}>
            Empate
          </button>
          <button className="btn btn-outline btn-sm" disabled={working} onClick={(e) => handlePick('away', e)}>
            {awayTeam}
          </button>
        </div>
      )}

      {showAuthModal && (
        <AuthModal
          title="Inicia sesión para votar"
          onClose={() => setShowAuthModal(false)}
          onSuccess={(newToken) => {
            setShowAuthModal(false);
            if (pendingPick) submitVote(pendingPick, newToken);
          }}
        />
      )}
    </div>
  );
}

function PredictionBar({ label, pct, highlight }) {
  return (
    <div className={`prediction-bar${highlight ? ' prediction-bar--mine' : ''}`}>
      <div className="prediction-bar-fill" style={{ width: `${pct}%` }} />
      <div className="prediction-bar-label">
        <span>{label}{highlight && ' ✓'}</span>
        <span>{pct}%</span>
      </div>
    </div>
  );
}
