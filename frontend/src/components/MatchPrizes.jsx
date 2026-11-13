import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { imagenAjustada } from '../utils/imagenes.js';
import { initials } from '../utils/matchDisplay.js';
import { cifraDelPremio, preciosDelPremio, textoDeVigencia } from '../utils/premios.js';
import { IconoPremio } from './MatchIcons.jsx';

// El premio de una tienda para quien acierte este partido (README, "Premios por
// acertar"), justo debajo de "¿Quién gana?". Sin premio no se pinta nada, ni un
// lugar vacío: un hueco esperando patrocinador es lo que haría que se leyera
// como anuncio. Pide sus datos solo, como "También transmiten", y el backend ya
// filtra al leer (tienda publicada y verificada, premio no retirado). Con el
// interruptor apagado la lista llega vacía.
//
// `abierta` es la misma de MatchPoll: mientras se puede votar, "para quien
// acierte"; después, "para quien acertó".
export default function MatchPrizes({ matchId, abierta }) {
  const [prizes, setPrizes] = useState(null);

  useEffect(() => {
    let vigente = true;
    setPrizes(null);
    api.getMatchPrizes(matchId)
      .then((data) => { if (vigente) setPrizes(data.prizes || []); })
      .catch(() => { if (vigente) setPrizes([]); });
    return () => { vigente = false; };
  }, [matchId]);

  if (!prizes || prizes.length === 0) return null;

  const varios = prizes.length > 1;
  return (
    <section className="mp-sec mp-prizes" aria-labelledby="mp-prizes-title">
      <h2 className="mp-title mp-prizes-title" id="mp-prizes-title">
        <IconoPremio />
        <span>{varios ? 'Premios' : 'Premio'} para quien {abierta ? 'acierte' : 'acertó'}</span>
      </h2>
      <ul className="mp-prize-list">
        {prizes.map((prize) => <PrizeCard key={prize.id} prize={prize} />)}
      </ul>
      <p className="mp-note">
        {abierta
          ? 'Si aciertas, te llega con tu aviso del resultado, con un código para cobrarlo en la tienda.'
          : 'Quien acertó lo recibió con su aviso del resultado, con un código para cobrarlo en la tienda.'}
      </p>
    </section>
  );
}

// Un premio como lo ve el público. La usa también la ventana "Poner un premio"
// del panel de una tienda como vista previa: con `preview`, la tienda no es un
// enlace, para que tocarla no saque a nadie de la ventana.
export function PrizeCard({ prize, preview = false }) {
  const precios = preciosDelPremio(prize);
  const { product, store } = prize;
  const Tienda = preview ? 'span' : Link;
  const destino = preview ? {} : { to: `/panel/organizacion/${store.id}` };
  return (
    <li className="mp-prize">
      <span className="mp-prize-photo">
        {product.image_url
          ? <img src={imagenAjustada(product.image_url, 200)} alt="" loading="lazy" decoding="async" />
          : <IconoPremio />}
      </span>
      <div className="mp-prize-body">
        <p className="mp-prize-what">
          <span className="mp-prize-figure">{cifraDelPremio(prize)}</span>
          <span className="mp-prize-product">
            {prize.discount_percent < 100 && <span className="mp-prize-en">de descuento en </span>}
            {product.name}
          </span>
        </p>
        {precios && (
          <p className="mp-prize-price">
            <s>{precios.antes}</s> {precios.despues} <small>{precios.moneda}</small>
          </p>
        )}
        <p className="mp-prize-valid">{textoDeVigencia(prize.valid_days)}</p>
        <Tienda {...destino} className="mp-prize-store">
          <span className="mp-prize-store-logo" aria-hidden="true">
            {store.logo_url ? <img src={imagenAjustada(store.logo_url, 80)} alt="" /> : initials(store.name)}
          </span>
          <span className="mp-prize-store-text">
            <span className="mp-prize-store-name">
              {store.name}
              {store.is_verified && <span className="mp-prize-check" title="Verificada por CFBAMX"> ✓</span>}
            </span>
            <span className="mp-prize-store-cta">Ver tienda →</span>
          </span>
        </Tienda>
      </div>
    </li>
  );
}
