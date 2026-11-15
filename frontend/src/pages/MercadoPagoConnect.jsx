import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { storeHref } from '../utils/storePanel.js';

// A donde regresa Mercado Pago cuando una tienda conecta su cuenta:
// /mercadopago/conectar (README, "Compras en la vitrina" → "Mercado Pago").
// Mercado Pago manda el `code` y el `state` que le dio el backend; esta página se
// los pasa con la sesión, y el backend exige que el `state` sea de esa tienda y de
// esta misma persona. Tiene que ser exactamente la dirección dada de alta en la
// aplicación de Mercado Pago, por eso es una sola para todas las tiendas: la
// tienda viaja en el `state`.
export default function MercadoPagoConnect() {
  const [params] = useSearchParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const enviado = useRef(false);

  const state = params.get('state') || '';
  const code = params.get('code') || '';
  const negado = params.get('error');
  const tienda = Number(state.split('.')[0]) || null;

  useEffect(() => {
    if (enviado.current || !token) return;
    if (negado || !code || !tienda) {
      setError(negado
        ? 'No se conectó: en Mercado Pago no se dio el permiso.'
        : 'Mercado Pago no regresó lo necesario para conectar tu cuenta.');
      return;
    }
    // El código vale una sola vez: aunque React monte dos veces, se manda una.
    enviado.current = true;
    api.connectMercadoPago(tienda, { code, state }, token)
      .then(() => navigate(`${storeHref(tienda, 'cobro')}&mp=conectado`, { replace: true }))
      .catch((e) => setError(e.offline ? 'Sin conexión: no se pudo terminar de conectar.' : e.message));
  }, [token, code, state, tienda, negado, navigate]);

  return (
    <div className="container">
      <div className="form-card" style={{ maxWidth: 480 }}>
        <h2>Conectar Mercado Pago</h2>
        {!error ? (
          <p>Conectando tu cuenta de Mercado Pago…</p>
        ) : (
          <>
            <div className="form-error">{error}</div>
            {tienda && (
              <Link to={storeHref(tienda, 'cobro')} className="btn btn-flag btn-block" style={{ marginTop: 16 }}>
                Volver a Cobro y entrega
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}
