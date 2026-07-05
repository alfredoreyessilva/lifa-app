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

async function getOrCreateSubscription(vapidKey) {
  const reg = await navigator.serviceWorker.ready;
  let sub   = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
  }
  return sub;
}

async function checkSubscription(endpoint, leagueId, matchId, teamName) {
  const res = await fetch(`${BASE}/notifications/check`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint,
      league_id: leagueId || null,
      match_id:  matchId  || null,
      team_name: teamName || null,
    }),
  });
  const data = await res.json();
  return data.subscribed;
}

async function saveSubscription(subscription, leagueId, matchId, teamName) {
  await fetch(`${BASE}/notifications/subscribe`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscription,
      league_id: leagueId || null,
      match_id:  matchId  || null,
      team_name: teamName || null,
    }),
  });
}

async function removeSubscription(subscription, leagueId, matchId, teamName) {
  await fetch(`${BASE}/notifications/unsubscribe`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscription: { endpoint: subscription.endpoint },
      league_id: leagueId || null,
      match_id:  matchId  || null,
      team_name: teamName || null,
    }),
  });
}

// Props:
// leagueId  → suscripción a toda la liga
// matchId   → suscripción a un partido específico
// teamName  → suscripción a un equipo específico
// label     → texto del botón cuando no está suscrito
export default function SubscribeButton({ leagueId, matchId, teamName, label = 'Notificarme' }) {
  const [status,  setStatus]  = useState('loading');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported');
      return;
    }

    navigator.serviceWorker.register('/sw.js').catch(() => {});

    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      if (!sub) { setStatus('unsubscribed'); return; }

      // Verificar si está suscrito específicamente a este liga/partido/equipo
      const isSubscribed = await checkSubscription(
        sub.endpoint, leagueId, matchId, teamName
      );
      setStatus(isSubscribed ? 'subscribed' : 'unsubscribed');
    }).catch(() => setStatus('unsubscribed'));
  }, [leagueId, matchId, teamName]);

  async function toggle() {
    setWorking(true);
    try {
      if (status === 'unsubscribed') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          alert('Necesitas permitir las notificaciones en tu navegador.');
          setWorking(false);
          return;
        }
        const vapidKey = await getVapidKey();
        const sub      = await getOrCreateSubscription(vapidKey);
        await saveSubscription(sub, leagueId, matchId, teamName);
        setStatus('subscribed');
      } else {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) await removeSubscription(sub, leagueId, matchId, teamName);
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
      title={isSubscribed ? 'Cancelar notificaciones' : label}
    >
      {working
        ? '…'
        : isSubscribed
          ? '🔔 Notificaciones activas'
          : `🔕 ${label}`}
    </button>
  );
}