import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import Loading from '../components/Loading.jsx';
import CalendarViewer from '../components/CalendarViewer.jsx';

// Calendario público de una Categoría (modelo viejo: categoría directo de
// liga, sin torneo). El visor en sí (filtros "ver por", tarjetas de
// partido) vive en CalendarViewer.jsx, compartido también con el
// calendario público de una Rama dentro de un Torneo.
export default function CalendarPage() {
  const { categoryId } = useParams();
  const [data, setData]   = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getMatches(categoryId).then(setData).catch((e) => setError(e.message));
  }, [categoryId]);

  if (error) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No encontramos este calendario</h3>
          <p>{error}</p>
          <Link to="/" className="btn btn-outline" style={{ marginTop: 16 }}>Volver al inicio</Link>
        </div>
      </div>
    );
  }

  if (!data) return <div className="container"><Loading /></div>;

  const { category, matches } = data;

  return (
    <div className="container">
      <div className="crumb"><Link to="/">Inicio</Link> / {category.name}</div>

      {/* Antes este calendario (modelo viejo: categoría directo de liga) se
          pintaba "pelón", sin el panel oscuro (.league-header-panel) que sí
          usa TournamentPage.jsx para el calendario del modelo nuevo. Por
          eso, al entrar por Liga → Torneo → Calendario se veía el panel
          negro, pero al volver aquí desde MatchPage ("Ver calendario
          completo") se perdía y solo quedaba el fondo verde — mismo dato,
          dos diseños distintos según la ruta. Se envuelve igual que en
          TournamentPage para que el calendario luzca consistente sin
          importar por dónde se llegue. */}
      <div className="league-header-panel">
        <div className="league-header-panel-body">
          <h1 style={{ fontSize: 'clamp(32px, 6vw, 56px)' }}>{category.name}</h1>
        </div>
        <div className="league-header-panel-body league-header-panel-body--content">
          <CalendarViewer
            matches={matches}
            title={category.name}
            emptyTitle="Calendario sin publicar"
            emptyText="Esta categoría aún no tiene partidos programados."
          />
        </div>
      </div>
    </div>
  );
}
