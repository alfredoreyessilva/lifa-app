import { useState, useEffect } from 'react';

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

async function getCurrentSubscription() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function subscribe(leagueId, matchId) {
  const reg     = await navigator.serviceWorker.ready;
  const vapidKey = await getVapidKey();

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly:      true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });

  await fetch(`${BASE}/notifications/subscribe`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscription,
      league_id: leagueId || null,
      match_id:  matchId  || null,
    }),
  });

  return subscription;
}

async function unsubscribe(subscription, leagueId, matchId) {
  await fetch(`${BASE}/notifications/unsubscribe`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscription: { endpoint: subscription.endpoint },
      league_id: leagueId || null,
      match_id:  matchId  || null,
    }),
  });
}

// leagueId: suscribirse a toda la liga
// matchId:  suscribirse a un partido específico
export default function SubscribeButton({ leagueId, matchId, label = 'Notificarme' }) {
  const [status,  setStatus]  = useState('loading'); // loading | unsupported | subscribed | unsubscribed
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported');
      return;
    }
    // Registrar el service worker si no está registrado
    navigator.serviceWorker.register('/sw.js').catch(() => {});

    getCurrentSubscription().then((sub) => {
      setStatus(sub ? 'subscribed' : 'unsubscribed');
    });
  }, []);

  async function toggle() {
    setWorking(true);
    try {
      if (status === 'unsubscribed') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          alert('Necesitas permitir las notificaciones en tu navegador para activar esta función.');
          setWorking(false);
          return;
        }
        await subscribe(leagueId, matchId);
        setStatus('subscribed');
      } else {
        const sub = await getCurrentSubscription();
        if (sub) await unsubscribe(sub, leagueId, matchId);
        setStatus('unsubscribed');
      }
    } catch (err) {
      console.error('Error con notificaciones:', err);
      alert('Hubo un problema al activar las notificaciones. Intenta de nuevo.');
    } finally {
      setWorking(false);
    }
  }

  if (status === 'loading')     return null;
  if (status === 'unsupported') return null;

  const isSubscribed = status === 'subscribed';

  return (
    <button
      className={`btn btn-sm ${isSubscribed ? 'btn-flag' : 'btn-outline'}`}
      onClick={toggle}
      disabled={working}
      title={isSubscribed ? 'Cancelar notificaciones' : 'Activar notificaciones'}
    >
      {working
        ? '…'
        : isSubscribed
          ? '🔔 Notificaciones activas'
          : `🔕 ${label}`}
    </button>
  );
}