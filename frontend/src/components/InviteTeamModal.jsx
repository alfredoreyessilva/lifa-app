import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import Modal from './Modal.jsx';

// Genera un link de invitación de un solo uso para que alguien reclame el
// puesto de representante de un equipo. Antes vivía solo dentro de
// Dashboard.jsx (pantalla vieja de gestión de liga); se sacó a su propio
// archivo para poder usarlo también desde el roster de liga nuevo
// (LeagueRoster.jsx), sin duplicar esta lógica dos veces.
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

  return (
    <Modal title={`Invitar representante — ${team.name}`} onClose={onClose}>
      {loading && <p>Generando link…</p>}
      {error && <div className="form-error">{error}</div>}

      {link && (
        <>
          <p style={{ fontSize: 13, color: 'var(--ink-dim)' }}>
            Copia este link y mándaselo por tu cuenta (WhatsApp, correo, etc.) a la persona que va a administrar el equipo.
            Al abrirlo, va a crear su cuenta o iniciar sesión, y quedará asignada de inmediato — el link deja de funcionar en cuanto se usa una vez.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input readOnly value={link} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
            <button type="button" className="btn btn-outline btn-sm" onClick={copyLink}>
              {copied ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>
        </>
      )}

      <div className="modal-actions">
        <button className="btn btn-flag" onClick={onDone}>Listo</button>
      </div>
    </Modal>
  );
}
