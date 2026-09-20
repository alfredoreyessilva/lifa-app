import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { registrarServiceWorker } from './utils/serviceWorker.js';
import { escucharLaRed } from './utils/offlineOutbox.js';
import './styles.css';

// Sin DSN (ej. en local si no se configuró) Sentry.init() simplemente no
// manda nada — no hace falta ningún "if" alrededor de esta llamada.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
});

// El service worker se registra AQUÍ y no dentro del botón de notificaciones,
// que es donde vivía hasta el 2026-09-20: un visor que nunca se suscribió a
// nada no tenía service worker, y por lo tanto no tenía nada sin señal.
registrarServiceWorker();

// La cola de lo capturado sin señal sube sola en cuanto vuelve la señal, esté
// abierta o no la pantalla que capturó. Va aquí, fuera de React, por eso mismo.
escucharLaRed();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Red de seguridad externa: el ErrorBoundary de App.jsx cubre las
        páginas dentro de <Routes>, pero si algo revienta fuera de eso
        (TopBar, AuthProvider, etc.) este boundary evita que quede una
        pantalla completamente en blanco. */}
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
