import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import Loading from './Loading.jsx';
import Modal from './Modal.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import LedgerEntryList from './LedgerEntryList.jsx';
import PlayerChargeForm from './PlayerChargeForm.jsx';
import PlayerPaymentForm from './PlayerPaymentForm.jsx';
import ClubMemberForm from './ClubMemberForm.jsx';
import RepeatPlayerChargeModal from './RepeatPlayerChargeModal.jsx';
import MonthlyFlowChart from './MonthlyFlowChart.jsx';
import { money, moneyShort, fmtDate, timeAgo, balanceClass } from '../utils/money.js';

const CATEGORY_LABELS = {
  mensualidad: 'Mensualidad', inscripcion: 'Inscripción', uniforme: 'Uniforme',
  torneo: 'Torneo / viaje', equipamiento: 'Equipamiento', multa: 'Multa', otro: 'Otro',
};

function statementUrl(shareToken) {
  return `${window.location.origin}/cuenta/${shareToken}`;
}

// Arma el mensaje que el tesorero manda por WhatsApp. El punto no es ahorrar
// tecleo: es que el mensaje SIEMPRE lleve el link del estado de cuenta, que es
// lo que corta la conversación de "¿cuánto debo?" / "mándame captura" en la
// que se va la vida de quien cobra en un club.
//
// Se abre WhatsApp con el texto ya escrito (wa.me), no se manda solo: no hay
// API de por medio, no cuesta nada, y el tesorero puede editarlo antes de
// enviarlo — que es lo correcto, porque conoce el tono de cada familia.
function whatsappReminderUrl(member, teamName) {
  const link = statementUrl(member.share_token);
  const saludo = member.tutor_name ? `Hola ${member.tutor_name}` : 'Hola';
  const owed = Number(member.balance) < 0;

  const cuerpo = owed
    ? `${saludo}, te escribo de ${teamName}. ${member.display_name} tiene un saldo pendiente de `
      + `${money(member.balance)}${member.next_due_date ? ` (vence el ${fmtDate(member.next_due_date)})` : ''}. `
      + `Aquí puedes ver el detalle y reportar tu pago: ${link}`
    : `${saludo}, te escribo de ${teamName}. ${member.display_name} está al corriente con sus cuotas. `
      + `Puedes consultar su estado de cuenta cuando quieras aquí: ${link}`;

  const phone = String(member.tutor_phone || '').replace(/[^\d]/g, '');
  return `https://wa.me/${phone}?text=${encodeURIComponent(cuerpo)}`;
}

// Cuotas del club hacia sus jugadores. Es el libro equipo → jugador
// (member_ledger_entries), el gemelo del que la liga usa para cobrarle al
// equipo — pero aquí el papá también escribe: reporta su pago desde el link
// público y el club lo confirma.
export default function TeamFinancesSection({ team, token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [openMemberId, setOpenMemberId] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => { refresh(); }, [team.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  function refresh() {
    setError('');
    return api.getPlayerBillingOverview(team.id, token)
      .then(setData)
      .catch((e) => setError(e.message));
  }

  async function openLedger(memberId) {
    if (openMemberId === memberId) { setOpenMemberId(null); setLedger(null); return; }
    setOpenMemberId(memberId);
    setLedger(null);
    try {
      setLedger(await api.getMemberLedger(team.id, memberId, token));
    } catch (e) {
      setError(e.message);
    }
  }

  async function reloadLedger(memberId) {
    if (!memberId) return;
    try {
      setLedger(await api.getMemberLedger(team.id, memberId, token));
    } catch { /* el panorama ya se refrescó; el detalle puede esperar */ }
  }

  async function afterWrite(memberId) {
    setModal(null);
    setConfirm(null);
    await refresh();
    await reloadLedger(memberId ?? openMemberId);
  }

  async function toggleReminders() {
    if (!data) return;
    setSavingSettings(true);
    try {
      const next = !data.team.member_billing_reminders_enabled;
      await api.updatePlayerBillingSettings(team.id, { member_billing_reminders_enabled: next }, token);
      setData((d) => ({ ...d, team: { ...d.team, member_billing_reminders_enabled: next } }));
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function remind(member) {
    // Marcar el recordatorio ANTES de abrir WhatsApp: si se hace después, el
    // navegador ya cambió de pestaña y la petición se puede quedar a medias.
    try {
      await api.updateTeamMember(team.id, member.member_id, { mark_reminded: true }, token);
      await refresh();
    } catch { /* que no se pierda el recordatorio por un fallo de red */ }
    window.open(whatsappReminderUrl(member, team.name), '_blank', 'noopener');
  }

  async function copyLink(member) {
    try {
      await navigator.clipboard.writeText(statementUrl(member.share_token));
      setNotice(`Link de ${member.display_name} copiado. Pégalo en tu grupo de WhatsApp.`);
      setTimeout(() => setNotice(''), 4000);
    } catch {
      setError('Tu navegador no dejó copiar el link. Ábrelo desde "Ver movimientos".');
    }
  }

  if (error && !data) return <div className="form-error">{error}</div>;
  if (!data) return <Loading />;

  const { kpis, members, pending_payments: pending } = data;
  const hasMembers = members.length > 0;
  const hasMovements = data.recent_activity.length > 0;

  if (!hasMembers) {
    return (
      <div className="empty-teach">
        <div className="empty-teach-icon">💰</div>
        <h3>Primero arma el padrón de tu club</h3>
        <p>
          Las cuotas se le cobran a la gente que tengas en tu padrón. Ve a la sección Jugadores
          y da de alta a quienes entrenan contigo — no necesitas estar en una liga ni inscrito
          en ningún torneo para empezar a cobrarles.
        </p>
      </div>
    );
  }

  return (
    <div>
      {error && <div className="form-error">{error}</div>}
      {notice && <div className="form-success">{notice}</div>}

      <div className="stat-strip">
        <div className="stat-tile">
          <div className="stat-tile-label">Cobrado este mes</div>
          <div className="stat-tile-value is-accent">{moneyShort(kpis.collected_this_month)}</div>
        </div>
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
            {kpis.active_count > 0 ? Math.round((kpis.up_to_date_count / kpis.active_count) * 100) : 0}%
          </div>
          <div className="stat-tile-sub">{kpis.up_to_date_count} de {kpis.active_count} jugadores</div>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="pending-tray">
          <div className="pending-tray-head">
            {pending.length} {pending.length === 1 ? 'pago espera' : 'pagos esperan'} tu confirmación
          </div>
          {pending.map((p) => (
            <div key={p.id} className="pending-row">
              <div className="pending-row-main">
                <div><strong>{p.display_name}</strong> reportó un pago</div>
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
                    await api.confirmPlayerPayment(p.id, token);
                    await afterWrite(p.member_id);
                  } catch (e) { setError(e.message); }
                }}
              >
                Confirmar
              </button>
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--danger)' }}
                onClick={() => setConfirm({
                  kind: 'reject',
                  entry: p,
                  memberName: p.display_name,
                })}
              >
                Rechazar
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="ws-toolbar">
        <button className="btn btn-accent" onClick={() => setModal({ type: 'charge' })}>
          Generar cuotas
        </button>
        <button className="btn btn-ws" onClick={() => setModal({ type: 'repeat' })}>
          Repetir el mes pasado
        </button>
        <label className="spacer" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ws-ink-dim)' }}>
          <input
            type="checkbox"
            checked={!!data.team.member_billing_reminders_enabled}
            onChange={toggleReminders}
            disabled={savingSettings}
          />
          Avisarme de cuotas vencidas
        </label>
      </div>

      {!hasMovements && (
        <div className="empty-teach" style={{ marginBottom: 24 }}>
          <div className="empty-teach-icon">🧾</div>
          <h3>Todavía no le cobras a nadie</h3>
          <p>
            Ponle su cuota a cada jugador en la tabla de abajo y después dale a
            <strong> Generar cuotas</strong>. A partir del mes que entra las vuelves a crear
            con un clic, y cada familia puede ver lo que debe sin tener que preguntarte.
          </p>
          <button className="btn btn-accent" onClick={() => setModal({ type: 'charge' })}>
            Generar las primeras cuotas
          </button>
        </div>
      )}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Jugador</th>
              <th>Cuota</th>
              <th className="col-num">Saldo</th>
              <th className="col-num">Vencido</th>
              <th>Vence</th>
              <th>Recordado</th>
              <th className="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {members.map((p) => {
              const balance = Number(p.balance);
              const isBaja = p.status === 'baja';
              const reminded = timeAgo(p.last_reminded_at);
              return (
                <tr key={p.member_id} className={isBaja ? 'row-muted' : ''}>
                  <td>
                    <div className="cell-player">
                      {p.photo_url && <img src={p.photo_url} alt="" />}
                      <div style={{ minWidth: 0 }}>
                        <div className="cell-player-name">
                          {p.display_name}
                          {p.jersey_number != null && (
                            <span style={{ color: 'var(--ws-ink-faint)' }}> #{p.jersey_number}</span>
                          )}
                        </div>
                        <div className="cell-player-sub">
                          {p.group_label || 'Sin categoría'}
                          {p.status === 'beca' && ' · Becado'}
                          {isBaja && ' · Baja'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {p.monthly_amount != null
                      ? <span className="money is-zero">{money(p.monthly_amount)}</span>
                      : <span style={{ color: 'var(--ws-ink-faint)', fontSize: 12 }}>sin definir</span>}
                  </td>
                  <td className="col-num">
                    <span className={`money ${balanceClass(balance)}`}>{money(balance)}</span>
                  </td>
                  <td className="col-num">
                    {Number(p.overdue_amount) > 0
                      ? <span className="money is-overdue">{money(p.overdue_amount)}</span>
                      : <span className="money is-zero">—</span>}
                  </td>
                  <td style={{ color: 'var(--ws-ink-faint)', fontSize: 12 }}>{fmtDate(p.next_due_date)}</td>
                  <td style={{ color: 'var(--ws-ink-faint)', fontSize: 12 }}>{reminded || '—'}</td>
                  <td className="col-actions">
                    {p.tutor_phone ? (
                      <button className="btn btn-ghost btn-sm" title="Abre WhatsApp con el mensaje listo"
                        onClick={() => remind(p)}>
                        Recordar
                      </button>
                    ) : (
                      <button className="btn btn-ghost btn-sm" title="Copia el link del estado de cuenta"
                        onClick={() => copyLink(p)}>
                        Copiar link
                      </button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'account', member: p })}>
                      Ficha
                    </button>
                    <button className="btn btn-ws btn-sm" onClick={() => setModal({ type: 'payment', member: p })}>
                      + Pago
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => openLedger(p.member_id)}>
                      {openMemberId === p.member_id ? 'Ocultar' : 'Movimientos'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openMemberId && (
        <div style={{
          marginTop: 20, background: 'var(--ws-surface)', border: '1px solid var(--ws-line)',
          borderRadius: 'var(--radius-md)', padding: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18 }}>
              Movimientos — {ledger ? ledger.member.display_name : ''}
            </h3>
            <button className="btn btn-ghost btn-sm" onClick={() => { setOpenMemberId(null); setLedger(null); }}>
              Cerrar
            </button>
          </div>
          {!ledger ? <Loading /> : (
            <LedgerEntryList
              entries={ledger.entries}
              categoryLabels={CATEGORY_LABELS}
              emptyText="Este jugador todavía no tiene movimientos."
              onConfirm={async (entry) => {
                try {
                  await api.confirmPlayerPayment(entry.id, token);
                  await afterWrite(openMemberId);
                } catch (e) { setError(e.message); }
              }}
              onVoid={(entry) => setConfirm({
                kind: entry.kind === 'payment' && entry.status === 'pending' ? 'reject' : 'void',
                entry,
                memberName: ledger.member.display_name,
              })}
            />
          )}
        </div>
      )}

      {data.monthly_flow.length > 0 && (
        <>
          <div className="ws-section-title">Cobranza de los últimos meses</div>
          <MonthlyFlowChart data={data.monthly_flow} />
        </>
      )}

      {modal?.type === 'charge' && (
        <Modal title="Generar cuotas" onClose={() => setModal(null)}>
          <PlayerChargeForm
            members={members}
            categories={data.categories}
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.createPlayerCharges(team.id, payload, token);
              await afterWrite();
            }}
          />
        </Modal>
      )}

      {modal?.type === 'repeat' && (
        <Modal title="Repetir cargos de un mes anterior" onClose={() => setModal(null)}>
          <RepeatPlayerChargeModal
            batches={data.recent_batches}
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.repeatPlayerCharges(team.id, payload, token);
              await afterWrite();
            }}
          />
        </Modal>
      )}

      {modal?.type === 'payment' && (
        <Modal title={`Registrar pago — ${modal.member.display_name}`} onClose={() => setModal(null)}>
          <PlayerPaymentForm
            memberName={modal.member.display_name}
            methods={data.payment_methods}
            suggestedAmount={Number(modal.member.balance) < 0 ? Math.abs(Number(modal.member.balance)) : null}
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.recordMemberPayment(team.id, modal.member.member_id, payload, token);
              await afterWrite(modal.member.member_id);
            }}
          />
        </Modal>
      )}

      {modal?.type === 'account' && (
        <Modal title={`Ficha — ${modal.member.display_name}`} onClose={() => setModal(null)}>
          <ClubMemberForm
            member={modal.member}
            statuses={data.account_statuses}
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.updateTeamMember(team.id, modal.member.member_id, payload, token);
              await afterWrite(modal.member.member_id);
            }}
          />
        </Modal>
      )}

      {confirm?.kind === 'reject' && (
        <ConfirmDialog
          title="Rechazar este pago"
          message={`El pago que reportó ${confirm.memberName} se marca como rechazado y no se aplica a su saldo.`}
          detail={<>
            <strong>{money(confirm.entry.amount)}</strong> · {confirm.entry.payment_method}
            {confirm.entry.reference ? ` · ${confirm.entry.reference}` : ''}
          </>}
          warning="El movimiento queda en el historial como rechazado — no se borra. Avísale a la familia por WhatsApp para que lo vuelva a reportar bien."
          confirmLabel="Rechazar pago"
          danger
          reasonLabel="Motivo (queda asentado)"
          reasonRequired
          onClose={() => setConfirm(null)}
          onConfirm={async (reason) => {
            await api.voidPlayerLedgerEntry(confirm.entry.id, reason, token);
            await afterWrite(confirm.entry.member_id);
          }}
        />
      )}

      {confirm?.kind === 'void' && (
        <ConfirmDialog
          title={confirm.entry.kind === 'charge' ? 'Cancelar este cargo' : 'Cancelar este pago'}
          message={`Se cancela el movimiento de ${confirm.memberName} y su saldo se recalcula.`}
          detail={<>
            <strong>{money(confirm.entry.amount)}</strong> · {confirm.entry.concept}
            {confirm.entry.due_date ? ` · vence ${fmtDate(confirm.entry.due_date)}` : ''}
          </>}
          warning="El libro no borra nada: el movimiento se marca como cancelado y se le suma otro que lo revierte, para que el saldo siempre cuadre con el historial."
          confirmLabel="Cancelar movimiento"
          cancelLabel="Mejor no"
          danger
          reasonLabel="Motivo (opcional, queda asentado)"
          onClose={() => setConfirm(null)}
          onConfirm={async (reason) => {
            await api.voidPlayerLedgerEntry(confirm.entry.id, reason, token);
            await afterWrite(confirm.entry.member_id);
          }}
        />
      )}
    </div>
  );
}
