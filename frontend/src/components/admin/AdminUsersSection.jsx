import { useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import ConfirmDialog from '../ConfirmDialog.jsx';
import { countFilters, formatNumber, matchesSearch, toNumber, userFilters } from '../../utils/adminPanel.js';
import {
  Band, FilterScoreboard, Identity, NoResults, RowMenu, SearchBox, SectionError, SectionLoading,
  Status, TableFooter, formatDate, useSectionFilter, useTableView,
} from './AdminKit.jsx';

export default function AdminUsersSection({ users, error, reload, token }) {
  const { user: me } = useAuth();
  const [modal, setModal] = useState(null);

  const filters = useMemo(() => userFilters(), []);
  const [filter, setFilter] = useSectionFilter(filters, 'todos');

  const list = users ?? [];
  const active = filters.find((f) => f.key === filter);
  const view = useTableView((query) => list
    .filter(active.test)
    .filter((u) => matchesSearch(query, [u.name, u.email])), filter);

  const rows = view.page.rows;

  return (
    <>
      <Band title="Usuarios">
        <FilterScoreboard
          label="Filtrar usuarios"
          filters={countFilters(filters, list)}
          active={filter}
          onChange={setFilter}
          loading={!users}
        />
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[error]} />

        {!users ? !error && <SectionLoading /> : (
          <>
            <div className="adm-toolbar">
              <SearchBox value={view.query} onChange={view.setQuery} placeholder="Buscar por nombre o correo" />
            </div>

            {rows.length === 0 ? (
              <NoResults onClear={filter !== 'todos' || view.query ? () => { view.setQuery(''); setFilter('todos'); } : null}>
                {list.length === 0 ? 'Todavía no hay usuarios registrados.' : 'Ningún usuario coincide con lo que buscas.'}
              </NoResults>
            ) : (
              <div className="adm-table-box">
                <div className="table-wrap">
                  <table className="data-table adm-table adm-users-table">
                    <caption className="adm-sr-only">Usuarios registrados</caption>
                    <thead>
                      <tr>
                        <th>Usuario</th>
                        <th className="adm-col-owner" style={{ width: '32%' }}>Correo</th>
                        <th style={{ width: 140 }}>Rol</th>
                        <th className="col-num" style={{ width: 76 }}>Ligas</th>
                        <th className="adm-col-date" style={{ width: 108 }}>Alta</th>
                        <th className="col-actions" style={{ width: 64 }}>
                          <span className="adm-sr-only">Acciones</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((u) => (
                        <tr key={u.id}>
                          <td><Identity name={u.name} sub={u.email} round /></td>
                          <td className="adm-col-owner adm-cell-clip" title={u.email}>{u.email}</td>
                          <td>
                            {u.role === 'admin' ? <Status tone="on">Administrador</Status> : <span className="adm-faint">Usuario</span>}
                          </td>
                          <td className="col-num adm-num">{formatNumber(u.league_count)}</td>
                          <td className="adm-col-date adm-faint">{formatDate(u.created_at)}</td>
                          <td className="col-actions">
                            {u.role !== 'admin' && u.id !== me?.id && (
                              <div className="adm-row-actions">
                                <RowMenu
                                  label={`Más acciones de ${u.name}`}
                                  items={[{
                                    label: 'Eliminar usuario',
                                    danger: true,
                                    onSelect: () => setModal({ type: 'delete', user: u }),
                                  }]}
                                />
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TableFooter view={view} noun={view.page.total === 1 ? 'usuario' : 'usuarios'} />
              </div>
            )}
          </>
        )}
      </div>

      {modal?.type === 'delete' && (
        <ConfirmDialog
          title="Eliminar usuario"
          message={`¿Seguro que quieres eliminar a ${modal.user.name} (${modal.user.email})? Se eliminarán también ${toNumber(modal.user.league_count) === 1 ? 'su liga' : 'sus ligas'} y todos sus datos.`}
          confirmLabel="Eliminar usuario"
          danger
          onConfirm={async () => {
            await api.adminDeleteUser(modal.user.id, token);
            await reload();
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
