import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import ConfirmDialog from '../ConfirmDialog.jsx';
import { Band, ScoreCell, Scoreboard, SectionError, SectionLoading, Status, formatDate } from '../admin/AdminKit.jsx';
import { MatchTime, MediaMatch } from '../media/MediaBits.jsx';
import { formatNumber } from '../../utils/adminPanel.js';
import { ENTREGAS, LO_QUE_FALTA } from '../../utils/compras.js';
import { storeHref } from '../../utils/storePanel.js';
import { StoreEyebrow } from './StoreWorkspace.jsx';

// "Cobro y entrega" del panel de una tienda (README, "Compras en la vitrina" → "El
// panel de la tienda"): arriba, lo que le falta para vender; luego su Mercado
// Pago, cómo entrega y su política de devoluciones, y los partidos donde va a
// estar. Lo que decide CFBAMX —publicarla y verificarla— se dice sin botón.
//
// Conectar Mercado Pago es solo de un dueño (permiso `cobros`): quien conecta
// decide a dónde va el dinero. Al administrador se le dice quién lo hace.
const vacio = (v) => (v === null || v === undefined ? '' : String(v));

function formDe(s) {
  return {
    address: vacio(s?.address),
    pickup_enabled: s?.pickup_enabled === true,
    pickup_hours: vacio(s?.pickup_hours),
    shipping_enabled: s?.shipping_enabled === true,
    shipping_fee: vacio(s?.shipping_fee),
    free_shipping_from: vacio(s?.free_shipping_from),
    match_enabled: s?.match_enabled === true,
    return_policy: vacio(s?.return_policy),
  };
}

export default function StoreSalesSection({ store, org, sales, salesError, token, loadSales, setModal }) {
  const [params] = useSearchParams();
  const [form, setForm] = useState(() => formDe(sales?.settings));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [mpBusy, setMpBusy] = useState(false);
  const [mpError, setMpError] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(null);

  // Cuando llegan los ajustes guardados (o cambian por otra pestaña), el formulario los toma.
  const guardados = JSON.stringify(sales?.settings ?? null);
  useEffect(() => { setForm(formDe(sales?.settings)); }, [guardados]);

  if (!sales) {
    return (
      <>
        <Band title="Cobro y entrega" eyebrow={<StoreEyebrow store={store} />} />
        <div className="adm-canvas">{salesError ? <SectionError messages={[salesError]} /> : <SectionLoading />}</div>
      </>
    );
  }

  const update = (key, value) => { setForm((f) => ({ ...f, [key]: value })); setSaved(false); setError(''); };
  const cuenta = sales.account;
  const conectada = cuenta?.vigente === true;

  async function guardar(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.saveStoreSalesSettings(store.id, form, token);
      await loadSales();
      setSaved(true);
    } catch (err) {
      setError(err.offline ? 'Sin conexión: no se guardó.' : err.message);
    } finally {
      setSaving(false);
    }
  }

  async function conectar() {
    setMpBusy(true);
    setMpError('');
    try {
      const { url } = await api.getMercadoPagoLink(store.id, token);
      window.location.assign(url);
    } catch (err) {
      setMpBusy(false);
      setMpError(err.offline ? 'Sin conexión: vuelve a intentarlo.' : err.message);
    }
  }

  return (
    <>
      <Band title="Cobro y entrega" eyebrow={<StoreEyebrow store={store} />}>
        <Scoreboard label="Cómo vende tu tienda">
          <ScoreCell
            label="Vitrina"
            small
            value={<Status tone={sales.selling ? 'on' : 'off'}>{sales.selling ? 'Vende' : 'No vende'}</Status>}
            sub={sales.selling ? 'Cada producto con precio lleva «Comprar»' : 'Abajo, lo que le falta'}
          />
          <ScoreCell
            label="Mercado Pago"
            small
            value={<Status tone={conectada ? 'on' : 'off'}>{conectada ? 'Conectado' : cuenta ? 'Por reconectar' : 'Sin conectar'}</Status>}
          />
          <ScoreCell label="Entregas" value={formatNumber(sales.deliveries.length)} sub={sales.deliveries.map((d) => ENTREGAS[d].short).join(' · ') || 'Ninguna lista'} />
          <ScoreCell label="Productos" value={formatNumber(sales.purchasable_count)} sub="Se pueden comprar" />
        </Scoreboard>
      </Band>

      <div className="adm-canvas sws-sales">
        <SectionError messages={[salesError]} />
        {params.get('mp') === 'conectado' && conectada && (
          <p className="sws-sales-ok" role="status">Listo: tu Mercado Pago quedó conectado. El dinero de cada venta te llega directo.</p>
        )}

        {sales.missing.length > 0 ? (
          <div className="adm-prizes-before">
            <h2>Para vender en tu vitrina te falta</h2>
            <ul className="sws-missing">
              {sales.missing.map((clave) => (
                <li key={clave}>
                  {LO_QUE_FALTA[clave]?.label ?? clave}
                  {LO_QUE_FALTA[clave]?.quien === 'cfbamx' && <span className="adm-faint"> · lo hace CFBAMX</span>}
                  {clave === 'telefono' && <> · <Link to={storeHref(store.id, 'perfil')}>Editar perfil</Link></>}
                  {clave === 'producto' && <> · <Link to={storeHref(store.id, 'productos')}>Productos</Link></>}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="sws-sales-ok">
            Tu vitrina vende: cada producto con precio lleva «Comprar». <Link to={`/panel/organizacion/${store.id}`}>Ver mi vitrina</Link>
          </p>
        )}

        <section className="sws-sales-block" aria-labelledby="sws-mp">
          <h2 id="sws-mp" className="adm-canvas-title">Mercado Pago</h2>
          {cuenta ? (
            <p>
              Cuenta {cuenta.provider_user_id}, conectada el {formatDate(cuenta.connected_at)}
              {cuenta.connected_by_name && <> por {cuenta.connected_by_name}</>}.
              {!conectada && ' Su permiso venció: vuelve a conectarla para seguir vendiendo.'}
            </p>
          ) : (
            <p>
              Conecta la cuenta de Mercado Pago de tu tienda: el comprador paga ahí, con tarjeta, en OXXO o con su saldo, y el
              dinero de cada venta te llega directo. CFBAMX nunca lo toca. Las devoluciones y la factura son tuyas.
            </p>
          )}
          {sales.can_connect ? (
            <div className="sws-sales-actions">
              {(!cuenta || !conectada) && (
                <button type="button" className="btn btn-flag btn-sm" disabled={mpBusy} onClick={conectar}>
                  {mpBusy ? 'Abriendo Mercado Pago…' : cuenta ? 'Volver a conectar' : 'Conectar Mercado Pago'}
                </button>
              )}
              {cuenta && (
                <button type="button" className="btn btn-ws btn-sm" onClick={() => setDisconnecting(true)}>Desconectar</button>
              )}
            </div>
          ) : (
            <p className="adm-faint">La conecta el dueño de la tienda: decide a dónde llega el dinero.</p>
          )}
          {mpError && <div className="form-error">{mpError}</div>}
        </section>

        <form className="sws-sales-block" onSubmit={guardar} aria-labelledby="sws-entregas" noValidate>
          <h2 id="sws-entregas" className="adm-canvas-title">Cómo vendes</h2>
          <div className="field">
            <label htmlFor="sws-s-address">Domicilio de tu tienda</label>
            <input id="sws-s-address" maxLength={200} value={form.address} onChange={(e) => update('address', e.target.value)} placeholder="Av. Tulum 10, Centro, Cancún" />
            <span className="sws-field-hint">Sale en la compra como quién vende, y es donde recogen.</span>
          </div>

          <fieldset className="sws-delivery">
            <legend>Formas de entrega</legend>
            <label className="sws-check">
              <input type="checkbox" checked={form.pickup_enabled} onChange={(e) => update('pickup_enabled', e.target.checked)} />
              <span>{ENTREGAS.pickup.label}<em>En tu domicilio, sin costo.</em></span>
            </label>
            {form.pickup_enabled && (
              <div className="field sws-delivery-detail">
                <label htmlFor="sws-s-hours">Horario para recoger</label>
                <input id="sws-s-hours" maxLength={120} value={form.pickup_hours} onChange={(e) => update('pickup_hours', e.target.value)} placeholder="Lunes a sábado, 10 a 19" />
              </div>
            )}
            <label className="sws-check">
              <input type="checkbox" checked={form.shipping_enabled} onChange={(e) => update('shipping_enabled', e.target.checked)} />
              <span>{ENTREGAS.shipping.label}<em>A todo México, con tu paquetería. Al enviarlo pones la guía.</em></span>
            </label>
            {form.shipping_enabled && (
              <div className="sws-product-row sws-delivery-detail">
                <div className="field">
                  <label htmlFor="sws-s-fee">Costo del envío (MXN)</label>
                  <input id="sws-s-fee" type="number" inputMode="decimal" min="0" step="0.01" value={form.shipping_fee} onChange={(e) => update('shipping_fee', e.target.value)} placeholder="150" />
                </div>
                <div className="field">
                  <label htmlFor="sws-s-free">Gratis desde (opcional)</label>
                  <input id="sws-s-free" type="number" inputMode="decimal" min="0" step="0.01" value={form.free_shipping_from} onChange={(e) => update('free_shipping_from', e.target.value)} placeholder="2000" />
                </div>
              </div>
            )}
            <label className="sws-check">
              <input type="checkbox" checked={form.match_enabled} onChange={(e) => update('match_enabled', e.target.checked)} />
              <span>{ENTREGAS.match.label}<em>En los partidos donde vas a estar (abajo), sin costo. Se pide hasta 3 horas antes.</em></span>
            </label>
          </fieldset>

          <div className="field">
            <label htmlFor="sws-s-policy">Política de cambios y devoluciones</label>
            <textarea id="sws-s-policy" rows={4} maxLength={2000} value={form.return_policy} onChange={(e) => update('return_policy', e.target.value)} placeholder="Cambios de talla en 15 días con ticket y la etiqueta puesta…" />
            <span className="sws-field-hint">Quien compra la lee antes de pagar, y se guarda en su pedido como estaba.</span>
          </div>

          {error && <div className="form-error">{error}</div>}
          <div className="sws-sales-actions">
            <button type="submit" className="btn btn-flag btn-sm" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
            {saved && <span className="sws-sales-saved" role="status">Guardado</span>}
          </div>
        </form>

        <section className="sws-sales-block" aria-labelledby="sws-puestos">
          <div className="sws-sales-head">
            <h2 id="sws-puestos" className="adm-canvas-title">Partidos donde vas a estar</h2>
            <button type="button" className="btn btn-ws btn-sm" onClick={() => setModal({ type: 'stand' })}>+ Agregar partido</button>
          </div>
          {!form.match_enabled && sales.stands.length > 0 && (
            <p className="adm-faint">«Entrega en un partido» está apagada: estos partidos no se le ofrecen a nadie.</p>
          )}
          {sales.stands.length === 0 ? (
            <p className="adm-faint">Ninguno. Agrega los partidos a los que vas a llevar tu puesto, y quien te compre podrá recoger ahí.</p>
          ) : (
            <ul className="sws-stands">
              {sales.stands.map((s) => (
                <li key={s.stand_id}>
                  <span className="sws-stands-match"><MediaMatch match={s} /></span>
                  <span className="sws-stands-side">
                    <MatchTime match={s} />
                    {s.is_open ? <Status tone="on">Recibe pedidos</Status> : <Status>Ya cerró</Status>}
                    {s.note && <span className="adm-faint">{s.note}</span>}
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWithdrawing(s)}>Quitar</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {disconnecting && (
        <ConfirmDialog
          title="Desconectar Mercado Pago"
          message={`${org?.name ?? store.name} deja de vender en su vitrina hasta que conectes otra vez.`}
          detail="Los pedidos que ya están pagados siguen aquí, pero reembolsarlos se hace desde tu cuenta de Mercado Pago: CFBAMX ya no tiene tu permiso."
          confirmLabel="Desconectar"
          danger
          onClose={() => setDisconnecting(false)}
          onConfirm={async () => {
            await api.disconnectMercadoPago(store.id, token);
            await loadSales();
            setDisconnecting(false);
          }}
        />
      )}
      {withdrawing && (
        <ConfirmDialog
          title="Quitar el partido"
          message={`¿Ya no vas a estar en ${withdrawing.home_team} vs ${withdrawing.away_team}?`}
          detail="Nadie más lo puede elegir. Los pedidos que ya lo eligieron siguen diciendo ese partido: avísales si cambia algo."
          confirmLabel="Quitar"
          onClose={() => setWithdrawing(null)}
          onConfirm={async () => {
            await api.withdrawStoreStand(store.id, withdrawing.stand_id, token);
            await loadSales();
            setWithdrawing(null);
          }}
        />
      )}
    </>
  );
}
