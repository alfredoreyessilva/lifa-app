import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { caducaEn, linkDeInvitacion, enlaceWhatsApp } from '../utils/invitaciones.js';
import Modal from './Modal.jsx';

// El link para ENTREGARLE un equipo a su representante. Antes vivía solo
// dentro de Dashboard.jsx (pantalla vieja de gestión de liga); se sacó a su
// propio archivo para poder usarlo también desde el roster de liga nuevo
// (LeagueRoster.jsx), sin duplicar esta lógica dos veces.
//
// Es uno de los dos tipos de link, y el único que funciona distinto (README,
// "Dos links distintos: la entrega y la invitación con rol"): hay UNA entrega
// viva a la vez, y generar otra cancela la anterior. Por eso este modal
// primero PREGUNTA si ya hay una, y solo genera cuando se le pide. Hasta el
// 2026-09-23 generaba una al abrirse, y abrirlo solo para volver a copiar el
// link mataba en silencio el que ya estaba en el WhatsApp de alguien (PD-30).
//
// Entregar es de una sola vía: en cuanto alguien reclama el link, la liga se
// sale de la administración de ese equipo y no puede volver a entrar. El
// backend contesta 409 si se intenta otra vez, y aquí eso se explica en vez de
// enseñarse como un error rojo — no es una falla, es el modelo funcionando.
//
// Lo que NO cambia al entregar es la participación del equipo en los torneos
// de la liga: eso vive aparte y se administra aparte.
export default function InviteTeamModal({ team, token, onClose, onDone }) {
  const [vigente, setVigente] = useState(undefined); // undefined = cargando · null = no hay
  const [error, setError] = useState('');
  const [generando, setGenerando] = useState(false);
  const [confirmarOtro, setConfirmarOtro] = useState(false);
  const [copied, setCopied] = useState(false);

  // Leer no cambia nada, así que no importa que React lo corra dos veces en
  // desarrollo — que era justo lo que dejaba dos links vivos cuando esto
  // generaba al montarse.
  useEffect(() => {
    api.getTeamInvite(team.id, token)
      .then(({ invite }) => setVigente(invite))
      .catch((e) => { setError(e.message); setVigente(null); });
  }, [team.id]);

  async function generar() {
    setError('');
    setGenerando(true);
    try {
      const nueva = await api.createTeamInvite(team.id, token);
      setVigente(nueva);
      setConfirmarOtro(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerando(false);
    }
  }

  const link = vigente?.token ? linkDeInvitacion(vigente.token) : null;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Si el navegador no deja copiar solo, la persona puede seleccionar el texto a mano.
    }
  }

  // Un 409 aquí significa "este equipo ya se administra solo", que no es un
  // error de quien hizo clic: es la única respuesta posible. Se muestra como
  // explicación y no como falla.
  const yaEntregado = error && /ya se administra solo/i.test(error);

  return (
    <Modal title={`Entregar el perfil — ${team.name}`} onClose={onClose}>
      {vigente === undefined && !error && <p>Buscando el link de entrega…</p>}

      {yaEntregado ? (
        <>
          <p style={{ fontSize: 14 }}>
            <strong>{team.name}</strong> ya se administra solo. Su acceso lo reparten sus propios
            dueños desde su panel, no la liga.
          </p>
          <p style={{ fontSize: 13, color: 'var(--ink-dim)' }}>
            Entregar un equipo es de una sola vía, a propósito: si la liga pudiera retomarlo,
            podría llegar al padrón del club por la puerta de atrás. Su participación en tus
            torneos no cambia con esto — sigue en tu calendario y en tus ramas igual que siempre.
          </p>
        </>
      ) : error ? (
        <div className="form-error">{error}</div>
      ) : null}

      {!yaEntregado && vigente === null && (
        <>
          <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginTop: 0 }}>
            Genera el link y mándaselo a la persona que va a administrar el equipo. Al abrirlo va a
            crear su cuenta o iniciar sesión, y quedará como <strong>dueño</strong> del equipo.
          </p>
          <p style={{ fontSize: 12, color: 'var(--ink-dim)' }}>
            En cuanto lo use, <strong>sales de la administración de este equipo</strong>: dejas de
            ver su padrón y sus cuotas, y ya no puedes repartir su acceso ni eliminarlo. Lo que no
            cambia es su participación en tus torneos.
          </p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={generar} disabled={generando}>
              {generando ? 'Generando…' : 'Generar link'}
            </button>
          </div>
        </>
      )}

      {!yaEntregado && link && (
        <>
          <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginTop: 0 }}>
            Este es el link de entrega de <strong>{team.name}</strong>. Mándaselo por WhatsApp con el
            botón, o cópialo. Sirve una sola vez, para una sola persona, y{' '}
            <strong>{caducaEn(vigente.seconds_left)}</strong>.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input readOnly value={link} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
            <button type="button" className="btn btn-outline btn-sm" onClick={copyLink}>
              {copied ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>
          {/* Es un <a> y no un window.open: así el navegador no lo bloquea. */}
          <a
            className="btn btn-accent"
            style={{ display: 'block', textAlign: 'center', marginTop: 10 }}
            href={enlaceWhatsApp(
              `Te entrego el perfil de ${team.name} en CFBAMX. Abre este link para administrarlo (sirve una sola vez):`,
              link,
            )}
            target="_blank"
            rel="noopener noreferrer"
          >
            Enviar por WhatsApp
          </a>
          <p style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 10 }}>
            En cuanto lo use, sales de la administración de este equipo: dejas de ver su padrón y sus
            cuotas, y ya no puedes repartir su acceso ni eliminarlo. Su participación en tus torneos
            no cambia. Mientras nadie lo use, puedes cancelar la entrega.
          </p>

          {/* Generar otro es la excepción, no el camino: se pide aparte y se
              avisa qué le pasa al que ya se mandó. */}
          {confirmarOtro ? (
            <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginTop: 12 }}>
              <p style={{ fontSize: 13, margin: 0 }}>
                <strong>El link de arriba va a dejar de servir.</strong> Úsalo solo si el que mandaste
                se perdió o le llegó a la persona equivocada.
              </p>
              <div className="modal-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmarOtro(false)}>No, dejar este</button>
                <button className="btn btn-danger btn-sm" onClick={generar} disabled={generando}>
                  {generando ? 'Generando…' : 'Sí, generar otro'}
                </button>
              </div>
            </div>
          ) : (
            <div className="modal-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmarOtro(true)}>Generar otro link</button>
              <button className="btn btn-flag" onClick={onDone}>Listo</button>
            </div>
          )}
        </>
      )}

      {yaEntregado && (
        <div className="modal-actions">
          <button className="btn btn-flag" onClick={onDone}>Listo</button>
        </div>
      )}
    </Modal>
  );
}
