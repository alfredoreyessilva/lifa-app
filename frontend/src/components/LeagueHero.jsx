import { useState } from 'react';
import { imagenAjustada } from '../utils/imagenes.js';
import { encabezadoApilado, largoDelNombre, regionDeLiga } from '../utils/leagueDisplay.js';
import { Casco, Yardas } from './MatchField.jsx';
import { IconoCompartir } from './MatchIcons.jsx';
import LeagueContacts from './LeagueContacts.jsx';

// El encabezado de una liga es la misma cancha de una tarjeta del calendario, a
// escala de portada: de un lado la end zone con su nombre rotulado, luego la
// línea de gol y del otro lado la portada (README, "La página de una liga").
//
// La portada no se recorta. Puede ser una foto o un flyer con texto hasta las
// orillas, y no hay forma de saber cuál es, así que su espacio se mide con su
// propia proporción (`--proporcion`).
export default function LeagueHero({ league, pintura }) {
  const [proporcion, setProporcion] = useState(null);
  const [rota, setRota] = useState(false);
  const [copied, setCopied] = useState(false);

  const hayPortada = Boolean(league.cover_url) && !rota;
  const region = regionDeLiga(league);

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const clases = [
    'lp-hero',
    encabezadoApilado({ proporcion, nombre: league.name, descripcion: league.description }) ? 'lp-hero--apilada' : '',
    hayPortada ? '' : 'lp-hero--sin-portada',
  ].filter(Boolean).join(' ');

  return (
    <header className={clases} style={proporcion ? { '--proporcion': proporcion } : undefined}>
      <div className="lp-hero-zona">
        <div className="lp-hero-marca">
          <Casco lado="home" nombre={league.name} logo={league.logo_url} pintura={pintura} ancho={240} />
          <h1 style={{ '--len': largoDelNombre(league.name) }}>{league.name}</h1>
        </div>

        {league.description && <p className="lp-hero-desc">{league.description}</p>}
        {region && <p className="lp-hero-region" title={league.state}>{region}</p>}

        <LeagueContacts league={league}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={copyLink}>
            <IconoCompartir />
            {copied ? '✓ Link copiado' : 'Compartir esta liga'}
          </button>
        </LeagueContacts>

        {league.is_verified ? (
          <p className="lp-hero-nota"><b>Liga verificada ✓</b> Espacio administrado oficialmente por la liga.</p>
        ) : (
          <p className="lp-hero-nota">Este espacio aún no es administrado oficialmente por la liga.</p>
        )}
      </div>

      {hayPortada ? (
        <div className="lp-hero-portada" style={{ '--portada': `url("${imagenAjustada(league.cover_url, 64)}")` }}>
          <img
            src={imagenAjustada(league.cover_url, 1280)}
            alt={`Portada de ${league.name}`}
            onLoad={(e) => setProporcion(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
            onError={() => setRota(true)}
          />
        </div>
      ) : (
        <div className="mh-field lp-hero-cancha" aria-hidden="true"><Yardas /></div>
      )}
    </header>
  );
}
