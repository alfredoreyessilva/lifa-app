import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import Modal from './Modal.jsx';

// Genera un link de invitación de un solo uso para sumar a alguien más como
// administrador de una liga o equipo (organization_members), con el mismo
// acceso que quien ya la administra — a diferencia de InviteTeamModal, que
// REEMPLAZA al representante, este link AGREGA a quien lo reclame sin
// quitarle el acceso a nadie más.
export default function InviteAdminModal({ organizationId, organizationName, token, onClose, onDone }) {
  const [link, setLink] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.createOrgAdminInvite(organizationId, token)
      .then(({ token: inviteToken }) => {
        setLink(`${window.location.origin}/invitaciones/${inviteToken}`);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [organizationId]);

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
    <Modal title={`Invitar administrador — ${organizationName}`} onClose={onClose}>
      {loading && <p>Generando link…</p>}
      {error && <div className="form-error">{error}</div>}

      {link && (
        <>
          <p style={{ fontSize: 13, color: 'var(--ink-dim)' }}>
            Copia este link y mándaselo por tu cuenta (WhatsApp, correo, etc.) a la persona que quieres que administre {organizationName} junto contigo.
            Al abrirlo, va a crear su cuenta o iniciar sesión, y va a quedar con el mismo acceso que tú de inmediato — el link deja de funcionar en cuanto se usa una vez.
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
