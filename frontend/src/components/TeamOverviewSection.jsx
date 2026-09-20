import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import Loading from './Loading.jsx';
import MonthlyFlowChart from './MonthlyFlowChart.jsx';
import { money, moneyShort, fmtDate, balanceClass } from '../utils/money.js';
import { puede } from '../utils/permisos.js';

// La primera pantalla del panel: qué pasó, qué falta, y los tres botones que
// el tesorero va a apretar hoy.
//
// Se alimenta del mismo overview de Finanzas — no hay un endpoint aparte para
// el resumen. Una consulta menos que mantener, y garantiza que las dos
// pantallas nunca muestren cifras distintas.
export default function TeamOverviewSection({ team, token }) {
  const [data, setData] = useState(null);
  const [statement, setStatement] = useState(null);
  const [error, setError] = useState('');

  const base = `/panel/equipo/${team.id}`;
  const isIndependent = !team.league_id;

  // Este resumen está armado con los dos libros, así que solo tiene sentido
  // para quien los puede ver. Un coach o un editor de roster no: a ellos NO se
  // les pide el padrón —pedirlo sería un 403 pintado como error rojo por algo
  // que no es un error— y se les pinta el resumen corto de más abajo.
  const veElPadron = puede(team, 'cuotas_club');
  const veLaCuentaConLaLiga = puede(team, 'cobranza_liga');

  useEffect(() => {
    if (!veElPadron) return;
    setData(null);
    api.getPlayerBillingOverview(team.id, token).then(setData).catch((e) => setError(e.message));
  }, [team.id, token, veElPadron]);

  useEffect(() => {
    if (isIndependent || !veLaCuentaConLaLiga) { setStatement(null); return; }
    api.getTeamStatement(team.id, token).then(setStatement).catch(() => setStatement(null));
  }, [team.id, token, isIndependent, veLaCuentaConLaLiga]);

  // El resumen de quien no lleva dinero. No es un panel vacío a propósito: el
  // coach existe para mirar el equipo, así que lo que ve es el equipo.
  if (!veElPadron) {
    return (
      <div>
        <div className="stat-strip">
          <div className="stat-tile">
            <div className="stat-tile-label">Tu rol aquí</div>
            <div className="stat-tile-value is-accent" style={{ fontSize: 22 }}>{team.my_role_label || '—'}</div>
            <div className="stat-tile-sub">{team.league_name || 'Equipo independiente'}</div>
          </div>
        </div>
        <p style={{ color: 'var(--ws-ink-dim)', fontSize: 13 }}>
          {puede(team, 'roster')
            ? <>Administras el <strong>roster de torneo</strong> de este equipo: quién puede jugar en cada rama. Lo encuentras en la pestaña <Link to={`${base}/jugadores`}>Padrón</Link>.</>
            : <>Tienes acceso de consulta al equipo. El padrón del club y su contabilidad los lleva el tesorero, y no se muestran aquí.</>}
        </p>
      </div>
    );
  }

  if (error) return <div className="form-error">{error}</div>;
  if (!data) return <Loading />;

  const { kpis, members } = data;
  const leagueBalance = statement ? Number(statement.balance || 0) : null;
  const upToDatePct = kpis.active_count > 0
    ? Math.round((kpis.up_to_date_count / kpis.active_count) * 100)
    : 0;

  return (
    <div>
      {kpis.pending_payments_count > 0 && (
        <div className="pending-tray" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="pending-tray-head" style={{ marginBottom: 4 }}>
              {kpis.pending_payments_count} {kpis.pending_payments_count === 1 ? 'pago espera' : 'pagos esperan'} tu confirmación
            </div>
            <div style={{ fontSize: 12, color: 'var(--ws-ink-dim)' }}>
              Una familia ya reportó su pago con comprobante. Hasta que lo confirmes, no baja su saldo.
            </div>
          </div>
          <Link to={`${base}/finanzas`} className="btn btn-accent btn-sm">Revisar ahora</Link>
        </div>
      )}

      <div className="stat-strip">
        <div className="stat-tile">
          <div className="stat-tile-label">Cobrado este mes</div>
          <div className="stat-tile-value is-accent">{moneyShort(kpis.collected_this_month)}</div>
          <div className="stat-tile-sub">de tus jugadores</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-label">Por cobrar</div>
          <div className={`stat-tile-value ${kpis.receivable > 0 ? 'is-owed' : 'is-zero'}`}>
            {moneyShort(kpis.receivable)}
          </div>
          <div className="stat-tile-sub">
            {kpis.overdue > 0 ? `${moneyShort(kpis.overdue)} ya vencido` : 'nada vencido'}
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-label">Al corriente</div>
          <div className="stat-tile-value is-positive">{upToDatePct}%</div>
          <div className="stat-tile-sub">{kpis.up_to_date_count} de {kpis.active_count} jugadores</div>
        </div>
        {!isIndependent && leagueBalance !== null && (
          <div className="stat-tile">
            <div className="stat-tile-label">Con tu liga</div>
            <div className={`stat-tile-value ${balanceClass(leagueBalance)}`}>{money(leagueBalance)}</div>
            <div className="stat-tile-sub">
              <Link to={`${base}/estado-de-cuenta`} style={{ color: 'var(--accent)' }}>Ver estado de cuenta</Link>
            </div>
          </div>
        )}
      </div>

      <div className="ws-toolbar">
        <Link to={`${base}/finanzas`} className="btn btn-accent">Cobranza del mes</Link>
        <Link to={`${base}/finanzas`} className="btn btn-ws">Registrar un pago</Link>
        <Link to={`${base}/jugadores`} className="btn btn-ws">Administrar el padrón</Link>
      </div>

      {members.length === 0 ? (
        <div className="empty-teach">
          <div className="empty-teach-icon">🏈</div>
          <h3>Empieza por tu padrón</h3>
          <p>
            Da de alta a la gente que entrena contigo y a partir de ahí puedes cobrarles la cuota,
            llevar su estado de cuenta y mandarles recordatorios sin perseguir a nadie por WhatsApp.
            No hace falta estar en una liga para esto.
          </p>
          <Link to={`${base}/jugadores`} className="btn btn-accent">Ir al Padrón</Link>
        </div>
      ) : (
        <>
          <div className="ws-section-title">Cobranza de los últimos meses</div>
          <MonthlyFlowChart data={data.monthly_flow} />

          <div className="ws-section-title">Actividad reciente</div>
          <RecentActivity entries={data.recent_activity} />
        </>
      )}
    </div>
  );
}

function RecentActivity({ entries }) {
  if (!entries || entries.length === 0) {
    return (
      <p style={{ color: 'var(--ws-ink-faint)', fontSize: 13 }}>
        Todavía no hay movimientos. En cuanto generes las primeras cuotas, aquí vas a ver
        quién pagó y quién no.
      </p>
    );
  }

  return (
    <div>
      {entries.map((e) => {
        const isCharge = e.kind === 'charge';
        const isPayment = e.kind === 'payment';
        const pending = isPayment && e.status === 'pending';
        const voided = e.status === 'void';
        const fromPlayer = e.created_by_side === 'player';

        return (
          <div key={e.id} className={`ledger-row${voided ? ' is-void' : ''}`}>
            <div className="ledger-row-main">
              <div className="ledger-row-concept">
                <strong>{e.display_name}</strong>
                {isCharge && ' — nuevo cargo'}
                {isPayment && (fromPlayer ? ' — reportó un pago' : ' — pago registrado')}
                {e.kind === 'adjustment' && ' — ajuste'}
              </div>
              <div className="ledger-row-meta">
                {e.concept} · {fmtDate(e.created_at)}
                {voided ? ' · CANCELADO' : ''}
              </div>
            </div>
            <div className="ledger-row-right">
              {pending && <span className="pill is-info">Por confirmar</span>}
              <span className={`money ${isCharge ? 'is-owed' : 'is-positive'}`}>
                {isCharge ? '−' : '+'}{money(e.amount)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
