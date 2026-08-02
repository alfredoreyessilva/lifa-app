import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';

// Lista y crea los Grupos de una Conferencia específica (texto libre, ej.
// "Grupo A").
// Ruta: .../rama/:branchId/conferencia/:conferenceId
export default function GroupsPanel() {
  const { id, year, tournamentId, categoryId, branchId, conferenceId } = useParams();
  const { token } = useAuth();

  const [conference, setConference] = useState(null);
  const [groups, setGroups] = useState(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    api.getConferences(branchId, token)
      .then((list) => setConference(list.find((c) => String(c.id) === conferenceId) || null))
      .catch((e) => setError(e.message));
  }, [branchId, conferenceId, token]);

  function refreshGroups() {
    api.getTestGroups(conferenceId, token).then(setGroups).catch((e) => setError(e.message));
  }

  useEffect(() => {
    if (token) refreshGroups();
  }, [conferenceId, token]);

  if (!token) {
    return <div className="container"><p>Necesitas iniciar sesión para ver esto.</p></div>;
  }

  return (
    <div className="container">
      <div className="crumb">
        <Link to={`/panel/liga/${id}/${year}/torneo/${tournamentId}/categoria/${categoryId}/rama/${branchId}/conferencias`}>
          ← Conferencias
        </Link>
      </div>

      <div className="dash-header">
        <div>
          <span className="eyebrow">{conference ? conference.name : 'Cargando…'}</span>
          <h1>Grupos</h1>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newName.trim()) return;
          await api.createTestGroup(conferenceId, { name: newName.trim() }, token);
          setNewName('');
          refreshGroups();
        }}
      >
        <div className="field">
          <label>Nombre del grupo</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Ej. Grupo A"
          />
        </div>
        <div className="modal-actions">
          <button className="btn btn-flag">Agregar grupo</button>
        </div>
      </form>

      {groups === null && <p>Cargando…</p>}
      {groups && groups.length === 0 && (
        <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
          Esta conferencia todavía no tiene grupos. Agrega el primero arriba.
        </p>
      )}
      {groups && groups.length > 0 && (
        <div className="league-grid">
          {groups.map((g) => (
            <div key={g.id} className="league-card">
              <h3>{g.name}</h3>
              <span className="state">Partidos: próximo paso</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
