import KpIcon from "./KpIcon.jsx";
import "./ToggleSwitch.css";

export default function ToggleSwitch({ id, label, icon, checked, onChange }) {
  return (
    <label className="toggle-row" htmlFor={id}>
      <span className="toggle-label">
        {icon && <KpIcon glyph={icon} size={20} />}
        {label}
      </span>
      <span className={`toggle ${checked ? "is-on" : ""}`}>
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-thumb" />
      </span>
    </label>
  );
}
