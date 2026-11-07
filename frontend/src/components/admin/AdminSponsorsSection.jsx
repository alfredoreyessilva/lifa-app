import { useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import Modal from '../Modal.jsx';
import ConfirmDialog from '../ConfirmDialog.jsx';
import { clickRate, formatNumber, sponsorTotals } from '../../utils/adminPanel.js';
import { Band, ScoreCell, Scoreboard, SectionError, SectionLoading } from './AdminKit.jsx';
import { IconPlus } from './AdminIcons.jsx';

// La barra lateral del sitio tiene cuatro lugares, y la pantalla se dibuja igual: un
// lugar por patrocinador, con su alcance adentro. El alcance estaba en otra pestaña,
// lejos del logo al que se refiere.
const SLOTS = 4;

const formatRate = (rate) => (rate === null ? '—' : `${rate.toFixed(1)} %`);

export default function AdminSponsorsSection({ sponsors, stats, error, reload, token }) {
  const [modal, setModal] = useState(null);

  const list = sponsors ?? [];
  const reach = new Map((stats?.sponsors ?? []).map((s) => [s.id, s]));
  const totals = sponsorTotals(stats?.sponsors ?? []);
  const free = Math.max(0, SLOTS - list.length);

  return (
    <>
      <Band title="Patrocinadores">
        <Scoreboard label="Alcance de los patrocinadores">
          <ScoreCell label="Lugares ocupados" value={`${list.length} de ${SLOTS}`} loading={!sponsors} />
          <ScoreCell label="Impresiones" value={formatNumber(totals.impressions)} loading={!stats} />
          <ScoreCell label="Clics" value={formatNumber(totals.clicks)} loading={!stats} />
          <ScoreCell label="CTR" value={formatRate(totals.rate)} loading={!stats} />
        </Scoreboard>
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[error]} />

        {!sponsors ? !error && <SectionLoading /> : (
          <>
          <div className="adm-slots">
            {list.map((sponsor) => (
              <SponsorSlot
                key={sponsor.id}
                sponsor={sponsor}
                reach={reach.get(sponsor.id)}
                onEdit={() => setModal({ type: 'edit', sponsor })}
                onDelete={() => setModal({ type: 'delete', sponsor })}
              />
            ))}
            {Array.from({ length: free }, (_, index) => (
              <button
                key={index}
                type="button"
                className="adm-slot is-free"
                onClick={() => setModal({ type: 'add' })}
              >
                <IconPlus />
                Agregar patrocinador
              </button>
            ))}
          </div>
          <p className="adm-note">Los logos salen en la barra lateral del sitio, a la vista de todo el que entra.</p>
          </>
        )}
      </div>

      {modal?.type === 'add' && (
        <Modal title="Nuevo patrocinador" onClose={() => setModal(null)}>
          <SponsorForm
            submitLabel="Agregar"
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.adminCreateSponsor(payload, token);
              await reload();
              setModal(null);
            }}
          />
        </Modal>
      )}

      {modal?.type === 'edit' && (
        <Modal title="Editar patrocinador" onClose={() => setModal(null)}>
          <SponsorForm
            initial={modal.sponsor}
            submitLabel="Guardar"
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              await api.adminUpdateSponsor(modal.sponsor.id, payload, token);
              await reload();
              setModal(null);
            }}
          />
        </Modal>
      )}

      {modal?.type === 'delete' && (
        <ConfirmDialog
          title="Eliminar patrocinador"
          message={`¿Seguro que quieres eliminar ${modal.sponsor.name ? `a ${modal.sponsor.name}` : 'este patrocinador'}?`}
          confirmLabel="Eliminar"
          danger
          onConfirm={async () => {
            await api.adminDeleteSponsor(modal.sponsor.id, token);
            await reload();
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

function SponsorSlot({ sponsor, reach, onEdit, onDelete }) {
  return (
    <article className="adm-slot">
      <div className="adm-slot-logo">
        <img src={sponsor.logo_url} alt={sponsor.name || 'Patrocinador'} />
      </div>
      <div className="adm-slot-body">
        <h2 title={sponsor.name || undefined}>{sponsor.name || 'Sin nombre'}</h2>
        {sponsor.link_url
          ? <a className="adm-slot-link" href={sponsor.link_url} target="_blank" rel="noopener noreferrer" title={sponsor.link_url}>{sponsor.link_url}</a>
          : <span className="adm-slot-link adm-faint">Sin enlace</span>}
      </div>
      <dl className="adm-facts">
        <div><dt>Impresiones</dt><dd>{formatNumber(reach?.impressions)}</dd></div>
        <div><dt>Clics</dt><dd>{formatNumber(reach?.clicks)}</dd></div>
        <div><dt>CTR</dt><dd>{formatRate(clickRate(reach?.impressions, reach?.clicks))}</dd></div>
      </dl>
      <div className="adm-slot-actions">
        <button type="button" className="btn btn-ws btn-sm" onClick={onEdit}>Editar</button>
        <button type="button" className="btn btn-ghost btn-sm adm-danger-text" onClick={onDelete}>Eliminar</button>
      </div>
    </article>
  );
}

function SponsorForm({ initial, onSubmit, onCancel, submitLabel }) {
  const { token } = useAuth();
  const fileRef = useRef(null);
  const [form, setForm] = useState({ name: initial?.name || '', logo_url: initial?.logo_url || '', link_url: initial?.link_url || '' });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await api.uploadImage(file, token);
      setForm((f) => ({ ...f, logo_url: url.startsWith('http') ? url : `${import.meta.env.VITE_API_URL || ''}${url}` }));
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.logo_url) { setError('El logo es obligatorio'); return; }
    setError('');
    setLoading(true);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}

      <div className="field">
        <label>Nombre del patrocinador (opcional)</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Coca-Cola" />
      </div>

      <div className="field">
        <label>Logo</label>
        <div className="adm-logo-field">
          {form.logo_url && (
            <div className="adm-slot-logo is-small">
              <img src={form.logo_url} alt="Vista previa del logo" />
            </div>
          )}
          <input type="file" accept="image/*" ref={fileRef} onChange={handleFile} style={{ display: 'none' }} />
          <button type="button" className="btn btn-ws btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? 'Subiendo…' : 'Subir logo'}
          </button>
          {form.logo_url && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ ...form, logo_url: '' })}>Quitar</button>
          )}
        </div>
        <input
          type="text"
          placeholder="o pega URL: https://…"
          value={form.logo_url}
          onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
          style={{ marginTop: 8 }}
        />
      </div>

      <div className="field">
        <label>Enlace (opcional)</label>
        <input type="url" value={form.link_url} onChange={(e) => setForm({ ...form, link_url: e.target.value })} placeholder="https://…" />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-accent" disabled={loading}>{loading ? 'Guardando…' : submitLabel}</button>
      </div>
    </form>
  );
}
