import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Loading from '../components/Loading.jsx';
import { initials, getMatchParts } from '../utils/matchDisplay.js';
import { guardarPartido, leerPartido, hayAlmacenLocal } from '../utils/offlineDb.js';
import { agregarPendiente, suscribir, reintentarTodo, cargar as cargarCola } from '../utils/offlineOutbox.js';
import { clavePendiente, textoDeCola } from '../utils/offlineQueue.js';
import { prepararPantalla } from '../utils/serviceWorker.js';

// El roster de un equipo en un partido — y, para quien tiene el permiso
// `asistencia`, el pase de lista de esa misma lista.
//
// **No son dos pantallas ni dos botones.** Es la misma lista, y lo que cambia
// es si se puede marcar. Por eso cuelga del PARTIDO y no de la rama: la
// asistencia es a un partido, y un roster suelto, sin partido en contexto, no
// tiene a qué marcarle nada (README, "Roster público y pase de lista").
//
// Quién aparece: quien estaba en el roster **ese día**, no hoy. Lo resuelve el
// backend; aquí no se filtra nada.
const ETIQUETA = { present: 'Presente', absent: 'Ausente' };

export default function PublicRosterPage() {
  const { matchId, teamId } = useParams();
  const { token } = useAuth();
  // La llave con la que esta pantalla se busca a sí misma en la cola. Es la
  // misma que usa `offlineQueue` para fusionar dos capturas de lo mismo.
  const claveDeEstaLista = clavePendiente({ kind: 'attendance', matchId: Number(matchId), teamId: Number(teamId) });

  // `undefined` es "cargando" y `null` es "no hay / no puedo". Son estados
  // distintos: con los dos en null la pantalla no existe, pero con el público
  // en null y el pase de lista lleno sí — es justo el caso de una categoría de
  // menores, que deja el roster privado y de todos modos pasa lista.
  const [publico, setPublico] = useState(undefined);
  const [lista, setLista] = useState(undefined);
  const [marcas, setMarcas] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState('');
  // Lo que se capturó y todavía vive solo en este teléfono, y si esta pantalla
  // ya está lista para abrirse sin señal.
  const [cola, setCola] = useState([]);
  const [preparado, setPreparado] = useState(null);
  const [preparando, setPreparando] = useState(false);
  const [deLoLocal, setDeLoLocal] = useState(false);

  useEffect(() => {
    let vivo = true;
    setPublico(undefined);
    setLista(undefined);
    setMarcas({});
    setGuardado(false);
    setDeLoLocal(false);
    setError('');

    (async () => {
      const [pub, asis] = await Promise.all([
        api.getPublicMatchTeamRoster(matchId, teamId).catch(() => null),
        // Se pide siempre que haya sesión, y el 403 se ignora en silencio. NO se
        // pregunta antes con `puede()` por dos razones: el permiso vive en la
        // liga, cuyo id solo se conoce DESPUÉS de cargar, y el pase de lista
        // existe aunque el roster sea privado — si esto dependiera de la
        // respuesta pública, el visor de una categoría de menores no podría
        // pasar lista. Un 403 aquí no es un error que enseñarle a nadie: es "no
        // te toca".
        token ? api.getMatchAttendance(matchId, token).catch(() => null) : Promise.resolve(null),
      ]);
      if (!vivo) return;

      const equipo = asis?.teams?.find((t) => t.team_id === Number(teamId)) || null;

      if (pub || equipo) {
        setPublico(pub);
        setLista(equipo ? { ...asis, equipo } : null);
        // Se guarda lo que se pudo traer, sin prometer nada: la promesa de "esto
        // ya se captura sin señal" la hace el botón de Preparar partido, que
        // además se asegura de la pantalla. Esto es solo no desperdiciar una
        // carga que ya ocurrió.
        guardarPartido(matchId, teamId, { publico: pub, asistencia: asis });
        return;
      }

      // Ni red ni permiso: lo último que queda es lo que este teléfono bajó
      // antes. Es el caso de la cancha — se preparó en el estacionamiento y
      // aquí ya no hay señal.
      const local = await leerPartido(matchId, teamId);
      if (!vivo) return;
      if (local?.datos) {
        const equipoLocal = local.datos.asistencia?.teams?.find((t) => t.team_id === Number(teamId)) || null;
        setPublico(local.datos.publico || null);
        setLista(equipoLocal ? { ...local.datos.asistencia, equipo: equipoLocal } : null);
        setPreparado(local.preparadoEn);
        setDeLoLocal(true);
      } else {
        setPublico(null);
        setLista(null);
      }
    })();

    return () => { vivo = false; };
  }, [matchId, teamId, token]);

  // Qué hay preparado para esta pantalla y qué hay sin subir. Las dos se leen al
  // entrar porque las dos son avisos: una promete y la otra advierte.
  useEffect(() => {
    let vivo = true;
    leerPartido(matchId, teamId).then((p) => { if (vivo && p) setPreparado(p.preparadoEn); });
    const dejarDeMirar = suscribir((c) => { if (vivo) setCola(c); });
    return () => { vivo = false; dejarDeMirar(); };
  }, [matchId, teamId]);

  // El borrador arranca en lo que ya está guardado. Lo que no tiene fila no
  // entra: "sin pasar lista" es la ausencia de marca, no un valor.
  //
  // **Y lo que está EN LA COLA manda sobre lo que trajo el servidor.** Sin esto,
  // recargar la página sin señal devolvía la pantalla al estado preparado —
  // la captura seguía a salvo en la cola, pero el visor la veía desaparecer y
  // volvía a marcar sobre una base vieja. Lo capturado es lo cierto hasta que
  // suba.
  useEffect(() => {
    if (!lista?.equipo) return;
    let vivo = true;
    (async () => {
      const enCola = (await cargarCola()).find((p) => clavePendiente(p) === claveDeEstaLista);
      if (!vivo) return;
      setMarcas(enCola
        ? Object.fromEntries(enCola.entries.map((e) => [e.player_id, e.status]))
        : Object.fromEntries(lista.equipo.roster.filter((p) => p.status).map((p) => [p.id, p.status])));
    })();
    return () => { vivo = false; };
  }, [lista, claveDeEstaLista]);

  // Contra qué se compara el borrador para saber si hay algo sin guardar. Si hay
  // una captura en la cola, ESA es la última guardada: el botón no puede pedir
  // que se vuelva a guardar algo que ya está a salvo esperando señal.
  const guardadas = useMemo(() => {
    const enCola = cola.find((p) => clavePendiente(p) === claveDeEstaLista);
    if (enCola) return Object.fromEntries(enCola.entries.map((e) => [e.player_id, e.status]));
    return lista?.equipo
      ? Object.fromEntries(lista.equipo.roster.filter((p) => p.status).map((p) => [p.id, p.status]))
      : {};
  }, [lista, cola, claveDeEstaLista]);

  const sinGuardar = useMemo(() => (
    JSON.stringify(marcas) !== JSON.stringify(guardadas)
  ), [marcas, guardadas]);

  const cargando = publico === undefined || lista === undefined;
  // La lista pública manda cuando existe, porque es la que trae la foto. Si la
  // categoría es privada pero quien mira puede pasar lista, se usa la del pase
  // de lista, que es la misma consulta sin las columnas públicas.
  const roster = publico?.roster ?? lista?.equipo?.roster ?? [];

  useEffect(() => {
    const nombre = publico?.team?.name || lista?.equipo?.name;
    if (nombre) document.title = `Roster · ${nombre} · CFBAMX`;
    return () => { document.title = 'CFBAMX'; };
  }, [publico, lista]);

  function marcar(playerId, estado) {
    setGuardado(false);
    setMarcas((prev) => {
      const next = { ...prev };
      // Volver a picarle al mismo estado desmarca: es la única forma de
      // regresar a "sin pasar lista", que es un estado real y no un vacío.
      if (next[playerId] === estado) delete next[playerId];
      else next[playerId] = estado;
      return next;
    });
  }

  function todosPresentes() {
    setGuardado(false);
    setMarcas(Object.fromEntries(roster.map((p) => [p.id, 'present'])));
  }

  function limpiar() {
    setGuardado(false);
    setMarcas({});
  }

  // Guardar ya no es "mandar al servidor": es **meterlo a la cola**, que lo
  // persiste en este teléfono y lo sube cuando pueda. Con señal eso pasa en el
  // mismo instante y no se nota; sin señal, la captura sobrevive a recargar la
  // página, a cerrar la pestaña y al camino de regreso.
  //
  // El orden importa: primero se guarda, luego se intenta. Al revés se pierde la
  // captura cuando la petición se queda colgada y alguien cierra la pestaña.
  async function guardar() {
    setGuardando(true);
    setError('');
    try {
      const entries = Object.entries(marcas).map(([player_id, status]) => ({
        player_id: Number(player_id), status,
      }));
      const pendiente = { kind: 'attendance', matchId: Number(matchId), teamId: Number(teamId), entries };
      const colaNueva = await agregarPendiente(pendiente);

      const sigueEnCola = colaNueva.some((p) => clavePendiente(p) === claveDeEstaLista);
      if (sigueEnCola) {
        // No subió. La pantalla se queda con lo capturado —es lo cierto— y el
        // contador de arriba dice que todavía vive solo aquí.
        setLista((prev) => (prev ? { ...prev, equipo: { ...prev.equipo, roster: aplicarMarcas(prev.equipo.roster) } } : prev));
        setGuardado(true);
        return;
      }

      // Subió: se relee del servidor, porque si algo se ignoró (alguien que ya
      // no está en el roster) la pantalla tiene que ver el estado real y no el
      // que creía tener.
      const d = await api.getMatchAttendance(matchId, token).catch(() => null);
      const equipo = d?.teams?.find((t) => t.team_id === Number(teamId));
      if (equipo) {
        setLista({ ...d, equipo });
        guardarPartido(matchId, teamId, { publico, asistencia: d });
      }
      setGuardado(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  // Lo capturado, encima de la lista que ya se tenía. Es lo que permite que la
  // pantalla siga diciendo la verdad sin señal: lo marcado es lo marcado,
  // aunque nadie lo haya subido todavía.
  function aplicarMarcas(filas) {
    return (filas || []).map((p) => (
      marcas[p.id] === p.status ? p : { ...p, status: marcas[p.id] ?? null }
    ));
  }

  // ── Preparar el partido ──
  //
  // Una descarga EXPLÍCITA y previa, no un cache oportunista. El cache
  // oportunista —"se guarda lo que hayas visitado"— falla exactamente cuando
  // importa: el visor que nunca abrió esta pantalla con señal llega a la cancha
  // sin nada, y ahí ya no hay forma de avisarle. Esto se pide, así que se puede
  // verificar ANTES de salir.
  async function preparar() {
    setPreparando(true);
    setError('');
    try {
      const almacen = await hayAlmacenLocal();
      if (!almacen) {
        // Decir la verdad importa más que ofrecer la función: prometer captura
        // sin señal y no poder cumplir es peor que no ofrecerla.
        setError('Este navegador no deja guardar datos localmente (puede ser el modo privado), así que esta pantalla no va a abrir sin señal.');
        return;
      }
      await guardarPartido(matchId, teamId, { publico, asistencia: lista ? { ...lista, teams: [lista.equipo] } : null });
      // Y la pantalla misma, que es la otra mitad: de nada sirve tener los datos
      // si la app no abre.
      await prepararPantalla();
      setPreparado(Date.now());
    } catch (e) {
      setError(e.message);
    } finally {
      setPreparando(false);
    }
  }

  if (cargando) return <div className="container"><Loading /></div>;

  // Mismo mensaje para "no existe", "es privado" y "no te toca", que es lo que
  // el backend hace al responder 404 en todos los casos: desde afuera no se
  // debe poder distinguir uno del otro.
  if (!publico && !lista?.equipo) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>Este roster no es público</h3>
          <p>La liga decide si publica el roster de cada categoría, y esta no lo publica.</p>
          <Link to={`/partidos/${matchId}`} className="btn btn-outline" style={{ marginTop: 16 }}>Volver al partido</Link>
        </div>
      </div>
    );
  }

  const equipo = publico?.team || { id: Number(teamId), name: lista.equipo.name, logo_url: lista.equipo.logo_url };
  const partido = publico?.match || lista?.match || null;
  const photos = publico?.photos === true;
  const puedeMarcar = lista?.can_mark === true;
  const veLista = Boolean(lista?.equipo);

  const contexto = [
    publico?.category?.name || lista?.match?.category_name,
    publico?.branch?.name && publico.branch.name.toUpperCase() !== (publico?.category?.name || '').toUpperCase()
      ? publico.branch.name
      : null,
    [publico?.category?.season, publico?.category?.year].filter(Boolean).join(' ') || null,
  ].filter(Boolean).join(' · ');

  const marcados = Object.values(marcas);
  const presentes = marcados.filter((e) => e === 'present').length;
  const ausentes = marcados.filter((e) => e === 'absent').length;
  const sinMarcar = Math.max(0, roster.length - presentes - ausentes);

  // ¿ESTA captura sigue sin subir?
  const pendiente = cola.some((p) => clavePendiente(p) === claveDeEstaLista);

  const cuando = partido?.match_date ? getMatchParts(partido.match_date) : null;
  const ultima = veLista
    ? lista.equipo.roster.filter((p) => p.marked_at).sort((a, b) => (a.marked_at < b.marked_at ? 1 : -1))[0]
    : null;

  return (
    <div className="container public-roster-page">
      <div className="crumb">
        <Link to="/">Inicio</Link>
        {publico?.league?.slug && <> / <Link to={`/ligas/${publico.league.slug}`}>{publico.league.name}</Link></>}
        {' '}/ <Link to={`/partidos/${matchId}`}>Partido</Link>
        {' '}/ Roster de {equipo.name}
      </div>

      <div className="public-roster-head">
        <div className="public-roster-logo">
          {equipo.logo_url ? <img src={equipo.logo_url} alt={equipo.name} /> : <span>{initials(equipo.name)}</span>}
        </div>
        <div>
          <div className="player-hero-eyebrow">{puedeMarcar ? 'Pase de lista' : 'Roster'}</div>
          <h1 className="player-hero-name">{equipo.name}</h1>
          <div className="player-hero-team">
            {[
              partido?.rival ? `vs ${partido.rival}` : null,
              cuando ? `${cuando.day} ${cuando.month}` : null,
              contexto || null,
            ].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>

      {/* El pase de lista, arriba de la lista: es lo que esta pantalla viene a
          hacer cuando quien mira puede marcar. */}
      {veLista && (
        <div className="attendance-bar">
          <div className="attendance-counts">
            <span className="attendance-count is-present">{presentes} presentes</span>
            <span className="attendance-count is-absent">{ausentes} ausentes</span>
            <span className="attendance-count">{sinMarcar} sin pasar lista</span>
          </div>
          <p className="attendance-note">
            <strong>“Sin pasar lista” no es “faltó”.</strong> Si nadie marcó a alguien, aquí no se
            registra ninguna falta — la plataforma entrega el conteo, y el criterio de elegibilidad
            es de la liga.
          </p>
          {puedeMarcar && (
            <div className="attendance-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={todosPresentes} disabled={guardando}>
                Todos presentes
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={limpiar} disabled={guardando || marcados.length === 0}>
                Borrar el pase de lista
              </button>
              <button type="button" className="btn btn-flag btn-sm" onClick={guardar} disabled={guardando || !sinGuardar}>
                {guardando ? 'Guardando…' : guardado && !sinGuardar ? '✓ Guardado' : 'Guardar pase de lista'}
              </button>
            </div>
          )}
          {error && <div className="form-error" style={{ marginTop: 10 }}>{error}</div>}
          {ultima && !sinGuardar && !pendiente && (
            <p className="attendance-signature">
              Última marca: {ultima.marked_by || 'alguien de la liga'} · {new Date(ultima.marked_at).toLocaleString('es-MX')}
            </p>
          )}

          {/* ── Lo que todavía vive solo en este teléfono ──
              Mientras las capturas no suben viven en UN SOLO LUGAR: si alguien
              borra los datos del navegador o pierde el teléfono, se perdieron.
              Es el mismo riesgo que tiene la hoja de papel que esto sustituye,
              no uno nuevo — pero la pantalla tiene que decirlo en voz alta en
              vez de dejarlo implícito. */}
          {textoDeCola(cola) && (
            <div className="offline-pending">
              <span className="offline-dot" aria-hidden="true" />
              <div>
                <strong>{textoDeCola(cola)}</strong>
                <div className="offline-pending-note">
                  Se sube solo en cuanto vuelva la señal. No cierres sesión ni borres los
                  datos del navegador hasta entonces.
                </div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => reintentarTodo()}>
                Reintentar ahora
              </button>
            </div>
          )}

          {deLoLocal && (
            <p className="attendance-signature">
              Sin señal — esta lista es la copia que bajaste
              {preparado ? ` el ${new Date(preparado).toLocaleString('es-MX')}` : ''}. Lo que marques
              se guarda aquí y sube cuando vuelva el internet.
            </p>
          )}

          {puedeMarcar && !deLoLocal && (
            <div className="attendance-prepare">
              <button type="button" className="btn btn-ghost btn-sm" onClick={preparar} disabled={preparando}>
                {preparando ? 'Preparando…' : preparado ? '↻ Volver a preparar' : '⬇ Preparar partido'}
              </button>
              <span className="attendance-prepare-note">
                {preparado
                  ? `Listo: este partido ya se puede pasar lista sin señal (preparado el ${new Date(preparado).toLocaleString('es-MX')}).`
                  : 'Descárgalo ahora, con internet, para poder pasar lista en la cancha aunque no haya señal.'}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="public-roster-card">
        {roster.length === 0 ? (
          <p className="player-empty-note" style={{ padding: '10px 0' }}>
            Este equipo todavía no tiene jugadores inscritos en esta rama.
          </p>
        ) : (
          roster.map((p) => {
            const marca = marcas[p.id];
            return (
              <div key={p.id} className="public-roster-row">
                <div className="public-roster-num">
                  {p.jersey_number != null ? p.jersey_number : '—'}
                </div>
                {photos && (
                  <div className="public-roster-photo">
                    {p.photo_url
                      ? <img src={p.photo_url} alt="" />
                      : <span>{initials(`${p.first_name} ${p.last_name}`)}</span>}
                  </div>
                )}
                <div className="public-roster-who">
                  <div className="public-roster-name">{p.first_name} {p.last_name}</div>
                  <div className="public-roster-pos">{p.position || 'Sin posición'}</div>
                </div>

                {puedeMarcar ? (
                  <div className="attendance-pick">
                    {['present', 'absent'].map((estado) => (
                      <button
                        key={estado}
                        type="button"
                        className={`attendance-btn is-${estado}${marca === estado ? ' is-on' : ''}`}
                        onClick={() => marcar(p.id, estado)}
                        aria-pressed={marca === estado}
                      >
                        {ETIQUETA[estado]}
                      </button>
                    ))}
                  </div>
                ) : veLista ? (
                  <div className={`attendance-tag${marca ? ` is-${marca}` : ''}`}>
                    {marca ? ETIQUETA[marca] : 'Sin pasar lista'}
                  </div>
                ) : null}
              </div>
            );
          })
        )}

        <p className="public-roster-note">
          {roster.length > 0 && `${roster.length} jugador${roster.length !== 1 ? 'es' : ''} en el roster de este partido. `}
          {veLista
            ? 'La asistencia no es pública: la ven la liga y el equipo, nadie más.'
            : `De un roster público se publica nombre, número y posición${photos ? ', y la foto que el equipo autorizó' : ''} — nada más.`}
        </p>
      </div>
    </div>
  );
}
