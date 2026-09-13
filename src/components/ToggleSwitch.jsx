import "./ToggleSwitch.css";

export default function ToggleSwitch({ id, label, checked, onChange }) {
  return (
    <label className="toggle-row" htmlFor={id}>
      <span>{label}</span>
      <span className={`toggle ${checked ? "is-on" : ""}`}>
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-thumb" />
      </span>
    </label>
  );
}
