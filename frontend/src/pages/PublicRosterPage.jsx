import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import Loading from '../components/Loading.jsx';
import { initials } from '../utils/matchDisplay.js';

// El roster de un equipo en una rama, en público. Se llega desde el partido —
// no hay un link suelto a esta pantalla en ningún lado— porque es el mismo
// botón que más adelante va a abrir el pase de lista para quien tenga permiso:
// la asistencia es a un partido, y un roster sin partido en contexto no tiene
// a qué marcarle nada (README, "Roster público y pase de lista").
//
// Lo que se ve aquí es lo que trae un programa de mano impreso: nombre, número
// y posición. El recorte lo hace el backend, no esta pantalla — si la categoría
// no publica su roster, el endpoint contesta 404 y aquí no llega nada que
// esconder.
export default function PublicRosterPage() {
  const { branchId, teamId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    api.getPublicBranchTeamRoster(branchId, teamId).then(setData).catch((e) => setError(e.message));
  }, [branchId, teamId]);

  useEffect(() => {
    if (data) document.title = `Roster · ${data.team.name} · CFBAMX`;
    return () => { document.title = 'CFBAMX'; };
  }, [data]);

  // Mismo mensaje para "no existe" y para "es privado", que es justo lo que el
  // backend hace al responder 404 en los dos casos: desde afuera no se debe
  // poder distinguir uno del otro.
  if (error) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>Este roster no es público</h3>
          <p>La liga decide si publica el roster de cada categoría, y esta no lo publica.</p>
          <Link to="/" className="btn btn-outline" style={{ marginTop: 16 }}>Volver al inicio</Link>
        </div>
      </div>
    );
  }

  if (!data) return <div className="container"><Loading /></div>;

  const { league, tournament, category, branch, team, roster, photos } = data;
  const temporada = [category.season, category.year].filter(Boolean).join(' ');
  // La rama "Sin clasificar" y las que se llaman igual que su categoría no
  // agregan nada al encabezado; repetirlas se lee como un error.
  const ramaVisible = branch.name && branch.name.toUpperCase() !== category.name.toUpperCase();

  return (
    <div className="container public-roster-page">
      <div className="crumb">
        <Link to="/">Inicio</Link>
        {league.slug && <> / <Link to={`/ligas/${league.slug}`}>{league.name}</Link></>}
        {tournament && <> / <Link to={`/torneos/${tournament.id}`}>{tournament.name}</Link></>}
        {' '}/ Roster de {team.name}
      </div>

      <div className="public-roster-head">
        <div className="public-roster-logo">
          {team.logo_url ? <img src={team.logo_url} alt={team.name} /> : <span>{initials(team.name)}</span>}
        </div>
        <div>
          <div className="player-hero-eyebrow">Roster</div>
          <h1 className="player-hero-name">{team.name}</h1>
          <div className="player-hero-team">
            {[category.name, ramaVisible ? branch.name : null, temporada].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>

      <div className="public-roster-card">
        {roster.length === 0 ? (
          <p className="player-empty-note" style={{ padding: '10px 0' }}>
            Este equipo todavía no tiene jugadores inscritos en esta rama.
          </p>
        ) : (
          roster.map((p) => (
            <div key={p.id} className="public-roster-row">
              <div className="public-roster-num">
                {p.jersey_number != null ? p.jersey_number : '—'}
              </div>
              {photos && (
                <div className="public-roster-photo">
                  {p.photo_url
                    ? <img src={p.photo_url} alt="" />
                    : <span>{initials(`${p.first_name} ${p.last_name}`)}</span>}
                </div>
              )}
              <div className="public-roster-who">
                <div className="public-roster-name">{p.first_name} {p.last_name}</div>
                <div className="public-roster-pos">{p.position || 'Sin posición'}</div>
              </div>
            </div>
          ))
        )}

        <p className="public-roster-note">
          {roster.length > 0 && `${roster.length} jugador${roster.length !== 1 ? 'es' : ''} inscrito${roster.length !== 1 ? 's' : ''}. `}
          De un roster público se publica nombre, número y posición{photos ? ', y la foto que el equipo autorizó' : ''} — nada más.
        </p>
      </div>
    </div>
  );
}
