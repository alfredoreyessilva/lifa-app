import { useState } from 'react';
import { api } from '../api/client.js';

// Vive DENTRO de la misma tarjeta de registro/login (no es una ruta ni una
// pantalla aparte) — el objetivo es que la persona pueda revisar su correo
// en otra pestaña, copiar el código, y volver aquí mismo sin haber
// "salido" nunca de la página de LIFA.
export default function EmailVerificationForm({ email, token, onVerified, onSkip }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (code.trim().length !== 6) {
      setError('El código tiene 6 dígitos');
      return;
    }
    setLoading(true);
    try {
      const data = await api.verifyEmail(code.trim(), token);
      onVerified(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    setError('');
    setResending(true);
    try {
      await api.resendVerificationCode(token);
      setResent(true);
      setTimeout(() => setResent(false), 5000);
    } catch (err) {
      setError(err.message);
    } finally {
      setResending(false);
    }
  }

  return (
    <div>
      <p style={{ marginBottom: 16, color: 'var(--ink-dim)', fontSize: 14 }}>
        Te enviamos un código de 6 dígitos a <strong>{email}</strong>. Revísalo en otra pestaña
        y pégalo aquí — no necesitas salir de esta página.
      </p>
      {error && <div className="form-error">{error}</div>}
      <form onSubmit={onSubmit}>
        <div className="field">
          <label>Código de verificación</label>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            style={{ letterSpacing: 8, fontSize: 22, textAlign: 'center' }}
          />
        </div>
        <button className="btn btn-flag btn-block" disabled={loading}>
          {loading ? 'Verificando…' : 'Verificar correo'}
        </button>
      </form>
      <div className="form-foot">
        ¿No te llegó?{' '}
        <button type="button" className="btn-link" onClick={onResend} disabled={resending}>
          {resending ? 'Enviando…' : 'Reenviar código'}
        </button>
      </div>
      {resent && (
        <div style={{ color: '#4caf50', fontSize: 12, textAlign: 'center', marginTop: 4 }}>
          Código reenviado ✓
        </div>
      )}
      {onSkip && (
        <div className="form-foot">
          <button type="button" className="btn-link" onClick={onSkip}>
            Hacerlo más tarde
          </button>
        </div>
      )}
    </div>
  );
}
