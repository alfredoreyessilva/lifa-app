import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import Modal from './Modal.jsx';

// Genera un link de un solo uso para ENTREGARLE un equipo a su representante.
// Antes vivía solo dentro de Dashboard.jsx (pantalla vieja de gestión de
// liga); se sacó a su propio archivo para poder usarlo también desde el roster
// de liga nuevo (LeagueRoster.jsx), sin duplicar esta lógica dos veces.
//
// Entregar es de una sola vía: en cuanto alguien reclama el link, la liga se
// sale de la administración de ese equipo y no puede volver a entrar. El
// backend contesta 409 si se intenta otra vez, y aquí eso se explica en vez de
// enseñarse como un error rojo — no es una falla, es el modelo funcionando.
//
// Lo que NO cambia al entregar es la participación del equipo en los torneos
// de la liga: eso vive aparte y se administra aparte.
export default function InviteTeamModal({ team, token, onClose, onDone }) {
  const [link, setLink] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.createTeamInvite(team.id, token)
      .then(({ token: inviteToken }) => {
        setLink(`${window.location.origin}/invitaciones/${inviteToken}`);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [team.id]);

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
      {loading && <p>Generando link…</p>}

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

      {link && (
        <>
          <p style={{ fontSize: 13, color: 'var(--ink-dim)' }}>
            Copia este link y mándaselo por tu cuenta (WhatsApp, correo, etc.) a la persona que va a administrar el equipo.
            Al abrirlo va a crear su cuenta o iniciar sesión, y quedará como <strong>dueño</strong> del
            equipo de inmediato — el link deja de funcionar en cuanto se usa una vez.
          </p>
          <p style={{ fontSize: 12, color: 'var(--ink-dim)' }}>
            En cuanto lo reclame, <strong>sales de la administración de este equipo</strong>: dejas de ver
            su padrón y sus cuotas, y ya no puedes repartir su acceso. Lo que no cambia es su
            participación en tus torneos. Mientras nadie lo reclame, puedes cancelar la entrega.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input readOnly value={link} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
            <button type="button" className="btn btn-outline btn-sm" onClick={copyLink}>
              {copied ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>
          {/* Mismo porqué que en InviteAdminModal: el link viaja completo, al
              final y en su propia línea. */}
          <a
            className="btn btn-accent"
            style={{ display: 'block', textAlign: 'center', marginTop: 10 }}
            href={`https://wa.me/?text=${encodeURIComponent(
              `Te entrego el perfil de ${team.name} en CFBAMX. Abre este link para administrarlo (sirve una sola vez):\n${link}`
            )}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Enviar por WhatsApp
          </a>
        </>
      )}

      <div className="modal-actions">
        <button className="btn btn-flag" onClick={onDone}>Listo</button>
      </div>
    </Modal>
  );
}
