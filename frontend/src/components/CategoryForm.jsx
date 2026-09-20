import CharField from './CharField.jsx';
import { useState } from 'react';
import { required, maxLength, runValidations } from '../utils/validation.js';

export default function CategoryForm({ initial, onSubmit, onCancel, submitLabel }) {
  const [name,   setName]   = useState(initial?.name   || '');
  const [autoStatusEnabled, setAutoStatusEnabled] = useState(initial?.auto_status_enabled || false);
  const [autoStatusHours,   setAutoStatusHours]   = useState(initial?.auto_status_window_hours || '');
  // Los dos interruptores del roster público. Nacen APAGADOS y ese default es
  // la decisión de verdad: es la única respuesta que no lastima a nadie si la
  // pregunta se contesta a las prisas.
  const [rosterPublic, setRosterPublic] = useState(initial?.roster_public || false);
  const [rosterPhotos, setRosterPhotos] = useState(initial?.roster_photos || false);
  const [error,  setError]  = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');

    const validationError = runValidations([
      () => required(name, 'El nombre de la categoría'),
      () => maxLength(name, 80, 'El nombre de la categoría'),
      () => {
        if (autoStatusEnabled && !autoStatusHours) {
          return 'Elige cuántas horas (1, 2 o 3) para el cálculo automático, o apaga esa opción.';
        }
        return null;
      },
    ]);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    try {
      await onSubmit({
        name: name.trim(),
        auto_status_enabled: autoStatusEnabled,
        auto_status_window_hours: autoStatusEnabled ? Number(autoStatusHours) : null,
        roster_public: rosterPublic,
        roster_photos: rosterPublic && rosterPhotos,
      });
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}

      <div className="field">
        <label>Categoría</label>
        <CharField
          required
          max={40}
          uppercase
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej. BANTAM, VARSITY, FEMENIL"
        />
      </div>

      <div className="field" style={{ background: 'rgba(255,255,255,0.06)', padding: '12px 16px', borderRadius: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={autoStatusEnabled}
            onChange={(e) => setAutoStatusEnabled(e.target.checked)}
          />
          Activar cálculo automático de estado del partido
        </label>
        <p style={{ fontSize: 13, opacity: 0.75, marginTop: 6 }}>
          Si la dejas apagada, tú controlas cuándo un partido inicia y termina, sin límite de tiempo.
          Si la activas, el sistema lo marca solo como finalizado después de las horas que elijas —
          solo aplica a los partidos que nadie haya iniciado o finalizado manualmente.
        </p>

        {autoStatusEnabled && (
          <div style={{ marginTop: 10 }}>
            <label>¿Cuántas horas después de la hora programada?</label>
            <div className="pill-group">
              {[1, 2, 3].map((h) => (
                <button
                  key={h}
                  type="button"
                  className={`pill-btn${Number(autoStatusHours) === h ? ' pill-btn--active' : ''}`}
                  onClick={() => setAutoStatusHours(h)}
                >
                  {h} {h === 1 ? 'hora' : 'horas'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── El roster de esta categoría, ¿se publica? ──
          Se pregunta AQUÍ, al crear la categoría, y no en un ajuste escondido:
          una categoría ES un corte de edad y de nivel, así que quien la está
          creando sabe en este momento si está armando la Infantil o la Mayor.
          Preguntarlo por equipo obligaría a acertarle veinte veces a la misma
          decisión. Ver README, "Roster público y pase de lista". */}
      <div className="field" style={{ background: 'rgba(255,255,255,0.06)', padding: '12px 16px', borderRadius: 10 }}>
        <label>¿El roster de esta categoría se publica?</label>
        <div className="pill-group">
          <button
            type="button"
            className={`pill-btn${!rosterPublic ? ' pill-btn--active' : ''}`}
            onClick={() => { setRosterPublic(false); setRosterPhotos(false); }}
          >
            Privado
          </button>
          <button
            type="button"
            className={`pill-btn${rosterPublic ? ' pill-btn--active' : ''}`}
            onClick={() => setRosterPublic(true)}
          >
            Público
          </button>
        </div>
        <p style={{ fontSize: 13, opacity: 0.75, marginTop: 6 }}>
          En público se ve <strong>nombre, número y posición</strong> — lo mismo que trae un
          programa de mano. La CURP y la fecha de nacimiento no salen nunca, y la asistencia
          tampoco: eso lo siguen viendo solo la liga y el equipo.
        </p>

        {rosterPublic && (
          <div style={{ marginTop: 12 }}>
            <label>¿Y la foto de los jugadores?</label>
            <div className="pill-group">
              <button
                type="button"
                className={`pill-btn${!rosterPhotos ? ' pill-btn--active' : ''}`}
                onClick={() => setRosterPhotos(false)}
              >
                Sin foto
              </button>
              <button
                type="button"
                className={`pill-btn${rosterPhotos ? ' pill-btn--active' : ''}`}
                onClick={() => setRosterPhotos(true)}
              >
                Con foto
              </button>
            </div>
            <p style={{ fontSize: 13, opacity: 0.75, marginTop: 6 }}>
              Esto es el <strong>techo</strong>: cada equipo puede apagar la foto de su propio
              roster aunque tú la permitas, pero ninguno puede encenderla si tú la dejas apagada.
            </p>
          </div>
        )}

        <p style={{ fontSize: 13, marginTop: 12, marginBottom: 0, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
          <strong>Recomendación de CFBAMX.</strong> Si esta categoría es de menores de edad, te
          sugerimos dejar el roster privado. Publicar el nombre, el número y la cara de un menor
          en una página abierta no le aporta nada a la competencia y sí lo expone fuera de la
          cancha. Lo que el proceso de competencia sí necesita —quién está inscrito, quién
          asistió, quién es elegible— la liga y el equipo ya lo ven sin que nada de eso sea
          público. Tú decides: es tu torneo y tus familias.
        </p>
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-flag" disabled={loading}>
          {loading ? 'Guardando…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
