import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';

const BRANCH_OPTIONS = ['Varonil', 'Femenil', 'Mixto'];

// Lista y crea las Ramas de una Categoría específica.
// Ruta: /panel/liga/:id/:year/torneo/:tournamentId/categoria/:categoryId
export default function BranchesPanel() {
  const { id, year, tournamentId, categoryId } = useParams();
  const { token } = useAuth();

  const [category, setCategory] = useState(null);
  const [branches, setBranches] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    api.getCategoriesForTournament(tournamentId, token)
      .then((list) => setCategory(list.find((c) => String(c.id) === categoryId) || null))
      .catch((e) => setError(e.message));
  }, [tournamentId, categoryId, token]);

  function refreshBranches() {
    api.getBranches(categoryId, token).then(setBranches).catch((e) => setError(e.message));
  }

  useEffect(() => {
    if (token) refreshBranches();
  }, [categoryId, token]);

  if (!token) {
    return <div className="container"><p>Necesitas iniciar sesión para ver esto.</p></div>;
  }

  return (
    <div className="container">
      <div className="crumb">
        <Link to={`/panel/liga/${id}/${year}/torneo/${tournamentId}`}>← Categorías</Link>
      </div>

      <div className="dash-header">
        <div>
          <span className="eyebrow">{category ? category.name : 'Cargando…'}</span>
          <h1>Ramas</h1>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="field">
        <label>Agregar rama</label>
        <div className="pill-group">
          {BRANCH_OPTIONS.map((b) => (
            <button
              key={b}
              type="button"
              className="pill-btn"
              disabled={branches?.some((br) => br.name === b)}
              onClick={async () => {
                await api.createBranch(categoryId, { name: b }, token);
                refreshBranches();
              }}
            >
              {branches?.some((br) => br.name === b) ? `${b} ✓` : `+ ${b}`}
            </button>
          ))}
        </div>
      </div>

      {branches === null && <p>Cargando…</p>}
      {branches && branches.length === 0 && (
        <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
          Esta categoría todavía no tiene ramas. Agrega la primera arriba.
        </p>
      )}
      {branches && branches.length > 0 && (
        <div className="league-grid">
          {branches.map((b) => (
            <Link
              key={b.id}
              to={`/panel/liga/${id}/${year}/torneo/${tournamentId}/categoria/${categoryId}/rama/${b.id}`}
              className="league-card"
            >
              <h3>{b.name}</h3>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
