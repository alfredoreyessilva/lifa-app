import { useState } from 'react';
import { formatNumber, toNumber } from '../../utils/adminPanel.js';
import { Band, ScoreCell, Scoreboard, SectionError, SectionLoading, Status } from './AdminKit.jsx';

// El cron que dispara POST /api/notifications/trigger vive FUERA del repositorio, y
// durante mucho tiempo la única forma de saber si seguía corriendo era entrar al
// panel del proveedor. De ahí esta sección: la app registra cada llamada, así que
// puede contestar sola las dos preguntas que importan — "¿sigue vivo?" y "¿cada
// cuánto?".
//
// La cadencia no se configura: se mide. 96 llamadas en un día completo son 15 minutos
// entre una y otra.

export const CRON_STATES = {
  ok:        { tone: 'on',  text: 'Corriendo' },
  atrasado:  { tone: 'ask', text: 'Atrasado' },
  sin_señal: { tone: 'bad', text: 'Sin señal' },
};

function haceCuanto(min) {
  if (min === null || min === undefined) return 'Nunca';
  if (min < 1)  return 'Hace menos de un minuto';
  if (min < 60) return `Hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'Hace 1 día' : `Hace ${d} días`;
}

function cadaCuanto(min) {
  if (!min) return '—';
  if (min < 60) return `Cada ${min} min`;
  const h = Math.round(min / 60);
  return h === 24 ? 'Una vez al día' : `Cada ${h} h`;
}

function tolerancia(min) {
  return min < 120 ? `${min} min` : `${Math.round(min / 60)} h`;
}

function hora(valor) {
  if (!valor) return '—';
  return new Date(valor).toLocaleTimeString('es-MX', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City',
  });
}

function fechaCorta(dia) {
  return new Date(`${dia}T12:00:00`).toLocaleDateString('es-MX', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function avisos(n) {
  return n === 1 ? '1 aviso' : `${n} avisos`;
}

// Resume en una línea qué hizo la corrida diaria de cobranza. El objeto que guarda la
// bitácora es el mismo que el endpoint del cron devuelve.
function resumenCobranza(r) {
  if (!r) return '—';
  const piezas = [];
  const liga = r.billing_reminders;
  const jug  = r.player_billing_reminders;
  if (liga && (liga.dueSoon || liga.overdue)) piezas.push(`liga: ${avisos(liga.dueSoon + liga.overdue)}`);
  if (jug  && (jug.dueSoon  || jug.overdue))  piezas.push(`clubes: ${avisos(jug.dueSoon + jug.overdue)}`);
  if (r.monthly_charges_created)              piezas.push(`${r.monthly_charges_created} mensualidades`);
  if (r.monthly_charges_error)                piezas.push(`⚠ ${r.monthly_charges_error}`);
  return piezas.length ? piezas.join(' · ') : 'Nada que hacer';
}

export default function AdminCronSection({ cron, error, reload }) {
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }

  const state = cron ? CRON_STATES[cron.estado] ?? CRON_STATES.sin_señal : null;
  const days = cron?.dias ?? [];
  const busiest = Math.max(1, ...days.map((d) => toNumber(d.llamadas)));

  return (
    <>
      <Band
        title="Cron"
        actions={(
          <button type="button" className="btn btn-ws btn-sm" disabled={refreshing || !cron} onClick={refresh}>
            {refreshing ? 'Actualizando…' : 'Actualizar'}
          </button>
        )}
      >
        <Scoreboard label="Estado del cron">
          <ScoreCell
            label="Estado"
            small
            loading={!cron}
            value={state && <Status tone={state.tone}>{state.text}</Status>}
            sub={cron?.minutos_de_tolerancia ? `Tolerancia de ${tolerancia(cron.minutos_de_tolerancia)}` : null}
          />
          <ScoreCell label="Última llamada" small loading={!cron} value={cron && haceCuanto(cron.minutos_desde_ultima_llamada)} />
          <ScoreCell
            label="Cadencia"
            small
            loading={!cron}
            value={cron && cadaCuanto(cron.cadencia_estimada_min)}
            sub={cron?.cadencia_medida_el ? `Medida el ${fechaCorta(cron.cadencia_medida_el)}` : null}
          />
          <ScoreCell label="Llamadas hoy" value={formatNumber(cron?.llamadas_hoy)} loading={!cron} />
          <ScoreCell
            label="Cobranza de hoy"
            small
            loading={!cron}
            value={cron && (cron.cobranza_corrio_hoy ? <Status tone="on" check>Corrió</Status> : <Status>Todavía no</Status>)}
          />
        </Scoreboard>
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[error]} />

        {!cron ? !error && <SectionLoading /> : (
          <>
            <h2 className="adm-canvas-title">Últimos 14 días</h2>

            {days.length === 0 ? (
              <div className="adm-no-results">
                <p>
                  Todavía no hay ninguna llamada registrada. Si el cron externo sigue configurado,
                  debería aparecer aquí en cuanto vuelva a correr.
                </p>
              </div>
            ) : (
              <div className="adm-table-box">
                <div className="table-wrap">
                  <table className="data-table adm-table adm-cron-table">
                    <caption className="adm-sr-only">Llamadas al cron por día</caption>
                    <thead>
                      <tr>
                        <th style={{ width: 140 }}>Día</th>
                        <th style={{ width: 220 }}>Llamadas</th>
                        <th style={{ width: 96 }}>Última</th>
                        <th style={{ width: 124 }}>Cobranza</th>
                        <th>Qué hizo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((d) => (
                        <tr key={d.dia}>
                          <td>{d.dia === cron.hoy_mx ? 'Hoy' : fechaCorta(d.dia)}</td>
                          <td>
                            <span className="adm-mini">
                              <span className="adm-mini-track">
                                <span style={{ width: `${(toNumber(d.llamadas) / busiest) * 100}%` }} />
                              </span>
                              <span className="adm-num">{formatNumber(d.llamadas)}</span>
                            </span>
                          </td>
                          <td className="adm-num">{hora(d.ultima_llamada)}</td>
                          <td>
                            {d.cobranza_ok
                              ? <Status tone="on" check><span className="adm-num">{hora(d.cobranza_a_las)}</span></Status>
                              : <span className="adm-faint">—</span>}
                          </td>
                          <td className="adm-cell-clip" title={resumenCobranza(d.cobranza_resultado)}>
                            {resumenCobranza(d.cobranza_resultado)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <p className="adm-note">
              Los avisos de partido corren en cada llamada; la cobranza y las mensualidades,
              una vez al día. La bitácora guarda 120 días.
            </p>
          </>
        )}
      </div>
    </>
  );
}
