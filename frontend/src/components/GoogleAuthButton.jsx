import { useEffect, useRef } from 'react';

// Botón "Continuar con Google" con Google Identity Services (el script se
// carga en index.html). A propósito no usamos ninguna librería de npm para
// esto: el SDK oficial de Google ya expone todo lo necesario en
// `window.google`, así que sumar una dependencia extra solo duplicaría lo
// mismo con más peso.
//
// Si VITE_GOOGLE_CLIENT_ID no está configurado, el componente no renderiza
// nada — así el registro/login por correo sigue funcionando exactamente
// igual mientras se configura Google (no es un requisito para usar la app).
export default function GoogleAuthButton({ onCredential, onError }) {
  const buttonRef = useRef(null);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    let interval;

    function render() {
      if (cancelled || !window.google?.accounts?.id || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (response?.credential) onCredential(response.credential);
          else onError?.('No se pudo obtener la respuesta de Google');
        },
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
        width: 320,
      });
    }

    // El script de Google se carga async en index.html — puede que todavía
    // no esté listo cuando este componente monta, así que reintentamos unas
    // cuantas veces en vez de asumir que window.google ya existe.
    if (window.google?.accounts?.id) {
      render();
    } else {
      interval = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(interval);
          render();
        }
      }, 200);
      setTimeout(() => clearInterval(interval), 10000);
    }

    return () => { cancelled = true; clearInterval(interval); };
  }, [clientId, onCredential, onError]);

  if (!clientId) return null;

  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0 12px' }}>
      <div ref={buttonRef} />
    </div>
  );
}
