import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import TournamentForm from '../components/TournamentForm.jsx';
import CategoryForm from '../components/CategoryForm.jsx';

export default function TournamentFormTestPage() {
  const { token, leagues } = useAuth();
  const [leagueId, setLeagueId] = useState(leagues[0]?.id || '');
  const [testYear, setTestYear] = useState('2026');
  const [result, setResult] = useState(null);
  const [key, setKey] = useState(0); // fuerza a vaciar el formulario de torneo tras guardar
  const [list, setList] = useState(null);

  const [selectedTournamentId, setSelectedTournamentId] = useState('');
  const [categoryKey, setCategoryKey] = useState(0);
  const [categoryList, setCategoryList] = useState(null);

  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [branchList, setBranchList] = useState(null);
  const [branchKey, setBranchKey] = useState(0);

  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [conferenceList, setConferenceList] = useState(null);
  const [conferenceKey, setConferenceKey] = useState(0);
  const [newConferenceName, setNewConferenceName] = useState('');

  const [selectedConferenceId, setSelectedConferenceId] = useState(''); // '' = sin conferencia
  const [groupList, setGroupList] = useState(null);
  const [groupKey, setGroupKey] = useState(0);
  const [newGroupName, setNewGroupName] = useState('');

  const [selectedGroupId, setSelectedGroupId] = useState(''); // '' = sin grupo

  const [matchList, setMatchList] = useState(null);
  const [homeTeam, setHomeTeam] = useState('');
  const [awayTeam, setAwayTeam] = useState('');
  const [matchDate, setMatchDate] = useState('');
  const [matchError, setMatchError] = useState('');
  const [matchKey, setMatchKey] = useState(0);

  const BRANCH_OPTIONS = ['Varonil', 'Femenil', 'Mixto'];

  useEffect(() => {
    if (!leagueId && leagues.length > 0) {
      setLeagueId(leagues[0].id);
    }
  }, [leagues, leagueId]);

  useEffect(() => {
    if (!leagueId || !token) return;
    api.getTournaments(leagueId, testYear, token).then(setList).catch(() => setList([]));
  }, [leagueId, testYear, token, result]);

  useEffect(() => {
    if (!selectedTournamentId && list && list.length > 0) {
      setSelectedTournamentId(list[0].id);
    }
  }, [list, selectedTournamentId]);

  useEffect(() => {
    if (!selectedTournamentId || !token) { setCategoryList(null); return; }
    api.getCategoriesForTournament(selectedTournamentId, token)
      .then(setCategoryList)
      .catch(() => setCategoryList([]));
  }, [selectedTournamentId, token, categoryKey]);

  useEffect(() => {
    if (categoryList && categoryList.length > 0) {
      setSelectedCategoryId((prev) => prev || categoryList[0].id);
    } else {
      setSelectedCategoryId('');
    }
  }, [categoryList]);

  useEffect(() => {
    if (!selectedCategoryId || !token) { setBranchList(null); return; }
    api.getBranches(selectedCategoryId, token).then(setBranchList).catch(() => setBranchList([]));
  }, [selectedCategoryId, token, branchKey]);

  useEffect(() => {
    if (branchList && branchList.length > 0) {
      setSelectedBranchId((prev) => prev || branchList[0].id);
    } else {
      setSelectedBranchId('');
    }
  }, [branchList]);

  // Conferencias de la rama elegida (opcional: puede no haber ninguna)
  useEffect(() => {
    if (!selectedBranchId || !token) { setConferenceList(null); return; }
    api.getConferences(selectedBranchId, token).then(setConferenceList).catch(() => setConferenceList([]));
  }, [selectedBranchId, token, conferenceKey]);

  useEffect(() => {
    setSelectedConferenceId(''); // al cambiar de rama, reinicia a "sin conferencia"
  }, [selectedBranchId]);

  // Grupos de la conferencia elegida (solo si se eligió alguna)
  useEffect(() => {
    if (!selectedConferenceId || !token) { setGroupList(null); return; }
    api.getTestGroups(selectedConferenceId, token).then(setGroupList).catch(() => setGroupList([]));
  }, [selectedConferenceId, token, groupKey]);

  useEffect(() => {
    setSelectedGroupId(''); // al cambiar de conferencia, reinicia a "sin grupo"
  }, [selectedConferenceId]);

  useEffect(() => {
    if (!selectedBranchId || !token) { setMatchList(null); return; }
    api.getTestMatches(selectedBranchId, token).then(setMatchList).catch(() => setMatchList([]));
  }, [selectedBranchId, token, matchKey]);

  if (!token) {
    return (
      <div className="container">
        <div className="section-head"><h2>Prueba: Registrar torneo</h2></div>
        <p>Necesitas iniciar sesión con una cuenta que administre alguna liga para probar esto.</p>
      </div>
    );
  }

  if (leagues.length === 0) {
    return (
      <div className="container">
        <div className="section-head"><h2>Prueba: Registrar torneo</h2></div>
        <p>Tu cuenta no administra ninguna liga todavía, así que no hay dónde crear el torneo de prueba.</p>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="section-head">
        <h2>Prueba: Registrar torneo</h2>
      </div>

      <div className="field">
        <label>Liga (real) en la que se va a crear el torneo de prueba</label>
        <select value={leagueId} onChange={(e) => setLeagueId(e.target.value)}>
          {leagues.map((lg) => (
            <option key={lg.id} value={lg.id}>{lg.name}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Año (temporal, solo para esta prueba — todavía no existe /anios real)</label>
        <input
          type="number"
          value={testYear}
          onChange={(e) => setTestYear(e.target.value)}
          style={{ width: 120 }}
        />
      </div>

      {result && (
        <div className="form-error" style={{ background: 'rgba(255,255,255,0.08)', color: 'inherit' }}>
          Torneo creado correctamente. id: {result.id}, nombre: {result.name}, año: {result.year}
        </div>
      )}

      <TournamentForm
        key={key}
        submitLabel="Guardar torneo (real)"
        onCancel={() => {}}
        onSubmit={async (data) => {
          const created = await api.createTournament(leagueId, { ...data, year: testYear }, token);
          setResult(created);
          setKey((k) => k + 1);
        }}
      />

      <div className="section-head" style={{ marginTop: 40 }}>
        <h2>Torneos ya creados ({testYear})</h2>
      </div>
      {list === null && <p>Cargando…</p>}
      {list && list.length === 0 && <p>Todavía no hay torneos creados con este año.</p>}
      {list && list.length > 0 && (
        <ul>
          {list.map((t) => (
            <li key={t.id}>#{t.id} — {t.name} ({t.year})</li>
          ))}
        </ul>
      )}

      {list && list.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 40 }}>
            <h2>Prueba: Categorías dentro de un torneo</h2>
          </div>

          <div className="field">
            <label>Torneo sobre el que vamos a probar las categorías</label>
            <select value={selectedTournamentId} onChange={(e) => setSelectedTournamentId(e.target.value)}>
              {list.map((t) => (
                <option key={t.id} value={t.id}>#{t.id} — {t.name}</option>
              ))}
            </select>
          </div>

          <CategoryForm
            key={categoryKey}
            submitLabel="Guardar categoría (real)"
            onCancel={() => {}}
            onSubmit={async (data) => {
              await api.createCategoryForTournament(selectedTournamentId, data, token);
              setCategoryKey((k) => k + 1);
            }}
          />

          <div className="section-head" style={{ marginTop: 24 }}>
            <h2>Categorías de este torneo</h2>
          </div>
          {categoryList === null && <p>Cargando…</p>}
          {categoryList && categoryList.length === 0 && <p>Este torneo todavía no tiene categorías.</p>}
          {categoryList && categoryList.length > 0 && (
            <ul>
              {categoryList.map((c) => (
                <li key={c.id}>#{c.id} — {c.name}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {categoryList && categoryList.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 40 }}>
            <h2>Prueba: Ramas dentro de una categoría</h2>
          </div>

          <div className="field">
            <label>Categoría sobre la que vamos a probar las ramas</label>
            <select value={selectedCategoryId} onChange={(e) => setSelectedCategoryId(e.target.value)}>
              {categoryList.map((c) => (
                <option key={c.id} value={c.id}>#{c.id} — {c.name}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Agregar rama</label>
            <div className="pill-group">
              {BRANCH_OPTIONS.map((b) => (
                <button
                  key={b}
                  type="button"
                  className="pill-btn"
                  disabled={branchList?.some((br) => br.name === b)}
                  onClick={async () => {
                    await api.createBranch(selectedCategoryId, { name: b }, token);
                    setBranchKey((k) => k + 1);
                  }}
                >
                  {branchList?.some((br) => br.name === b) ? `${b} ✓` : `+ ${b}`}
                </button>
              ))}
            </div>
          </div>

          <div className="section-head" style={{ marginTop: 24 }}>
            <h2>Ramas de esta categoría</h2>
          </div>
          {branchList === null && <p>Cargando…</p>}
          {branchList && branchList.length === 0 && <p>Esta categoría todavía no tiene ramas.</p>}
          {branchList && branchList.length > 0 && (
            <ul>
              {branchList.map((b) => (
                <li key={b.id}>#{b.id} — {b.name}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {branchList && branchList.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 40 }}>
            <h2>Prueba: Conferencias dentro de una rama (opcional)</h2>
          </div>

          <div className="field">
            <label>Rama sobre la que vamos a probar conferencias/grupos/partidos</label>
            <select value={selectedBranchId} onChange={(e) => setSelectedBranchId(e.target.value)}>
              {branchList.map((b) => (
                <option key={b.id} value={b.id}>#{b.id} — {b.name}</option>
              ))}
            </select>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newConferenceName.trim()) return;
              await api.createConference(selectedBranchId, { name: newConferenceName.trim() }, token);
              setNewConferenceName('');
              setConferenceKey((k) => k + 1);
            }}
          >
            <div className="field">
              <label>Nombre de la conferencia (ej. Americana, Nacional)</label>
              <input type="text" value={newConferenceName} onChange={(e) => setNewConferenceName(e.target.value)} placeholder="Ej. Conferencia Norte" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-flag">Agregar conferencia</button>
            </div>
          </form>

          <div className="field" style={{ marginTop: 16 }}>
            <label>Conferencia a usar (opcional — puedes dejarla en "ninguna")</label>
            <select value={selectedConferenceId} onChange={(e) => setSelectedConferenceId(e.target.value)}>
              <option value="">— Sin conferencia —</option>
              {conferenceList?.map((c) => (
                <option key={c.id} value={c.id}>#{c.id} — {c.name}</option>
              ))}
            </select>
          </div>
          {conferenceList === null && <p>Cargando…</p>}
          {conferenceList && conferenceList.length === 0 && <p>Esta rama todavía no tiene conferencias (está bien, son opcionales).</p>}
        </>
      )}

      {selectedConferenceId && (
        <>
          <div className="section-head" style={{ marginTop: 40 }}>
            <h2>Prueba: Grupos dentro de una conferencia (opcional)</h2>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newGroupName.trim()) return;
              await api.createTestGroup(selectedConferenceId, { name: newGroupName.trim() }, token);
              setNewGroupName('');
              setGroupKey((k) => k + 1);
            }}
          >
            <div className="field">
              <label>Nombre del grupo (ej. Grupo A)</label>
              <input type="text" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="Ej. Grupo A" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-flag">Agregar grupo</button>
            </div>
          </form>

          <div className="field" style={{ marginTop: 16 }}>
            <label>Grupo a usar (opcional — puedes dejarlo en "ninguno")</label>
            <select value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)}>
              <option value="">— Sin grupo —</option>
              {groupList?.map((g) => (
                <option key={g.id} value={g.id}>#{g.id} — {g.name}</option>
              ))}
            </select>
          </div>
          {groupList === null && <p>Cargando…</p>}
          {groupList && groupList.length === 0 && <p>Esta conferencia todavía no tiene grupos (está bien, son opcionales).</p>}
        </>
      )}

      {selectedBranchId && (
        <>
          <div className="section-head" style={{ marginTop: 40 }}>
            <h2>Prueba: Crear partido</h2>
          </div>
          <p style={{ opacity: 0.8, fontSize: 14 }}>
            Este partido va a colgar del nivel más profundo que hayas elegido arriba:
            {selectedGroupId ? ' el grupo seleccionado.' : selectedConferenceId ? ' la conferencia (sin grupo).' : ' la rama directamente (sin conferencia ni grupo).'}
          </p>

          {matchError && <div className="form-error">{matchError}</div>}

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setMatchError('');
              if (!homeTeam.trim() || !awayTeam.trim() || !matchDate) {
                setMatchError('Faltan datos: equipo local, visitante y fecha son obligatorios.');
                return;
              }
              try {
                await api.createTestMatch(selectedBranchId, {
                  home_team: homeTeam.trim(),
                  away_team: awayTeam.trim(),
                  match_date: matchDate,
                  group_id: selectedGroupId || null,
                }, token);
                setHomeTeam('');
                setAwayTeam('');
                setMatchDate('');
                setMatchKey((k) => k + 1);
              } catch (err) {
                setMatchError(err.message);
              }
            }}
          >
            <div className="field">
              <label>Equipo local</label>
              <input type="text" value={homeTeam} onChange={(e) => setHomeTeam(e.target.value)} placeholder="Ej. Dragones" />
            </div>
            <div className="field">
              <label>Equipo visitante</label>
              <input type="text" value={awayTeam} onChange={(e) => setAwayTeam(e.target.value)} placeholder="Ej. Halcones" />
            </div>
            <div className="field">
              <label>Fecha y hora</label>
              <input type="datetime-local" value={matchDate} onChange={(e) => setMatchDate(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-flag">Guardar partido de prueba</button>
            </div>
          </form>

          <div className="section-head" style={{ marginTop: 24 }}>
            <h2>Partidos de esta rama (todos, sin importar grupo)</h2>
          </div>
          {matchList === null && <p>Cargando…</p>}
          {matchList && matchList.length === 0 && <p>Esta rama todavía no tiene partidos.</p>}
          {matchList && matchList.length > 0 && (
            <ul>
              {matchList.map((m) => (
                <li key={m.id} style={{ marginBottom: 10 }}>
                  #{m.id} — {m.home_team} vs {m.away_team} — {m.match_date} — estado: <strong>{m.status}</strong>
                  {m.group_id ? ` — grupo #${m.group_id}` : ''}
                  <div className="pill-group" style={{ marginTop: 4 }}>
                    {[
                      { value: 'scheduled', label: 'Programado' },
                      { value: 'live',      label: 'Iniciado' },
                      { value: 'finished',  label: 'Finalizado' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`pill-btn${m.status === opt.value ? ' pill-btn--active' : ''}`}
                        disabled={m.status === opt.value}
                        onClick={async () => {
                          await api.updateMatchStatus(m.id, opt.value, token);
                          setMatchKey((k) => k + 1);
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
