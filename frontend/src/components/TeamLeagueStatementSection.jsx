import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import Loading from './Loading.jsx';
import Modal from './Modal.jsx';
import LedgerEntryList from './LedgerEntryList.jsx';
import ReportPaymentForm from './ReportPaymentForm.jsx';
import { money, fmtDate, balanceClass } from '../utils/money.js';

const CATEGORY_LABELS = {
  campo: 'Renta de campo', arbitraje: 'Arbitraje', transmision: 'Transmisión',
  inscripcion: 'Inscripción', multa: 'Multa', fianza: 'Fianza', otro: 'Otro',
};

// Lo que el equipo le debe A SU LIGA. Es el otro libro (team_ledger_entries,
// routes/billing.js): los cargos los pone la liga y el equipo no los toca, pero
// sus pagos sí los puede reportar — con su comprobante, igual que un papá con
// su club. El pago queda pendiente hasta que la liga lo confirma.
//
// Antes era la página /panel/equipo/:id/estado-de-cuenta con su propio
// encabezado y breadcrumb; ahora es una sección más del panel, para que el
// club vea sus dos frentes de dinero (lo que debe y lo que le deben) en el
// mismo lugar.
export default function TeamLeagueStatementSection({ team, token }) {
  const [data, setData] = useState(null);
  // Igual que en el estado de cuenta público: el error de carga reemplaza la
  // sección, el de una acción solo se avisa encima.
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [reporting, setReporting] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => { load(); }, [team.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  function load() {
    setData(null);
    setLoadError('');
    return api.getTeamStatement(team.id, token).then(setData).catch((e) => setLoadError(e.message));
  }

  if (loadError) return <div className="form-error">{loadError}</div>;
  if (!data) return <Loading />;

  const balance = Number(data.balance || 0);

  return (
    <div>
      {error && <div className="form-error">{error}</div>}

      <div className="stat-strip">
        <div className="stat-tile">
          <div className="stat-tile-label">{balance < 0 ? 'Le debes a la liga' : balance > 0 ? 'Saldo a favor' : 'Saldo'}</div>
          <div className={`stat-tile-value ${balanceClass(balance)}`}>{money(balance)}</div>
          <div className="stat-tile-sub">{data.league_name}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-label">Próximo vencimiento</div>
          <div className="stat-tile-value">{data.next_due_date ? fmtDate(data.next_due_date) : '—'}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-label">Vencido</div>
          <div className={`stat-tile-value ${Number(data.overdue_amount) > 0 ? 'is-overdue' : 'is-zero'}`}>
            {Number(data.overdue_amount) > 0 ? money(data.overdue_amount) : '—'}
          </div>
        </div>
      </div>

      {sent && (
        <div className="form-success">
          Listo, tu liga ya recibió el comprobante. En cuanto lo confirmen, tu saldo se actualiza aquí.
        </div>
      )}

      <div className="ws-toolbar">
        {data.has_pending_payment ? (
          <>
            <span className="pill is-info">Tienes un pago en revisión</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                setError('');
                try {
                  await api.withdrawTeamPayment(team.id, token);
                  setSent(false);
                  await load();
                } catch (e) { setError(e.message); }
              }}
            >
              Retirarlo
            </button>
          </>
        ) : (
          <button className="btn btn-accent" onClick={() => setReporting(true)}>
            Ya pagué — reportar pago
          </button>
        )}
      </div>

      <div className="ws-section-title">Movimientos con la liga</div>

      <LedgerEntryList
        entries={data.entries}
        categoryLabels={CATEGORY_LABELS}
        periodPrefix="J"
        emptyText="Tu liga todavía no te ha registrado ningún cargo."
      />

      <p style={{ color: 'var(--ws-ink-faint)', fontSize: 12, marginTop: 20 }}>
        Los cargos los registra tu liga. Tus pagos los puedes reportar aquí con tu comprobante,
        y tu saldo se actualiza en cuanto tu liga los confirme.
        {data.league_contact?.whatsapp
          ? <> Si algo no cuadra, avísale por WhatsApp al <strong>{data.league_contact.whatsapp}</strong>.</>
          : ''}
      </p>

      {reporting && (
        <Modal title="Reportar un pago a tu liga" onClose={() => setReporting(false)}>
          <ReportPaymentForm
            methods={data.payment_methods}
            suggestedAmount={balance < 0 ? Math.abs(balance) : null}
            receiverLabel="tu liga"
            uploadProof={(file) => api.uploadImage(file, token)}
            submitPayment={(payload) => api.reportTeamPayment(team.id, payload, token)}
            onCancel={() => setReporting(false)}
            onDone={async () => {
              setReporting(false);
              setSent(true);
              await load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
