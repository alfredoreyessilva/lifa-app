import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Band, ScoreCell, Scoreboard } from '../components/admin/AdminKit.jsx';
import DashboardOrganizations, { RegisterInvite } from '../components/dashboard/DashboardOrganizations.jsx';
import DashboardBoard from '../components/dashboard/DashboardBoard.jsx';
import { formatNumber } from '../utils/adminPanel.js';
import {
  accuracyFigure, firstName, organizationsOf, organizationsSummary, pendingFigure, splitBoard, upcomingFigure,
} from '../utils/dashboard.js';
import { figuraDePremios } from '../utils/premios.js';
import '../components/admin/admin.css';
import '../components/dashboard/dashboard.css';

// "Mi panel" (/panel): la puerta de una cuenta. Las ligas, equipos y
// organizaciones que administras, y lo que sigues como aficionado. Se arma con las
// piezas del Panel Admin —la banda con el marcador y el lienzo negro—, sin barra
// lateral porque no tiene secciones. README, "Mi panel".
//
// El panel de un equipo vive en pages/TeamPanel.jsx y el de una liga en
// LeagueStructurePanel.jsx: aquí solo está la puerta a cada uno.
export default function Dashboard() {
  const { token, user, leagues, teams, organizations } = useAuth();
  const [board, setBoard] = useState(null);
  const [boardError, setBoardError] = useState('');
  const [stats, setStats] = useState(null);
  const [prizes, setPrizes] = useState(null);

  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    // El servicio puede tardar ~40 s en despertar (PD-03): mientras, el marcador
    // dice "—" y la cartelera "Cargando…".
    api.getBoard(token)
      .then((rows) => { if (alive) setBoard(rows); })
      .catch((e) => {
        if (!alive) return;
        setBoardError(e.offline
          ? 'Sin conexión: tu cartelera se carga cuando vuelva la señal.'
          : 'No se pudo cargar tu cartelera.');
      });
    api.getMyPredictionStats(token)
      .then((data) => { if (alive) setStats(data); })
      .catch(() => { if (alive) setStats(false); });
    // Los premios por acertar (README, "Premios por acertar"). Si no hay, o si
    // están apagados (la lista llega vacía), no sale su celda.
    api.getMyPrizes(token)
      .then((data) => { if (alive) setPrizes(data.prizes || []); })
      .catch(() => { if (alive) setPrizes([]); });
    return () => { alive = false; };
  }, [token]);

  const reloadBoard = useCallback(() => api.getBoard(token).then(setBoard), [token]);

  const orgs = useMemo(
    () => organizationsOf({ leagues, teams, organizations }),
    [leagues, teams, organizations],
  );
  // La hora se toma una vez por cartelera: así el marcador, las listas y el pie de
  // cada tarjeta deciden con el mismo reloj si un partido ya se jugó.
  const { upcoming, past, now } = useMemo(() => {
    const at = Date.now();
    return { ...splitBoard(board, at), now: at };
  }, [board]);

  const name = firstName(user?.name);
  const upcomingCell = board ? upcomingFigure(upcoming, now)
    : { value: '—', sub: boardError ? 'No se pudo cargar' : null };
  const accuracy = accuracyFigure(stats);
  const pending = pendingFigure(stats);
  const prizeCell = figuraDePremios(prizes);

  return (
    <div className="adm is-solo">
      <div className="adm-main">
        <Band title={name ? `Hola, ${name}` : 'Mi panel'} eyebrow={name ? 'Mi panel' : null}>
          <Scoreboard label="Tu cuenta en cifras">
            {orgs.length > 0 && (
              <ScoreCell label="Organizaciones" value={formatNumber(orgs.length)} sub={organizationsSummary(orgs)} />
            )}
            <ScoreCell
              label="Por jugar"
              value={upcomingCell.value}
              sub={upcomingCell.sub}
              loading={!board && !boardError}
            />
            <ScoreCell label="Aciertos" value={accuracy.value} sub={accuracy.sub} loading={accuracy.loading} />
            <ScoreCell label="Por calificar" value={pending.value} loading={pending.loading} />
            {prizeCell && (
              <ScoreCell
                label="Premios"
                value={prizeCell.value}
                sub={<Link to="/premios" className="dsh-prizes-link">{prizeCell.sub}</Link>}
              />
            )}
          </Scoreboard>
        </Band>

        <div className="adm-canvas">
          {orgs.length > 0 && <DashboardOrganizations organizations={orgs} />}
          <DashboardBoard
            board={board}
            upcoming={upcoming}
            past={past}
            now={now}
            error={boardError}
            token={token}
            reload={reloadBoard}
          />
          {orgs.length === 0 && <RegisterInvite />}
        </div>
      </div>
    </div>
  );
}
