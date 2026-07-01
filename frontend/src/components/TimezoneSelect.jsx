import { TIMEZONE_GROUPS, getTimezoneOffset } from '../utils/timezones.js';

export default function TimezoneSelect({ value, onChange, label = 'Zona horaria' }) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {TIMEZONE_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} ({getTimezoneOffset(opt.value)})
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}