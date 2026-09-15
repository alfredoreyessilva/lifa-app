import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import Loading from '../components/Loading.jsx';
import LedgerEntryList from '../components/LedgerEntryList.jsx';
import Modal from '../components/Modal.jsx';
import ReportPaymentForm from '../components/ReportPaymentForm.jsx';
import { money, fmtDate } from '../utils/money.js';
import { useAccentColor } from '../utils/color.js';

const CATEGORY_LABELS = {
  mensualidad: 'Mensualidad', inscripcion: 'Inscripción', uniforme: 'Uniforme',
  torneo: 'Torneo / viaje', equipamiento: 'Equipamiento', multa: 'Multa', otro: 'Otro',
};

// Estado de cuenta de UN jugador, público y sin sesión. Ruta: /cuenta/:token
//
// Es la pantalla que el papá abre desde WhatsApp, casi siempre en el teléfono
// y casi siempre con prisa. Por eso: el saldo es lo primero y lo más grande, y
// el botón de reportar el pago está arriba, no al final del historial.
//
// El token de la URL es la credencial — no hay login. El backend nunca
// devuelve datos de otro jugador desde este endpoint.
export default function PlayerStatementPage() {
  const { shareToken } = useParams();
  const [data, setData] = useState(null);
  // Dos errores distintos a propósito: uno mata la página (el token no existe)
  // y el otro es un aviso encima de la página que sí cargó (falló retirar el
  // pago). Con uno solo, tropezar en una acción borraba todo lo demás.
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [reporting, setReporting] = useState(false);
  const [sent, setSent] = useState(false);

  // El modal de "reportar mi pago" es un portal: sin esto sale amarillo
  // aunque el club tenga su propio color.
  useAccentColor(data?.team?.brand_color);

  useEffect(() => { load(); }, [shareToken]); // eslint-disable-line react-hooks/exhaustive-deps

  function load() {
    setLoadError('');
    return api.getPublicPlayerStatement(shareToken)
      .then(setData)
      .catch((e) => setLoadError(e.message));
  }

  if (loadError) {
    return (
      <div className="statement-page">
        <div className="empty-state">
          <h3>No encontramos este estado de cuenta</h3>
          <p style={{ color: 'var(--ws-ink-dim)', fontSize: 13 }}>
            El link pudo haber sido reemplazado por tu club. Pídeles el nuevo.
          </p>
        </div>
      </div>
    );
  }

  if (!data) return <Loading />;

  const balance = Number(data.balance || 0);
  const owes = balance < 0;
  const overdue = Number(data.overdue_amount || 0) > 0;

  return (
    <div className="statement-page ws">
      <div className="statement-hero">
        {data.team.logo_url && (
          <img className="statement-hero-logo" src={data.team.logo_url} alt={data.team.name} />
        )}
        <div className="statement-label">{data.team.name}</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: '8px 0 16px' }}>
          {data.player.first_name} {data.player.last_name}
          {data.player.jersey_number != null && (
            <span style={{ color: 'var(--ws-ink-faint)' }}> #{data.player.jersey_number}</span>
          )}
        </h1>

        <div className="statement-label">
          {owes ? 'Saldo pendiente' : balance > 0 ? 'Saldo a favor' : 'Estado'}
        </div>
        <div
          className="statement-balance"
          style={{ color: owes ? 'var(--flag)' : balance > 0 ? 'var(--positive)' : 'var(--ws-ink)' }}
        >
          {balance === 0 ? 'Al corriente' : money(balance)}
        </div>

        {owes && data.next_due_date && (
          <div style={{ fontSize: 13, color: overdue ? 'var(--danger)' : 'var(--ws-ink-dim)' }}>
            {overdue
              ? `${money(data.overdue_amount)} ya vencido`
              : `Vence el ${fmtDate(data.next_due_date)}`}
          </div>
        )}

        {data.has_pending_payment ? (
          <div style={{ marginTop: 16 }}>
            <div className="pill is-info">Tu pago está en revisión</div>
            <div style={{ marginTop: 8 }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={async () => {
                  setActionError('');
                  try {
                    await api.withdrawPlayerPayment(shareToken);
                    setSent(false);
                    await load();
                  } catch (e) { setActionError(e.message); }
                }}
              >
                Me equivoqué, retirarlo
              </button>
            </div>
          </div>
        ) : (
          <button
            className="btn btn-accent btn-block"
            style={{ marginTop: 20 }}
            onClick={() => setReporting(true)}
          >
            Ya pagué — subir comprobante
          </button>
        )}
      </div>

      {actionError && <div className="form-error">{actionError}</div>}

      {sent && (
        <div className="form-success">
          Listo, tu club ya recibió el comprobante. En cuanto lo confirmen, tu saldo se actualiza aquí.
        </div>
      )}

      <div className="ws-section-title">Tus movimientos</div>

      <LedgerEntryList
        entries={data.entries}
        categoryLabels={CATEGORY_LABELS}
        emptyText="Tu club todavía no te ha registrado ningún cargo."
      />

      <p style={{ color: 'var(--ws-ink-faint)', fontSize: 12, marginTop: 24, textAlign: 'center' }}>
        ¿Algo no cuadra? Escríbele a tu club
        {data.team.contact_phone ? <> al <strong>{data.team.contact_phone}</strong></> : ''}
        {data.team.contact_email ? <> o a <strong>{data.team.contact_email}</strong></> : ''}.
        <br />
        Este estado de cuenta lo lleva tu club en CFBAMX.
      </p>

      {reporting && (
        <Modal title="Reportar mi pago" onClose={() => setReporting(false)}>
          <ReportPaymentForm
            methods={data.payment_methods}
            suggestedAmount={owes ? Math.abs(balance) : null}
            receiverLabel="tu club"
            uploadProof={(file) => api.uploadPaymentProof(shareToken, file)}
            submitPayment={(payload) => api.reportPlayerPayment(shareToken, payload)}
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
