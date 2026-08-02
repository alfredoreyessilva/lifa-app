import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';

// Lista y crea las Conferencias de una Rama específica (texto libre, a
// diferencia de Rama que tiene opciones fijas Varonil/Femenil/Mixto).
// Ruta: /panel/liga/:id/:year/torneo/:tournamentId/categoria/:categoryId/rama/:branchId
export default function ConferencesPanel() {
  const { id, year, tournamentId, categoryId, branchId } = useParams();
  const { token } = useAuth();

  const [branch, setBranch] = useState(null);
  const [conferences, setConferences] = useState(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    api.getBranches(categoryId, token)
      .then((list) => setBranch(list.find((b) => String(b.id) === branchId) || null))
      .catch((e) => setError(e.message));
  }, [categoryId, branchId, token]);

  function refreshConferences() {
    api.getConferences(branchId, token).then(setConferences).catch((e) => setError(e.message));
  }

  useEffect(() => {
    if (token) refreshConferences();
  }, [branchId, token]);

  if (!token) {
    return <div className="container"><p>Necesitas iniciar sesión para ver esto.</p></div>;
  }

  return (
    <div className="container">
      <div className="crumb">
        <Link to={`/panel/liga/${id}/${year}/torneo/${tournamentId}/categoria/${categoryId}/rama/${branchId}`}>← Rama</Link>
      </div>

      <div className="dash-header">
        <div>
          <span className="eyebrow">{branch ? branch.name : 'Cargando…'}</span>
          <h1>Conferencias</h1>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newName.trim()) return;
          await api.createConference(branchId, { name: newName.trim() }, token);
          setNewName('');
          refreshConferences();
        }}
      >
        <div className="field">
          <label>Nombre de la conferencia</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Ej. Conferencia Norte"
          />
        </div>
        <div className="modal-actions">
          <button className="btn btn-flag">Agregar conferencia</button>
        </div>
      </form>

      {conferences === null && <p>Cargando…</p>}
      {conferences && conferences.length === 0 && (
        <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
          Esta rama todavía no tiene conferencias. Agrega la primera arriba.
        </p>
      )}
      {conferences && conferences.length > 0 && (
        <div className="league-grid">
          {conferences.map((c) => (
            <Link
              key={c.id}
              to={`/panel/liga/${id}/${year}/torneo/${tournamentId}/categoria/${categoryId}/rama/${branchId}/conferencia/${c.id}`}
              className="league-card"
            >
              <h3>{c.name}</h3>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
