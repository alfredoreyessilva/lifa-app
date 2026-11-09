import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import NotificationCard from '../NotificationCard.jsx';
import { countFilters, formatNumber, matchesSearch, pluralize } from '../../utils/adminPanel.js';
import {
  NOTIFICATION_FILTERS, channelStates, groupNotifications, notificationAudience, notificationMeta,
  notificationPreview, notificationReaders, notificationSearchFields, notificationText, notificationVariants,
  reachLabel, recipientsLabel,
} from '../../utils/adminNotifications.js';
import {
  Band, FilterScoreboard, NoResults, SearchBox, SectionError, SectionLoading, Status, formatDate, useSectionFilter,
} from './AdminKit.jsx';

// El catálogo de todo lo que la app avisa (README, "Notificaciones: todo lo que la
// app avisa"). No es una bandeja: es para ver qué avisos existen antes de crear
// otro, y cuánto sale cada uno. Lo escrito a mano llega del backend
// (utils/catalogoDeAvisos.js); quién lo ve, cuántos salieron y si cada canal está
// encendido salen de los datos.

const COLUMNS = 5;

export default function AdminNotificationsSection({ catalog, error }) {
  const [filter, setFilter] = useSectionFilter(NOTIFICATION_FILTERS, 'todos');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null);
  const close = useCallback(() => setOpen(null), []);

  // El texto de cada aviso se arma una vez —con las funciones de la bandeja, en los
  // calculados— y es también lo que se busca.
  const avisos = useMemo(() => (catalog?.avisos ?? []).map((aviso) => {
    const texto = notificationText(aviso);
    return { ...aviso, texto, meta: notificationMeta(aviso), campos: notificationSearchFields(aviso, texto) };
  }), [catalog]);

  const active = NOTIFICATION_FILTERS.find((f) => f.key === filter);
  const visibles = avisos.filter(active.test).filter((a) => matchesSearch(query, a.campos));
  const grupos = groupNotifications(visibles, catalog?.temas ?? []);
  const canales = catalog?.canales;

  return (
    <>
      <Band title="Notificaciones">
        <FilterScoreboard
          label="Filtrar avisos por a quién le llegan"
          filters={countFilters(NOTIFICATION_FILTERS, avisos)}
          active={filter}
          onChange={setFilter}
          loading={!catalog}
        />
      </Band>

      <div className="adm-canvas">
        <SectionError messages={[error]} />

        {!catalog ? !error && <SectionLoading /> : (
          <>
            {catalog.desconocidos?.length > 0 && (
              <div className="adm-attention" role="status">
                {catalog.desconocidos.map((d) => (
                  <div key={d.tipo} className="adm-attention-row is-ask">
                    <span className="adm-status-dot" aria-hidden="true" />
                    <span className="adm-attention-text">
                      La base tiene {pluralize(d.total, 'aviso')} «{d.tipo}» que este catálogo no conoce.
                      Hay que agregarlo a utils/catalogoDeAvisos.js.
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="adm-toolbar">
              <SearchBox value={query} onChange={setQuery} placeholder="Buscar un aviso: pago, marcador, votar…" />
            </div>

            {grupos.length === 0 ? (
              <NoResults onClear={() => { setQuery(''); setFilter('todos'); }}>
                Ningún aviso coincide con lo que buscas.
              </NoResults>
            ) : (
              <div className="adm-table-box">
                <div className="table-wrap">
                  <table className="data-table adm-table adm-nt-table">
                    <caption className="adm-sr-only">Los avisos que manda la app, por tema</caption>
                    <thead>
                      <tr>
                        <th>Aviso</th>
                        <th className="adm-nt-col-when" style={{ width: '30%' }}>Cuándo sale</th>
                        <th style={{ width: '21%' }}>Le llega a</th>
                        <th className="col-num" style={{ width: 84 }}>30 días</th>
                        <th className="col-actions" style={{ width: 68 }}>
                          <span className="adm-sr-only">Ver</span>
                        </th>
                      </tr>
                    </thead>
                    {grupos.map(({ tema, avisos: deTema }) => (
                      <tbody key={tema.clave}>
                        <tr className="adm-nt-group">
                          <th colSpan={COLUMNS} scope="colgroup">
                            <span className="adm-nt-group-name">{tema.nombre}</span>
                            <span className="adm-nt-group-count">{deTema.length}</span>
                            <span className="adm-nt-group-note">{tema.nota}</span>
                          </th>
                        </tr>
                        {deTema.map((aviso) => (
                          <NotificationRow key={aviso.tipo} aviso={aviso} canales={canales} onOpen={() => setOpen(aviso)} />
                        ))}
                      </tbody>
                    ))}
                  </table>
                </div>
                <footer className="adm-table-foot adm-nt-foot">
                  <span>{pluralize(visibles.length, 'aviso')}</span>
                  <span>
                    «Al leer»: se arma cada vez que alguien abre su bandeja. No se guarda, así que no se cuenta;
                    su renglón dice a cuántas personas les puede llegar.
                  </span>
                </footer>
              </div>
            )}
          </>
        )}
      </div>

      {open && <NotificationDetail aviso={open} canales={canales} onClose={close} />}
    </>
  );
}

function NotificationRow({ aviso, canales, onOpen }) {
  const { meta, texto } = aviso;
  const lectores = notificationReaders(aviso);
  const alcance = reachLabel(aviso);
  // 27 de 29 salen solo por la bandeja: el canal se dice cuando es otro.
  const otrosCanales = channelStates(aviso, canales).filter((estado) => estado.canal !== 'bandeja');

  return (
    <tr>
      <td>
        <div className="adm-nt-who">
          <span className="adm-nt-icon" aria-hidden="true">{meta.icon}</span>
          <span className="adm-who-text">
            <span className="adm-who-name">{meta.label}</span>
            <span className="adm-who-sub" title={texto.title}>{texto.title}</span>
            {otrosCanales.length > 0 && (
              <span className="adm-nt-tags">
                {otrosCanales.map((estado) => <Status key={estado.canal} tone={estado.tone}>{estado.text}</Status>)}
              </span>
            )}
          </span>
        </div>
      </td>
      <td className="adm-nt-col-when adm-nt-when">{aviso.cuando}</td>
      <td>
        <span className="adm-nt-to">{notificationAudience(aviso)}</span>
        {lectores && <span className="adm-nt-sub">{lectores}</span>}
        {alcance && <span className="adm-nt-sub">{alcance}</span>}
      </td>
      <td className="col-num">
        <Sends aviso={aviso} />
      </td>
      <td className="col-actions">
        <button type="button" className="btn btn-ws btn-sm" onClick={onOpen} aria-label={`Ver el aviso ${meta.label}`}>
          Ver
        </button>
      </td>
    </tr>
  );
}

function Channels({ aviso, canales }) {
  return (
    <span className="adm-nt-channels">
      {channelStates(aviso, canales).map((estado) => (
        <Status key={estado.canal} tone={estado.tone}>{estado.text}</Status>
      ))}
    </span>
  );
}

function Sends({ aviso }) {
  if (!aviso.envios) {
    return (
      <span className="adm-nt-sends" title="No se guarda: se arma cada vez que alguien abre su bandeja.">
        <span className="adm-nt-sends-calc">Al leer</span>
      </span>
    );
  }
  const { ultimos_30: recientes, total } = aviso.envios;
  return (
    <span className="adm-nt-sends">
      <span className={`adm-nt-sends-value adm-num${recientes === 0 ? ' is-zero' : ''}`}>{formatNumber(recientes)}</span>
      <span className="adm-nt-sub">{total === 0 ? 'nunca ha salido' : `${formatNumber(total)} en total`}</span>
    </span>
  );
}

// Lo que dice "Ver": el aviso como le llega a quien lo recibe, y lo que hay que
// saber antes de crear otro parecido.
function NotificationDetail({ aviso, canales, onClose }) {
  const ventana = useRef(null);

  // El Modal de la app no se cierra con Escape; esta ventana solo se lee, así que
  // Escape la cierra. El foco entra a la ventana sin moverla: puesto en "Cerrar",
  // que va hasta abajo, la desplazaba y lo primero que se veía era el final de los
  // datos en vez de la tarjeta del aviso.
  useEffect(() => {
    ventana.current?.focus({ preventScroll: true });
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const variantes = notificationVariants(aviso);
  const lectores = aviso.lo_ven ? Object.entries(aviso.lo_ven) : [];
  const alcance = reachLabel(aviso);

  return (
    <Modal title={aviso.meta.label} onClose={onClose}>
      <div ref={ventana} className="adm-nt-detail" tabIndex={-1}>
        {aviso.como === 'correo' ? (
          <EmailPreview muestra={aviso.muestra} />
        ) : (
          <div className="adm-nt-preview">
            <NotificationCard item={notificationPreview(aviso)} preview />
            <p className="adm-nt-preview-note">Así le llega, con datos de muestra.</p>
          </div>
        )}

        <dl className="adm-nt-facts">
          <div>
            <dt>Cuándo sale</dt>
            <dd>{aviso.cuando}</dd>
          </div>

          <div>
            <dt>Le llega a</dt>
            <dd>
              {notificationAudience(aviso)}
              {lectores.map(([org, roles]) => (
                <span key={org} className="adm-nt-line">
                  {lectores.length > 1 ? `En ${org === 'liga' ? 'la liga' : 'el equipo'}: ` : 'Lo ven: '}
                  {roles.join(', ')}
                </span>
              ))}
              {alcance && (
                <span className="adm-nt-line">
                  Hoy {alcance}
                  {aviso.casilla
                    ? ': quienes siguen algo con esa casilla marcada en el menú de Seguir.'
                    : ': quienes votaron en un calendario con partidos de los últimos 60 días.'}
                </span>
              )}
            </dd>
          </div>

          <div>
            <dt>Canal</dt>
            <dd>
              <Channels aviso={aviso} canales={canales} />
              {aviso.canales.includes('push') && !canales?.push && (
                <span className="adm-nt-line adm-faint">El push está apagado en este servidor (PUSH_NOTIFICATIONS).</span>
              )}
              {aviso.canales.includes('correo') && !canales?.correo && (
                <span className="adm-nt-line adm-faint">Sin RESEND_API_KEY y EMAIL_FROM en este servidor, no sale ningún correo.</span>
              )}
            </dd>
          </div>

          <div>
            <dt>Envíos</dt>
            <dd><SendsDetail aviso={aviso} /></dd>
          </div>

          {aviso.sinRepetir.length > 0 && (
            <div>
              <dt>Para no repetir</dt>
              <dd>
                <ul className="adm-nt-list">
                  {aviso.sinRepetir.map((regla) => <li key={regla}>{regla}</li>)}
                </ul>
              </dd>
            </div>
          )}

          {aviso.ojo?.length > 0 && (
            <div>
              <dt>Ojo</dt>
              <dd>
                <ul className="adm-nt-list">
                  {aviso.ojo.map((nota) => <li key={nota}>{nota}</li>)}
                </ul>
              </dd>
            </div>
          )}

          {variantes.length > 0 && (
            <div>
              <dt>También dice</dt>
              <dd>
                <ul className="adm-nt-list">
                  {variantes.map((v, i) => (
                    <li key={i}>
                      <strong>{v.title}</strong>
                      {v.body && <span className="adm-nt-quote">{v.body}</span>}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}

          {aviso.push?.length > 0 && (
            <div>
              <dt>Por push</dt>
              <dd>
                <ul className="adm-nt-list">
                  {aviso.push.map((p, i) => (
                    <li key={i}>
                      <strong>{p.titulo}</strong>
                      <span className="adm-nt-quote">{p.cuerpo}</span>
                      <span className="adm-faint">{p.cuando}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}

          <div>
            <dt>En el código</dt>
            <dd>
              <code className="adm-nt-code">{aviso.tipo}</code>
              {aviso.archivos.map((archivo) => (
                <span key={archivo} className="adm-nt-line adm-faint">{archivo}</span>
              ))}
            </dd>
          </div>
        </dl>

        <div className="modal-actions">
          <button type="button" className="btn btn-ws" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </Modal>
  );
}

function SendsDetail({ aviso }) {
  if (!aviso.envios) {
    return 'No se guarda: se arma cada vez que alguien abre su bandeja, así que no se puede contar.';
  }
  const { total, ultimos_30: recientes, destinatarios_30: destinatarios, ultimo } = aviso.envios;
  if (total === 0) {
    return aviso.como === 'correo'
      ? 'Nunca ha salido: no hay ningún código generado.'
      : 'Nunca ha salido.';
  }
  return (
    <>
      {recientes > 0
        ? `${pluralize(recientes, aviso.como === 'correo' ? 'correo' : 'aviso')} en los últimos 30 días, a ${recipientsLabel(aviso, destinatarios)}.`
        : 'Ninguno en los últimos 30 días.'}
      <span className="adm-nt-line">
        {formatNumber(total)} en total · el último, el {formatDate(ultimo)}.
      </span>
      {aviso.como === 'correo' && (
        <span className="adm-nt-line adm-faint">Se cuentan los códigos generados: cada uno es un correo.</span>
      )}
    </>
  );
}

// El correo como sale: blanco, con el código grande en medio (utils/email.js).
function EmailPreview({ muestra }) {
  return (
    <div className="adm-nt-preview">
      <div className="adm-nt-email">
        <div className="adm-nt-email-subject">
          <span>Asunto</span>
          {muestra.asunto}
        </div>
        <div className="adm-nt-email-body">
          <p className="adm-nt-email-hello">{muestra.saludo}</p>
          <p>{muestra.linea}</p>
          <p className="adm-nt-email-code">{muestra.codigo}</p>
          <p className="adm-nt-email-small">{muestra.letraChica}</p>
        </div>
      </div>
      <p className="adm-nt-preview-note">Así le llega, con datos de muestra.</p>
    </div>
  );
}
