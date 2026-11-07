import { useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import ConfirmDialog from '../ConfirmDialog.jsx';
import {
  LEAGUE_FILTERS, countFilters, leagueHasRequest, matchesSearch, sortLeagues,
} from '../../utils/adminPanel.js';
import { regionDeLiga } from '../../utils/leagueDisplay.js';
import {
  Band, FilterScoreboard, Identity, NoResults, RowMenu, SearchBox, SectionError, SectionLoading,
  Status, TableFooter, Verified, formatDate, useSectionFilter, useTableView,
} from './AdminKit.jsx';

export default function AdminLeaguesSection({ leagues, error, reload, token }) {
  const [modal, setModal] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState('');
  const [filter, setFilter] = useSectionFilter(LEAGUE_FILTERS, 'todas');

  const sorted = useMemo(() => sortLeagues(leagues ?? []), [leagues]);
  const active = LEAGUE_FILTERS.find((f) => f.key === filter);
  const view = useTableView((query) => sorted
    .filter(active.test)
    .filter((lg) => matchesSearch(query, [lg.name, lg.state, lg.owner_name, lg.owner_email])), filter);

  const rows = view.page.rows;
  // "Publicar" pide lugar; sin solicitudes a la vista, esa columna se lo regresa al
  // nombre.
  const showsRequest = rows.some(leagueHasRequest);

  async function run(league, action) {
    setBusyId(league.id);
    setActionError('');
    try {
      await action();
      await reload();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const togglePublic = (lg) => run(lg, () => (
    lg.is_public ? api.adminUnpublishLeague(lg.id, token) : api.adminPublishLeague(lg.id, token)
  ));
  const toggleVerified = (lg) => run(lg, () => (
    lg.is_verified ? api.adminUnverifyLeague(lg.id, token) : api.adminVerifyLeague(lg.id, token)
  ));

  return (
    <>
      <Band title="Ligas">
        <FilterScoreboard
          label="Filtrar ligas"
          filters={countFilters(LEAGUE_FILTERS, sorted)}
          active={filter}
          onChange={setFilter}
          loading={!leagues}
        />
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[error, actionError]} />

        {!leagues ? !error && <SectionLoading /> : (
          <>
            <div className="adm-toolbar">
              <SearchBox
                value={view.query}
                onChange={view.setQuery}
                placeholder="Buscar por liga, estado o responsable"
              />
            </div>

            {rows.length === 0 ? (
              <NoResults onClear={filter !== 'todas' || view.query ? () => { view.setQuery(''); setFilter('todas'); } : null}>
                {leagues.length === 0 ? 'Todavía no hay ligas registradas.' : 'Ninguna liga coincide con lo que buscas.'}
              </NoResults>
            ) : (
              <div className="adm-table-box">
                <div className="table-wrap">
                  <table className="data-table adm-table">
                    <caption className="adm-sr-only">Ligas registradas</caption>
                    <thead>
                      <tr>
                        <th>Liga</th>
                        <th className="adm-col-owner" style={{ width: '24%' }}>Responsable</th>
                        <th style={{ width: 176 }}>Estado</th>
                        <th className="adm-col-date" style={{ width: 108 }}>Alta</th>
                        <th className="col-actions" style={{ width: showsRequest ? 206 : 112 }}>
                          <span className="adm-sr-only">Acciones</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((lg) => (
                        <LeagueRow
                          key={lg.id}
                          league={lg}
                          busy={busyId === lg.id}
                          onTogglePublic={() => togglePublic(lg)}
                          onToggleVerified={() => toggleVerified(lg)}
                          onDecline={() => setModal({ type: 'decline', league: lg })}
                          onDelete={() => setModal({ type: 'delete', league: lg })}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <TableFooter view={view} noun={view.page.total === 1 ? 'liga' : 'ligas'} />
              </div>
            )}
          </>
        )}
      </div>

      {modal?.type === 'decline' && (
        <ConfirmDialog
          title="Rechazar solicitud de publicación"
          message={`${modal.league.name} seguirá sin aparecer en el sitio público, pero no se borra nada: su calendario y su configuración quedan intactos.`}
          detail="El dueño recibe el motivo en su bandeja y puede volver a solicitarlo cuando lo corrija."
          confirmLabel="Rechazar y avisar"
          reasonLabel="Motivo (lo va a leer el dueño de la liga)"
          reasonRequired
          onConfirm={async (reason) => {
            await api.adminDeclineLeaguePublish(modal.league.id, reason, token);
            await reload();
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.type === 'delete' && (
        <ConfirmDialog
          title="Eliminar liga"
          message={`¿Seguro que quieres eliminar ${modal.league.name} y todos sus datos? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar liga"
          danger
          onConfirm={async () => {
            await api.adminDeleteLeague(modal.league.id, token);
            await reload();
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

function LeagueRow({ league: lg, busy, onTogglePublic, onToggleVerified, onDecline, onDelete }) {
  const request = leagueHasRequest(lg);

  return (
    <tr className={[request && 'is-request', busy && 'is-busy'].filter(Boolean).join(' ') || undefined}>
      <td>
        <Identity
          name={lg.name}
          sub={regionDeLiga(lg) || 'Sin estado'}
          title={lg.state || undefined}
          logo={lg.logo_url}
        />
      </td>
      <td className="adm-col-owner">
        {lg.owner_name ? (
          <span className="adm-who-text">
            <span className="adm-who-name is-plain" title={lg.owner_name}>{lg.owner_name}</span>
            <span className="adm-who-sub" title={lg.owner_email}>{lg.owner_email}</span>
          </span>
        ) : <span className="adm-faint">Sin propietario</span>}
      </td>
      <td>
        <span className="adm-state">
          {request ? <Status tone="ask">Solicitó publicarse</Status>
            : lg.is_public ? <Status tone="on">Pública</Status>
              : <Status>Privada</Status>}
          <Verified on={lg.is_verified} />
        </span>
      </td>
      <td className="adm-col-date adm-faint">{formatDate(lg.created_at)}</td>
      <td className="col-actions">
        <div className="adm-row-actions">
          {request && (
            <button type="button" className="btn btn-accent btn-sm" disabled={busy} onClick={onTogglePublic}>
              {busy ? 'Un momento…' : 'Publicar'}
            </button>
          )}
          <a href={`/ligas/${lg.slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-ws btn-sm">
            Ver
          </a>
          <RowMenu
            label={`Más acciones de ${lg.name}`}
            disabled={busy}
            items={[
              // En una solicitud, publicar ya está a la vista en la fila. Rechazar va aquí:
              // abre un diálogo que pide el motivo, y no vale el lugar de un botón que le
              // quitaría al nombre de la liga la mitad de su columna en una laptop. Solo
              // tiene sentido ante una solicitud pendiente: rechazar una liga que nadie
              // pidió publicar no significa nada, y el backend lo rechaza con 400.
              request
                ? { label: 'Rechazar solicitud', onSelect: onDecline }
                : { label: lg.is_public ? 'Ocultar liga' : 'Publicar liga', onSelect: onTogglePublic },
              { label: lg.is_verified ? 'Quitar verificación' : 'Marcar verificada', onSelect: onToggleVerified },
              { divider: true, key: 'peligro' },
              { label: 'Eliminar liga', danger: true, onSelect: onDelete },
            ]}
          />
        </div>
      </td>
    </tr>
  );
}
