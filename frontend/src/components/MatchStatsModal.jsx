import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import Modal from './Modal.jsx';

const STAT_FIELDS = [
  { key: 'pass_completions', label: 'Pases completos' },
  { key: 'pass_attempts', label: 'Intentos de pase' },
  { key: 'pass_yards', label: 'Yardas por pase' },
  { key: 'pass_td', label: 'Pases de TD' },
  { key: 'interceptions_thrown', label: 'Intercepciones lanzadas' },
  { key: 'rush_attempts', label: 'Acarreos' },
  { key: 'rush_yards', label: 'Yardas terrestres' },
  { key: 'rush_td', label: 'TD terrestres' },
  { key: 'receptions', label: 'Recepciones' },
  { key: 'receiving_yards', label: 'Yardas recibidas' },
  { key: 'receiving_td', label: 'TD recibidos' },
  { key: 'tackles', label: 'Tackles' },
  { key: 'sacks', label: 'Sacks' },
  { key: 'interceptions_def', label: 'Intercepciones defensivas' },
  { key: 'field_goals_made', label: 'Goles de campo anotados' },
  { key: 'extra_points_made', label: 'Puntos extra anotados' },
];

const emptyForm = STAT_FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: '' }), {});

// Captura las estadísticas de UN jugador a la vez, dentro de UN partido —
// así se pidió expresamente: "elijo jugador y cargo sus números, uno por
// uno". Muestra abajo la lista de quiénes ya tienen estadísticas
// capturadas en este partido, para llevar control de a quién falta.
export default function MatchStatsModal({ match, token, onClose }) {
  const [homeRoster, setHomeRoster] = useState(null);
  const [awayRoster, setAwayRoster] = useState(null);
  const [captured, setCaptured] = useState(null);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const notLinked = !match.home_team_id && !match.away_team_id;

  useEffect(() => {
    if (notLinked) return;
    if (match.home_team_id) api.getTeamRoster(match.home_team_id, token).then((d) => setHomeRoster(d.roster)).catch(() => setHomeRoster([]));
    if (match.away_team_id) api.getTeamRoster(match.away_team_id, token).then((d) => setAwayRoster(d.roster)).catch(() => setAwayRoster([]));
    loadCaptured();
  }, [match.id]);

  async function loadCaptured() {
    try {
      const data = await api.getMatchStats(match.id, token);
      setCaptured(data.stats);
    } catch (e) {
      setError(e.message);
    }
  }

  function rosterForTeam(teamId) {
    if (Number(teamId) === match.home_team_id) return homeRoster || [];
    if (Number(teamId) === match.away_team_id) return awayRoster || [];
    return [];
  }

  function selectPlayer(playerId) {
    setSelectedPlayerId(playerId);
    // Si ya hay estadística capturada para este jugador, precarga sus
    // números — así "capturar" y "corregir" son la misma pantalla.
    const existing = captured?.find((s) => String(s.player_id) === String(playerId));
    if (existing) {
      const next = { ...emptyForm };
      STAT_FIELDS.forEach((f) => { next[f.key] = String(existing[f.key] ?? 0); });
      setForm(next);
    } else {
      setForm(emptyForm);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!selectedTeamId || !selectedPlayerId) {
      setError('Elige equipo y jugador primero');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = { team_id: Number(selectedTeamId) };
      STAT_FIELDS.forEach((f) => { payload[f.key] = form[f.key] === '' ? 0 : Number(form[f.key]); });
      await api.savePlayerMatchStats(match.id, selectedPlayerId, payload, token);
      await loadCaptured();
      setSelectedPlayerId('');
      setForm(emptyForm);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const roster = selectedTeamId ? rosterForTeam(selectedTeamId) : [];

  return (
    <Modal title={`Estadísticas — ${match.home_team} vs ${match.away_team}`} onClose={onClose}>
      {notLinked ? (
        <p style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
          Este partido todavía no está conectado con sus equipos. Usa "Conectar equipos con sus partidos" en el panel de la liga antes de capturar estadísticas.
        </p>
      ) : (
        <>
          {error && <div className="form-error">{error}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div className="field">
              <label>Equipo</label>
              <select
                value={selectedTeamId}
                onChange={(e) => { setSelectedTeamId(e.target.value); setSelectedPlayerId(''); setForm(emptyForm); }}
              >
                <option value="">Selecciona…</option>
                {match.home_team_id && <option value={match.home_team_id}>{match.home_team}</option>}
                {match.away_team_id && <option value={match.away_team_id}>{match.away_team}</option>}
              </select>
            </div>
            <div className="field">
              <label>Jugador</label>
              <select
                value={selectedPlayerId}
                onChange={(e) => selectPlayer(e.target.value)}
                disabled={!selectedTeamId}
              >
                <option value="">Selecciona…</option>
                {roster.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.jersey_number != null ? `#${p.jersey_number} ` : ''}{p.first_name} {p.last_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedPlayerId && (
            <form onSubmit={handleSave}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
                {STAT_FIELDS.map((f) => (
                  <div className="field" key={f.key}>
                    <label>{f.label}</label>
                    <input
                      type="number"
                      min="0"
                      value={form[f.key]}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>
                <button type="submit" className="btn btn-flag" disabled={saving}>
                  {saving ? 'Guardando…' : '+ Guardar estadísticas'}
                </button>
              </div>
            </form>
          )}

          {captured && captured.length > 0 && (
            <div style={{ marginTop: 20, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
              <div style={{ fontSize: 12, letterSpacing: '0.1em', color: 'var(--ink-dim)', textTransform: 'uppercase', marginBottom: 8 }}>
                Ya capturados en este partido
              </div>
              {captured.map((s) => (
                <div key={s.id} className="admin-match-row">
                  <div className="who">{s.first_name} {s.last_name}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
