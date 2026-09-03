import { useState } from 'react';
import Modal from './Modal.jsx';

export default function NotificationPreferencesModal({
  isOpen,
  onClose,
  onSave,
  onUnsubscribe,
  isSubscribed = false,
  initialPreferences = null,
  title = 'Configurar avisos',
  targetName = '',
}) {
  const [inApp, setInApp] = useState(
    initialPreferences?.in_app !== undefined ? initialPreferences.in_app : true
  );
  const [pushEnabled, setPushEnabled] = useState(
    initialPreferences?.push_enabled !== undefined ? initialPreferences.push_enabled : false
  );
  const [notifyUpcoming, setNotifyUpcoming] = useState(
    initialPreferences?.notify_upcoming !== undefined ? initialPreferences.notify_upcoming : true
  );
  const [notifyLive, setNotifyLive] = useState(
    initialPreferences?.notify_live !== undefined ? initialPreferences.notify_live : true
  );
  const [notifyFinal, setNotifyFinal] = useState(
    initialPreferences?.notify_final !== undefined ? initialPreferences.notify_final : true
  );
  const [notifyChanges, setNotifyChanges] = useState(
    initialPreferences?.notify_changes !== undefined ? initialPreferences.notify_changes : true
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  async function handleSave(e) {
    e.preventDefault();
    if (!inApp && !pushEnabled) {
      setError('Debes seleccionar al menos un canal (Bandeja de LIFA o Notificaciones Push).');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSave({
        in_app: inApp,
        push_enabled: pushEnabled,
        notify_upcoming: notifyUpcoming,
        notify_live: notifyLive,
        notify_final: notifyFinal,
        notify_changes: notifyChanges,
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Error al guardar preferencias');
    } finally {
      setSaving(false);
    }
  }

  async function handleUnsubscribeClick() {
    setSaving(true);
    try {
      await onUnsubscribe();
      onClose();
    } catch (err) {
      setError(err.message || 'Error al cancelar notificaciones');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      {targetName && (
        <p style={{ color: 'var(--paper)', fontSize: 14, marginTop: -8, marginBottom: 16, fontWeight: 500 }}>
          {targetName}
        </p>
      )}

      {error && (
        <div style={{ color: '#ff6b6b', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSave}>
        {/* Canales */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontFamily: 'var(--font-eyebrow)', fontSize: 11, color: 'var(--ink-dim)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
            ¿Dónde quieres recibir avisos?
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--field-deep, #141814)', padding: '12px 14px', borderRadius: 6, border: '1px solid var(--line)' }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--paper)' }}>
              <input
                type="checkbox"
                checked={inApp}
                onChange={(e) => setInApp(e.target.checked)}
                style={{ marginTop: 3, accentColor: 'var(--flag)' }}
              />
              <div>
                <strong>📥 En mi bandeja de LIFA</strong>
                <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 2 }}>
                  Guarda el partido en "Partidos que sigo" en tu cuenta (no requiere permisos del navegador).
                </div>
              </div>
            </label>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--paper)' }}>
              <input
                type="checkbox"
                checked={pushEnabled}
                onChange={(e) => setPushEnabled(e.target.checked)}
                style={{ marginTop: 3, accentColor: 'var(--flag)' }}
              />
              <div>
                <strong>🔔 Notificaciones Push del Navegador</strong>
                <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 2 }}>
                  Avisos emergentes en tu pantalla o celular aunque la página esté cerrada.
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Tipos de Alertas */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontFamily: 'var(--font-eyebrow)', fontSize: 11, color: 'var(--ink-dim)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
            ¿Qué avisos deseas recibir?
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--field-deep, #141814)', padding: '12px 14px', borderRadius: 6, border: '1px solid var(--line)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--paper)' }}>
              <input
                type="checkbox"
                checked={notifyUpcoming}
                onChange={(e) => setNotifyUpcoming(e.target.checked)}
                style={{ accentColor: 'var(--flag)' }}
              />
              <span>⏰ Recordatorio previo (1 hora antes)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--paper)' }}>
              <input
                type="checkbox"
                checked={notifyLive}
                onChange={(e) => setNotifyLive(e.target.checked)}
                style={{ accentColor: 'var(--flag)' }}
              />
              <span>🔴 Inicio y transmisiones en vivo</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--paper)' }}>
              <input
                type="checkbox"
                checked={notifyFinal}
                onChange={(e) => setNotifyFinal(e.target.checked)}
                style={{ accentColor: 'var(--flag)' }}
              />
              <span>🏆 Marcador final al concluir</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--paper)' }}>
              <input
                type="checkbox"
                checked={notifyChanges}
                onChange={(e) => setNotifyChanges(e.target.checked)}
                style={{ accentColor: 'var(--flag)' }}
              />
              <span>⚠️ Cambios de horario, fecha o sede</span>
            </label>
          </div>
        </div>

        {/* Acciones */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {saving ? 'Guardando…' : isSubscribed ? 'Actualizar preferencias' : 'Activar avisos'}
          </button>

          {isSubscribed && (
            <button
              type="button"
              onClick={handleUnsubscribeClick}
              disabled={saving}
              className="btn btn-outline"
              style={{ width: '100%', justifyContent: 'center', color: '#ff6b6b', borderColor: 'rgba(255,107,107,0.3)' }}
            >
              Dejar de recibir notificaciones
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
