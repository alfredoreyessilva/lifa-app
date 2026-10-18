import { useState } from 'react';
import { api } from '../api/client.js';
import { required, minLength, validEmail, runValidations } from '../utils/validation.js';

// "¿Olvidaste tu contraseña?" (README, "Recuperar la contraseña", 2026-10-17).
//
// Vive DENTRO de la tarjeta de "Iniciar sesión" y del modal de login, igual que
// la verificación de correo, y no en una ruta aparte: quien se atoró votando en
// el concurso no pierde la pantalla en la que estaba.
//
// Dos pasos: el correo, y luego el código junto con la contraseña nueva. Al
// canjearlo la persona entra directo — onSuccess recibe lo mismo que un login.
export default function PasswordResetForm({ initialEmail = '', onSuccess, onCancel }) {
  const [step, setStep] = useState('correo'); // 'correo' | 'codigo'
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  async function onRequest(e) {
    e.preventDefault();
    setError('');
    const validationError = runValidations([
      () => required(email, 'El correo electrónico'),
      () => validEmail(email),
    ]);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      await api.requestPasswordReset(email.trim());
      setStep('codigo');
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
      await api.requestPasswordReset(email.trim());
      setResent(true);
      setTimeout(() => setResent(false), 5000);
    } catch (err) {
      setError(err.message);
    } finally {
      setResending(false);
    }
  }

  async function onConfirm(e) {
    e.preventDefault();
    setError('');
    const validationError = runValidations([
      () => (code.trim().length !== 6 ? 'El código tiene 6 dígitos' : null),
      () => required(password, 'La contraseña nueva'),
      () => minLength(password, 6, 'La contraseña nueva'),
      () => (password !== passwordConfirm ? 'Las contraseñas no coinciden' : null),
    ]);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      const data = await api.confirmPasswordReset({ email: email.trim(), code: code.trim(), password });
      onSuccess(data.token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Cada paso con su `key`: sin ella, React reusa el <input> del correo para el
  // código —están en el mismo lugar del árbol— y `autoFocus`, que solo corre al
  // montar, deja el cursor fuera del campo que toca llenar.
  if (step === 'correo') {
    return (
      <form key="correo" onSubmit={onRequest}>
        <p style={{ marginBottom: 16, color: 'var(--ink-dim)', fontSize: 14 }}>
          Escribe el correo con el que entras y te mandamos un código de 6 dígitos para elegir una
          contraseña nueva.
        </p>
        {error && <div className="form-error">{error}</div>}
        <div className="field">
          <label>Correo electrónico</label>
          <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button className="btn btn-flag btn-block" disabled={loading}>
          {loading ? 'Mandando…' : 'Mandarme el código'}
        </button>
        <div className="form-foot">
          <button type="button" className="btn-link" onClick={onCancel}>
            Volver a iniciar sesión
          </button>
        </div>
      </form>
    );
  }

  // No se dice "te mandamos": se dice "si hay una cuenta". La respuesta del
  // backend es la misma exista o no, y esta pantalla no puede saber más que él.
  return (
    <form key="codigo" onSubmit={onConfirm}>
      <p style={{ marginBottom: 16, color: 'var(--ink-dim)', fontSize: 14 }}>
        Si hay una cuenta con <strong>{email.trim()}</strong>, te llegó un código de 6 dígitos. Vence en
        10 minutos. Revísalo en otra pestaña y escríbelo aquí, sin salir de esta página.
      </p>
      {error && <div className="form-error">{error}</div>}
      <div className="field">
        <label>Código</label>
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
      <div className="field">
        <label>Contraseña nueva</label>
        <input type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="field">
        <label>Confirma la contraseña nueva</label>
        <input type="password" autoComplete="new-password" required value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} />
      </div>
      <p style={{ marginBottom: 12, color: 'var(--ink-dim)', fontSize: 12 }}>
        Al cambiarla se cierra tu sesión en los demás aparatos donde la tengas abierta.
      </p>
      <button className="btn btn-flag btn-block" disabled={loading}>
        {loading ? 'Cambiando…' : 'Cambiar contraseña y entrar'}
      </button>
      <div className="form-foot">
        ¿No te llegó?{' '}
        <button type="button" className="btn-link" onClick={onResend} disabled={resending}>
          {resending ? 'Enviando…' : 'Reenviar código'}
        </button>
        {' · '}
        <button type="button" className="btn-link" onClick={() => { setStep('correo'); setCode(''); setError(''); }}>
          Usar otro correo
        </button>
      </div>
      {resent && (
        <div style={{ color: '#4caf50', fontSize: 12, textAlign: 'center', marginTop: 4 }}>
          Si hay una cuenta con ese correo, te mandamos otro. Usa el nuevo: el anterior ya no sirve.
        </div>
      )}
    </form>
  );
}
