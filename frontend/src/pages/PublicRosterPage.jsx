import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Loading from '../components/Loading.jsx';
import { initials, getMatchParts } from '../utils/matchDisplay.js';

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

  useEffect(() => {
    let vivo = true;
    setPublico(undefined);
    setLista(undefined);
    setMarcas({});
    setGuardado(false);
    setError('');

    api.getPublicMatchTeamRoster(matchId, teamId)
      .then((d) => { if (vivo) setPublico(d); })
      .catch(() => { if (vivo) setPublico(null); });

    // Se pide siempre que haya sesión, y el 403 se ignora en silencio. NO se
    // pregunta antes con `puede()` por dos razones: el permiso vive en la liga,
    // cuyo id solo se conoce DESPUÉS de cargar, y el pase de lista existe
    // aunque el roster sea privado — si esto dependiera de la respuesta
    // pública, el visor de una categoría de menores no podría pasar lista.
    // Un 403 aquí no es un error que enseñarle a nadie: es "no te toca".
    if (token) {
      api.getMatchAttendance(matchId, token)
        .then((d) => {
          if (!vivo) return;
          const equipo = d.teams.find((t) => t.team_id === Number(teamId));
          setLista(equipo ? { ...d, equipo } : null);
        })
        .catch(() => { if (vivo) setLista(null); });
    } else {
      setLista(null);
    }

    return () => { vivo = false; };
  }, [matchId, teamId, token]);

  // El borrador arranca en lo que ya está guardado. Lo que no tiene fila no
  // entra: "sin pasar lista" es la ausencia de marca, no un valor.
  useEffect(() => {
    if (!lista?.equipo) return;
    setMarcas(Object.fromEntries(
      lista.equipo.roster.filter((p) => p.status).map((p) => [p.id, p.status]),
    ));
  }, [lista]);

  const guardadas = useMemo(() => (
    lista?.equipo
      ? Object.fromEntries(lista.equipo.roster.filter((p) => p.status).map((p) => [p.id, p.status]))
      : {}
  ), [lista]);

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

  async function guardar() {
    setGuardando(true);
    setError('');
    try {
      const entries = Object.entries(marcas).map(([player_id, status]) => ({
        player_id: Number(player_id), status,
      }));
      const r = await api.saveMatchAttendance(matchId, { teamId: Number(teamId), entries }, token);
      // Se pinta lo que contestó el servidor y no lo que se mandó: si algo se
      // ignoró (alguien que ya no está en el roster), la pantalla tiene que ver
      // el estado real.
      setLista((prev) => ({ ...prev, equipo: { ...prev.equipo, roster: r.roster, summary: r.summary } }));
      setGuardado(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
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
          {ultima && !sinGuardar && (
            <p className="attendance-signature">
              Última marca: {ultima.marked_by || 'alguien de la liga'} · {new Date(ultima.marked_at).toLocaleString('es-MX')}
            </p>
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
