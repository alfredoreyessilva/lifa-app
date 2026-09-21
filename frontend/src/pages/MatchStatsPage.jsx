import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Loading from '../components/Loading.jsx';
import { getMatchParts } from '../utils/matchDisplay.js';
import { guardarPartido, leerPartido, hayAlmacenLocal } from '../utils/offlineDb.js';
import { agregarPendiente, reemplazar, suscribir, reintentarTodo } from '../utils/offlineOutbox.js';
import { textoDeJugadasSinSubir, quitarJugadaDelLote, unirJugadas } from '../utils/offlineQueue.js';
import { prepararPantalla } from '../utils/serviceWorker.js';
import {
  NIVELES, NIVELES_DE_CAPTURA, TIPOS, PAPELES_POR_TIPO, PAPELES_DE_DEFENSA, ROLES,
  faltaParaGuardar, derivarDownsDelPartido, siguienteDown, textoDeDown, nuevaLlaveDeJugada,
} from '../utils/plays.js';

// El tercer botón del partido: **Estadísticas** le muestra el box score a
// cualquiera, y a quien tiene el permiso `estadisticas` le abre el panel de
// captura. Es el mismo patrón que el roster público y el pase de lista — no
// son dos pantallas, es la misma y lo que cambia es si se puede capturar.
//
// El box score ES público, a diferencia de la asistencia: es el resultado
// deportivo, que es justo lo que un torneo publica.
//
// Todo lo que se captura aquí pasa primero por la cola sin señal, nunca por la
// red directamente. En una cancha sin internet esa es la diferencia entre
// usarse y volver al papel (README, "Capturar sin señal").

// El almacén local guarda por `(partido, equipo)` porque nació con el pase de
// lista, que es de un equipo. Las estadísticas son del partido entero, así que
// usan el 0 como "los dos": `SERIAL` empieza en 1, así que ningún equipo lo
// ocupa y las dos pantallas no se pisan.
const CLAVE_LOCAL = 0;

// Las columnas del box score, por bloque. Se enseña el bloque solo si alguien
// tiene algo en él: una tabla de ceros no informa, estorba.
//
// Los intentos de pase se abrevian "Env" (envíos) y no "Int", que es lo que
// saldría solo: en la misma tabla "Int" ya son las intercepciones, y las dos
// abreviaturas juntas se leen mal justo en el renglón que más se mira.
const BLOQUES = [
  { titulo: 'Pase', cols: [
    ['passes-completions', 'Comp'], ['passes-attempts', 'Env'], ['passes-yards', 'Yds'],
    ['passes-touchdowns', 'TD'], ['passes-interceptions', 'Int'],
  ] },
  { titulo: 'Acarreo', cols: [
    ['rushes-attempts', 'Acar'], ['rushes-yards', 'Yds'], ['rushes-touchdowns', 'TD'],
  ] },
  { titulo: 'Recepción', cols: [
    ['receptions-total', 'Rec'], ['receptions-yards', 'Yds'], ['receptions-touchdowns', 'TD'],
  ] },
  { titulo: 'Defensa', cols: [
    ['tackles-total', 'Taq'], ['sacks-total', 'Cap'], ['interceptions-total', 'Int'],
  ] },
  { titulo: 'Patadas', cols: [
    ['field-goals-made', 'GC'], ['extra-points-made', 'PAT'],
  ] },
];

export default function MatchStatsPage() {
  const { matchId } = useParams();
  const { token } = useAuth();

  // `undefined` es "cargando" y `null` es "no hay / no puedo". El box score es
  // público, así que casi siempre hay algo; el panel es de quien tiene el
  // permiso, y un 403 aquí no es un error que enseñarle a nadie.
  const [box, setBox] = useState(undefined);
  const [panel, setPanel] = useState(undefined);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [cola, setCola] = useState([]);
  const [preparado, setPreparado] = useState(null);
  const [preparando, setPreparando] = useState(false);
  const [deLoLocal, setDeLoLocal] = useState(false);

  // Lo que se está capturando.
  const [sesion, setSesion] = useState(null);
  const [serie, setSerie] = useState(null);
  const [borrador, setBorrador] = useState(null);
  const [editando, setEditando] = useState(null);

  // ── Cargar ──
  useEffect(() => {
    let vivo = true;
    setBox(undefined); setPanel(undefined); setError(''); setDeLoLocal(false);

    (async () => {
      const [b, p] = await Promise.all([
        api.getMatchBoxScore(matchId).catch(() => null),
        // Se pide siempre que haya sesión y el 403 se ignora en silencio: el
        // permiso vive en la liga, cuyo id solo se conoce DESPUÉS de cargar.
        token ? api.getMatchCapture(matchId, token).catch(() => null) : Promise.resolve(null),
      ]);
      if (!vivo) return;

      if (b || p) {
        setBox(b); setPanel(p);
        if (p) guardarPartido(matchId, CLAVE_LOCAL, { box: b, panel: p });
        return;
      }

      // Ni red ni permiso: lo último que queda es lo que este teléfono bajó.
      // Es el caso de la cancha.
      const local = await leerPartido(matchId, CLAVE_LOCAL);
      if (!vivo) return;
      if (local?.datos) {
        setBox(local.datos.box || null);
        setPanel(local.datos.panel || null);
        setPreparado(local.preparadoEn);
        setDeLoLocal(true);
      } else {
        setBox(null); setPanel(null);
      }
    })();

    return () => { vivo = false; };
  }, [matchId, token]);

  useEffect(() => {
    let vivo = true;
    leerPartido(matchId, CLAVE_LOCAL).then((p) => { if (vivo && p) setPreparado(p.preparadoEn); });
    const dejarDeMirar = suscribir((c) => { if (vivo) setCola(c); });
    return () => { vivo = false; dejarDeMirar(); };
  }, [matchId]);

  // Al entrar, se retoma la sesión que ya estaba: la buena si es mía, o la que
  // yo tenía abierta. Recargar la página en la cancha no puede costar volver a
  // reclamar el partido — eso necesita señal.
  useEffect(() => {
    if (!panel?.sessions) return;
    setSesion((prev) => prev ?? panel.sessions.find((s) => s.id === panel.session_id) ?? panel.sessions[0] ?? null);
  }, [panel]);

  const miPendiente = useMemo(
    () => cola.find((p) => p.kind === 'plays' && Number(p.matchId) === Number(matchId)) || null,
    [cola, matchId],
  );

  // **Las jugadas de esta sesión: las del servidor MÁS las que siguen en la
  // cola.** Lo que está en la cola manda, igual que en el pase de lista: sin
  // esto, recargar sin señal devolvía la pantalla al estado preparado y el
  // visor veía desaparecer lo que acababa de capturar.
  const jugadas = useMemo(() => {
    const delServidor = (sesion && panel?.plays_by_session?.[sesion.id]) || [];
    return unirJugadas(delServidor, miPendiente?.plays || []);
  }, [panel, sesion, miPendiente]);

  const derivados = useMemo(() => derivarDownsDelPartido(jugadas), [jugadas]);

  // La serie en curso arranca donde quedó la última jugada capturada.
  useEffect(() => {
    if (!jugadas.length || serie) return;
    const ultima = jugadas[jugadas.length - 1];
    setSerie({ number: ultima.drive_number, offenseTeamId: ultima.offense_team_id, clock: '', yardLine: null });
  }, [jugadas, serie]);

  const equipos = panel?.teams || [];
  const ataque = equipos.find((t) => t.team_id === serie?.offenseTeamId) || equipos[0] || null;
  const defensa = equipos.find((t) => t.team_id !== ataque?.team_id) || null;
  const puedeCapturar = Boolean(panel);
  const nivel = sesion?.capture_level || 'offense';

  const deLaSerie = useMemo(
    () => jugadas.filter((j) => j.drive_number === serie?.number),
    [jugadas, serie],
  );
  const proximo = useMemo(() => siguienteDown(deLaSerie), [deLaSerie]);

  const partido = box?.match || panel?.match || null;
  useEffect(() => {
    if (partido) document.title = `Estadísticas · ${partido.home_team || ''} vs ${partido.away_team || ''} · CFBAMX`;
    return () => { document.title = 'CFBAMX'; };
  }, [partido]);

  // ── Reclamar ──
  async function reclamar(capture_level, takeOver = false) {
    setError(''); setAviso('');
    try {
      const r = await api.claimMatchCapture(matchId, { captureLevel: capture_level, takeOver }, token);
      setSesion(r.session);
      setSerie({ number: 1, offenseTeamId: equipos[0]?.team_id ?? null, clock: '', yardLine: null });
      const p = await api.getMatchCapture(matchId, token).catch(() => null);
      if (p) setPanel(p);
    } catch (e) {
      // El 409 no es un no: es un "confirma". Se pregunta y se reenvía.
      if (e.status === 409) {
        setAviso(`${e.message}. Si tomas el control, lo que esa persona ya capturó NO se borra: queda guardado aparte y después alguien decide cuál captura es la buena.`);
        return;
      }
      setError(e.message);
    }
  }

  // ── Capturar ──
  function empezarJugada(tipo) {
    setEditando(null);
    setBorrador({
      client_play_id: nuevaLlaveDeJugada(),
      play_type: tipo,
      participants: [],
      yards_gained: '',
      points: 0,
      scoring_team_id: null,
    });
  }

  function alternarParticipante(playerId, role) {
    setBorrador((b) => {
      if (!b) return b;
      const yaEsta = b.participants.some((p) => p.player_id === playerId && p.role === role);
      return {
        ...b,
        participants: yaEsta
          ? b.participants.filter((p) => !(p.player_id === playerId && p.role === role))
          : [...b.participants, { player_id: playerId, role }],
      };
    });
  }

  // Guardar una jugada es **meterla a la cola**, no mandarla. Con señal sube en
  // el mismo instante y no se nota; sin señal sobrevive a recargar la página, a
  // cerrar la pestaña y al camino de regreso.
  async function guardarJugada() {
    const falta = faltaParaGuardar(borrador);
    if (falta) { setError(falta); return; }
    setError('');

    const esNueva = !editando;
    const jugada = {
      ...borrador,
      yards_gained: Number(borrador.yards_gained),
      // `sequence` es el orden de captura y la asigna ESTE dispositivo: no es
      // identidad, y dos teléfonos empiezan los dos en 1.
      sequence: esNueva ? (jugadas.length ? Math.max(...jugadas.map((j) => j.sequence)) + 1 : 1) : editando.sequence,
      drive_number: serie?.number ?? 1,
      period: serie?.period || '1',
      // El reloj y la posición van SOLO en la primera jugada de la serie: de
      // 120 capturas a 10 o 15, que es lo que hace esto sostenible.
      clock: deLaSerie.length === 0 ? (serie?.clock || null) : null,
      yard_line: deLaSerie.length === 0 ? (serie?.yardLine ?? null) : null,
      offense_team_id: serie?.offenseTeamId ?? ataque?.team_id,
      down: null,
      distance: null,
    };

    // Si la jugada todavía vive en la cola, corregirla es volver a capturarla
    // —la unión por `client_play_id` la reemplaza—. Si ya subió, necesita su
    // propia llamada, porque el lote no pisa lo que ya está del otro lado.
    const yaSubio = !esNueva && !(miPendiente?.plays || []).some((j) => j.client_play_id === jugada.client_play_id);
    if (yaSubio) {
      await agregarPendiente({ kind: 'play-edit', matchId: Number(matchId), clientPlayId: jugada.client_play_id, play: jugada });
    } else {
      await agregarPendiente({
        kind: 'plays', matchId: Number(matchId),
        sessionId: sesion?.id ?? null, captureLevel: nivel, plays: [jugada],
      });
    }

    setBorrador(null);
    setEditando(null);
    await refrescarSiHaySenal();
  }

  async function borrarJugada(jugada) {
    setError('');
    const enCola = (miPendiente?.plays || []).some((j) => j.client_play_id === jugada.client_play_id);
    if (enCola) {
      // Nunca existió del otro lado: se saca del lote y ya. Va por
      // `reemplazar` y no por `agregarPendiente` porque el lote se FUSIONA —
      // encolarlo recortado lo volvería a unir con el anterior y la jugada
      // regresaría sin que nada fallara.
      await reemplazar(quitarJugadaDelLote(miPendiente, jugada.client_play_id));
    } else {
      await agregarPendiente({ kind: 'play-delete', matchId: Number(matchId), clientPlayId: jugada.client_play_id });
    }
    await refrescarSiHaySenal();
  }

  // Se relee del servidor cuando se pudo; sin señal no pasa nada, porque lo que
  // está en la cola ya manda sobre lo que trajo el servidor.
  async function refrescarSiHaySenal() {
    const [b, p] = await Promise.all([
      api.getMatchBoxScore(matchId).catch(() => null),
      token ? api.getMatchCapture(matchId, token).catch(() => null) : Promise.resolve(null),
    ]);
    if (b) setBox(b);
    if (p) { setPanel(p); guardarPartido(matchId, CLAVE_LOCAL, { box: b, panel: p }); }
  }

  function nuevaSerie(offenseTeamId) {
    setBorrador(null);
    setSerie((s) => ({
      number: (s?.number ?? 0) + 1,
      offenseTeamId,
      period: s?.period || '1',
      clock: '',
      yardLine: null,
    }));
  }

  // ── Preparar el partido ──
  async function preparar() {
    setPreparando(true); setError('');
    try {
      if (!await hayAlmacenLocal()) {
        setError('Este navegador no deja guardar datos localmente (puede ser el modo privado), así que esta pantalla no va a abrir sin señal.');
        return;
      }
      await guardarPartido(matchId, CLAVE_LOCAL, { box, panel });
      await prepararPantalla();
      setPreparado(Date.now());
    } catch (e) {
      setError(e.message);
    } finally {
      setPreparando(false);
    }
  }

  if (box === undefined || panel === undefined) return <div className="container"><Loading /></div>;

  if (!box && !panel) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>Este partido no tiene estadísticas</h3>
          <Link to={`/partidos/${matchId}`} className="btn btn-outline" style={{ marginTop: 16 }}>Volver al partido</Link>
        </div>
      </div>
    );
  }

  const cuando = partido?.match_date ? getMatchParts(partido.match_date) : null;
  const sinSubir = textoDeJugadasSinSubir(cola, matchId);

  return (
    <div className="container match-stats-page">
      <div className="crumb">
        <Link to="/">Inicio</Link> / <Link to={`/partidos/${matchId}`}>Partido</Link> / Estadísticas
      </div>

      <div className="public-roster-head">
        <div>
          <div className="player-hero-eyebrow">{puedeCapturar ? 'Captura por jugada' : 'Estadísticas'}</div>
          <h1 className="player-hero-name">{partido?.home_team} vs {partido?.away_team}</h1>
          <div className="player-hero-team">
            {[cuando ? `${cuando.day} ${cuando.month}` : null,
              partido?.home_score != null ? `${partido.home_score} — ${partido.away_score}` : null,
            ].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>

      {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}
      {aviso && (
        <div className="stats-warning">
          <p>{aviso}</p>
          <button type="button" className="btn btn-flag btn-sm" onClick={() => reclamar(nivel, true)}>
            Tomar el control
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAviso('')}>Cancelar</button>
        </div>
      )}

      {/* ── Lo que todavía vive solo en este teléfono ──
          Mientras no suben, las jugadas viven en UN SOLO LUGAR. Es el mismo
          riesgo que la hoja de papel que esto sustituye, no uno nuevo — pero
          lo que convierte esto en una pérdida es que nadie se entere de que
          todavía vive ahí. */}
      {sinSubir && (
        <div className="offline-pending">
          <span className="offline-dot" aria-hidden="true" />
          <div>
            <strong>{sinSubir}</strong>
            <div className="offline-pending-note">
              Se suben solas en cuanto vuelva la señal. No cierres sesión ni borres los
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
          Sin señal — esto es la copia que bajaste
          {preparado ? ` el ${new Date(preparado).toLocaleString('es-MX')}` : ''}. Lo que captures
          se guarda aquí y sube cuando vuelva el internet.
        </p>
      )}

      {/* ── El panel del visor ── */}
      {puedeCapturar && !sesion && (
        <div className="stats-claim">
          <h3>¿Qué vas a capturar?</h3>
          <p className="stats-claim-note">
            <strong>El nivel no es una preferencia:</strong> de él depende cómo se lee este
            partido. Si capturas solo las anotaciones, el box score sigue saliendo de los
            totales — porque derivarlo de ocho jugadas diría que el equipo entero corrió las
            yardas de sus touchdowns y nada más.
          </p>
          {NIVELES_DE_CAPTURA.map((n) => (
            <button key={n} type="button" className="stats-level" onClick={() => reclamar(n)}>
              <strong>{NIVELES[n].nombre}</strong>
              <span>{NIVELES[n].costo}</span>
              <span className="stats-level-produce">{NIVELES[n].produce}</span>
            </button>
          ))}
        </div>
      )}

      {puedeCapturar && sesion && (
        <div className="stats-capture">
          <div className="stats-drive">
            <div>
              <span className="stats-drive-label">Serie {serie?.number ?? 1}</span>
              <strong>{textoDeDown(proximo)}</strong>
              <span className="stats-drive-team">Balón de {ataque?.name || '—'}</span>
            </div>
            <div className="stats-drive-actions">
              {equipos.map((t) => (
                <button key={t.team_id} type="button" className="btn btn-ghost btn-sm" onClick={() => nuevaSerie(t.team_id)}>
                  Nueva serie · {t.name}
                </button>
              ))}
            </div>
          </div>

          {/* El reloj y la posición se preguntan UNA VEZ por serie. Es la
              decisión que abarata todo: son los tres campos caros y van en la
              primera jugada, no en las ciento veinte. */}
          {deLaSerie.length === 0 && (
            <div className="stats-drive-start">
              <label>
                Empieza en la yarda
                <input
                  type="number" inputMode="numeric" min="0" max="100"
                  value={serie?.yardLine ?? ''}
                  onChange={(e) => setSerie((s) => ({ ...s, yardLine: e.target.value === '' ? null : Number(e.target.value) }))}
                  placeholder="75"
                />
                <small>Yardas que faltan para anotar</small>
              </label>
              <label>
                Reloj
                <input
                  type="text" value={serie?.clock ?? ''}
                  onChange={(e) => setSerie((s) => ({ ...s, clock: e.target.value }))}
                  placeholder="12:40"
                />
                <small>Solo al empezar la serie</small>
              </label>
              <label>
                Periodo
                <select value={serie?.period || '1'} onChange={(e) => setSerie((s) => ({ ...s, period: e.target.value }))}>
                  {['1', '2', '3', '4', 'OT1', 'OT2'].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            </div>
          )}

          {!borrador ? (
            <div className="stats-types">
              {Object.entries(TIPOS).map(([tipo, nombre]) => (
                <button key={tipo} type="button" className="stats-type" onClick={() => empezarJugada(tipo)}>
                  {nombre}
                </button>
              ))}
            </div>
          ) : (
            <BorradorDeJugada
              borrador={borrador}
              setBorrador={setBorrador}
              nivel={nivel}
              ataque={ataque}
              defensa={defensa}
              editando={editando}
              onParticipante={alternarParticipante}
              onGuardar={guardarJugada}
              onCancelar={() => { setBorrador(null); setEditando(null); setError(''); }}
            />
          )}

          {/* La bitácora. Cada jugada se puede corregir o borrar: se corrige LA
              JUGADA, no el total — el box score se recalcula solo porque no se
              guarda en ningún lado. */}
          {jugadas.length > 0 && (
            <div className="stats-log">
              <h4>{jugadas.length} jugada{jugadas.length === 1 ? '' : 's'} capturada{jugadas.length === 1 ? '' : 's'}</h4>
              {[...jugadas].reverse().map((j) => {
                const d = derivados.get(j.client_play_id);
                const enCola = (miPendiente?.plays || []).some((q) => q.client_play_id === j.client_play_id);
                return (
                  <div key={j.client_play_id} className={`stats-log-row${enCola ? ' is-pending' : ''}`}>
                    <div className="stats-log-down">{textoDeDown(d)}</div>
                    <div className="stats-log-what">
                      <strong>{TIPOS[j.play_type]} · {j.yards_gained > 0 ? '+' : ''}{j.yards_gained} yds</strong>
                      {j.points > 0 && <span className="stats-log-points">{j.points} pts</span>}
                      <div className="stats-log-who">
                        {(j.participants || []).map((p) => `${ROLES[p.role]}: ${p.name || `#${p.player_id}`}`).join(' · ') || 'Sin participantes'}
                      </div>
                    </div>
                    <div className="stats-log-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                        setEditando(j);
                        setBorrador({
                          client_play_id: j.client_play_id, play_type: j.play_type,
                          participants: (j.participants || []).map((p) => ({ player_id: p.player_id, role: p.role })),
                          yards_gained: j.yards_gained, points: j.points || 0, scoring_team_id: j.scoring_team_id,
                          sequence: j.sequence,
                        });
                      }}>Corregir</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => borrarJugada(j)}>Borrar</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!deLoLocal && (
            <div className="attendance-prepare">
              <button type="button" className="btn btn-ghost btn-sm" onClick={preparar} disabled={preparando}>
                {preparando ? 'Preparando…' : preparado ? '↻ Volver a preparar' : '⬇ Preparar partido'}
              </button>
              <span className="attendance-prepare-note">
                {preparado
                  ? `Listo: este partido ya se captura sin señal (preparado el ${new Date(preparado).toLocaleString('es-MX')}).`
                  : 'Descárgalo ahora, con internet, para poder capturar en la cancha aunque no haya señal.'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── El box score, para cualquiera ── */}
      <BoxScore box={box} />
    </div>
  );
}

// ── El borrador de una jugada ─────────────────────────────────────────────
//
// Lo que cuesta capturar no son las jugadas, son los campos que obligan a
// mirar a otro lado. Quién llevó el balón y cuántas yardas ganó lo ve la misma
// persona que sigue la jugada; el reloj hay que voltear a verlo y los
// taqueadores hay que buscarlos en el montón. Por eso aquí solo están los
// primeros, y la defensa aparece nada más en nivel `full`.
function BorradorDeJugada({ borrador, setBorrador, nivel, ataque, defensa, editando, onParticipante, onGuardar, onCancelar }) {
  const papeles = PAPELES_POR_TIPO[borrador.play_type] || [];
  const falta = faltaParaGuardar({ ...borrador, yards_gained: borrador.yards_gained === '' ? null : Number(borrador.yards_gained) });

  const tiene = (playerId, role) => borrador.participants.some((p) => p.player_id === playerId && p.role === role);

  return (
    <div className="stats-draft">
      <div className="stats-draft-head">
        <strong>{editando ? 'Corrigiendo' : 'Capturando'}: {TIPOS[borrador.play_type]}</strong>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancelar}>Cancelar</button>
      </div>

      {papeles.map((role) => (
        <div key={role} className="stats-pick">
          <div className="stats-pick-label">{ROLES[role]}</div>
          <div className="stats-pick-grid">
            {(role === 'returner' ? defensa : ataque)?.roster?.map((p) => (
              <button
                key={p.id} type="button"
                className={`stats-num${tiene(p.id, role) ? ' is-on' : ''}`}
                onClick={() => onParticipante(p.id, role)}
                title={`${p.first_name} ${p.last_name}`}
              >
                {p.jersey_number ?? '—'}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* La defensa solo en nivel `full`: es el campo que exige una segunda
          persona, y las guías de preparatoria dicen que se agregue después. */}
      {nivel === 'full' && defensa && (
        <details className="stats-defense">
          <summary>Defensa (opcional)</summary>
          {PAPELES_DE_DEFENSA.map((role) => (
            <div key={role} className="stats-pick">
              <div className="stats-pick-label">{ROLES[role]}</div>
              <div className="stats-pick-grid">
                {defensa.roster.map((p) => (
                  <button
                    key={p.id} type="button"
                    className={`stats-num${tiene(p.id, role) ? ' is-on' : ''}`}
                    onClick={() => onParticipante(p.id, role)}
                    title={`${p.first_name} ${p.last_name}`}
                  >
                    {p.jersey_number ?? '—'}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </details>
      )}

      <div className="stats-yards">
        <div className="stats-pick-label">Yardas</div>
        <div className="stats-yards-row">
          {[-10, -5, -1, 0, 1, 3, 5, 10, 20].map((y) => (
            <button
              key={y} type="button"
              className={`stats-yard${String(borrador.yards_gained) === String(y) ? ' is-on' : ''}`}
              onClick={() => setBorrador((b) => ({ ...b, yards_gained: y }))}
            >
              {y > 0 ? `+${y}` : y}
            </button>
          ))}
          <input
            type="number" inputMode="numeric" className="stats-yard-input"
            value={borrador.yards_gained}
            onChange={(e) => setBorrador((b) => ({ ...b, yards_gained: e.target.value }))}
            placeholder="otras"
          />
        </div>
        <small>Cero también es un valor: un pase incompleto ganó cero.</small>
      </div>

      <div className="stats-score">
        <div className="stats-pick-label">¿Anotó?</div>
        <div className="stats-yards-row">
          {[0, 1, 2, 3, 6].map((pts) => (
            <button
              key={pts} type="button"
              className={`stats-yard${borrador.points === pts ? ' is-on' : ''}`}
              onClick={() => setBorrador((b) => ({
                ...b, points: pts,
                scoring_team_id: pts > 0 ? (b.scoring_team_id ?? ataque?.team_id ?? null) : null,
              }))}
            >
              {pts === 0 ? 'No' : `${pts} pts`}
            </button>
          ))}
        </div>
        {borrador.points > 0 && (
          <div className="stats-yards-row" style={{ marginTop: 8 }}>
            {[ataque, defensa].filter(Boolean).map((t) => (
              <button
                key={t.team_id} type="button"
                className={`stats-yard${borrador.scoring_team_id === t.team_id ? ' is-on' : ''}`}
                onClick={() => setBorrador((b) => ({ ...b, scoring_team_id: t.team_id }))}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <button type="button" className="btn btn-flag stats-save" onClick={onGuardar} disabled={Boolean(falta)}>
        {falta || (editando ? 'Guardar la corrección' : 'Guardar jugada')}
      </button>
    </div>
  );
}

// ── El box score ──────────────────────────────────────────────────────────
function BoxScore({ box }) {
  if (!box) return null;

  const porEquipo = new Map();
  for (const p of box.players || []) {
    const k = p.team_id ?? 0;
    if (!porEquipo.has(k)) porEquipo.set(k, []);
    porEquipo.get(k).push(p);
  }

  const nombreDe = (teamId) => (
    teamId === box.match.home_team_id ? box.match.home_team
      : teamId === box.match.away_team_id ? box.match.away_team
        : 'Sin equipo'
  );

  return (
    <div className="box-score">
      <h3>Box score</h3>

      {/* De dónde salió este box score. Viaja siempre y se dice siempre: un
          partido capturado solo en anotaciones TIENE jugadas y aun así sus
          números vienen de los totales, y quien lo lee tiene derecho a saberlo
          en vez de suponer. */}
      <p className="box-score-source">
        {box.source === 'plays'
          ? `Derivado de las jugadas capturadas (nivel ${NIVELES[box.capture_level]?.nombre?.toLowerCase() || box.capture_level}). No se guarda: se suma.`
          : box.capture_level === 'scoring'
            ? 'Este partido se capturó solo en anotaciones, así que sus jugadas dicen quién anotó pero no alcanzan para un box score. Estos números son los totales capturados a mano.'
            : 'Totales capturados a mano.'}
      </p>

      {box.points_by_team && box.match.home_score != null && (
        <ContrasteDeMarcador box={box} />
      )}

      {(box.players || []).length === 0 ? (
        <p className="player-empty-note">Todavía no hay estadísticas de este partido.</p>
      ) : (
        [...porEquipo.entries()].map(([teamId, jugadores]) => (
          <div key={teamId} className="box-score-team">
            <h4>{nombreDe(Number(teamId))}</h4>
            {BLOQUES.map((bloque) => {
              const conAlgo = jugadores.filter((p) => bloque.cols.some(([k]) => Number(p[k]) > 0));
              if (conAlgo.length === 0) return null;
              return (
                <div key={bloque.titulo} className="box-score-block">
                  <div className="box-score-block-title">{bloque.titulo}</div>
                  <table className="box-score-table">
                    <thead>
                      <tr>
                        <th>Jugador</th>
                        {bloque.cols.map(([k, etiqueta]) => <th key={k}>{etiqueta}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {conAlgo.map((p) => (
                        <tr key={p.player_id}>
                          <td>{p.jersey_number != null ? `#${p.jersey_number} ` : ''}{p.name || `Jugador ${p.player_id}`}</td>
                          {bloque.cols.map(([k]) => <td key={k}>{p[k] ?? '—'}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}

// La suma de puntos de las jugadas es una SEGUNDA lectura del marcador, no un
// reemplazo: `matches.home_score` se sigue capturando a mano. Cuando las dos no
// cuadran, esto lo dice — y no corrige nada, porque cuál de las dos está mal es
// algo que la plataforma no puede saber (regla 10).
function ContrasteDeMarcador({ box }) {
  const { home_team_id: local, away_team_id: visita, home_score: hs, away_score: as } = box.match;
  const deJugadas = box.points_by_team || {};
  const cuadra = Number(deJugadas[local] || 0) === Number(hs) && Number(deJugadas[visita] || 0) === Number(as);
  if (cuadra) return null;

  return (
    <div className="box-score-mismatch">
      <strong>El marcador y las jugadas no cuadran.</strong>{' '}
      El marcador publicado dice {hs}–{as} y las jugadas capturadas suman{' '}
      {Number(deJugadas[local] || 0)}–{Number(deJugadas[visita] || 0)}. Puede faltar una jugada
      por capturar, o el marcador puede estar mal. Aquí no se corrige solo: hay que revisarlo.
    </div>
  );
}
