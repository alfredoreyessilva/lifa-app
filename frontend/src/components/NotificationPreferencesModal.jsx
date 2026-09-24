import { useState } from 'react';
import Modal from './Modal.jsx';

// El menú de "Seguir". Las cuatro casillas dicen qué avisos de lo que sigues
// llegan a "Mis notificaciones". La elección de canal (bandeja o push) solo
// aparece con el push encendido: hoy está en pausa y la bandeja es el único.
export default function NotificationPreferencesModal({
  isOpen,
  onClose,
  onSave,
  onUnsubscribe,
  isSubscribed = false,
  initialPreferences = null,
  pushDisponible = false,
  title = 'Seguir',
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
    if (pushDisponible && !inApp && !pushEnabled) {
      setError('Elige al menos un canal: Mis notificaciones o notificaciones push.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSave({
        in_app: pushDisponible ? inApp : true,
        push_enabled: pushDisponible ? pushEnabled : false,
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
      setError(err.message || 'No se pudo dejar de seguir');
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
        {/* Canales — solo con el push encendido */}
        {pushDisponible && (
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
                <strong>📥 En Mis notificaciones</strong>
                <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 2 }}>
                  Los avisos te esperan en la app, en el balón de arriba (no requiere permisos del navegador).
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
        )}

        {/* Tipos de Alertas */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontFamily: 'var(--font-eyebrow)', fontSize: 11, color: 'var(--ink-dim)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
            {pushDisponible ? '¿Qué avisos deseas recibir?' : '¿Qué quieres ver en Mis notificaciones?'}
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
              <span>🔴 Cuando empieza el partido</span>
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
            {saving ? 'Guardando…' : isSubscribed ? 'Guardar' : 'Seguir'}
          </button>

          {isSubscribed && (
            <button
              type="button"
              onClick={handleUnsubscribeClick}
              disabled={saving}
              className="btn btn-outline"
              style={{ width: '100%', justifyContent: 'center', color: '#ff6b6b', borderColor: 'rgba(255,107,107,0.3)' }}
            >
              Dejar de seguir
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
