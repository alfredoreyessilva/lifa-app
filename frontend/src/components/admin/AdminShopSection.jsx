import { useState } from 'react';
import { api } from '../../api/client.js';
import ConfirmDialog from '../ConfirmDialog.jsx';
import { formatNumber, pluralize, switchChangedBy } from '../../utils/adminPanel.js';
import { money, moneyShort } from '../../utils/money.js';
import { panelDeCompras, porcentaje } from '../../utils/compras.js';
import { Band, ScoreCell, Scoreboard, SectionError, SectionLoading, Status, formatDate } from './AdminKit.jsx';

// Panel Admin → Compras (README, "Compras en la vitrina" → "Panel Admin →
// Compras"): el botón que prende y apaga las compras para toda la plataforma, la
// comisión de CFBAMX —que nace en 0— y lo que ayuda a decidir. Tiene la forma de
// la sección Premios, y el estado tampoco vive aquí: vive en el backend
// (`platform_switches` y `platform_settings`).
//
// Cuenta pedidos y dinero, nunca personas: el admin no necesita los datos de
// quien compró para operar la plataforma.

const SWITCH_KEY = 'store_purchases';
const FEE_KEY = 'purchase_fee_percent';

const MX_DATE_TIME = {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  timeZone: 'America/Mexico_City',
};
const formatDateTime = (value) => (value ? new Date(value).toLocaleString('es-MX', MX_DATE_TIME) : '—');

export default function AdminShopSection({ data, error, reload, token }) {
  const [confirming, setConfirming] = useState(false);
  const [feeDraft, setFeeDraft] = useState(null);
  const [feeConfirm, setFeeConfirm] = useState(null);
  const [feeError, setFeeError] = useState('');

  const shop = data ? panelDeCompras(data) : null;
  const on = shop?.enabled === true;

  async function flip() {
    await api.adminSetSwitch(SWITCH_KEY, !on, token);
    await reload();
    setConfirming(false);
  }

  function askFee(e) {
    e.preventDefault();
    const value = Number(String(feeDraft ?? '').replace(',', '.'));
    if (!Number.isFinite(value) || value < shop.feeLimits.min || value > shop.feeLimits.max) {
      setFeeError(`Escribe un porcentaje de ${shop.feeLimits.min} a ${shop.feeLimits.max}`);
      return;
    }
    if (value === shop.fee) { setFeeDraft(null); return; }
    setFeeError('');
    setFeeConfirm(value);
  }

  async function saveFee() {
    await api.adminSetSetting(FEE_KEY, feeConfirm, token);
    await reload();
    setFeeConfirm(null);
    setFeeDraft(null);
  }

  return (
    <>
      <Band
        title="Compras en la vitrina"
        actions={shop && (
          <button
            type="button"
            className="btn btn-ws btn-sm"
            disabled={!on && !shop.configured}
            title={!on && !shop.configured ? 'Faltan las variables de Mercado Pago en el servidor' : undefined}
            onClick={() => setConfirming(true)}
          >
            {on ? 'Apagar compras' : 'Prender compras'}
          </button>
        )}
      >
        <Scoreboard label="Las compras en la vitrina">
          <ScoreCell
            label="Estado"
            small
            loading={!shop}
            value={shop && <Status tone={on ? 'on' : 'off'}>{on ? 'Prendidas' : 'Apagadas'}</Status>}
            sub={shop && (shop.since ? `Desde el ${formatDate(shop.since)}` : 'Nunca se han prendido')}
          />
          <ScoreCell label="Tiendas" value={formatNumber(shop?.stores)} loading={!shop} sub="Publicadas y verificadas" />
          <ScoreCell label="Conectadas" value={formatNumber(shop?.connected)} loading={!shop} sub="Con su Mercado Pago" />
          <ScoreCell label="Pagados" value={formatNumber(shop?.paid)} loading={!shop} sub="Pedidos, últimos 30 días" />
          <ScoreCell label="Vendido" value={shop ? moneyShort(shop.paidAmount) : '—'} loading={!shop} sub="En esos pedidos, a las tiendas" />
          <ScoreCell label="Comisión" value={shop ? porcentaje(shop.fee) : '—'} loading={!shop} sub="De CFBAMX, por venta" />
        </Scoreboard>
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[error]} />

        {!shop ? !error && <SectionLoading /> : (
          <>
            {!shop.configured && (
              <div className="adm-prizes-before" role="note">
                <h2>Faltan las variables de Mercado Pago en el servidor</h2>
                <p>
                  Sin ellas las compras no existen, aunque el botón esté prendido. Van en las variables de
                  entorno de Render: {shop.missing.map((v, i) => (
                    <span key={v}>{i > 0 && ', '}<code>{v}</code></span>
                  ))}.
                </p>
              </div>
            )}

            {!on && (
              <div className="adm-prizes-before">
                <h2>Antes de prenderlas</h2>
                <ol>
                  <li>La revisión fiscal con un contador: aun sin comisión, CFBAMX conecta compras entre terceros.</li>
                  <li>La revisión legal de lo que se enseña antes de pagar (PROFECO) y de los dos textos de abajo.</li>
                  <li>
                    Pasar a los Términos y al Aviso de Privacidad las secciones que quedaron redactadas en el README:
                    «Compras en la vitrina» → «Antes de prenderlo».
                  </li>
                  <li>Una vuelta con las credenciales de prueba de Mercado Pago: conectar, una tarjeta aprobada, una ficha de OXXO, una rechazada y un reembolso.</li>
                  <li>Las llaves de producción de Mercado Pago en Render, con la dirección del aviso dada de alta.</li>
                  <li>Una compra real pequeña, de punta a punta, con una tienda verificada.</li>
                </ol>
              </div>
            )}

            <h2 className="adm-canvas-title">Qué cambia</h2>
            <div className="adm-prizes-effects">
              <section className={`adm-prizes-effect${on ? ' is-current' : ''}`} aria-label="Prendidas">
                <div className="adm-prizes-effect-head">
                  <Status tone="on">Prendidas</Status>
                  {on && <span className="adm-prizes-now">Así están ahora</span>}
                </div>
                <ul>
                  <li>Las tiendas publicadas y verificadas tienen Pedidos y Cobro y entrega en su panel, y conectan su Mercado Pago.</li>
                  <li>En la vitrina de una tienda que vende, cada producto con precio lleva «Comprar», y hay carrito.</li>
                  <li>El dinero de cada venta le llega directo a la tienda; CFBAMX no lo toca.</li>
                </ul>
              </section>
              <section className={`adm-prizes-effect${on ? '' : ' is-current'}`} aria-label="Apagadas">
                <div className="adm-prizes-effect-head">
                  <Status>Apagadas</Status>
                  {!on && <span className="adm-prizes-now">Así están ahora</span>}
                </div>
                <ul>
                  <li>Nadie compra: no hay «Comprar» ni carrito, y las rutas de comprar contestan como si no existieran.</li>
                  <li>Un pedido que ya existe se sigue viendo con su link, y la tienda lo sigue atendiendo: es una venta pagada.</li>
                  <li>No se borra nada: al prenderlas, todo vuelve como estaba.</li>
                </ul>
              </section>
            </div>

            <h2 className="adm-canvas-title">La comisión de CFBAMX</h2>
            <div className="adm-shop-fee">
              <p>
                Se le pide a Mercado Pago en cada cobro, y él la separa de lo que recibe la tienda. Cada pedido guarda la
                que le tocó. Hoy es <strong>{porcentaje(shop.fee)}</strong>.
                {shop.fees > 0 && <> En los últimos 30 días sumó {money(shop.fees)}.</>}
              </p>
              <form className="adm-shop-fee-form" onSubmit={askFee}>
                <label htmlFor="adm-shop-fee">Comisión por venta</label>
                <div className="adm-shop-fee-input">
                  <input
                    id="adm-shop-fee"
                    inputMode="decimal"
                    value={feeDraft ?? String(shop.fee)}
                    onChange={(e) => { setFeeDraft(e.target.value); setFeeError(''); }}
                    aria-describedby="adm-shop-fee-hint"
                  />
                  <span aria-hidden="true">%</span>
                </div>
                <button type="submit" className="btn btn-ws btn-sm" disabled={feeDraft === null}>Cambiar</button>
              </form>
              <p id="adm-shop-fee-hint" className="adm-note">
                De {shop.feeLimits.min} a {shop.feeLimits.max}%. Cobrarla vuelve a CFBAMX intermediario con ingresos: antes, habla
                con tu contador.
              </p>
              {feeError && <div className="form-error">{feeError}</div>}
            </div>

            <h2 className="adm-canvas-title">Quién las movió</h2>
            <ChangesTable
              rows={[
                ...shop.history.map((h) => ({ at: h.changed_at, who: h, what: h.enabled ? <Status tone="on">Las prendió</Status> : <Status>Las apagó</Status> })),
                ...shop.feeHistory.map((h) => ({ at: h.changed_at, who: h, what: <span>Comisión a {porcentaje(h.value)}</span> })),
              ].sort((a, b) => new Date(b.at) - new Date(a.at))}
            />
            <p className="adm-note">El cambio se ve al instante en toda la plataforma. Aquí salen los últimos 10 de cada uno.</p>
          </>
        )}
      </div>

      {confirming && shop && (on ? (
        <ConfirmDialog
          title="Apagar las compras"
          message="Nadie va a poder comprar en ninguna vitrina, y las tiendas dejan de ver Cobro y entrega."
          detail="Los pedidos que ya existen siguen: quien compró los ve con su link, y la tienda los sigue atendiendo y reembolsando."
          confirmLabel="Apagar compras"
          onConfirm={flip}
          onClose={() => setConfirming(false)}
        />
      ) : (
        <ConfirmDialog
          title="Prender las compras"
          message={shop.stores > 0
            ? `Las tiendas publicadas y verificadas —hoy, ${pluralize(shop.stores, 'tienda')}— van a poder conectar su Mercado Pago y vender desde su vitrina.`
            : 'Hoy no hay ninguna tienda publicada y verificada: nadie va a poder vender hasta que verifiques una.'}
          detail="Se ve al instante, en toda la plataforma. Las puedes apagar cuando quieras sin borrar nada."
          warning="Antes de prenderlas para el público van la revisión fiscal y la legal, y las secciones de los Términos y del Aviso de Privacidad (README, «Compras en la vitrina» → «Antes de prenderlo»)."
          confirmLabel="Prender compras"
          onConfirm={flip}
          onClose={() => setConfirming(false)}
        />
      ))}

      {feeConfirm !== null && (
        <ConfirmDialog
          title={`Comisión de CFBAMX: ${porcentaje(feeConfirm)}`}
          message={feeConfirm > 0
            ? `En cada venta, Mercado Pago le va a separar a la tienda el ${porcentaje(feeConfirm)} del total para CFBAMX.`
            : 'Las ventas dejan de pagar comisión.'}
          detail="Aplica a los pedidos nuevos; cada pedido ya hecho guarda la que le tocó."
          warning={feeConfirm > 0 ? 'Cobrar comisión es un ingreso de CFBAMX por intermediar: tendrías que facturárselo a cada tienda. Habla antes con tu contador.' : undefined}
          confirmLabel="Cambiar comisión"
          onConfirm={saveFee}
          onClose={() => setFeeConfirm(null)}
        />
      )}
    </>
  );
}

function ChangesTable({ rows }) {
  if (rows.length === 0) {
    return (
      <div className="adm-no-results">
        <p>Nadie las ha movido: están apagadas y sin comisión desde que se construyeron.</p>
      </div>
    );
  }
  return (
    <div className="adm-table-box">
      <div className="table-wrap">
        <table className="data-table adm-table adm-prizes-table">
          <caption className="adm-sr-only">Cada vez que alguien movió las compras o la comisión</caption>
          <thead>
            <tr>
              <th style={{ width: 220 }}>Cuándo</th>
              <th style={{ width: 200 }}>Qué</th>
              <th>Quién</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.at}-${index}`}>
                <td className="adm-num">{formatDateTime(row.at)}</td>
                <td>{row.what}</td>
                <td className={row.who.changed_by_name ? undefined : 'adm-faint'}>{switchChangedBy(row.who)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
