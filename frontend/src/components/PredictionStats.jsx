import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// Se coloca junto a Mi Cartelera, en Dashboard.jsx. Solo se muestra si la
// persona ya tiene al menos una predicción hecha — si nunca ha votado, no
// tiene caso mostrar una tarjeta vacía en "0 de 0".
export default function PredictionStats() {
  const { token } = useAuth();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.getMyPredictionStats(token).then(setStats).catch(() => {});
  }, [token]);

  if (!stats || stats.total === 0) return null;

  return (
    <div className="prediction-stats-card">
      <div className="prediction-stats-main">
        <div className="prediction-stats-pct">
          {stats.accuracyPct === null ? '—' : `${stats.accuracyPct}%`}
        </div>
        <div>
          <div className="prediction-stats-label">Tu % de aciertos</div>
          <div className="prediction-stats-sub">
            {stats.graded === 0
              ? 'Todavía ningún partido calificado'
              : `${stats.correct} de ${stats.graded} ${stats.graded === 1 ? 'calificado' : 'calificados'}`}
          </div>
        </div>
      </div>
      {stats.pending > 0 && (
        <div className="prediction-stats-pending">
          {stats.pending} {stats.pending === 1 ? 'predicción pendiente' : 'predicciones pendientes'} de calificar
        </div>
      )}
    </div>
  );
}
