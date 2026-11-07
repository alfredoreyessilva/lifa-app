import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  attentionItems, fillDays, formatNumber, isNewThisMonth, pluralize, toNumber,
} from '../../utils/adminPanel.js';
import { Band, ScoreCell, Scoreboard, SectionError, SectionLoading } from './AdminKit.jsx';
import { DailyVisitsChart, LeaguesByStateChart, Meter, UserGrowthChart } from './AdminCharts.jsx';
import { IconChevronRight } from './AdminIcons.jsx';

// La primera pantalla de /admin contesta dos cosas, en este orden: qué te toca
// atender y cómo va la plataforma. Las gráficas son además lo que se le enseña a un
// patrocinador: tracción, tráfico, alcance y una comunidad que participa.
export default function AdminOverviewSection({ data, errors }) {
  const { stats, leagues, organizations, cron, users } = data;
  const loading = !stats;
  const attention = attentionItems({ leagues, organizations, cron });

  const days = useMemo(() => fillDays(stats?.homeViews?.last30Days ?? []), [stats]);
  const visitsInWindow = days.reduce((sum, d) => sum + d.count, 0);

  const newUsers = users?.filter((user) => isNewThisMonth(user)).length ?? 0;
  const publicLeagues = leagues?.filter((league) => league.is_public).length;

  return (
    <>
      <Band title="Resumen">
        <Scoreboard label="Cifras de la plataforma">
          <ScoreCell
            label="Usuarios"
            value={formatNumber(stats?.users)}
            sub={newUsers > 0 ? `+${formatNumber(newUsers)} este mes` : null}
            loading={loading}
          />
          <ScoreCell
            label="Ligas"
            value={formatNumber(stats?.leagues)}
            sub={publicLeagues !== undefined ? pluralize(publicLeagues, 'pública') : null}
            loading={loading}
          />
          <ScoreCell label="Equipos" value={formatNumber(stats?.teams)} loading={loading} />
          <ScoreCell label="Partidos" value={formatNumber(stats?.matches)} loading={loading} />
          <ScoreCell
            label="Visitas a Home"
            value={formatNumber(stats?.homeViews?.total)}
            sub={stats ? `${formatNumber(visitsInWindow)} en 30 días` : null}
            loading={loading}
          />
          <ScoreCell
            label="Visitantes únicos"
            value={formatNumber(stats?.homeViews?.uniqueVisitors)}
            loading={loading}
          />
        </Scoreboard>
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[errors.stats]} />

        {attention.length > 0 && (
          <section className="adm-attention" aria-label="Por atender">
            {attention.map((item) => (
              <Link key={item.key} to={item.to} className={`adm-attention-row is-${item.tone}`}>
                <span className="adm-status-dot" aria-hidden="true" />
                <span className="adm-attention-text">{item.text}</span>
                <span className="adm-attention-go">Revisar <IconChevronRight /></span>
              </Link>
            ))}
          </section>
        )}

        {stats ? <Board stats={stats} days={days} visitsInWindow={visitsInWindow} /> : !errors.stats && <SectionLoading />}
      </div>
    </>
  );
}

function Board({ stats, days, visitsInWindow }) {
  const predictions = stats.predictions ?? { total: 0, uniquePredictors: 0, totalPools: 0, poolMembers: 0 };
  const totalUsers = toNumber(stats.users);
  const participation = totalUsers > 0 ? Math.round((predictions.uniquePredictors / totalUsers) * 100) : 0;

  return (
    <div className="adm-board">
      <section className="adm-cell is-wide">
        <h2>Crecimiento de usuarios</h2>
        <p className="adm-cell-sub">Total acumulado, mes a mes</p>
        <UserGrowthChart data={stats.userGrowth ?? []} />
      </section>

      <section className="adm-cell is-narrow">
        <h2>Visitas a Home</h2>
        <p className="adm-cell-sub">{pluralize(visitsInWindow, 'visita')} en los últimos 30 días</p>
        <DailyVisitsChart days={days} />
      </section>

      <section className="adm-cell is-wide">
        <h2>Ligas por estado</h2>
        <p className="adm-cell-sub">Una liga cuenta en cada estado donde juega</p>
        <LeaguesByStateChart data={stats.leaguesByState ?? []} />
      </section>

      <section className="adm-cell is-narrow">
        <h2>Participación en quinielas</h2>
        <p className="adm-cell-sub">
          {formatNumber(predictions.uniquePredictors)} de {formatNumber(totalUsers)} usuarios predicen
        </p>
        <div className="adm-meter-row">
          <Meter
            value={predictions.uniquePredictors}
            max={totalUsers}
            label="Usuarios que predicen partidos"
          />
          <span className="adm-meter-value">{participation} %</span>
        </div>
        <dl className="adm-facts">
          <div><dt>Predicciones hechas</dt><dd>{formatNumber(predictions.total)}</dd></div>
          <div><dt>Quinielas creadas</dt><dd>{formatNumber(predictions.totalPools)}</dd></div>
          <div><dt>Usuarios en quinielas</dt><dd>{formatNumber(predictions.poolMembers)}</dd></div>
        </dl>
      </section>
    </div>
  );
}
