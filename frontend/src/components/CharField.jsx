// CharField — input o textarea con límite de caracteres y contador visual.
// Props:
//   as="input"|"textarea"  (default: "input")
//   max={number}           límite de caracteres
//   uppercase={bool}       convierte a mayúsculas automáticamente
//   value, onChange, ...rest  se pasan al elemento nativo

export default function CharField({ as: Tag = 'input', max, uppercase = false, value, onChange, ...rest }) {
  const len = (value || '').length;
  const near = max && len >= max * 0.85; // amarillo al 85%
  const full = max && len >= max;        // rojo al llegar al límite

  function handleChange(e) {
    let val = e.target.value;
    if (uppercase) val = val.toUpperCase();
    if (max && val.length > max) val = val.slice(0, max);
    // Simular evento con valor modificado
    onChange({ ...e, target: { ...e.target, value: val } });
  }

  return (
    <div style={{ position: 'relative' }}>
      <Tag
        value={value}
        onChange={handleChange}
        maxLength={max}
        {...rest}
      />
      {max && (
        <div style={{
          fontSize: 11,
          textAlign: 'right',
          marginTop: 3,
          color: full ? 'var(--flag)' : near ? '#f59e0b' : 'var(--ink-dim)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {len}/{max}
        </div>
      )}
    </div>
  );
}
