// Campo reutilizable para editar una LISTA de links (agregar/quitar varios),
// usado tanto en el formulario de equipo (links predeterminados) como en el
// formulario de partido (links específicos de ese partido, prellenados desde
// los equipos pero editables).
export default function LinkListField({ label, links, onChange, placeholder, hint }) {
  const items = links || [];

  function updateAt(i, value) {
    const next = [...items];
    next[i] = value;
    onChange(next);
  }

  function removeAt(i) {
    onChange(items.filter((_, idx) => idx !== i));
  }

  function add() {
    onChange([...items, '']);
  }

  return (
    <div className="field">
      <label>{label}</label>
      {hint && (
        <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: -2, marginBottom: 8 }}>{hint}</div>
      )}

      {items.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 8 }}>Sin links agregados.</div>
      )}

      {items.map((url, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            value={url}
            onChange={(e) => updateAt(i, e.target.value)}
            placeholder={placeholder || 'https://…'}
            style={{ flex: 1 }}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeAt(i)}>
            Quitar
          </button>
        </div>
      ))}

      <button type="button" className="btn btn-outline btn-sm" onClick={add}>
        + Agregar link
      </button>
    </div>
  );
}
