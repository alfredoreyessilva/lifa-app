import { money, fmtDate } from '../utils/money.js';

// Lista de movimientos de un libro contable. La misma pintura sirve para los
// tres libros que existen hoy: liga→equipo (estado de cuenta del equipo),
// equipo→jugador (panel de Finanzas) y el estado de cuenta público del papá.
//
// Estaba copiada dos veces en línea (BillingLeaguePanel y TeamStatementPanel)
// con estilos distintos en cada copia; aquí queda una sola vez, con clases.
//
// Reglas de signo, iguales en los tres libros:
//   cargo              → −  (te suben el adeudo)
//   ajuste 'debit'     → −  (revierte un pago)
//   pago / ajuste credit → + (te bajan el adeudo)
export default function LedgerEntryList({
  entries,
  categoryLabels = {},
  periodPrefix = '',
  emptyText = 'Sin movimientos todavía.',
  onVoid,
  onConfirm,
}) {
  if (!entries || entries.length === 0) {
    return <p style={{ color: 'var(--ws-ink-dim)', fontSize: 13 }}>{emptyText}</p>;
  }

  return (
    <div>
      {entries.map((e) => {
        const isCharge = e.kind === 'charge';
        const isPayment = e.kind === 'payment';
        const isAdjustment = e.kind === 'adjustment';
        // 'void' es un movimiento cancelado (lleva su ajuste de reversa);
        // 'rejected' y 'withdrawn' son pagos que nunca se abonaron y por eso
        // no llevan ajuste — ver BALANCE_SUM_SQL en routes/billing.js. Los tres
        // se pintan tachados, pero no se llaman igual: al papá le importa
        // saber si se lo rechazaron o si él mismo lo retiró.
        const rejected = e.status === 'rejected';
        const withdrawn = e.status === 'withdrawn';
        const voided = e.status === 'void' || rejected || withdrawn;
        const pending = isPayment && e.status === 'pending';
        const negative = isCharge || (isAdjustment && e.direction === 'debit');
        const period = e.period_label || e.week_label;
        const categoryLabel = e.category ? (categoryLabels[e.category] || e.category) : null;

        return (
          <div key={e.id} className={`ledger-row${voided ? ' is-void' : ''}`}>
            <div className="ledger-row-main">
              <div className="ledger-row-concept">
                {e.concept}
                {categoryLabel && categoryLabel !== e.concept ? ` · ${categoryLabel}` : ''}
                {period ? ` · ${periodPrefix}${period}` : ''}
              </div>
              <div className="ledger-row-meta">
                {isCharge && `Cargo · vence ${fmtDate(e.due_date)}`}
                {isPayment && `Pago${e.payment_method ? ` (${e.payment_method})` : ''}${e.reference ? ` · ${e.reference}` : ''}`}
                {isAdjustment && 'Ajuste'}
                {e.status === 'settled' ? ' · saldado' : ''}
                {rejected ? ' · RECHAZADO' : withdrawn ? ' · RETIRADO' : e.status === 'void' ? ' · CANCELADO' : ''}
                {' · '}{fmtDate(e.created_at)}
              </div>
            </div>

            <div className="ledger-row-right">
              {pending && <span className="pill is-info">Por confirmar</span>}

              {e.proof_url && (
                <a href={e.proof_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                  Comprobante
                </a>
              )}

              <span className={`money ${negative ? 'is-owed' : 'is-positive'}`}>
                {negative ? '−' : '+'}{money(e.amount)}
              </span>

              {onConfirm && pending && (
                <button className="btn btn-accent btn-sm" onClick={() => onConfirm(e)}>Confirmar</button>
              )}

              {onVoid && !voided && !isAdjustment && (
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => onVoid(e)}>
                  {pending ? 'Rechazar' : 'Cancelar'}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
