import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import Modal from '../Modal.jsx';
import ConfirmDialog from '../ConfirmDialog.jsx';
import { RowMenu, SearchBox, SectionLoading, Status } from '../admin/AdminKit.jsx';
import { MatchTime, MediaMatch } from '../media/MediaBits.jsx';
import { matchesSearch } from '../../utils/adminPanel.js';
import { catalogPrice } from '../../utils/money.js';
import { imagenAjustada } from '../../utils/imagenes.js';
import { matchContext, scheduleDays } from '../../utils/mediaPanel.js';
import {
  ACCIONES, ENTREGAS, ESTADOS, RENGLONES, conTalla, cuandoEsElPartido, direccionEnTexto, dondeEsElPartido,
  enlaceDeWhatsApp, etiquetaDelEstado, mensajeParaElComprador, partidoEnTexto, telefonoEnTexto, urlDelPedido,
} from '../../utils/compras.js';

// Las ventanas de lo que una tienda vende (README, "Compras en la vitrina"): un
// pedido, y poner un puesto en un partido. Van con la piel oscura del panel, como
// las demás ventanas de la tienda.

const MX = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' };
const cuando = (v) => (v ? new Date(v).toLocaleString('es-MX', MX) : '');
const TONO = { wait: 'ask', ok: 'on', off: 'off', bad: 'bad' };
const STOCK = { out: null, untracked: null, short: 'Sin existencias: no alcanzó cuando se pagó' };

// Un pedido: quién compró y cómo encontrarlo, qué compró, la entrega, el pago y su
// historia; la acción que sigue a la vista y "Cancelar y reembolsar" en "⋯". Cada
// cambio ofrece "Avisarle por WhatsApp", con el mensaje ya escrito.
export function OrderModal({ store, orderId, token, onClose, onChanged }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [envio, setEnvio] = useState({ carrier: '', tracking: '' });
  const [cancelando, setCancelando] = useState(false);
  const [hecho, setHecho] = useState('');

  useEffect(() => {
    let vigente = true;
    api.getStoreOrder(store.id, orderId, token)
      .then((o) => { if (vigente) setOrder(o); })
      .catch((e) => { if (vigente) setError(e.message); });
    return () => { vigente = false; };
  }, [store.id, orderId, token]);

  async function hacer(accion, cuerpo) {
    setBusy(true);
    setError('');
    try {
      const nuevo = await api.storeOrderAction(store.id, orderId, accion, cuerpo, token);
      setOrder(nuevo);
      setHecho(ACCIONES[accion].hecho);
      onChanged?.();
    } catch (e) {
      setError(e.offline ? 'Sin conexión: no se guardó. Vuelve a intentarlo.' : e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!order) {
    return (
      <Modal title={`Pedido ${orderId}`} onClose={onClose}>
        {error ? <div className="form-error">{error}</div> : <SectionLoading />}
      </Modal>
    );
  }

  const url = urlDelPedido(order.token, window.location.origin);
  const whatsapp = enlaceDeWhatsApp(order.buyer.phone, mensajeParaElComprador(order, store.name, url));
  const principal = order.actions.find((a) => a !== 'cancel');
  const puedeCancelar = order.actions.includes('cancel');
  const partido = order.delivery.promised?.match;
  const envioHecho = order.history.find((h) => h.kind === 'shipped');

  return (
    <>
    <Modal title={`Pedido ${order.id}`} onClose={onClose}>
      <div className="sws-order">
        <div className="sws-order-head">
          <Status tone={TONO[ESTADOS[order.status]?.tone] ?? 'off'}>{etiquetaDelEstado(order.status, order.delivery.method)}</Status>
          <span className="adm-faint">Hecho el {cuando(order.created_at)}</span>
          {puedeCancelar && (
            <RowMenu
              label={`Más acciones del pedido ${order.id}`}
              items={[{ label: ACCIONES.cancel.label, danger: true, onSelect: () => setCancelando(true) }]}
            />
          )}
        </div>

        {hecho && <p className="sws-order-done" role="status">{hecho}. {whatsapp && 'Avísale a quien compró:'}</p>}

        <section className="sws-order-block">
          <h3>Quién compró</h3>
          <p>
            <strong>{order.buyer.name}</strong><br />
            WhatsApp {telefonoEnTexto(order.buyer.phone)}{order.buyer.email && <> · {order.buyer.email}</>}
          </p>
          {whatsapp && (
            <a className="btn btn-ws btn-sm" href={whatsapp} target="_blank" rel="noopener noreferrer">Avisarle por WhatsApp</a>
          )}
        </section>

        <section className="sws-order-block">
          <h3>Lo que compró</h3>
          <ul className="sws-order-items">
            {order.items.map((i) => (
              <li key={i.id}>
                <span className="sws-order-thumb">
                  {i.image_url ? <img src={imagenAjustada(i.image_url, 96)} alt="" /> : null}
                </span>
                <span className="sws-order-item">
                  {conTalla(i.name, i.size)} <span className="adm-faint sws-order-qty">× {i.quantity}</span>
                  {STOCK[i.stock] && <span className="sws-order-flag">{STOCK[i.stock]}</span>}
                  {i.stock_back && <span className="adm-faint"> · Regresó a tus existencias</span>}
                </span>
                <span className="adm-num">{catalogPrice(i.line_total)}</span>
              </li>
            ))}
          </ul>
          <dl className="sws-order-totals">
            {order.shipping_fee > 0 && <div><dt>Envío</dt><dd>{catalogPrice(order.shipping_fee)}</dd></div>}
            <div><dt>Total</dt><dd>{catalogPrice(order.total)} MXN</dd></div>
            {order.fee_amount > 0 && <div><dt>Comisión de CFBAMX</dt><dd>{catalogPrice(order.fee_amount)}</dd></div>}
          </dl>
        </section>

        <section className="sws-order-block">
          <h3>{ENTREGAS[order.delivery.method]?.label}</h3>
          {order.delivery.method === 'pickup' && <p>En tu tienda, en tu horario: {order.delivery.promised?.hours}</p>}
          {order.delivery.method === 'shipping' && (
            <p>
              {direccionEnTexto(order.delivery.address)}
              {order.delivery.address?.references && <><br /><span className="adm-faint">{order.delivery.address.references}</span></>}
              {envioHecho && <><br />{envioHecho.carrier}{envioHecho.tracking && ` · Guía ${envioHecho.tracking}`}</>}
            </p>
          )}
          {order.delivery.method === 'match' && partido && (
            <p>
              {partidoEnTexto(order.delivery.match_now ?? partido)}<br />
              {cuandoEsElPartido({ ...partido, ...(order.delivery.match_now ?? {}) })}
              {dondeEsElPartido(partido) && <><br /><span className="adm-faint">{dondeEsElPartido(partido)}</span></>}
            </p>
          )}
        </section>

        <section className="sws-order-block">
          <h3>Pago</h3>
          {order.payment ? (
            <p>Mercado Pago, pago {order.payment.mp_payment_id}, el {cuando(order.payment.approved_at)}</p>
          ) : (
            <p className="adm-faint">Todavía sin pagar.</p>
          )}
          {order.extra_payments.length > 0 && (
            <p className="sws-order-flag is-block">
              Pagado dos veces: reembolsa desde tu Mercado Pago {order.extra_payments.length === 1 ? 'el pago' : 'los pagos'} {order.extra_payments.join(', ')}.
            </p>
          )}
          <ol className="sws-order-history">
            {order.history.map((h, n) => (
              <li key={`${h.kind}-${n}`}>
                <span>{RENGLONES[h.kind] ?? h.kind}{h.reason ? `: ${h.reason}` : ''}</span>
                <span className="adm-faint">{cuando(h.at)}</span>
              </li>
            ))}
          </ol>
        </section>

        {principal === 'shipped' && (
          <div className="sws-order-ship">
            <div className="field">
              <label htmlFor="sws-o-carrier">Paquetería</label>
              <input id="sws-o-carrier" value={envio.carrier} onChange={(e) => setEnvio({ ...envio, carrier: e.target.value })} placeholder="Estafeta, DHL, FedEx…" />
            </div>
            <div className="field">
              <label htmlFor="sws-o-tracking">Guía (opcional)</label>
              <input id="sws-o-tracking" value={envio.tracking} onChange={(e) => setEnvio({ ...envio, tracking: e.target.value })} />
            </div>
          </div>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>
          {principal && (
            <button
              type="button"
              className="btn btn-flag"
              disabled={busy || (principal === 'shipped' && !envio.carrier.trim())}
              onClick={() => hacer(principal, principal === 'shipped' ? envio : undefined)}
            >
              {busy ? 'Guardando…' : ACCIONES[principal].label}
            </button>
          )}
        </div>
      </div>
    </Modal>

      {/* Fuera de la ventana del pedido: una encima de la otra, cada una con su fondo. */}
      {cancelando && (
        <ConfirmDialog
          title={`Cancelar el pedido ${order.id}`}
          message={`Mercado Pago le reembolsa a ${order.buyer.name} los ${catalogPrice(order.total)} completos, y lo que salió de tus existencias regresa.`}
          warning="No se deshace. Si solo se va a tardar, mejor avísale por WhatsApp."
          reasonLabel="Por qué se cancela (lo ve quien compró)"
          confirmLabel="Cancelar y reembolsar"
          cancelLabel="No cancelar"
          danger
          onClose={() => setCancelando(false)}
          onConfirm={async (reason) => {
            await hacer('cancel', { reason });
            setCancelando(false);
          }}
        />
      )}
    </>
  );
}

// Poner un puesto en un partido: la tienda va a estar ahí y entrega lo que le
// compren para ese partido. Partidos públicos, con fecha, en los próximos 30 días
// y a más de 3 horas de empezar: lo que el backend vuelve a revisar.
export function StandModal({ store, token, onClose, onSaved }) {
  const [matches, setMatches] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [matchId, setMatchId] = useState(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let vigente = true;
    api.getStoreStandMatches(store.id, token)
      .then((d) => { if (vigente) setMatches(d.matches || []); })
      .catch((e) => { if (vigente) { setError(`No se pudieron cargar los partidos: ${e.message}`); setMatches([]); } });
    return () => { vigente = false; };
  }, [store.id, token]);

  const visibles = (matches || []).filter((m) => matchesSearch(query, [m.home_team, m.away_team, matchContext(m)]));
  const dias = scheduleDays(visibles);

  async function guardar(e) {
    e.preventDefault();
    if (!matchId) { setError('Elige el partido'); return; }
    setSaving(true);
    setError('');
    try {
      await api.addStoreStand(store.id, { match_id: matchId, note }, token);
      await onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title="Agregar un partido" onClose={onClose}>
      <form className="sws-prize-form" onSubmit={guardar} noValidate>
        <p className="sws-field-hint">
          Quien te compre puede elegir recoger ahí. Se puede pedir hasta 3 horas antes del partido, para que alcances a
          prepararlo.
        </p>
        {matches && matches.length > 0 && <SearchBox value={query} onChange={setQuery} placeholder="Buscar por equipo o liga" />}
        <div className="sws-pick-list" role="radiogroup" aria-label="Partido">
          {matches === null && <SectionLoading />}
          {matches && matches.length === 0 && !error && (
            <p className="sws-pick-empty">No hay partidos en las ligas públicas de aquí a 30 días.</p>
          )}
          {dias.map((day) => (
            <div key={day.key} className="sws-pick-day">
              <span className="sws-pick-day-label">{day.label}</span>
              {day.rows.map((m) => {
                const ya = Boolean(m.stand_id);
                const aqui = matchId === m.match_id;
                return (
                  <label key={m.match_id} className={`sws-pick${aqui ? ' is-on' : ''}${ya ? ' is-taken' : ''}`}>
                    <input type="radio" name="sws-stand-match" checked={aqui} disabled={ya} onChange={() => setMatchId(m.match_id)} />
                    <span className="sws-pick-main"><MediaMatch match={m} /></span>
                    <span className="sws-pick-side">{ya ? <Status>Ya vas a estar</Status> : <MatchTime match={m} />}</span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="sws-stand-note">Dónde te encuentran (opcional)</label>
          <input id="sws-stand-note" maxLength={140} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Puesto junto a la taquilla" />
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn btn-flag" disabled={saving || !matchId}>{saving ? 'Guardando…' : 'Agregar partido'}</button>
        </div>
      </form>
    </Modal>
  );
}
