import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import Loading from '../components/Loading.jsx';

const CATEGORY_LABELS = {
  campo: 'Renta de campo', arbitraje: 'Arbitraje', transmision: 'Transmisión',
  inscripcion: 'Inscripción', multa: 'Multa', fianza: 'Fianza', otro: 'Otro',
};

function money(v) {
  const n = Number(v || 0);
  return `$${Math.abs(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Estado de cuenta de un equipo con su liga — SOLO LECTURA.
// Ruta: /panel/equipo/:id/estado-de-cuenta
export default function TeamStatementPanel() {
  const { id } = useParams();
  const { token, teams } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const isMine = (teams || []).some((t) => String(t.id) === String(id));

  useEffect(() => {
    if (!token || !isMine) return;
    api.getTeamStatement(id, token).then(setData).catch((e) => setError(e.message));
  }, [id, token]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const balance = Number(data?.balance || 0);
  const owes = balance < 0;

  return (
    <div className="container">
      <div className="crumb">
        <Link to={`/panel/equipo/${id}`}>← {data ? data.team.name : 'Equipo'}</Link>
      </div>

      <div className="dash-header">
        <div>
          <span className="eyebrow">{data ? `${data.team.name} · ${data.league_name}` : 'Cargando…'}</span>
          <h1>Estado de cuenta</h1>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {!data ? <Loading /> : (
        <>
          <div style={{
            background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8,
            padding: 20, marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'baseline',
          }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {owes ? 'Debes' : balance > 0 ? 'Saldo a favor' : 'Saldo'}
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, color: owes ? 'var(--flag)' : balance > 0 ? 'var(--field)' : 'var(--ink)' }}>
                {money(balance)}
              </div>
            </div>
            {data.next_due_date && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--ink-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Próximo vencimiento</div>
                <div style={{ fontSize: 18 }}>{fmtDate(data.next_due_date)}</div>
              </div>
            )}
            {Number(data.overdue_amount) > 0 && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--flag)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Vencido</div>
                <div style={{ fontSize: 18, color: 'var(--flag)' }}>{money(data.overdue_amount)}</div>
              </div>
            )}
          </div>

          {data.entries.length === 0 ? (
            <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>Tu liga todavía no te ha registrado ningún cargo.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.entries.map((e) => {
                const isCharge = e.kind === 'charge';
                const isAdjustment = e.kind === 'adjustment';
                const voided = e.status === 'void';
                const sign = isCharge || (isAdjustment && e.direction === 'debit') ? '−' : '+';
                const color = sign === '−' ? 'var(--flag)' : 'var(--field)';
                return (
                  <div key={e.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                    padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 4,
                    opacity: voided ? 0.5 : 1,
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, textDecoration: voided ? 'line-through' : 'none' }}>
                        {e.concept}
                        {e.category && (CATEGORY_LABELS[e.category] || e.category) !== e.concept
                          ? ` · ${CATEGORY_LABELS[e.category] || e.category}` : ''}
                        {e.week_label ? ` · J${e.week_label}` : ''}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-dim)' }}>
                        {isCharge && `Cargo · vence ${fmtDate(e.due_date)}`}
                        {e.kind === 'payment' && `Pago registrado por la liga${e.payment_method ? ` (${e.payment_method})` : ''}`}
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
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p style={{ color: 'var(--ink-dim)', fontSize: 12, marginTop: 20 }}>
            ¿Ya pagaste y no aparece? Los pagos los registra tu liga.
            {data.league_contact?.whatsapp && <> Avísale por WhatsApp al <strong>{data.league_contact.whatsapp}</strong>.</>}
          </p>
        </>
      )}
    </div>
  );
}
