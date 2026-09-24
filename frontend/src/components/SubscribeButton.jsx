import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import { pushDisponible } from '../utils/pushStatus.js';
import AuthModal from './AuthModal.jsx';
import NotificationPreferencesModal from './NotificationPreferencesModal.jsx';

// "Seguir" un partido, un equipo o una liga. Lo que sigues aparece en "Mi
// cartelera" y sus avisos llegan a "Mis notificaciones" (README,
// "Notificaciones: la bandeja y el push").
//
// El push es un canal APARTE y hoy está en pausa: mientras el backend diga que
// está apagado, este botón no lo ofrece y el navegador nunca pide permiso.

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

// El dispositivo ya suscrito, si lo hay. Solo se mira con el push encendido.
async function suscripcionActual() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  return (await reg?.pushManager?.getSubscription().catch(() => null)) || null;
}

function paraLaApi(subscription) {
  if (!subscription) return null;
  const json = subscription.toJSON ? subscription.toJSON() : subscription;
  return { endpoint: subscription.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth } };
}

// Props:
// leagueId   → seguir toda la liga
// matchId    → seguir un partido específico
// teamName   → seguir un equipo (con leagueId, el de esa liga)
// label      → texto del botón cuando todavía no lo sigues
// targetName → qué se está siguiendo, para el menú
export default function SubscribeButton({
  leagueId,
  matchId,
  teamName,
  label = 'Seguir',
  targetName = '',
}) {
  const [status, setStatus] = useState('loading');
  const [preferences, setPreferences] = useState(null);
  const [conPush, setConPush] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showPrefsModal, setShowPrefsModal] = useState(false);
  const { token } = useAuth();

  const target = { league_id: leagueId || null, match_id: matchId || null, team_name: teamName || null };

  useEffect(() => {
    let vigente = true;
    (async () => {
      const push = await pushDisponible();
      // Sin sesión, el seguimiento se busca por el dispositivo; eso solo
      // existe con el push encendido.
      const sub = push ? await suscripcionActual() : null;
      const data = await api.checkFollow(target, sub?.endpoint, token).catch(() => ({ subscribed: false }));
      if (!vigente) return;
      setConPush(push);
      setStatus(data.subscribed ? 'subscribed' : 'unsubscribed');
      setPreferences(data.preferences || null);
    })();
    return () => { vigente = false; };
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
    let sinPush = null; // por qué no quedó push, si se pidió y no se pudo

    if (!conPush) {
      // Con el push en pausa el único canal es la bandeja.
      finalPrefs = { ...finalPrefs, in_app: true, push_enabled: false };
    } else if (newPrefs.push_enabled) {
      try {
        if ('Notification' in window) {
          const perm = await Notification.requestPermission();
          if (perm === 'granted') {
            const { key } = await api.getVapidPublicKey();
            sub = await getOrCreateSubscription(key);
            if (!sub) sinPush = 'Este navegador no pudo activar las notificaciones push.';
          } else {
            // El permiso fue denegado o cerrado: desactivamos push pero mantenemos la bandeja
            finalPrefs.push_enabled = false;
            sinPush = 'El navegador no dio permiso para mostrar notificaciones.';
          }
        } else {
          finalPrefs.push_enabled = false;
          sinPush = 'Este navegador no admite notificaciones push.';
        }
      } catch (err) {
        console.warn('Error al activar push:', err);
        finalPrefs.push_enabled = false;
        sinPush = 'Este navegador no pudo activar las notificaciones push.';
      }
    }

    // Si solo pidió push y no se pudo, guardar dejaría un seguimiento sin
    // ningún canal: no avisaría nada y el botón diría "Siguiendo".
    if (sinPush && !finalPrefs.in_app) {
      throw new Error(`${sinPush} Marca "En Mis notificaciones" para recibir los avisos sin push.`);
    }

    const respuesta = await api.saveFollow(target, paraLaApi(sub), finalPrefs, token);
    const guardadas = respuesta?.preferences || null;
    setStatus('subscribed');
    // Se pinta lo que guardó el backend, no lo que se marcó. Antes, si el
    // navegador fallaba al suscribirse, la pantalla decía "push activado"
    // hasta recargar, y la base decía que no.
    setPreferences(guardadas || finalPrefs);

    const quedo = guardadas || finalPrefs;
    if (conPush && newPrefs.push_enabled && !quedo.push_enabled) {
      // Se lanza DESPUÉS de guardar: lo demás sí quedó, y así el menú se
      // queda abierto con la explicación en vez de cerrarse como si todo
      // hubiera salido bien.
      throw new Error(`${sinPush || 'No se pudieron activar las notificaciones push.'} ${
        quedo.in_app ? 'Tus avisos quedaron solo en Mis notificaciones.' : 'No quedó ningún aviso activo.'}`);
    }
  }

  async function handleUnsubscribe() {
    const sub = conPush ? await suscripcionActual() : null;
    await api.removeFollow(target, sub?.endpoint ? { endpoint: sub.endpoint } : null, token);
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
        title={isSubscribed ? 'Ajustar qué te avisamos, o dejar de seguir' : label}
        type="button"
      >
        {isSubscribed ? '✓ Siguiendo' : label}
      </button>

      {showAuthModal && (
        <AuthModal
          title="Inicia sesión para seguir partidos"
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
          pushDisponible={conPush}
          title={isSubscribed ? 'Siguiendo' : 'Seguir'}
          targetName={targetName}
        />
      )}
    </>
  );
}
