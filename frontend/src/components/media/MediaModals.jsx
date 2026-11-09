import { useState } from 'react';
import { api } from '../../api/client.js';
import Modal from '../Modal.jsx';
import ConfirmDialog from '../ConfirmDialog.jsx';
import OrganizationProfileForm from '../OrganizationProfileForm.jsx';
import { MatchWhen } from '../league/LeagueMatchBits.jsx';
import { hasLink, linkPayload, validateLink } from '../../utils/mediaPanel.js';
import { MediaMatch } from './MediaBits.jsx';

// Las ventanas del panel de un medio. Sobre el lienzo se ven con la piel oscura
// de admin.css (`body:has(.adm) .modal`), y league.css les pasa sus tokens verdes
// a los del lienzo (`body:has(.lws) .modal`), como en el panel de una tienda.
//
// modal: { type: 'link', match, broadcast? } | { type: 'remove', broadcast } | { type: 'profile' }
export default function MediaModal({ modal, media, org, token, onClose, onBroadcastsChanged, onProfileSaved }) {
  if (modal.type === 'link') {
    return (
      <LinkModal
        mediaId={media.id}
        match={modal.match}
        broadcast={modal.broadcast}
        token={token}
        onClose={onClose}
        onSaved={async () => { await onBroadcastsChanged(); onClose(); }}
      />
    );
  }

  if (modal.type === 'remove') {
    const b = modal.broadcast;
    return (
      <ConfirmDialog
        title="Dejar de transmitir"
        message={`¿Dejar de transmitir ${b.home_team} contra ${b.away_team}?`}
        warning="Tu logo sale de «También transmiten», en la página del partido. Si fue un error, puedes volver a sumarte desde Partidos o desde la página del partido."
        confirmLabel="Dejar de transmitir"
        danger
        onClose={onClose}
        onConfirm={async () => {
          await api.deleteBroadcast(b.id, token);
          await onBroadcastsChanged();
          onClose();
        }}
      />
    );
  }

  if (modal.type === 'profile') {
    return (
      <Modal title="Editar perfil" onClose={onClose}>
        <OrganizationProfileForm
          org={org}
          token={token}
          onCancel={onClose}
          onSaved={async (saved) => { onProfileSaved(saved); onClose(); }}
        />
      </Modal>
    );
  }

  return null;
}

// Sumarse a un partido, o cambiarle el link al que ya transmite. Es la misma
// petición en los dos casos (POST /broadcasts): la pareja partido-medio es
// única, así que volver a mandarla edita el link y no le vuelve a avisar a la
// liga (README, "El aviso a la liga sale una sola vez").
function LinkModal({ mediaId, match, broadcast, token, onClose, onSaved }) {
  const joining = !broadcast;
  const [url, setUrl] = useState(() => (broadcast && hasLink(broadcast) ? broadcast.url.trim() : ''));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const problem = validateLink(url);
    if (problem) { setError(problem); return; }

    setSaving(true);
    setError('');
    try {
      await api.createBroadcast({ match_id: match.match_id, organization_id: mediaId, url: linkPayload(url) }, token);
      await onSaved();
    } catch (err) {
      setError(err.offline ? 'Sin conexión: inténtalo cuando vuelva la señal.' : err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title={joining ? 'Transmitir este partido' : 'Link de tu transmisión'} onClose={onClose}>
      <form className="mws-link-form" onSubmit={handleSubmit} noValidate>
        <div className="mws-link-match">
          <span className="mws-link-match-teams"><MediaMatch match={match} /></span>
          <MatchWhen match={match} />
        </div>

        <div className="field">
          <label htmlFor="mws-link-url">Link de tu transmisión</label>
          <input
            id="mws-link-url"
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtube.com/live/…"
            autoFocus
          />
        </div>
        <p className="mws-field-hint">
          {joining
            ? 'Es opcional: puedes ponerlo después. Con link, tu logo en «También transmiten» abre tu transmisión; sin link, abre tu ficha.'
            : 'Tu logo en «También transmiten» abre este link. Si lo dejas vacío, abre tu ficha.'}
        </p>

        {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="btn btn-flag" disabled={saving}>
            {saving ? 'Guardando…' : joining ? 'Transmitir' : 'Guardar link'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
