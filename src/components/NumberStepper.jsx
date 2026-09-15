// Small reusable +/- number input, used anywhere the app collects a
// count (burners, cutting boards, pots, servings...).
import KpIcon from "./KpIcon.jsx";
import "./NumberStepper.css";

export default function NumberStepper({ id, label, icon, value, min = 0, max = 12, onChange }) {
  const clamp = (n) => Math.max(min, Math.min(max, n));

  return (
    <div className="field">
      <label htmlFor={id} className="stepper-label">
        {icon && <KpIcon glyph={icon} size={16} />}
        {label}
      </label>
      <div className="number-stepper">
        <button type="button" className="stepper-btn" onClick={() => onChange(clamp(value - 1))} aria-label={`Decrease ${label}`}>
          &minus;
        </button>
        <input
          id={id}
          type="number"
          className="stepper-input mono"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(clamp(Number(e.target.value) || 0))}
        />
        <button type="button" className="stepper-btn" onClick={() => onChange(clamp(value + 1))} aria-label={`Increase ${label}`}>
          +
        </button>
      </div>
    </div>
  );
}
