import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import AuthModal from './AuthModal.jsx';
import NotificationPreferencesModal from './NotificationPreferencesModal.jsx';

const BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';

async function getVapidKey() {
  const res  = await fetch(`${BASE}/notifications/vapid-public-key`);
  const data = await res.json();
  return data.key;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function getOrCreateSubscription(vapidKey) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub   = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
    }
    return sub;
  } catch {
    return null;
  }
}

async function checkSubscription(endpoint, leagueId, matchId, teamName, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}/notifications/check`, {
    method:  'POST',
    headers,
    body: JSON.stringify({
      endpoint:  endpoint || null,
      league_id: leagueId || null,
      match_id:  matchId  || null,
      team_name: teamName || null,
    }),
  });
  return await res.json().catch(() => ({ subscribed: false }));
}

async function saveSubscription(subscription, preferences, leagueId, matchId, teamName, token) {
  const res = await fetch(`${BASE}/notifications/subscribe`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${token}`,
    },
    body: JSON.stringify({
      subscription: subscription ? {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.toJSON ? subscription.toJSON().keys?.p256dh : subscription.keys?.p256dh,
          auth:   subscription.toJSON ? subscription.toJSON().keys?.auth   : subscription.keys?.auth,
        },
      } : null,
      preferences,
      league_id: leagueId || null,
      match_id:  matchId  || null,
      team_name: teamName || null,
    }),
  });
  if (!res.ok) throw new Error('No se pudo guardar la suscripción');
}

async function removeSubscription(subscription, leagueId, matchId, teamName, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  await fetch(`${BASE}/notifications/unsubscribe`, {
    method:  'POST',
    headers,
    body: JSON.stringify({
      subscription: subscription?.endpoint ? { endpoint: subscription.endpoint } : null,
      league_id: leagueId || null,
      match_id:  matchId  || null,
      team_name: teamName || null,
    }),
  });
}

// Props:
// leagueId   → suscripción a toda la liga
// matchId    → suscripción a un partido específico
// teamName   → suscripción a un equipo específico
// label      → texto del botón cuando no está suscrito
// targetName → texto identificador del partido/equipo para el modal
export default function SubscribeButton({
  leagueId,
  matchId,
  teamName,
  label = 'Notificarme',
  targetName = '',
}) {
  const [status, setStatus] = useState('loading');
  const [preferences, setPreferences] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showPrefsModal, setShowPrefsModal] = useState(false);
  const { token } = useAuth();

  useEffect(() => {
    let endpoint = null;

    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
      navigator.serviceWorker.ready.then(async (reg) => {
        const sub = await reg.pushManager.getSubscription().catch(() => null);
        endpoint = sub?.endpoint || null;
        doCheck(endpoint);
      }).catch(() => {
        doCheck(null);
      });
    } else {
      doCheck(null);
    }

    function doCheck(ep) {
      checkSubscription(ep, leagueId, matchId, teamName, token)
        .then((data) => {
          setStatus(data.subscribed ? 'subscribed' : 'unsubscribed');
          setPreferences(data.preferences || null);
        })
        .catch(() => {
          setStatus('unsubscribed');
        });
    }
  }, [leagueId, matchId, teamName, token]);

  function handleClick() {
    if (!token) {
      setShowAuthModal(true);
      return;
    }
    setShowPrefsModal(true);
  }

  async function handleSavePreferences(newPrefs) {
    let sub = null;
    let finalPrefs = { ...newPrefs };

    // Si el usuario marcó push, intentamos solicitar permiso al navegador
    if (newPrefs.push_enabled) {
      try {
        if ('Notification' in window) {
          const perm = await Notification.requestPermission();
          if (perm === 'granted') {
            const vapidKey = await getVapidKey();
            sub = await getOrCreateSubscription(vapidKey);
          } else {
            // El permiso fue denegado o cerrado: desactivamos push pero mantenemos in-app
            finalPrefs.push_enabled = false;
          }
        } else {
          finalPrefs.push_enabled = false;
        }
      } catch (err) {
        console.warn('Error al activar push:', err);
        finalPrefs.push_enabled = false;
      }
    }

    await saveSubscription(sub, finalPrefs, leagueId, matchId, teamName, token);
    setStatus('subscribed');
    setPreferences(finalPrefs);
  }

  async function handleUnsubscribe() {
    let sub = null;
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      sub = await reg?.pushManager?.getSubscription().catch(() => null);
    }
    await removeSubscription(sub, leagueId, matchId, teamName, token);
    setStatus('unsubscribed');
    setPreferences(null);
  }

  if (status === 'loading') return null;

  const isSubscribed = status === 'subscribed';

  return (
    <>
      <button
        className={`btn btn-sm ${isSubscribed ? 'btn-flag' : 'btn-outline'}`}
        onClick={handleClick}
        title={isSubscribed ? 'Configurar notificaciones' : label}
        type="button"
      >
        {isSubscribed ? '🔔 Alertas configuradas' : `🔔 ${label}`}
      </button>

      {showAuthModal && (
        <AuthModal
          title="Inicia sesión para recibir avisos"
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => {
            setShowAuthModal(false);
            setShowPrefsModal(true);
          }}
        />
      )}

      {showPrefsModal && (
        <NotificationPreferencesModal
          isOpen={showPrefsModal}
          onClose={() => setShowPrefsModal(false)}
          onSave={handleSavePreferences}
          onUnsubscribe={handleUnsubscribe}
          isSubscribed={isSubscribed}
          initialPreferences={preferences}
          title={isSubscribed ? 'Ajustar avisos' : 'Configurar avisos'}
          targetName={targetName}
        />
      )}
    </>
  );
}