import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import { imagenAjustada } from '../utils/imagenes.js';
import {
  estadoDelGanador, partidoDelPremio, preciosDelPremio, textoDelPremio, tramosDeMisPremios,
} from '../utils/premios.js';

// "Mis premios" (/premios): lo que ganaste por acertar (README, "Premios por
// acertar"). Existe porque el aviso del resultado sale de la bandeja a los 30
// días, o por el tope de 100, y un premio puede valer más; y porque en el
// mostrador lo que hace falta es el código a la vista, no buscar el aviso.
//
// Es una pantalla del aficionado, como Mis notificaciones: va en la noche de la
// cancha, no en el panel negro. Con el interruptor apagado no hay premios que
// enseñar, y lo dice en vez de prometer algo que no existe todavía.
export default function MyPrizes() {
  const { token } = useAuth();
  const [prizes, setPrizes] = useState(null);
  const [enabled, setEnabled] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return undefined;
    let vigente = true;
    setError('');
    api.getPrizesStatus()
      .then((s) => { if (vigente) setEnabled(Boolean(s.enabled)); })
      .catch(() => { if (vigente) setEnabled(true); });
    api.getMyPrizes(token)
      .then((data) => { if (vigente) setPrizes(data.prizes || []); })
      .catch((err) => {
        if (!vigente) return;
        setError(err.offline
          ? 'Sin conexión: no se pudieron cargar tus premios.'
          : (err.message || 'No se pudieron cargar tus premios.'));
        setPrizes((prev) => prev ?? []);
      });
    return () => { vigente = false; };
  }, [token]);

  const tramos = tramosDeMisPremios(prizes);
  const paraUsar = (prizes || []).filter((p) => p.status === 'valid').length;
  const cargando = prizes === null && !error;
  let indice = 0;

  return (
    <div className="container">
      <div className="nt-page pz-page">
        <header className="nt-hero">
          <span className="nt-hero-eyebrow">Por acertar</span>
          <h1 className="nt-hero-title">Mis premios</h1>
          <p className="nt-hero-sub">
            {cargando && 'Buscando lo que ganaste…'}
            {prizes && paraUsar > 0 && (
              <><strong>{paraUsar}</strong> {paraUsar === 1 ? 'premio para usar' : 'premios para usar'}. Enseña el código en la tienda.</>
            )}
            {prizes && prizes.length > 0 && paraUsar === 0 && 'Ya usaste o se vencieron todos. Aquí quedan.'}
            {prizes && prizes.length === 0 && !error && (enabled === false
              ? 'Los premios todavía no están disponibles.'
              : 'Todavía no tienes premios.')}
          </p>
        </header>

        {error && <div className="nt-aviso">{error}</div>}

        {cargando && (
          <div className="nt-list pz-list" aria-busy="true">
            {[0, 1].map((n) => <div key={n} className="nt-skeleton" />)}
          </div>
        )}

        {prizes && prizes.length === 0 && !error && enabled !== false && (
          <div className="nt-empty">
            <div className="nt-empty-ball" aria-hidden="true">🎁</div>
            <h3>Sin premios todavía</h3>
            <ul>
              <li><span aria-hidden="true">🏟️</span> Algunas tiendas le ponen premio a un partido: sale en su página, junto a «¿Quién gana?».</li>
              <li><span aria-hidden="true">🎯</span> Vota antes de que empiece. Si aciertas, el premio te llega con tu aviso del resultado.</li>
              <li><span aria-hidden="true">🛍️</span> Lo cobras en la tienda con tu código, antes de que venza.</li>
            </ul>
            <Link to="/" className="nt-card-cta">Explorar ligas →</Link>
          </div>
        )}

        {tramos.map((tramo) => (
          <section key={tramo.key} className="nt-day">
            <h2 className="nt-day-title"><span>{tramo.label}</span></h2>
            <div className="nt-list pz-list">
              {tramo.rows.map((premio) => (
                <PrizeCard key={premio.id} premio={premio} indice={indice++} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function PrizeCard({ premio, indice }) {
  const estado = estadoDelGanador(premio);
  const precios = preciosDelPremio(premio);
  const vale = premio.status === 'valid';
  return (
    <article
      className={`nt-card ${vale ? 'nt-card--oro' : 'nt-card--gris'} pz-card is-${premio.status}`}
      style={{ '--nt-i': Math.min(indice, 12) }}
    >
      <span className="pz-photo" aria-hidden="true">
        {premio.product?.image_url ? <img src={imagenAjustada(premio.product.image_url, 200)} alt="" /> : '🎁'}
      </span>
      <div className="nt-card-main">
        <div className="nt-card-top">
          <span className="nt-card-label">{estado.label}</span>
          <span className="nt-card-time">{estado.detail}</span>
        </div>
        <h3 className="nt-card-title">{textoDelPremio(premio)}</h3>
        {precios && (
          <p className="pz-price"><s>{precios.antes}</s> {precios.despues} <small>{precios.moneda}</small></p>
        )}
        {vale && premio.code && (
          <div className="pz-code">
            <span>Tu código</span>
            <code>{premio.code}</code>
          </div>
        )}
        <p className="nt-card-body">
          {`Por acertar ${partidoDelPremio(premio.match)}`}
          {premio.match?.league_name ? ` · ${premio.match.league_name}` : ''}
        </p>
        <div className="nt-card-foot">
          <span className="notification-origin">
            {premio.store?.name}{premio.store?.is_verified ? ' ✓' : ''}
          </span>
          <span className="pz-links">
            {premio.match?.id && <Link to={`/partidos/${premio.match.id}`} className="nt-prize-link">Ver partido</Link>}
            {premio.store?.id !== undefined && (
              <Link to={`/panel/organizacion/${premio.store.id}`} className={vale ? 'nt-card-cta' : 'nt-prize-link'}>
                Ver tienda →
              </Link>
            )}
          </span>
        </div>
      </div>
    </article>
  );
}
