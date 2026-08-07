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
      <CalendarViewer
        matches={matches}
        title={category.name}
        emptyTitle="Calendario sin publicar"
        emptyText="Esta categoría aún no tiene partidos programados."
      />
    </div>
  );
}
