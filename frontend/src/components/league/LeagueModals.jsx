import { useState } from 'react';
import { api } from '../../api/client.js';
import Modal from '../Modal.jsx';
import TournamentForm from '../TournamentForm.jsx';
import CategoryForm from '../CategoryForm.jsx';
import TeamForm from '../TeamForm.jsx';
import VenueForm from '../VenueForm.jsx';
import EditLeagueForm from '../EditLeagueForm.jsx';
import MatchForm from '../MatchForm.jsx';
import ExcelImport from '../ExcelImport.jsx';
import InviteTeamModal from '../InviteTeamModal.jsx';
import BranchRosterModal from '../BranchRosterModal.jsx';
import MatchStatsModal from '../MatchStatsModal.jsx';
import CompetitionModelModal from '../CompetitionModelModal.jsx';
import { scopeOptions, currentScopeValue } from '../../utils/leaguePanel.js';

// Las ventanas del panel de una liga: crear, editar y borrar en cualquier nivel
// del árbol. Salieron tal cual de pages/LeagueStructurePanel.jsx cuando el panel
// se rehízo en secciones (2026-11-07): lo que cambió es dónde se abren, no lo que
// hacen. Cada una refresca el árbol al terminar (`onDone`).
//
// Sobre el lienzo del panel se ven con la piel oscura de components/admin/admin.css
// (`body:has(.adm) .modal`), igual que las del Panel Admin.

export default function LeagueModal({ modal, token, leagueId, league, leagueTimezone, teams, venues, onClose, onDone, onRefresh, onLeagueChanged }) {
  const { type } = modal;

  // Liga
  if (type === 'edit-league') {
    return (
      <Modal title="Editar liga" onClose={onClose}>
        <EditLeagueForm
          league={league || { id: Number(leagueId) }}
          onCancel={onClose}
          onSubmit={async (payload) => { await api.updateLeague(leagueId, payload, token); onLeagueChanged(); }}
        />
      </Modal>
    );
  }

  // Equipos de la liga
  if (type === 'add-team') {
    return (
      <Modal title="Nuevo equipo" onClose={onClose}>
        <TeamForm submitLabel="Crear equipo" onCancel={onClose}
          onSubmit={async (payload) => { await api.createTeam(leagueId, payload, token); onDone(); }} />
      </Modal>
    );
  }
  if (type === 'edit-team') {
    return (
      <Modal title="Editar equipo" onClose={onClose}>
        <TeamForm initial={modal.team} submitLabel="Guardar cambios" onCancel={onClose}
          onSubmit={async (payload) => { await api.updateTeam(modal.team.id, payload, token); onDone(); }} />
      </Modal>
    );
  }
  if (type === 'delete-team') {
    return (
      <TypeNameConfirmModal title={`Eliminar equipo "${modal.team.name}"`}
        body={`Esto borra ${modal.team.name} y, con él, su cuenta contigo: los cargos y pagos de tu cobranza con este equipo se van para siempre y no se pueden recuperar. Los partidos donde aparezca no se borran, pero pierden el escudo y el vínculo: queda solo el nombre en texto. Si lo que quieres es que deje de participar, no lo elimines — sácalo de tu liga o del torneo, y sus partidos jugados se conservan intactos.`}
        name={modal.team.name} confirmLabel="Eliminar equipo para siempre" onClose={onClose}
        onConfirm={async () => { await api.deleteTeam(modal.team.id, token); onDone(); }} />
    );
  }
  if (type === 'remove-team-owner') {
    return (
      <ConfirmModal title="Cancelar la entrega"
        body={`El link de entrega de ${modal.team.name} deja de funcionar. Si ya alguien lo reclamó no se puede deshacer: ese equipo ya se administra solo.`}
        confirmLabel="Cancelar entrega" onClose={onClose}
        onConfirm={async () => { await api.removeTeamOwner(modal.team.id, token); onDone(); }} />
    );
  }
  if (type === 'invite-team') {
    return <InviteTeamModal team={modal.team} token={token} onClose={onClose} onDone={onDone} />;
  }

  // Sedes
  if (type === 'add-venue') {
    return (
      <Modal title="Nueva sede" onClose={onClose}>
        <VenueForm submitLabel="Crear sede" onCancel={onClose}
          onSubmit={async (payload) => { await api.createVenue(leagueId, payload, token); onDone(); }} />
      </Modal>
    );
  }
  if (type === 'edit-venue') {
    return (
      <Modal title="Editar sede" onClose={onClose}>
        <VenueForm initial={modal.venue} submitLabel="Guardar cambios" onCancel={onClose}
          onSubmit={async (payload) => { await api.updateVenue(modal.venue.id, payload, token); onDone(); }} />
      </Modal>
    );
  }
  if (type === 'delete-venue') {
    return (
      <ConfirmModal title={`Eliminar sede "${modal.venue.name}"`}
        body="Los partidos que la usen se quedan sin sede, no se eliminan."
        confirmLabel="Eliminar sede" onClose={onClose}
        onConfirm={async () => { await api.deleteVenue(modal.venue.id, token); onDone(); }} />
    );
  }

  // Torneos
  if (type === 'add-tournament') {
    return (
      <Modal title="Nuevo torneo" onClose={onClose}>
        <TournamentForm submitLabel="Crear torneo" onCancel={onClose}
          onSubmit={async (data) => { await api.createTournament(leagueId, data, token); onDone(); }} />
      </Modal>
    );
  }
  if (type === 'rename-tournament') {
    return (
      <Modal title={`Editar torneo — ${modal.t.name}`} onClose={onClose}>
        <TournamentForm initial={modal.t} submitLabel="Guardar cambios" onCancel={onClose}
          onSubmit={async (data) => { await api.updateTournament(modal.t.id, data, token); onDone(); }} />
      </Modal>
    );
  }
  if (type === 'delete-tournament') {
    return (
      <TypeNameConfirmModal title={`Eliminar torneo "${modal.t.name}"`}
        body={`Esto borra el torneo ${modal.t.name} (${modal.t.year}) y, con él, todas sus categorías, ramas, conferencias, grupos y partidos — para siempre.`}
        name={modal.t.name} confirmLabel="Eliminar torneo para siempre" onClose={onClose}
        onConfirm={async () => { await api.deleteTournament(modal.t.id, token); onDone(); }} />
    );
  }

  // Categorías
  if (type === 'add-category') {
    return (
      <Modal title={`Nueva categoría — ${modal.t.name}`} onClose={onClose}>
        <CategoryForm submitLabel="Crear categoría" onCancel={onClose}
          onSubmit={async (data) => { await api.createCategoryForTournament(modal.t.id, data, token); onDone(); }} />
      </Modal>
    );
  }
  if (type === 'rename-category') {
    return (
      <Modal title={`Editar categoría — ${modal.c.name}`} onClose={onClose}>
        <CategoryForm initial={modal.c} submitLabel="Guardar cambios" onCancel={onClose}
          onSubmit={async (data) => { await api.updateCategory(modal.c.id, data, token); onDone(); }} />
      </Modal>
    );
  }
  if (type === 'delete-category') {
    return (
      <ConfirmModal title={`Eliminar categoría "${modal.c.name}"`}
        body="Esto borra la categoría y, con ella, todas sus ramas, conferencias, grupos y partidos. No se puede deshacer."
        confirmLabel="Eliminar categoría" onClose={onClose}
        onConfirm={async () => { await api.deleteCategory(modal.c.id, token); onDone(); }} />
    );
  }

  // Ramas
  if (type === 'add-branch') {
    return <BranchAddModal onClose={onClose}
      onSubmit={async (name) => { await api.createBranch(modal.c.id, { name }, token); onDone(); }} />;
  }
  if (type === 'rename-branch') {
    return <PromptModal title={`Renombrar rama — ${modal.b.name}`} label="Nombre de la rama" initial={modal.b.name}
      submitLabel="Guardar" onClose={onClose}
      onSubmit={async (name) => { await api.updateBranch(modal.b.id, { name }, token); onDone(); }} />;
  }
  if (type === 'delete-branch') {
    return (
      <TypeNameConfirmModal title={`Eliminar rama "${modal.b.name}"`}
        body="Esto borra la rama y, con ella, todas sus conferencias, grupos y partidos — para siempre."
        name={modal.b.name} confirmLabel="Eliminar rama para siempre" onClose={onClose}
        onConfirm={async () => { await api.deleteBranch(modal.b.id, token); onDone(); }} />
    );
  }

  if (type === 'competition-model') {
    return <CompetitionModelModal branch={modal.b} token={token} onClose={onClose} />;
  }

  // Conferencias
  if (type === 'add-conference') {
    return <PromptModal title={`Nueva conferencia — ${modal.b.name}`} label="Nombre de la conferencia"
      placeholder="Ej. Conferencia Norte" submitLabel="Agregar" onClose={onClose}
      onSubmit={async (name) => { await api.createConference(modal.b.id, { name }, token); onDone(); }} />;
  }
  if (type === 'rename-conference') {
    return <PromptModal title={`Renombrar conferencia — ${modal.cf.name}`} label="Nombre de la conferencia"
      initial={modal.cf.name} submitLabel="Guardar" onClose={onClose}
      onSubmit={async (name) => { await api.updateConference(modal.cf.id, { name }, token); onDone(); }} />;
  }
  if (type === 'delete-conference') {
    return (
      <ConfirmModal title={`Eliminar conferencia "${modal.cf.name}"`}
        body="Esto borra la conferencia y sus grupos. Los partidos que apunten a ella quedan sin conferencia, no se eliminan."
        confirmLabel="Eliminar conferencia" onClose={onClose}
        onConfirm={async () => { await api.deleteConference(modal.cf.id, token); onDone(); }} />
    );
  }

  // Grupos
  if (type === 'add-branch-group') {
    return <PromptModal title={`Nuevo grupo — ${modal.b.name}`} label="Nombre del grupo" placeholder="Ej. Grupo A"
      submitLabel="Agregar" onClose={onClose}
      onSubmit={async (name) => { await api.createBranchGroup(modal.b.id, { name }, token); onDone(); }} />;
  }
  if (type === 'add-conf-group') {
    return <PromptModal title={`Nuevo grupo — ${modal.cf.name}`} label="Nombre del grupo" placeholder="Ej. Grupo A"
      submitLabel="Agregar" onClose={onClose}
      onSubmit={async (name) => { await api.createTestGroup(modal.cf.id, { name }, token); onDone(); }} />;
  }
  if (type === 'rename-group') {
    return <PromptModal title={`Renombrar grupo — ${modal.g.name}`} label="Nombre del grupo" initial={modal.g.name}
      submitLabel="Guardar" onClose={onClose}
      onSubmit={async (name) => { await api.updateGroup(modal.g.id, { name }, token); onDone(); }} />;
  }
  if (type === 'delete-group') {
    return (
      <ConfirmModal title={`Eliminar grupo "${modal.g.name}"`}
        body="Los partidos que tengan este grupo asignado se quedan sin grupo, no se eliminan."
        confirmLabel="Eliminar grupo" onClose={onClose}
        onConfirm={async () => { await api.deleteGroup(modal.g.id, token); onDone(); }} />
    );
  }

  // Equipos de la rama
  if (type === 'enroll-team') {
    const teamName = teams.find((x) => String(x.id) === String(modal.teamId))?.name || 'el equipo';
    return (
      <TeamScopeModal
        title={`Inscribir "${teamName}" a la rama`}
        branch={modal.b}
        team={null}
        submitLabel="Inscribir"
        onClose={onClose}
        onSubmit={async (scope) => { await api.enrollTeamInBranch(modal.b.id, modal.teamId, token, scope); onDone(); }}
      />
    );
  }
  if (type === 'team-scope') {
    return (
      <TeamScopeModal
        title={`Conferencia de "${modal.team.name}"`}
        branch={modal.b}
        team={modal.team}
        submitLabel="Guardar"
        onClose={onClose}
        onSubmit={async (scope) => { await api.updateBranchTeamScope(modal.b.id, modal.team.id, scope, token); onDone(); }}
      />
    );
  }
  if (type === 'unenroll-team') {
    return (
      <ConfirmModal title={`Quitar "${modal.team.name}" de la rama`}
        body="El equipo deja de estar inscrito en esta rama. Su roster de esta rama se elimina; sus partidos no."
        confirmLabel="Quitar de la rama" onClose={onClose}
        onConfirm={async () => { await api.removeTeamFromBranch(modal.b.id, modal.team.id, token); onDone(); }} />
    );
  }
  if (type === 'branch-roster') {
    return <BranchRosterModal branchId={modal.b.id} team={modal.team} token={token} onClose={onClose} />;
  }

  // Partidos
  if (type === 'add-match' || type === 'edit-match') {
    const isEdit = type === 'edit-match';
    return (
      <Modal title={isEdit ? 'Editar partido' : `Nuevo partido — ${modal.b.name}`} onClose={onClose}>
        <MatchForm
          initial={isEdit ? modal.match : undefined}
          submitLabel={isEdit ? 'Guardar cambios' : 'Crear partido'}
          teams={teams}
          venues={venues}
          groups={[]}
          conferences={modal.b.conferences}
          // Los equipos inscritos en ESTA rama, cada uno con su conferencia.
          // Es de donde el formulario deduce la conferencia del partido en vez
          // de pedir que se elija a mano.
          branchTeams={modal.b.teams || []}
          // Las fases de esta rama, para poder decir en cuál va el partido.
          // Si la rama no tiene fases creadas, el campo ni aparece.
          phases={modal.b.phases || []}
          leagueTimezone={leagueTimezone}
          token={token}
          leagueId={leagueId}
          categoryId={modal.c.id}
          onVenueCreated={onRefresh}
          onTeamCreated={onRefresh}
          onGroupCreated={onRefresh}
          onCancel={onClose}
          onSubmit={async (payload) => {
            if (isEdit) await api.updateMatch(modal.match.id, { ...payload, branch_id: modal.b.id }, token);
            else await api.createMatch(modal.c.id, { ...payload, branch_id: modal.b.id }, token);
            onDone();
          }}
        />
      </Modal>
    );
  }
  if (type === 'delete-match') {
    return (
      <ConfirmModal title="Eliminar partido"
        body={`¿Eliminar ${modal.match.home_team} vs ${modal.match.away_team}?`}
        confirmLabel="Eliminar partido" onClose={onClose}
        onConfirm={async () => { await api.deleteMatch(modal.match.id, token); onDone(); }} />
    );
  }
  if (type === 'match-stats') {
    return <MatchStatsModal match={modal.match} token={token} onClose={onClose} />;
  }
  if (type === 'import-matches') {
    const branchGroups = [
      ...modal.b.directGroups,
      ...modal.b.conferences.flatMap((cf) => cf.groups),
    ];
    return (
      <Modal title={`Subir calendario — ${modal.c.name} / ${modal.b.name}`} onClose={onClose}>
        <ExcelImport
          categoryId={modal.c.id}
          branchId={modal.b.id}
          categoryName={`${modal.c.name}_${modal.b.name}`}
          teams={teams}
          venues={venues}
          groups={branchGroups}
          onCancel={onClose}
          onDone={onDone}
        />
      </Modal>
    );
  }

  return null;
}

function PromptModal({ title, label, placeholder, initial, submitLabel, onClose, onSubmit }) {
  const [value, setValue] = useState(initial || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true); setError('');
    try { await onSubmit(value.trim()); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        {error && <div className="form-error">{error}</div>}
        <div className="field">
          <label>{label}</label>
          <input type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} autoFocus />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-flag" disabled={busy || !value.trim()}>{busy ? 'Guardando…' : submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

const BRANCH_OPTIONS = ['Varonil', 'Femenil', 'Mixto'];
function BranchAddModal({ onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create(value) {
    if (!value.trim()) return;
    setBusy(true); setError('');
    try { await onSubmit(value.trim()); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <Modal title="Nueva rama" onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      <div className="field">
        <label>Rama</label>
        <div className="pill-group">
          {BRANCH_OPTIONS.map((b) => (
            <button key={b} type="button" className="pill-btn" disabled={busy} onClick={() => create(b)}>+ {b}</button>
          ))}
        </div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); create(name); }}>
        <div className="field">
          <label>…o un nombre distinto</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Juvenil A" />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-flag" disabled={busy || !name.trim()}>{busy ? 'Guardando…' : 'Agregar rama'}</button>
        </div>
      </form>
    </Modal>
  );
}

// Dice a qué conferencia (o grupo) pertenece un equipo dentro de una rama.
// Sirve para las dos puertas de entrada: al inscribirlo por primera vez y al
// corregirlo después. Es UNA decisión por equipo, y de ella cuelgan todos sus
// partidos — el aviso de abajo lo deja explícito porque cambiarla aquí mueve
// el calendario entero de ese equipo, no un partido suelto.
function TeamScopeModal({ title, branch, team, submitLabel, onClose, onSubmit }) {
  const opciones = scopeOptions(branch);
  const [value, setValue] = useState(team ? currentScopeValue(team) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    const elegida = opciones.find((o) => o.value === value);
    setBusy(true); setError('');
    try {
      await onSubmit({
        conference_id: elegida ? elegida.conference_id : null,
        group_id:      elegida ? elegida.group_id      : null,
      });
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        {error && <div className="form-error">{error}</div>}
        {opciones.length === 0 ? (
          <p style={{ color: 'var(--ink-dim)', fontSize: 14 }}>
            Esta rama no se divide en conferencias ni grupos, así que no hay nada que elegir.
            {team ? '' : ' El equipo queda inscrito y puedes capturarle su roster.'}
          </p>
        ) : (
          <div className="field">
            <label>Conferencia o grupo</label>
            <select value={value} onChange={(e) => setValue(e.target.value)} autoFocus>
              <option value="">— Sin conferencia —</option>
              {opciones.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 6 }}>
              Se dice una sola vez, aquí. Todos los partidos de este equipo toman su
              conferencia de este dato, así que ya no hay que elegirla en cada juego.
              Si lo cambias, sus partidos se reacomodan solos.
            </div>
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-flag" disabled={busy}>{busy ? 'Guardando…' : submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmModal({ title, body, confirmLabel, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true); setError('');
    try { await onConfirm(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <Modal title={title} onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      <p style={{ color: 'var(--ink-dim)', fontSize: 14 }}>{body}</p>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={go}>{busy ? 'Aplicando…' : confirmLabel}</button>
      </div>
    </Modal>
  );
}

function TypeNameConfirmModal({ title, body, name, confirmLabel, onClose, onConfirm }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true); setError('');
    try { await onConfirm(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <Modal title={title} onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      <p style={{ color: 'var(--ink-dim)', fontSize: 14, marginBottom: 16 }}>{body}</p>
      <div className="field">
        <label>Escribe <strong>{name}</strong> para confirmar</label>
        <input type="text" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-danger" disabled={busy || value !== name} onClick={go}>
          {busy ? 'Eliminando…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
