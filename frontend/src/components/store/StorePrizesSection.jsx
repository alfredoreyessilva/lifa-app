import { useState } from 'react';
import { api } from '../../api/client.js';
import {
  Band, FilterScoreboard, NoResults, RowMenu, SectionError, SectionLoading, Status, useSectionFilter,
} from '../admin/AdminKit.jsx';
import { countFilters, formatNumber, pluralize } from '../../utils/adminPanel.js';
import { fechaCorta } from '../../utils/matchDisplay.js';
import {
  PRIZE_FILTERS, candadoDePremios, cifraDelPremio, estadoDelPremio, limpiarCodigo, partidoDelPremio,
  resultadoDelCodigo, textoDeCanjes, textoDelPremio, textoDeVigencia, totalesDePremios, tramosDelPanel,
} from '../../utils/premios.js';
import { StoreEyebrow } from './StoreWorkspace.jsx';
import { ProductThumb } from './StoreProductBits.jsx';
import { MatchTime, MediaMatch } from '../media/MediaBits.jsx';

const COLUMNAS = 5;

// Los premios de la tienda (README, "Premios por acertar"): arriba, cobrar un
// código, que es lo que se hace con alguien enfrente; abajo, sus premios por
// partido, con el marcador de en qué va cada uno. La tienda ve cuántos votaron,
// cuántos acertaron y cuántos ya cobraron, nunca quiénes.
//
// `canAward` lo decide el backend: publicada y verificada. Sin eso no pone
// premios ni cobra códigos, y se dice por qué, sin botón: publicarla y
// verificarla lo decide CFBAMX.
export default function StorePrizesSection({
  store, org, prizes, prizesError, canAward, setModal, token, loadPrizes,
}) {
  const [filter, setFilter] = useSectionFilter(PRIZE_FILTERS, 'todos');
  const rows = prizes || [];
  const active = PRIZE_FILTERS.find((f) => f.key === filter) ?? PRIZE_FILTERS[0];
  const tramos = tramosDelPanel(rows.filter(active.test));
  const totales = totalesDePremios(rows);
  const bloqueada = canAward === false;
  const motivo = bloqueada ? (candadoDePremios(org) || 'Tu tienda todavía no está publicada y verificada') : null;

  return (
    <>
      <Band
        title="Premios"
        eyebrow={<StoreEyebrow store={store} />}
        actions={(
          <button
            type="button"
            className="btn btn-flag btn-sm"
            disabled={canAward !== true}
            title={motivo ?? undefined}
            onClick={() => setModal({ type: 'prize' })}
          >
            + Premio
          </button>
        )}
      >
        <FilterScoreboard
          label="Filtrar premios"
          filters={countFilters(PRIZE_FILTERS, rows, filter)}
          active={filter}
          onChange={setFilter}
          loading={!prizes}
        />
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[prizesError]} />

        {bloqueada && (
          <div className="sws-gate" role="note">
            <Status tone="off">Todavía no puedes poner premios</Status>
            <p>
              {motivo}. Los premios son para tiendas publicadas y verificadas por CFBAMX: tu nombre sale en la
              página del partido y le prometes algo a quien acierte. Mientras tanto, tus premios no se ven en
              ningún lado y sus códigos no se pueden cobrar; vuelven solos en cuanto CFBAMX te publique y te
              verifique.
            </p>
          </div>
        )}

        <CodeCheck store={store} token={token} disabled={canAward !== true} onRedeemed={loadPrizes} />

        {!prizes ? !prizesError && <SectionLoading /> : rows.length === 0 ? (
          <div className="adm-no-results">
            <p>
              Todavía no pones ningún premio. Eliges un partido que todavía se pueda votar y un producto de tu
              vitrina con un descuento: sale en la página del partido, junto a «¿Quién gana?», y quien acierte
              lo recibe con su aviso del resultado, con un código para cobrarlo aquí.
            </p>
            {canAward === true && (
              <button type="button" className="btn btn-flag btn-sm" onClick={() => setModal({ type: 'prize' })}>
                + Poner el primero
              </button>
            )}
          </div>
        ) : tramos.length === 0 ? (
          <NoResults onClear={() => setFilter('todos')}>Ningún premio está en ese estado.</NoResults>
        ) : (
          <>
            {totales.ganadores > 0 && (
              <p className="adm-note sws-prize-totals">
                De lo entregado: {pluralize(totales.ganadores, 'persona acertó', 'personas acertaron')} y{' '}
                {formatNumber(totales.canjeados)} ya {totales.canjeados === 1 ? 'cobró su premio' : 'cobraron su premio'}.
              </p>
            )}
            <div className="adm-table-box">
              <div className="table-wrap">
                <table className="data-table adm-table sws-prizes">
                  <caption className="adm-sr-only">Premios de la tienda por partido</caption>
                  <thead>
                    <tr>
                      <th>Partido</th>
                      <th>Premio</th>
                      <th style={{ width: 150 }}>Estado</th>
                      <th className="sws-col-redeemed" style={{ width: 110 }}>Cobrados</th>
                      <th className="col-actions" style={{ width: 64 }}><span className="adm-sr-only">Acciones</span></th>
                    </tr>
                  </thead>
                  {tramos.map((tramo) => (
                    <tbody key={tramo.key}>
                      <tr className="lws-group">
                        <th colSpan={COLUMNAS} scope="colgroup">
                          {tramo.label}
                          <span className="lws-group-sub">{pluralize(tramo.rows.length, 'premio')}</span>
                        </th>
                      </tr>
                      {tramo.rows.map((p) => (
                        <PrizeRow
                          key={p.prize_id}
                          prize={p}
                          onWithdraw={() => setModal({ type: 'withdraw-prize', prize: p })}
                        />
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>
              <footer className="adm-table-foot">
                <span>{pluralize(rows.length, 'premio')}</span>
              </footer>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// Una fila, un botón: el menú "⋯" lleva al partido y, mientras se pueda votar,
// deja retirar el premio. Después de eso ya no se toca.
function PrizeRow({ prize: p, onWithdraw }) {
  const estado = estadoDelPremio(p);
  const cuando = p.match_date ? fechaCorta(p.match_date, p.timezone || p.league_timezone) : null;
  return (
    <tr>
      <td>
        <MediaMatch match={p} />
        <span className="sws-prize-when">
          {cuando && <span>{cuando}</span>}
          <MatchTime match={p} />
        </span>
      </td>
      <td>
        <div className="sws-prize-what">
          <ProductThumb product={{ image_url: p.product?.image_url }} />
          <span className="sws-prize-what-text">
            <span className="sws-prize-figure">{cifraDelPremio(p)}</span>
            <span className="sws-prize-product" title={p.product?.name}>{p.product?.name}</span>
            <span className="adm-faint">{textoDeVigencia(p.valid_days)}</span>
          </span>
        </div>
      </td>
      <td>
        <span className="adm-state">
          <Status tone={estado.tone}>{estado.label}</Status>
          <span className="adm-faint">
            {p.state === 'awarded'
              ? (p.winners > 0 ? pluralize(p.winners, 'acertó', 'acertaron') : 'Nadie acertó')
              : pluralize(p.votes, 'voto')}
          </span>
        </span>
      </td>
      <td className="sws-col-redeemed">
        {textoDeCanjes(p) ?? <span className="adm-faint">—</span>}
      </td>
      <td className="col-actions">
        <RowMenu
          label={`Más acciones del premio de ${partidoDelPremio(p)}`}
          items={[
            { label: 'Ver el partido', to: `/partidos/${p.match_id}` },
            p.state === 'open' && { divider: true, key: 'peligro' },
            p.state === 'open' && { label: 'Retirar premio', danger: true, onSelect: onWithdraw },
          ]}
        />
      </td>
    </tr>
  );
}

// Cobrar un premio en el mostrador: se escribe el código, el backend dice si
// vale, si ya se usó o si venció, y "Marcar como usado" guarda el canje. Una sola
// vez: si dos personas de la tienda lo cobran al mismo tiempo, la segunda se
// entera de que ya se usó. Nunca dice de quién es el código: el código es la
// credencial.
function CodeCheck({ store, token, disabled, onRedeemed }) {
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [justRedeemed, setJustRedeemed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function revisar(e) {
    e.preventDefault();
    const limpio = limpiarCodigo(code);
    if (!limpio) return;
    setBusy(true);
    setError('');
    setResult(null);
    setJustRedeemed(false);
    try {
      setResult(await api.checkPrizeCode(store.id, limpio, token));
    } catch (err) {
      setError(err.offline ? 'Sin conexión: no se pudo revisar el código.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  async function marcarComoUsado() {
    setBusy(true);
    setError('');
    try {
      setResult(await api.redeemPrizeCode(store.id, limpiarCodigo(code), token));
      setJustRedeemed(true);
      onRedeemed?.();
    } catch (err) {
      // Venció o lo cobró alguien más mientras tanto: se vuelve a revisar para
      // enseñar cómo quedó, no solo el error.
      setError(err.offline ? 'Sin conexión: no se marcó como usado. Vuelve a intentarlo.' : err.message);
      api.checkPrizeCode(store.id, limpiarCodigo(code), token).then(setResult).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  const visto = result ? resultadoDelCodigo(result) : null;

  return (
    <section className="sws-redeem" aria-labelledby="sws-redeem-title">
      <div className="sws-redeem-head">
        <h2 id="sws-redeem-title">Cobrar un premio</h2>
        <p>
          Cuando alguien te enseñe su código, escríbelo aquí. Te dice si vale, y lo marcas como usado al darle su
          descuento.
        </p>
      </div>
      <form className="sws-redeem-form" onSubmit={revisar}>
        <input
          value={code}
          onChange={(e) => { setCode(e.target.value); setResult(null); setJustRedeemed(false); setError(''); }}
          placeholder="CFB-27-K7M2Q9"
          aria-label="Código del premio"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          maxLength={40}
        />
        <button type="submit" className="btn btn-ws btn-sm" disabled={disabled || busy || !code.trim()}>
          {busy && !result ? 'Revisando…' : 'Revisar'}
        </button>
      </form>

      {visto && (
        <div className={`sws-redeem-result is-${justRedeemed ? 'on' : visto.tone}`} role="status">
          {justRedeemed ? (
            <>
              <Status tone="on" check>Listo: quedó como usado</Status>
              <p>{textoDelPremio(result)}. Entrégale su descuento.</p>
            </>
          ) : (
            <>
              <Status tone={visto.tone} check={visto.tone === 'on'}>{visto.title}</Status>
              <p>{visto.detail}</p>
              {result.match && <p className="adm-faint">Por acertar {partidoDelPremio(result.match)}</p>}
              {visto.canRedeem && (
                <button type="button" className="btn btn-flag btn-sm" disabled={busy} onClick={marcarComoUsado}>
                  {busy ? 'Guardando…' : 'Marcar como usado'}
                </button>
              )}
            </>
          )}
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
    </section>
  );
}
