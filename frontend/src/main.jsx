import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles.css';

// Sin DSN (ej. en local si no se configuró) Sentry.init() simplemente no
// manda nada — no hace falta ningún "if" alrededor de esta llamada.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
});

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
