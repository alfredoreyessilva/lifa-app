import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import Loading from './Loading.jsx';
import Modal from './Modal.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import BranchRosterModal from './BranchRosterModal.jsx';
import ClubMemberForm from './ClubMemberForm.jsx';
import ImportRosterModal from './ImportRosterModal.jsx';
import { money } from '../utils/money.js';

// Jugadores del club. Son DOS padrones distintos y la pantalla lo dice con
// todas sus letras, porque confundirlos fue el error de la primera versión:
//
//   Padrón del club  → la gente que entrena aquí y a la que el club le cobra.
//                      Lo arma el club. Existe aunque el equipo no esté en
//                      ninguna liga ni inscrito en ningún torneo.
//   Roster de torneo → quién puede jugar en qué rama. Lo arma la liga al
//                      inscribir al equipo, y sirve para elegibilidad.
//
// No se sincronizan: dar de alta a alguien en uno no lo da de alta en el otro.
// Lo único que los cruza es un botón de importar, que COPIA nombres una vez
// para no teclearlos dos veces, y ahí se acaba la relación.
export default function TeamRosterSection({ team, token }) {
  const [data, setData] = useState(null);
  const [branches, setBranches] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [openBranch, setOpenBranch] = useState(null);

  useEffect(() => { loadMembers(); loadBranches(); }, [team.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  function loadMembers() {
    setError('');
    return api.getPlayerBillingOverview(team.id, token)
      .then(setData)
      .catch((e) => setError(e.message));
  }

  // Un equipo independiente no tiene liga que lo inscriba en ramas, así que ni
  // se pregunta — y si la consulta falla por lo que sea, el padrón del club
  // tiene que seguir funcionando igual.
  function loadBranches() {
    if (!team.league_id) { setBranches([]); return Promise.resolve(); }
    return api.getTeamBranches(team.id, token)
      .then((d) => setBranches(d.branches))
      .catch(() => setBranches([]));
  }

  async function afterChange() {
    setModal(null);
    setConfirm(null);
    await loadMembers();
  }

  if (error && !data) return <div className="form-error">{error}</div>;
  if (!data) return <Loading />;

  const members = data.players;
  const active = members.filter((m) => m.status !== 'baja');
  const withoutFee = active.filter((m) => m.monthly_amount == null).length;

  return (
    <div>
      {error && <div className="form-error">{error}</div>}

      <div className="stat-strip">
        <div className="stat-tile">
          <div className="stat-tile-label">En el padrón</div>
          <div className="stat-tile-value is-accent">{active.length}</div>
          <div className="stat-tile-sub">
            {members.length - active.length > 0 ? `${members.length - active.length} de baja` : 'sin bajas'}
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-label">Sin cuota definida</div>
          <div className={`stat-tile-value ${withoutFee > 0 ? 'is-owed' : 'is-zero'}`}>{withoutFee}</div>
          <div className="stat-tile-sub">no entran en el cobro del mes</div>
        </div>
      </div>

      <div className="ws-toolbar">
        <button className="btn btn-accent" onClick={() => setModal({ type: 'member' })}>
          + Agregar jugador
        </button>
        {branches && branches.length > 0 && (
          <button className="btn btn-ws" onClick={() => setModal({ type: 'import' })}>
            Importar de un roster de torneo
          </button>
        )}
      </div>

      {members.length === 0 ? (
        <div className="empty-teach">
          <div className="empty-teach-icon">🏈</div>
          <h3>Arma el padrón de tu club</h3>
          <p>
            Da de alta a la gente que entrena contigo. No necesitas estar en una liga ni
            inscrito en ningún torneo: en cuanto tengas a alguien aquí con su cuota, ya le
            puedes cobrar desde Finanzas y mandarle su estado de cuenta.
          </p>
          <button className="btn btn-accent" onClick={() => setModal({ type: 'member' })}>
            Agregar al primer jugador
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Jugador</th>
                <th>Categoría</th>
                <th>Cuota</th>
                <th>Responsable de pago</th>
                <th>Situación</th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.player_id} className={m.status === 'baja' ? 'row-muted' : ''}>
                  <td>
                    <div className="cell-player">
                      {m.photo_url && <img src={m.photo_url} alt="" />}
                      <div style={{ minWidth: 0 }}>
                        <div className="cell-player-name">
                          {m.first_name} {m.last_name}
                          {m.jersey_number != null && (
                            <span style={{ color: 'var(--ws-ink-faint)' }}> #{m.jersey_number}</span>
                          )}
                        </div>
                        {m.position && <div className="cell-player-sub">{m.position}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={{ color: 'var(--ws-ink-faint)', fontSize: 12 }}>{m.group_label || '—'}</td>
                  <td>
                    {m.monthly_amount != null
                      ? <span className="money is-zero">{money(m.monthly_amount)}</span>
                      : <span className="pill is-owed">falta cuota</span>}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {m.tutor_name || m.tutor_phone
                      ? <>{m.tutor_name || 'Sin nombre'}{m.tutor_phone ? <span style={{ color: 'var(--ws-ink-faint)' }}> · {m.tutor_phone}</span> : ''}</>
                      : <span className="pill is-muted">sin WhatsApp</span>}
                  </td>
                  <td>
                    {m.status === 'activo' && <span className="pill is-ok">Activo</span>}
                    {m.status === 'beca' && <span className="pill is-info">Becado</span>}
                    {m.status === 'baja' && <span className="pill is-muted">Baja</span>}
                  </td>
                  <td className="col-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'member', member: m })}>
                      Editar
                    </button>
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
                      onClick={() => setConfirm(m)}>
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="ws-section-title">Rosters de torneo</div>
      <TournamentRosters team={team} branches={branches} onOpen={setOpenBranch} />

      {modal?.type === 'member' && (
        <Modal
          title={modal.member ? `Editar — ${modal.member.first_name} ${modal.member.last_name}` : 'Agregar jugador al padrón'}
          onClose={() => setModal(null)}
        >
          <ClubMemberForm
            member={modal.member}
            statuses={data.account_statuses}
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              if (modal.member) {
                await api.updatePlayerAccount(team.id, modal.member.player_id, payload, token);
              } else {
                await api.addTeamMember(team.id, payload, token);
              }
              await afterChange();
            }}
          />
        </Modal>
      )}

      {modal?.type === 'import' && (
        <Modal title="Importar de un roster de torneo" onClose={() => setModal(null)}>
          <ImportRosterModal
            branches={branches || []}
            onCancel={() => setModal(null)}
            onSubmit={async (payload) => {
              const r = await api.importRosterToMembers(team.id, payload, token);
              await afterChange();
              return r;
            }}
          />
        </Modal>
      )}

      {confirm && (
        <ConfirmDialog
          title="Quitar del padrón"
          message={`${confirm.first_name} ${confirm.last_name} deja de aparecer en el cobro del mes.`}
          warning={
            'Si ya tiene cargos o pagos registrados no se borra: se le da de baja y su historial '
            + 'se conserva completo. Solo se elimina de verdad si nunca tuvo un movimiento.'
          }
          confirmLabel="Quitar"
          cancelLabel="Mejor no"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await api.removeTeamMember(team.id, confirm.player_id, token);
            await afterChange();
          }}
        />
      )}

      {openBranch && (
        <BranchRosterModal
          branchId={openBranch.branch_id}
          team={team}
          token={token}
          onClose={() => { setOpenBranch(null); loadBranches(); }}
        />
      )}
    </div>
  );
}

// El otro padrón: quién está inscrito en qué rama para poder jugar. Lo arma la
// liga; el club lo administra pero no lo crea, y lo que pase aquí no afecta en
// nada a su cobranza.
function TournamentRosters({ team, branches, onOpen }) {
  if (!team.league_id) {
    return (
      <p style={{ color: 'var(--ws-ink-faint)', fontSize: 13 }}>
        Tu equipo es independiente, así que no participa en ninguna rama todavía. Cuando
        entres a una liga, aquí vas a administrar quién está inscrito para jugar — aparte de
        tu padrón, que se queda tal cual.
      </p>
    );
  }

  if (!branches) return <Loading />;

  if (branches.length === 0) {
    return (
      <p style={{ color: 'var(--ws-ink-faint)', fontSize: 13 }}>
        Tu liga todavía no te inscribe en ninguna rama. Cuando lo haga, aquí vas a poder subir
        el roster con el que juegan (incluida la plantilla de Excel). Tu padrón y tu cobranza
        no dependen de esto.
      </p>
    );
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Torneo</th>
            <th>Categoría</th>
            <th>Rama</th>
            <th className="col-num">Inscritos</th>
            <th className="col-actions"></th>
          </tr>
        </thead>
        <tbody>
          {branches.map((b) => (
            <tr key={b.branch_id}>
              <td>{b.tournament_name || '—'}{b.tournament_year ? ` ${b.tournament_year}` : ''}</td>
              <td>{b.category_name}</td>
              <td>{b.branch_name}</td>
              <td className="col-num"><span className="money">{b.roster_count}</span></td>
              <td className="col-actions">
                <button className="btn btn-ws btn-sm" onClick={() => onOpen(b)}>Ver roster</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
