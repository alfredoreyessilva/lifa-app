import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import Modal from '../components/Modal.jsx';
import Loading from '../components/Loading.jsx';
import ChargeForm from '../components/ChargeForm.jsx';
import PaymentForm from '../components/PaymentForm.jsx';
import RepeatChargeModal from '../components/RepeatChargeModal.jsx';

const CATEGORY_LABELS = {
  campo: 'Renta de campo', arbitraje: 'Arbitraje', transmision: 'Transmisión',
  inscripcion: 'Inscripción', multa: 'Multa', fianza: 'Fianza', otro: 'Otro',
};

function money(v) {
  const n = Number(v || 0);
  return `$${Math.abs(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function balanceColor(n) {
  if (Number(n) < 0) return 'var(--flag)';
  if (Number(n) > 0) return 'var(--field)';
  return 'var(--ink-dim)';
}

function balanceText(n) {
  const num = Number(n || 0);
  if (num < 0) return `Debe ${money(num)}`;
  if (num > 0) return `A favor ${money(num)}`;
  return 'Al corriente';
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Panel de cobranza de una liga. Ruta: /panel/liga/:id/cobranza
export default function BillingLeaguePanel() {
  const { id } = useParams();
  const { token, leagues } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { type, team? }
  const [savingSettings, setSavingSettings] = useState(false);

  const [openTeamId, setOpenTeamId] = useState(null);
  const [ledger, setLedger] = useState(null); // { team, balance, entries }

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
      const d = await api.getTeamLedger(id, teamId, token);
      setLedger(d);
    } catch (e) {
      setError(e.message);
    }
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

  async function handleCreateCharges(payload) {
    await api.createCharges(id, payload, token);
    setModal(null);
    await refresh();
    if (openTeamId) openLedgerReload(openTeamId);
  }

  async function handleRepeat(payload) {
    await api.repeatCharges(id, payload, token);
    setModal(null);
    await refresh();
    if (openTeamId) openLedgerReload(openTeamId);
  }

  async function handleRecordPayment(payload) {
    await api.recordPayment(id, modal.team.team_id, payload, token);
    setModal(null);
    await refresh();
    if (openTeamId === modal.team.team_id || openTeamId) openLedgerReload(modal.team.team_id);
  }

  async function openLedgerReload(teamId) {
    try {
      const d = await api.getTeamLedger(id, teamId, token);
      setLedger(d);
      setOpenTeamId(teamId);
    } catch { /* noop */ }
  }

  async function voidEntry(entry) {
    const label = entry.kind === 'charge' ? 'cargo' : 'pago';
    if (!window.confirm(`¿Cancelar este ${label} de ${money(entry.amount)}? Queda registrado en el historial como cancelado.`)) return;
    try {
      await api.voidLedgerEntry(entry.id, null, token);
      await refresh();
      openLedgerReload(openTeamId);
    } catch (e) {
      setError(e.message);
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
          <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={() => navigate('/panel')}>Volver a mi panel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="crumb">
        <Link to={`/panel/liga/${id}/estructura`}>← {data ? data.league.name : 'Liga'}</Link>
      </div>

      <div className="dash-header">
        <div>
          <span className="eyebrow">{data ? data.league.name : 'Cargando…'}</span>
          <h1>Cobranza</h1>
        </div>
      </div>

      <p style={{ color: 'var(--ink-dim)', fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        Registra lo que cobras cada semana a tus equipos (campo, arbitraje, transmisión…) y lleva su
        estado de cuenta. Cada equipo ve solo el suyo desde su panel.
      </p>

      {error && <div className="form-error">{error}</div>}

      {!data ? <Loading /> : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 16 }}>
            <button className="btn btn-flag" onClick={() => setModal({ type: 'charge' })}>+ Registrar cobro</button>
            <button className="btn btn-outline" onClick={() => setModal({ type: 'repeat' })}>↻ Repetir jornada anterior</button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginLeft: 'auto' }}>
              <input type="checkbox" checked={!!data.league.billing_reminders_enabled}
                onChange={toggleReminders} disabled={savingSettings} />
              Recordatorios automáticos a los equipos
            </label>
          </div>

          {data.teams.length === 0 ? (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
              Esta liga todavía no tiene equipos. Créalos en el panel de la liga para poder cobrarles.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="billing-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)', color: 'var(--ink-dim)', fontSize: 12 }}>
                    <th style={{ padding: '8px 6px' }}>Equipo</th>
                    <th style={{ padding: '8px 6px' }}>Saldo</th>
                    <th style={{ padding: '8px 6px' }}>Vencido</th>
                    <th style={{ padding: '8px 6px' }}>Próximo vencimiento</th>
                    <th style={{ padding: '8px 6px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {data.teams.map((t) => (
                    <tr key={t.team_id} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '8px 6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {t.logo_url && <img src={t.logo_url} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />}
                          <span>{t.team_name}</span>
                          {!t.has_representative && <span title="Sin representante todavía" style={{ fontSize: 11, color: 'var(--ink-dim)' }}>· sin rep.</span>}
                        </div>
                      </td>
                      <td style={{ padding: '8px 6px', color: balanceColor(t.balance), fontWeight: 600 }}>
                        {balanceText(t.balance)}
                      </td>
                      <td style={{ padding: '8px 6px', color: Number(t.overdue_amount) > 0 ? 'var(--flag)' : 'var(--ink-dim)' }}>
                        {Number(t.overdue_amount) > 0 ? money(t.overdue_amount) : '—'}
                      </td>
                      <td style={{ padding: '8px 6px', color: 'var(--ink-dim)' }}>{fmtDate(t.next_due_date)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => openLedger(t.team_id)}>
                          {openTeamId === t.team_id ? 'Ocultar' : 'Ver movimientos'}
                        </button>
                        <button className="btn btn-outline btn-sm" style={{ marginLeft: 6 }}
                          onClick={() => setModal({ type: 'payment', team: t })}>
                          + Pago
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {openTeamId && (
            <div style={{ marginTop: 20, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>
                  Movimientos — {data.teams.find((t) => t.team_id === openTeamId)?.team_name}
                </h3>
                <button className="btn btn-ghost btn-sm" onClick={() => { setOpenTeamId(null); setLedger(null); }}>Cerrar</button>
              </div>
              {!ledger ? <Loading /> : <LedgerList ledger={ledger} onVoid={voidEntry} />}
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
            onSubmit={handleCreateCharges}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}

      {modal?.type === 'repeat' && data && (
        <Modal title="Repetir cargos de una jornada anterior" onClose={() => setModal(null)}>
          <RepeatChargeModal batches={data.recent_batches}
            onSubmit={handleRepeat} onCancel={() => setModal(null)} />
        </Modal>
      )}

      {modal?.type === 'payment' && data && (
        <Modal title={`Registrar pago — ${modal.team.team_name}`} onClose={() => setModal(null)}>
          <PaymentForm teamName={modal.team.team_name} methods={data.payment_methods}
            suggestedAmount={Number(modal.team.balance) < 0 ? Math.abs(Number(modal.team.balance)) : null}
            onSubmit={handleRecordPayment} onCancel={() => setModal(null)} />
        </Modal>
      )}
    </div>
  );
}

function LedgerList({ ledger, onVoid }) {
  if (!ledger.entries || ledger.entries.length === 0) {
    return <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Sin movimientos todavía.</p>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {ledger.entries.map((e) => {
        const isCharge = e.kind === 'charge';
        const isPayment = e.kind === 'payment';
        const isAdjustment = e.kind === 'adjustment';
        const voided = e.status === 'void';
        const sign = isCharge || (isAdjustment && e.direction === 'debit') ? '−' : '+';
        const color = sign === '−' ? 'var(--flag)' : 'var(--field)';
        return (
          <div key={e.id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
            padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 4,
            opacity: voided ? 0.5 : 1,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, textDecoration: voided ? 'line-through' : 'none' }}>
                {e.concept}
                {e.category && (CATEGORY_LABELS[e.category] || e.category) !== e.concept
                  ? ` · ${CATEGORY_LABELS[e.category] || e.category}` : ''}
                {e.week_label ? ` · J${e.week_label}` : ''}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-dim)' }}>
                {isCharge && `Cargo · vence ${fmtDate(e.due_date)}`}
                {isPayment && `Pago${e.payment_method ? ` (${e.payment_method})` : ''}${e.reference ? ` · ${e.reference}` : ''}`}
                {isAdjustment && 'Ajuste'}
                {e.status === 'settled' ? ' · saldado' : ''}
                {voided ? ' · CANCELADO' : ''}
                {' · '}{fmtDate(e.created_at)}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
              {e.proof_url && (
                <a href={e.proof_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">comprobante</a>
              )}
              <span style={{ color, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{sign}{money(e.amount)}</span>
              {!voided && !isAdjustment && (
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--flag)' }} onClick={() => onVoid(e)}>Cancelar</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
