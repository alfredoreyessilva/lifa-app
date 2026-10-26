import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import Loading from './Loading.jsx';
import StandingsView from './StandingsView.jsx';
import { api } from '../api/client.js';

// Cómo se compite en esta rama: las fases del calendario, a qué nivel se
// corona campeón, y con qué reglamento se ordena y se desempata la tabla.
//
// Las cuatro pestañas son el mismo modelo visto por partes, y ese es el orden
// en que hay que llenarlo: primero las FASES (qué juegos cuentan), luego el
// FORMATO (cómo se ordena), luego los TÍTULOS (dónde hay campeón) y al final
// la VISTA PREVIA, que es la misma tabla que va a ver el público.
//
// No hay "guardar" general a propósito: cada sección guarda lo suyo al
// aplicarla. Un solo botón al final obligaría a mantener en memoria tres
// listas editables y a decidir qué pasa si una falla y las otras no.

const TABS = [
  { key: 'phases',  label: 'Fases' },
  { key: 'format',  label: 'Formato' },
  { key: 'titles',  label: 'Títulos' },
  { key: 'preview', label: 'Vista previa' },
];

const LEVEL_LABEL = {
  branch: 'General (toda la rama)',
  conference: 'Por conferencia',
  group: 'Por grupo',
};

const SCOPE_LABEL = { branch: 'Toda la rama', conference: 'Cada conferencia', group: 'Cada grupo' };

export default function CompetitionModelModal({ branch, token, onClose }) {
  const [tab, setTab] = useState('phases');
  const [catalog, setCatalog] = useState(null);
  const [phases, setPhases] = useState([]);
  const [weekLabels, setWeekLabels] = useState([]);
  const [titles, setTitles] = useState([]);
  const [standings, setStandings] = useState(null);
  const [onefa, setOnefa] = useState(null);
  const [onefaOpen, setOnefaOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Qué niveles tiene SENTIDO ofrecer: no se puede pedir tabla por
  // conferencia en una rama que no tiene conferencias.
  const hasConferences = (branch.conferences || []).length > 0;
  const hasGroups = (branch.conferences || []).some((cf) => (cf.groups || []).length > 0)
    || (branch.directGroups || []).length > 0;

  async function reload() {
    setError('');
    try {
      const [cat, ph, ti, st, onefaMode] = await Promise.all([
        api.getStandingsCatalog(token),
        api.getPhases(branch.id, token),
        api.getTitles(branch.id, token),
        api.getBranchStandingsAdmin(branch.id, token),
        // El Modo ONEFA es un extra: si falla, el resto del panel sirve igual.
        api.getOnefaMode(branch.id, token).catch(() => null),
      ]);
      setCatalog(cat); setPhases(ph.phases || []); setWeekLabels(ph.week_labels || []);
      setTitles(ti); setStandings(st); setOnefa(onefaMode);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [branch.id]);

  return (
    <Modal title={`Competencia · ${branch.name}`} onClose={onClose}>
      <div className="competition-modal">
        <div className="tab-bar">
          {TABS.map((t) => (
            <button key={t.key} className={`tab-btn ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {error && <div className="form-error">{error}</div>}

        {!loading && onefa?.available && (
          onefaOpen ? (
            <OnefaModePanel
              branch={branch} token={token} onefa={onefa}
              onApplied={reload} onClose={() => setOnefaOpen(false)} setError={setError}
            />
          ) : (
            <div className="competition-onefa-bar">
              <button type="button" className="btn btn-flag btn-sm" onClick={() => setOnefaOpen(true)}>
                Modo ONEFA
              </button>
              <span className="competition-help">Configura fases, tablas, desempate, clasificación y campeón como juega ONEFA.</span>
            </div>
          )
        )}

        {loading ? <Loading /> : (
          <>
            {tab === 'phases' && (
              <PhasesTab
                branch={branch} token={token} phases={phases}
                phaseTypes={catalog.phase_types} tiebreakers={catalog.tiebreakers}
                onChanged={reload} setError={setError}
                hasConferences={hasConferences} hasGroups={hasGroups}
                weekLabels={weekLabels}
              />
            )}
            {tab === 'format' && (
              <FormatTab
                branch={branch} token={token} catalog={catalog}
                config={standings?.branch} hasConferences={hasConferences} hasGroups={hasGroups}
                onChanged={reload} setError={setError}
              />
            )}
            {tab === 'titles' && (
              <TitlesTab
                branch={branch} token={token} titles={titles} phases={phases}
                standings={standings} hasConferences={hasConferences} hasGroups={hasGroups}
                onChanged={reload} setError={setError}
              />
            )}
            {tab === 'preview' && (
              <div className="standings-preview">
                <StandingsView
                  data={standings}
                  emptyText="Inscribe equipos en la rama y captura partidos con marcador para que aparezca la tabla."
                />
              </div>
            )}
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Modo ONEFA ---------- */

// La competencia completa de ONEFA de un clic (README, "Modo ONEFA"). Antes de
// aplicar enseña todo lo que va a quedar y deja elegir, por conferencia, cómo
// clasifica. El plan lo arma el backend: aquí solo se pinta, para que lo que
// se ve sea exactamente lo que se escribe.
const PHASE_TYPE_LABEL = {
  groups: 'Fase de grupos', round_robin: 'Todos contra todos', single_elimination: 'Eliminación directa',
};

function OnefaModePanel({ branch, token, onefa, onApplied, onClose, setError }) {
  const [choices, setChoices] = useState(
    Object.fromEntries((onefa.conferences || []).map((c) => [c.id, c.choice])));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const plan = onefa.plan;

  async function apply() {
    setBusy(true); setError('');
    try {
      await api.applyOnefaMode(branch.id, choices, token);
      setDone(true);
      await onApplied();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  if (done) {
    return (
      <div className="competition-onefa">
        <div className="competition-note">✓ La rama quedó en Modo ONEFA.</div>
        <p className="competition-help">
          Al capturar cuartos, semifinales y final, elige su <strong>fase</strong> en el partido:
          el campeón de cada conferencia sale del partido de la fase Final.
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Listo</button>
      </div>
    );
  }

  return (
    <div className="competition-onefa">
      <div className="competition-item-name">Modo ONEFA</div>

      {onefa.blocked_reason ? (
        <div className="form-error">{onefa.blocked_reason}</div>
      ) : plan && (
        <ul className="competition-onefa-plan">
          <li>
            <strong>Tablas:</strong>{' '}
            {plan.standings.standings_levels.map((l) => LEVEL_LABEL[l].toLowerCase()).join(' y ')}, sin tabla general.
          </li>
          <li>
            <strong>Desempate:</strong> ganados → entre sí → goal average; con tres o más, primero quien
            les ganó a todos y, si nadie, menos puntos en contra.
          </li>
          <li>
            <strong>Fases:</strong>{' '}
            {plan.phases.map((p) => `${p.name} (${PHASE_TYPE_LABEL[p.type] || p.type}${p.counts_for_standings ? ', cuenta' : ''})`).join(' · ')}.
          </li>
          <li>
            <strong>Quién clasifica a cuartos:</strong>
            {(onefa.conferences || []).map((c) => (
              <div key={c.id} className="competition-onefa-conf">
                <span>{c.name}{c.groups.length ? ` (${c.groups.join(', ')})` : ''}</span>
                <select
                  value={choices[c.id]}
                  onChange={(e) => setChoices({ ...choices, [c.id]: e.target.value })}
                >
                  {onefa.choices.map((o) => (
                    <option key={o.key} value={o.key} disabled={o.key === 'groups' && !c.can_use_groups}>{o.label}</option>
                  ))}
                </select>
              </div>
            ))}
            <span className="competition-help">Los mejores terceros se comparan por % de ganados y luego por goal average.</span>
          </li>
          <li>
            <strong>Título:</strong> “{plan.titles[0].name}”, lo gana el ganador del partido de la Final, uno por conferencia.
          </li>
        </ul>
      )}

      <div className="competition-onefa-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancelar</button>
        {!onefa.blocked_reason && plan && (
          <button type="button" className="btn btn-flag btn-sm" onClick={apply} disabled={busy}>
            {busy ? 'Aplicando…' : 'Aplicar modo ONEFA'}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- Fases ---------- */

function PhasesTab({ branch, token, phases, phaseTypes, tiebreakers, onChanged, setError, hasConferences, hasGroups, weekLabels }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('round_robin');
  const [adopt, setAdopt] = useState([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  // Jornadas que todavía tienen partidos sin fase. Son las que se pueden
  // adoptar; una vez adoptadas desaparecen de la lista solas.
  const adoptables = (weekLabels || []).filter((w) => w.unassigned > 0);

  async function add(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setError(''); setNote('');
    try {
      const creada = await api.createPhase(branch.id, {
        name: name.trim(), type, sort_order: phases.length, adopt_week_labels: adopt,
      }, token);
      if (creada.adopted > 0) {
        setNote(`Se asignaron ${creada.adopted} partido${creada.adopted === 1 ? '' : 's'} a “${creada.name}”.`);
      }
      setName(''); setType('round_robin'); setAdopt([]);
      await onChanged();
    } catch (e2) { setError(e2.message); }
    setBusy(false);
  }

  async function toggleCounts(p) {
    setError('');
    try {
      await api.updatePhase(p.id, { counts_for_standings: !p.counts_for_standings }, token);
      await onChanged();
    } catch (e) { setError(e.message); }
  }

  async function remove(p) {
    setError('');
    try { await api.deletePhase(p.id, token); await onChanged(); }
    catch (e) { setError(e.message); }
  }

  return (
    <div>
      <p className="competition-help">
        Cada fase declara su <strong>sistema de competencia</strong>: todos contra todos,
        fase de grupos, eliminación directa, sistema suizo. Eso describe cómo se juega, y
        aparte se dice si cuenta o no para la tabla — son dos cosas distintas (hay ligas
        donde el repechaje sí suma).
        Si no creas ninguna fase, se deduce de la jornada del partido
        (FINAL, SEMIFINAL, PLAYOFF y SCRIMMAGE no cuentan), así que tu tabla
        sale bien desde hoy sin capturar nada.
      </p>

      {phases.length === 0 ? (
        <div className="competition-empty">Sin fases propias. Se está usando la deducción por jornada.</div>
      ) : (
        <ul className="competition-list">
          {phases.map((p) => (
            <li key={p.id} className="competition-phase">
              <div className="competition-phase-head">
                <div>
                  <div className="competition-item-name">{p.name}</div>
                  <div className="competition-item-meta">
                    {(phaseTypes.find((t) => t.key === p.type) || {}).label || p.type}
                    {' · '}{p.match_count} partido{p.match_count === 1 ? '' : 's'}
                  </div>
                </div>
                <span className="tree-spacer" />
                <button
                  className={`competition-chip ${p.counts_for_standings ? 'is-on' : ''}`}
                  onClick={() => toggleCounts(p)}
                  title="Si cuenta o no para la tabla de posiciones"
                >
                  {p.counts_for_standings ? 'cuenta' : 'no cuenta'}
                </button>
                <button className="tree-chip-btn" onClick={() => remove(p)} title="Eliminar fase">✕</button>
              </div>

              {/* La clasificación solo tiene sentido en una fase que produce
                  tabla: de una eliminatoria no "clasifica el primero", avanza
                  quien gana su partido. */}
              {p.counts_for_standings && (
                <QualificationRules
                  phase={p} token={token} onChanged={onChanged} setError={setError}
                  conferences={branch.conferences || []} tiebreakers={tiebreakers}
                  hasConferences={hasConferences} hasGroups={hasGroups}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="competition-add">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej. Temporada regular"
          maxLength={60}
        />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {phaseTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <button className="btn btn-flag btn-sm" disabled={busy || !name.trim()}>Agregar</button>

        {adoptables.length > 0 && (
          <div className="competition-adopt">
            <div className="competition-adopt-title">
              ¿Qué jornadas van en esta fase? (opcional)
            </div>
            <div className="competition-adopt-chips">
              {adoptables.map((w) => (
                <button
                  type="button"
                  key={w.label}
                  className={`competition-chip ${adopt.includes(w.label) ? 'is-on' : ''}`}
                  onClick={() => setAdopt((prev) => prev.includes(w.label)
                    ? prev.filter((x) => x !== w.label)
                    : [...prev, w.label])}
                  title={`${w.unassigned} de ${w.total} partidos sin fase`}
                >
                  {w.label} · {w.unassigned}
                </button>
              ))}
            </div>
            <p className="competition-help" style={{ margin: '6px 0 0' }}>
              Sus partidos pasan a esta fase de un golpe. Solo se tocan los que no
              tienen fase todavía — lo que ya asignaste a mano no se pisa.
            </p>
          </div>
        )}
      </form>

      {note && <div className="competition-note">✓ {note}</div>}
    </div>
  );
}

// "De esta fase pasan los primeros N de cada grupo." Es OTRA cosa que el
// desempate: el desempate ORDENA la tabla, esto dice dónde va el corte.
//
// Una fase puede tener una regla por conferencia (README, "Clasificación:
// quién avanza"): en ONEFA, de la misma temporada regular 14 Grandes
// clasifica por su tabla y Nacional por grupos. La regla de una conferencia
// manda en ella; la de "todas las conferencias" vale para las que no tienen
// la suya.
function QualificationRules({ phase, token, onChanged, setError, conferences, tiebreakers, hasConferences, hasGroups }) {
  const rules = phase.qualifications || [];
  const [busy, setBusy] = useState(false);

  // La primera regla es de toda la rama, que es como funcionó siempre; las
  // siguientes van a la primera conferencia que no tenga la suya. Si ya todas
  // tienen, no hay a quién ponerle otra.
  const ocupadas = new Set(rules.map((r) => r.conference_id ?? null));
  const libre = rules.length === 0 ? null
    : (conferences.find((c) => !ocupadas.has(c.id)) || {}).id;

  async function add() {
    setBusy(true); setError('');
    try {
      await api.setPhaseQualification(phase.id, {
        from_scope: libre == null ? 'branch' : 'conference', top_n: 1, conference_id: libre,
      }, token);
      await onChanged();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  return (
    <div className="competition-qual-list">
      {rules.map((rule) => (
        <QualificationRow
          key={rule.id} phase={phase} rule={rule} token={token} onChanged={onChanged} setError={setError}
          conferences={conferences} ocupadas={ocupadas} tiebreakers={tiebreakers}
          hasConferences={hasConferences} hasGroups={hasGroups}
        />
      ))}
      {(rules.length === 0 || libre !== undefined) && (
        <button type="button" className="competition-qual-add" onClick={add} disabled={busy}>
          {rules.length === 0 ? '+ definir quién clasifica' : '+ otra regla para otra conferencia'}
        </button>
      )}
    </div>
  );
}

// Una regla. Se guarda al cambiar cualquiera de sus controles — es una regla
// de pocos campos, un botón "guardar" aparte sería más clics que la regla
// misma.
function QualificationRow({ phase, rule, token, onChanged, setError, conferences, ocupadas, tiebreakers, hasConferences, hasGroups }) {
  const [scope, setScope] = useState(rule.from_scope || 'branch');
  const [topN, setTopN] = useState(rule.top_n || 1);
  const [plusN, setPlusN] = useState(rule.plus_best_n || 0);
  const [busy, setBusy] = useState(false);
  const confId = rule.conference_id ?? null;

  // Lo que la pantalla no edita viaja de vuelta tal cual (la fase de destino y
  // con qué se comparan los lugares extra): el PUT reemplaza la regla entera,
  // y sin esto editar el número borraría lo que puso el Modo ONEFA.
  async function save(next = {}) {
    const cuerpo = {
      conference_id:     next.conferenceId !== undefined ? next.conferenceId : confId,
      from_scope:        next.scope ?? scope,
      top_n:             Number(next.topN ?? topN),
      plus_best_n:       Number(next.plusN ?? plusN),
      target_phase_id:   rule.target_phase_id ?? null,
      cross_tiebreakers: rule.cross_tiebreakers ?? null,
    };
    setBusy(true); setError('');
    try {
      await api.setPhaseQualification(phase.id, cuerpo, token);
      // Cambiar de conferencia es mover la regla: se guarda la nueva y
      // después se quita la vieja, para que un error no la deje sin ninguna.
      if (next.conferenceId !== undefined && next.conferenceId !== confId) {
        await api.clearPhaseQualification(phase.id, confId, token);
      }
      await onChanged();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  async function clear() {
    setBusy(true); setError('');
    try { await api.clearPhaseQualification(phase.id, confId, token); await onChanged(); }
    catch (e) { setError(e.message); }
    setBusy(false);
  }

  const labelOf = (key) => (tiebreakers.find((t) => t.key === key) || {}).label || key;

  return (
    <div className="competition-qual">
      <span>Clasifican los primeros</span>
      <input
        type="number" min="1" value={topN}
        onChange={(e) => setTopN(e.target.value)}
        onBlur={(e) => Number(e.target.value) > 0 && save({ topN: e.target.value })}
      />
      <span>de</span>
      <select value={scope} onChange={(e) => { setScope(e.target.value); save({ scope: e.target.value }); }}>
        <option value="branch" disabled={confId !== null}>la tabla general</option>
        <option value="conference" disabled={!hasConferences}>cada conferencia</option>
        <option value="group" disabled={!hasGroups}>cada grupo</option>
      </select>

      {hasConferences && (
        <>
          <span>en</span>
          <select
            value={confId ?? ''}
            onChange={(e) => save({ conferenceId: e.target.value ? Number(e.target.value) : null })}
            disabled={busy}
          >
            <option value="" disabled={confId !== null && ocupadas.has(null)}>todas las conferencias</option>
            {conferences.map((c) => (
              <option key={c.id} value={c.id} disabled={c.id !== confId && ocupadas.has(c.id)}>{c.name}</option>
            ))}
          </select>
        </>
      )}

      {/* Los lugares extra (wild cards, "mejores terceros"). Solo tienen
          sentido cuando hay VARIAS tablas que comparar entre sí: con una
          sola tabla general, el siguiente mejor ya es el lugar de abajo. */}
      {scope !== 'branch' && (
        <>
          <span>+ los</span>
          <input
            type="number" min="0" value={plusN}
            onChange={(e) => setPlusN(e.target.value)}
            onBlur={(e) => Number(e.target.value) >= 0 && save({ plusN: e.target.value })}
          />
          <span>mejores del lugar {Number(topN) + 1}</span>
        </>
      )}

      <button type="button" className="tree-chip-btn" onClick={clear} disabled={busy} title="Quitar la regla">✕</button>

      {Number(plusN) > 0 && Array.isArray(rule.cross_tiebreakers) && rule.cross_tiebreakers.length > 0 && (
        <p className="competition-help" style={{ flexBasis: '100%', margin: '4px 0 0' }}>
          Los mejores del lugar {Number(topN) + 1} se comparan por: {rule.cross_tiebreakers.map(labelOf).join(' → ')}.
        </p>
      )}
    </div>
  );
}

/* ---------- Formato de la tabla ---------- */

function FormatTab({ branch, token, catalog, config, hasConferences, hasGroups, onChanged, setError }) {
  const [levels, setLevels] = useState(config?.standings_levels || ['branch']);
  const [keys, setKeys] = useState(config?.tiebreakers || []);
  const [mode, setMode] = useState(config?.multi_team_mode || 'restart');

  // Reglamento propio por nivel de tabla. Vacío = todos heredan el de la
  // rama, que es como vive el 95% de las ligas. `editando` es qué se está
  // viendo: 'default' (el de la rama) o un nivel concreto.
  const [byLevel, setByLevel] = useState(config?.by_level || {});
  const [editando, setEditando] = useState('default');
  const [usePoints, setUsePoints] = useState(Boolean(config?.uses_points));
  const [pts, setPts] = useState({
    win: config?.points_win ?? 3, draw: config?.points_draw ?? 1, loss: config?.points_loss ?? 0,
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const byKey = Object.fromEntries(catalog.tiebreakers.map((t) => [t.key, t]));

  // Qué lista está editando la pantalla: la de la rama, o la propia de un
  // nivel. Si el nivel no tiene una propia todavía, se muestra la heredada
  // (de solo lectura hasta que la persona decida separarla).
  const propio = editando !== 'default' ? byLevel[editando] : null;
  const heredando = editando !== 'default' && !propio;
  const keysActuales = propio ? propio.tiebreakers : keys;
  const modeActual = propio ? (propio.multi_team_mode || 'restart') : mode;
  const available = catalog.tiebreakers.filter((t) => !keysActuales.includes(t.key));

  // Escribe la lista/modo en el lugar correcto según lo que se esté editando.
  //
  // Todas usan la forma funcional de setByLevel — `prev` en vez de la variable
  // `byLevel` del render — y no es estilo: aplicar un preconfigurado llama a
  // setCriterios Y a setModo en el mismo evento, y con la variable del render
  // las dos partirían del MISMO objeto viejo, así que la segunda pisaba a la
  // primera y el cambio de criterios se perdía en silencio.
  function setCriterios(lista) {
    if (editando === 'default') setKeys(lista);
    else setByLevel((prev) => ({ ...prev, [editando]: { ...prev[editando], tiebreakers: lista } }));
    setSaved(false);
  }
  function setModo(m) {
    if (editando === 'default') setMode(m);
    else setByLevel((prev) => ({ ...prev, [editando]: { ...prev[editando], multi_team_mode: m } }));
    setSaved(false);
  }
  // Separar un nivel del reglamento de la rama: arranca con una COPIA del
  // heredado, no vacío, para que se edite desde donde ya estaba.
  function separarNivel() {
    setByLevel((prev) => ({ ...prev, [editando]: { tiebreakers: [...keys], multi_team_mode: mode } }));
    setSaved(false);
  }
  function volverAHeredar() {
    setByLevel((prev) => {
      const copia = { ...prev };
      delete copia[editando];
      return copia;
    });
    setSaved(false);
  }

  function applyPreset(p) {
    setCriterios(p.tiebreakers);
    setModo(p.multi_team_mode);
    // El sistema de puntos es de la rama entera, no de un nivel: no tendría
    // sentido que la misma temporada valiera 3 puntos en una tabla y 2 en otra.
    const hasPts = p.points_win !== null && p.points_win !== undefined;
    setUsePoints(hasPts);
    if (hasPts) setPts({ win: p.points_win, draw: p.points_draw, loss: p.points_loss });
    setSaved(false);
  }

  function move(i, delta) {
    const next = [...keysActuales];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setCriterios(next);
  }

  function toggleLevel(l) {
    setLevels((prev) => (prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]));
    setSaved(false);
  }

  async function save() {
    setBusy(true); setError(''); setSaved(false);
    try {
      await api.updateStandingsConfig(branch.id, {
        standings_levels: levels.length ? levels : ['branch'],
        tiebreakers: keys,
        tiebreaker_mode: mode,
        tiebreakers_by_level: byLevel,
        points_win:  usePoints ? Number(pts.win)  : null,
        points_draw: usePoints ? Number(pts.draw) : null,
        points_loss: usePoints ? Number(pts.loss) : null,
      }, token);
      await onChanged();
      setSaved(true);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  return (
    <div>
      <div className="field">
        <label>Qué tablas se publican</label>
        <div className="competition-checks">
          {['branch', 'conference', 'group'].map((l) => {
            const disabled = (l === 'conference' && !hasConferences) || (l === 'group' && !hasGroups);
            return (
              <label key={l} className={disabled ? 'is-disabled' : ''}>
                <input
                  type="checkbox" disabled={disabled}
                  checked={levels.includes(l)} onChange={() => toggleLevel(l)}
                />
                {LEVEL_LABEL[l]}
                {disabled && <span className="competition-item-meta"> — esta rama no tiene</span>}
              </label>
            );
          })}
        </div>
        <p className="competition-help">
          Se pueden publicar varias a la vez. Si en tu liga no hay juegos entre conferencias,
          <strong> quita la general</strong>: una tabla que mezcla equipos que nunca se enfrentaron no
          significa nada.
        </p>
      </div>

      <div className="field">
        <label>Reglamento de desempate</label>

        {/* Solo aparece si la rama publica más de una tabla. Con una sola,
            elegir "a cuál aplica" sería una pregunta sin sentido. */}
        {levels.length > 1 && (
          <>
            <div className="competition-level-tabs">
              <button
                type="button"
                className={`competition-chip ${editando === 'default' ? 'is-on' : ''}`}
                onClick={() => setEditando('default')}
              >
                Todas las tablas
              </button>
              {levels.map((l) => (
                <button
                  type="button"
                  key={l}
                  className={`competition-chip ${editando === l ? 'is-on' : ''}`}
                  onClick={() => setEditando(l)}
                >
                  {LEVEL_LABEL[l]}{byLevel[l] ? ' ·' : ''}
                </button>
              ))}
            </div>
            <p className="competition-help" style={{ margin: '6px 0 10px' }}>
              {editando === 'default'
                ? 'Este es el reglamento base: lo usa toda tabla que no tenga uno propio.'
                : heredando
                  ? 'Esta tabla usa el reglamento base. Sepárala solo si su empate se resuelve distinto — pasa cuando una tabla compara equipos que no comparten calendario.'
                  : 'Esta tabla tiene reglamento propio; el base no la afecta.'}
            </p>
            {editando !== 'default' && (
              <div className="competition-presets" style={{ marginBottom: 10 }}>
                {heredando
                  ? <button type="button" className="btn btn-outline btn-sm" onClick={separarNivel}>Darle reglamento propio</button>
                  : <button type="button" className="btn btn-ghost btn-sm" onClick={volverAHeredar}>Volver a usar el base</button>}
              </div>
            )}
          </>
        )}

        <div className="competition-presets">
          {catalog.presets.map((p) => (
            <button key={p.key} type="button" className="btn btn-outline btn-sm" onClick={() => applyPreset(p)} title={p.description}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <ol className={`competition-criteria ${heredando ? 'is-inherited' : ''}`}>
        {keysActuales.map((k, i) => (
          <li key={k}>
            <span className="competition-criteria-num">{i + 1}</span>
            <span>
              {byKey[k]?.label || k}
              {byKey[k]?.help && <span className="competition-item-meta"> {byKey[k].help}</span>}
            </span>
            <span className="tree-spacer" />
            <button type="button" className="tree-chip-btn" onClick={() => move(i, -1)} disabled={heredando || i === 0}>↑</button>
            <button type="button" className="tree-chip-btn" onClick={() => move(i, 1)} disabled={heredando || i === keysActuales.length - 1}>↓</button>
            <button type="button" className="tree-chip-btn" disabled={heredando} onClick={() => setCriterios(keysActuales.filter((x) => x !== k))}>✕</button>
          </li>
        ))}
      </ol>

      {available.length > 0 && !heredando && (
        <select
          value="" className="competition-add-select"
          onChange={(e) => { if (e.target.value) setCriterios([...keysActuales, e.target.value]); }}
        >
          <option value="">+ Agregar criterio…</option>
          {available.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      )}

      <div className="field" style={{ marginTop: 16 }}>
        <label>Si empatan tres o más</label>
        <select value={modeActual} disabled={heredando} onChange={(e) => setModo(e.target.value)}>
          <option value="restart">Reiniciar el reglamento con los que queden</option>
          <option value="sequential">Seguir con el criterio siguiente</option>
          <option value="dominant_or_points_against">Primero quien les ganó a todos; si nadie, menos puntos en contra</option>
        </select>
        <p className="competition-help">
          No es lo mismo: al salir un equipo del empate, el criterio "entre sí" pasa a
          calcularse sobre otros partidos. Reiniciar vuelve a preguntarlo con los que
          quedan; seguir de largo usa números de un grupo que ya cambió. La tercera
          opción no sigue la lista con tres o más: va primero quien les ganó en la
          cancha a todos los demás, y si nadie, el grupo entero se ordena por menos
          puntos en contra; lo que siga empatado, por goal average.
        </p>
      </div>

      <div className="field">
        <label>
          <input
            type="checkbox" checked={usePoints}
            onChange={(e) => { setUsePoints(e.target.checked); setSaved(false); }}
          />
          {' '}Usar sistema de puntos
        </label>
        {usePoints ? (
          <div className="competition-points">
            {[['win', 'Ganar'], ['draw', 'Empatar'], ['loss', 'Perder']].map(([k, label]) => (
              <label key={k}>
                {label}
                <input
                  type="number" value={pts[k]}
                  onChange={(e) => { setPts({ ...pts, [k]: e.target.value }); setSaved(false); }}
                />
              </label>
            ))}
          </div>
        ) : (
          <p className="competition-help">
            Sin sistema de puntos, la tabla se ordena por el primer criterio de tu lista
            de arriba — juegos ganados o porcentaje de ganados, según cuál hayas puesto.
          </p>
        )}
      </div>

      <div className="modal-actions" style={{ marginTop: 8 }}>
        {saved && <span className="competition-saved">✓ Guardado</span>}
        <button type="button" className="btn btn-flag" onClick={save} disabled={busy || !keys.length}>
          {busy ? 'Guardando…' : 'Guardar formato'}
        </button>
      </div>
    </div>
  );
}

/* ---------- Títulos ---------- */

function TitlesTab({ branch, token, titles, phases, standings, hasConferences, hasGroups, onChanged, setError }) {
  const [form, setForm] = useState({ name: '', scope: 'branch', decided_by: 'match', phase_id: '' });
  const [busy, setBusy] = useState(false);

  // Un título que se gana en un partido casi siempre se juega en una fase de
  // eliminación. Se ofrecen esas primero; si la rama no tiene ninguna, se
  // ofrecen todas, porque hay torneos donde la final es el último juego del
  // todos-contra-todos y no una fase aparte.
  const ELIMINACION = ['single_elimination', 'double_elimination', 'series'];
  const deEliminacion = phases.filter((p) => ELIMINACION.includes(p.type));
  const usablePhases = deEliminacion.length ? deEliminacion : phases;

  async function add(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.createTitle(branch.id, {
        name: form.name.trim(),
        scope: form.scope,
        decided_by: form.decided_by,
        phase_id: form.decided_by === 'match' ? Number(form.phase_id) : null,
        sort_order: titles.length,
      }, token);
      setForm({ name: '', scope: 'branch', decided_by: 'match', phase_id: '' });
      await onChanged();
    } catch (e2) { setError(e2.message); }
    setBusy(false);
  }

  async function remove(t) {
    setError('');
    try { await api.deleteTitle(t.id, token); await onChanged(); }
    catch (e) { setError(e.message); }
  }

  const winnersOf = (titleId) =>
    (standings?.titles || []).find((t) => t.id === titleId)?.winners?.filter((w) => w.team_id) || [];

  return (
    <div>
      <p className="competition-help">
        Un título por cada nivel donde tu liga corona campeón. Una liga de todos contra
        todos con final tiene uno solo; una con dos conferencias que no se cruzan tiene
        uno por conferencia y ninguno general; una con divisiones dentro de conferencias
        puede tener los tres niveles. <strong>Si no hay campeón general, no crees ese
        título</strong> — esa ausencia es justo como se representa que las conferencias
        no se enfrentan entre sí.
      </p>

      {titles.length === 0 ? (
        <div className="competition-empty">Sin títulos declarados todavía.</div>
      ) : (
        <ul className="competition-list">
          {titles.map((t) => {
            const winners = winnersOf(t.id);
            return (
              <li key={t.id}>
                <div>
                  <div className="competition-item-name">{t.name}</div>
                  <div className="competition-item-meta">
                    {SCOPE_LABEL[t.scope]}
                    {' · '}
                    {t.decided_by === 'standings' ? 'primer lugar de la tabla' : `ganador de ${t.phase_name || 'la fase'}`}
                  </div>
                  {winners.length > 0 && (
                    <div className="competition-item-meta">
                      Campeón: {winners.map((w) => `${w.team_name}${w.scope_name ? ` (${w.scope_name})` : ''}`).join(' · ')}
                    </div>
                  )}
                </div>
                <span className="tree-spacer" />
                <button className="tree-chip-btn" onClick={() => remove(t)} title="Eliminar título">✕</button>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={add} className="competition-add competition-add--stack">
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Ej. Campeón de Conferencia"
          maxLength={60}
        />
        <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
          <option value="branch">{SCOPE_LABEL.branch}</option>
          <option value="conference" disabled={!hasConferences}>{SCOPE_LABEL.conference}</option>
          <option value="group" disabled={!hasGroups}>{SCOPE_LABEL.group}</option>
        </select>
        <select value={form.decided_by} onChange={(e) => setForm({ ...form, decided_by: e.target.value })}>
          <option value="match">Lo gana el ganador de un partido</option>
          <option value="standings">Lo gana el primer lugar de la tabla</option>
        </select>
        {form.decided_by === 'match' && (
          <select value={form.phase_id} onChange={(e) => setForm({ ...form, phase_id: e.target.value })}>
            <option value="">¿En qué fase se juega?…</option>
            {usablePhases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <button
          className="btn btn-flag btn-sm"
          disabled={busy || !form.name.trim() || (form.decided_by === 'match' && !form.phase_id)}
        >
          Agregar título
        </button>
      </form>

      {form.decided_by === 'match' && phases.length === 0 && (
        <p className="competition-help">
          Primero crea la fase en la que se juega (pestaña <strong>Fases</strong>) — un título
          por partido necesita saber de qué partido se trata.
        </p>
      )}
    </div>
  );
}
