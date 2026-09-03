import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';

// Se usa dentro de CalendarViewer, como pestaña "Ranking" junto a
// "Calendario". Recibe la lista exacta de IDs de partido que se están
// viendo — el ranking es de ESE calendario, no uno nacional cruzando ligas.
export default function CalendarRanking({ matchIds }) {
  const { user } = useAuth();
  const [ranking, setRanking] = useState(null);
  const [error, setError]     = useState('');

  useEffect(() => {
    if (matchIds.length === 0) { setRanking([]); return; }
    api.getCalendarRanking(matchIds).then(setRanking).catch((e) => setError(e.message));
  }, [matchIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="empty-state"><p>{error}</p></div>;
  if (!ranking) return null;

  if (ranking.length === 0) {
    return (
      <div className="empty-state">
        <h3>Todavía no hay ranking aquí</h3>
        <p>
          Nadie ha votado en este calendario todavía. Vota en "¿Quién gana?" y
          aparecerás aquí desde tu primera predicción.
        </p>
      </div>
    );
  }

  return (
    <div className="ranking-list">
      {ranking.map((r, i) => (
        <div key={r.userId} className={`ranking-row${user?.id === r.userId ? ' ranking-row--me' : ''}`}>
          <div className="ranking-pos">{i + 1}</div>
          <div className="ranking-name">{r.name}{user?.id === r.userId ? ' (tú)' : ''}</div>
          <div className="ranking-detail">
            {r.graded > 0 ? `${r.correct}/${r.graded} calificados` : `${r.total} predicciones · sin calificar`}
          </div>
          <div className="ranking-pct">{r.accuracyPct === null ? '—' : `${r.accuracyPct}%`}</div>
        </div>
      ))}
    </div>
  );
}
