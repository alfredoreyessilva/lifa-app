import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import Modal from '../components/Modal.jsx';
import Loading from '../components/Loading.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import LedgerEntryList from '../components/LedgerEntryList.jsx';
import ChargeForm from '../components/ChargeForm.jsx';
import PaymentForm from '../components/PaymentForm.jsx';
import RepeatChargeModal from '../components/RepeatChargeModal.jsx';
import { money, moneyShort, fmtDate, balanceClass, balanceText } from '../utils/money.js';

const CATEGORY_LABELS = {
  campo: 'Renta de campo', arbitraje: 'Arbitraje', transmision: 'Transmisión',
  inscripcion: 'Inscripción', multa: 'Multa', fianza: 'Fianza', otro: 'Otro',
};

// Panel de cobranza de una liga. Ruta: /panel/liga/:id/cobranza
//
// Usa las mismas piezas que el panel del equipo (.data-table, ConfirmDialog,
// LedgerEntryList, utils/money.js). Antes tenía su propia copia de cada cosa:
// cuatro helpers de formato repetidos, un LedgerList interno que pintaba lo
// mismo con otros estilos, una clase CSS `billing-table` que no existía en
// ninguna hoja, y un window.confirm del navegador para cancelar un movimiento
// contable — sin poder decir qué se cancelaba ni pedir el motivo.
export default function BillingLeaguePanel() {
  const { id } = useParams();
  const { token, leagues } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const [openTeamId, setOpenTeamId] = useState(null);
  const [ledger, setLedger] = useState(null);

  const isMine = (leagues || []).some((l) => String(l.id) === String(id));

  useEffect(() => {
    if (token && isMine) refresh();
  }, [id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  function refresh() {
    setError('');
    return api.getBillingOverview(id, token).then(setData).catch((e) => setError(e.message));
  }

  async function openLedger(teamId) {
    if (openTeamId === teamId) { setOpenTeamId(null); setLedger(null); return; }
    setOpenTeamId(teamId);
    setLedger(null);
    try {
      setLedger(await api.getTeamLedger(id, teamId, token));
    } catch (e) {
      setError(e.message);
    }
  }

  async function reloadLedger(teamId) {
    if (!teamId) return;
    try {
      setLedger(await api.getTeamLedger(id, teamId, token));
      setOpenTeamId(teamId);
    } catch { /* el panorama ya se refrescó; el detalle puede esperar */ }
  }

  async function afterWrite(teamId) {
    setModal(null);
    setConfirm(null);
    await refresh();
    await reloadLedger(teamId ?? openTeamId);
  }

  async function toggleReminders() {
    if (!data) return;
    setSavingSettings(true);
    try {
      const next = !data.league.billing_reminders_enabled;
      await api.updateBillingSettings(id, { billing_reminders_enabled: next }, token);
      setData((d) => ({ ...d, league: { ...d.league, billing_reminders_enabled: next } }));
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingSettings(false);
    }
  }

  if (!token) {
    return <div className="container"><p>Necesitas iniciar sesión para ver esto.</p></div>;
  }
  if (!isMine) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>No tienes permiso para ver este panel</h3>
          <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={() => navigate('/panel')}>
            Volver a mi panel
          </button>
        </div>
      </div>
    );
  }

  // KPIs de la liga. Se derivan de las filas que ya vienen en el overview, sin
  // pedirle nada nuevo al backend: lo que debe cada equipo, lo vencido, y
  // cuántos están al corriente.
  const kpis = data && {
    receivable: data.teams.reduce((sum, t) => sum + Math.max(-Number(t.balance), 0), 0),
    overdue: data.teams.reduce((sum, t) => sum + Number(t.overdue_amount || 0), 0),
    upToDate: data.teams.filter((t) => Number(t.balance) >= 0).length,
    total: data.teams.length,
  };

  const pending = data?.pending_payments || [];

  return (
    <div className="container">
      <div className="dashboard-panel ws">
        <div className="crumb">
          <Link to={`/panel/liga/${id}/estructura`}>← {data ? data.league.name : 'Liga'}</Link>
        </div>

        <div className="ws-head">
          <div className="ws-head-text">
            <span className="eyebrow">{data ? data.league.name : 'Cargando…'}</span>
            <h1>Cobranza</h1>
            <div className="ws-head-meta">
              Lo que cobras cada semana a tus equipos (campo, arbitraje, transmisión…).
              Cada equipo ve solo el suyo desde su panel.
            </div>
          </div>
        </div>

        {error && <div className="form-error">{error}</div>}

        {!data ? <Loading /> : (
          <>
            {data.teams.length > 0 && (
              <div className="stat-strip">
                <div className="stat-tile">
                  <div className="stat-tile-label">Por cobrar</div>
                  <div className={`stat-tile-value ${kpis.receivable > 0 ? 'is-owed' : 'is-zero'}`}>
                    {moneyShort(kpis.receivable)}
                  </div>
                </div>
                <div className="stat-tile">
                  <div className="stat-tile-label">Vencido</div>
                  <div className={`stat-tile-value ${kpis.overdue > 0 ? 'is-overdue' : 'is-zero'}`}>
                    {moneyShort(kpis.overdue)}
                  </div>
                </div>
                <div className="stat-tile">
                  <div className="stat-tile-label">Al corriente</div>
                  <div className="stat-tile-value is-positive">
                    {kpis.total > 0 ? Math.round((kpis.upToDate / kpis.total) * 100) : 0}%
                  </div>
                  <div className="stat-tile-sub">{kpis.upToDate} de {kpis.total} equipos</div>
                </div>
              </div>
            )}

            {pending.length > 0 && (
              <div className="pending-tray">
                <div className="pending-tray-head">
                  {pending.length === 1 ? 'Un pago espera' : `${pending.length} pagos esperan`} tu confirmación
                </div>
                {pending.map((p) => (
                  <div key={p.id} className="pending-row">
                    <div className="pending-row-main">
                      <div><strong>{p.team_name}</strong> reportó un pago</div>
                      <div className="pending-row-sub">
                        {p.payment_method}{p.reference ? ` · ${p.reference}` : ''} · {fmtDate(p.created_at)}
                        {p.note ? ` · ${p.note}` : ''}
                      </div>
                    </div>
                    <span className="money is-positive">{money(p.amount)}</span>
                    {p.proof_url && (
                      <a href={p.proof_url} target="_blank" rel="noopener noreferrer" className="btn btn-ws btn-sm">
                        Ver comprobante
                      </a>
                    )}
                    <button
                      className="btn btn-accent btn-sm"
                      onClick={async () => {
                        try {
                          await api.confirmTeamPayment(p.id, token);
                          await afterWrite(p.team_id);
                        } catch (e) { setError(e.message); }
                      }}
                    >
                      Confirmar
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--danger)' }}
                      onClick={() => setConfirm({ entry: p, teamName: p.team_name, reject: true })}
                    >
                      Rechazar
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="ws-toolbar">
              <button className="btn btn-accent" onClick={() => setModal({ type: 'charge' })}>
                Registrar cobro
              </button>
              <button className="btn btn-ws" onClick={() => setModal({ type: 'repeat' })}>
                Repetir jornada anterior
              </button>
              <label className="spacer" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ws-ink-dim)' }}>
                <input type="checkbox" checked={!!data.league.billing_reminders_enabled}
                  onChange={toggleReminders} disabled={savingSettings} />
                Recordatorios automáticos a los equipos
              </label>
            </div>

            {data.teams.length === 0 ? (
              <div className="empty-teach">
                <div className="empty-teach-icon">🏟️</div>
                <h3>Esta liga todavía no tiene equipos</h3>
                <p>
                  Créalos en el panel de la liga y aquí vas a poder registrarles lo que les cobras
                  cada jornada, llevar su estado de cuenta y ver quién te debe.
                </p>
                <Link to={`/panel/liga/${id}/estructura`} className="btn btn-accent">
                  Ir a la estructura de la liga
                </Link>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Equipo</th>
                      <th>Saldo</th>
                      <th className="col-num">Vencido</th>
                      <th>Próximo vencimiento</th>
                      <th className="col-actions"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.teams.map((t) => (
                      <tr key={t.team_id}>
                        <td>
                          <div className="cell-player">
                            {t.logo_url && <img src={t.logo_url} alt="" />}
                            <div style={{ minWidth: 0 }}>
                              <div className="cell-player-name">{t.team_name}</div>
                              {!t.has_representative && (
                                <div className="cell-player-sub">sin representante todavía</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`money ${balanceClass(t.balance)}`}>{balanceText(t.balance)}</span>
                        </td>
                        <td className="col-num">
                          {Number(t.overdue_amount) > 0
                            ? <span className="money is-overdue">{money(t.overdue_amount)}</span>
                            : <span className="money is-zero">—</span>}
                        </td>
                        <td style={{ color: 'var(--ws-ink-faint)', fontSize: 12 }}>{fmtDate(t.next_due_date)}</td>
                        <td className="col-actions">
                          <button className="btn btn-ws btn-sm" onClick={() => setModal({ type: 'payment', team: t })}>
                            + Pago
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => openLedger(t.team_id)}>
                            {openTeamId === t.team_id ? 'Ocultar' : 'Movimientos'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {openTeamId && (
              <div style={{
                marginTop: 20, background: 'var(--ws-surface)', border: '1px solid var(--ws-line)',
                borderRadius: 'var(--radius-md)', padding: 16,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18 }}>
                    Movimientos — {data.teams.find((t) => t.team_id === openTeamId)?.team_name}
                  </h3>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setOpenTeamId(null); setLedger(null); }}>
                    Cerrar
                  </button>
                </div>
                {!ledger ? <Loading /> : (
                  <LedgerEntryList
                    entries={ledger.entries}
                    categoryLabels={CATEGORY_LABELS}
                    periodPrefix="J"
                    emptyText="Este equipo todavía no tiene movimientos."
                    onConfirm={async (entry) => {
                      try {
                        await api.confirmTeamPayment(entry.id, token);
                        await afterWrite(openTeamId);
                      } catch (e) { setError(e.message); }
                    }}
                    onVoid={(entry) => setConfirm({
                      entry,
                      teamName: ledger.team.name,
                      reject: entry.kind === 'payment' && entry.status === 'pending',
                    })}
                  />
                )}
              </div>
            )}
          </>
        )}

        {modal?.type === 'charge' && data && (
          <Modal title="Registrar cobro" onClose={() => setModal(null)}>
            <ChargeForm
              teams={data.teams}
              categories={data.categories}
              tournaments={data.tournaments || []}
              weekLabels={data.week_labels || []}
              leagueId={id}
              token={token}
              onCancel={() => setModal(null)}
              onSubmit={async (payload) => {
                await api.createCharges(id, payload, token);
                await afterWrite();
              }}
            />
          </Modal>
        )}

        {modal?.type === 'repeat' && data && (
          <Modal title="Repetir cargos de una jornada anterior" onClose={() => setModal(null)}>
            <RepeatChargeModal
              batches={data.recent_batches}
              onCancel={() => setModal(null)}
              onSubmit={async (payload) => {
                await api.repeatCharges(id, payload, token);
                await afterWrite();
              }}
            />
          </Modal>
        )}

        {modal?.type === 'payment' && data && (
          <Modal title={`Registrar pago — ${modal.team.team_name}`} onClose={() => setModal(null)}>
            <PaymentForm
              teamName={modal.team.team_name}
              methods={data.payment_methods}
              suggestedAmount={Number(modal.team.balance) < 0 ? Math.abs(Number(modal.team.balance)) : null}
              onCancel={() => setModal(null)}
              onSubmit={async (payload) => {
                await api.recordPayment(id, modal.team.team_id, payload, token);
                await afterWrite(modal.team.team_id);
              }}
            />
          </Modal>
        )}

        {confirm && (
          <ConfirmDialog
            title={confirm.reject
              ? 'Rechazar este pago'
              : confirm.entry.kind === 'charge' ? 'Cancelar este cargo' : 'Cancelar este pago'}
            message={confirm.reject
              ? `El pago que reportó ${confirm.teamName} se marca como rechazado y no se aplica a su saldo.`
              : `Se cancela el movimiento de ${confirm.teamName} y su saldo se recalcula.`}
            detail={<>
              <strong>{money(confirm.entry.amount)}</strong> · {confirm.entry.concept || confirm.entry.payment_method}
              {confirm.entry.reference ? ` · ${confirm.entry.reference}` : ''}
              {confirm.entry.due_date ? ` · vence ${fmtDate(confirm.entry.due_date)}` : ''}
            </>}
            warning={confirm.reject
              ? 'El movimiento queda en el historial como rechazado — no se borra. Al equipo le llega el aviso para que lo vuelva a reportar bien.'
              : 'El libro no borra nada: el movimiento se marca como cancelado y se le suma otro que lo revierte, para que el saldo siempre cuadre con el historial.'}
            confirmLabel={confirm.reject ? 'Rechazar pago' : 'Cancelar movimiento'}
            cancelLabel="Mejor no"
            danger
            reasonLabel={confirm.reject ? 'Motivo (queda asentado)' : 'Motivo (opcional, queda asentado)'}
            reasonRequired={!!confirm.reject}
            onClose={() => setConfirm(null)}
            onConfirm={async (reason) => {
              await api.voidLedgerEntry(confirm.entry.id, reason, token);
              await afterWrite(confirm.entry.team_id ?? openTeamId);
            }}
          />
        )}
      </div>
    </div>
  );
}
