import { EQUIPMENT_OPTIONS, DIFFICULTY_OPTIONS, PHASE_OPTIONS } from "../data/dishes.js";
import "./NodeEditorPanel.css";

export default function NodeEditorPanel({ node, allNodes, onChange, onDelete }) {
  const others = allNodes.filter((n) => n.id !== node.id);

  const toggleSet = (list, value, checked) => {
    const set = new Set(list);
    checked ? set.add(value) : set.delete(value);
    return [...set];
  };

  return (
    <div className="editor-panel">
      <span className="mini-title">
        Editing &mdash; <span className="mono">{node.id}</span>
      </span>

      <div className="field">
        <label htmlFor="f-label">Label</label>
        <input id="f-label" type="text" value={node.label} onChange={(e) => onChange(node.id, (n) => (n.label = e.target.value))} />
      </div>

      <div className="field">
        <label htmlFor="f-desc">Description</label>
        <textarea id="f-desc" value={node.description} onChange={(e) => onChange(node.id, (n) => (n.description = e.target.value))} />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="f-phase">Phase</label>
          <select id="f-phase" value={node.phase || "prep"} onChange={(e) => onChange(node.id, (n) => (n.phase = e.target.value))}>
            {PHASE_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-duration">Duration (minutes)</label>
          <input
            id="f-duration"
            type="number"
            min="0.25"
            step="0.25"
            value={Number((node.estimated_duration_sec / 60).toFixed(2))}
            onChange={(e) => {
              const minutes = Math.max(0.25, Number(e.target.value) || 0);
              onChange(node.id, (n) => (n.estimated_duration_sec = Math.round(minutes * 60)));
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="f-difficulty">Difficulty</label>
          <select id="f-difficulty" value={node.difficulty} onChange={(e) => onChange(node.id, (n) => (n.difficulty = e.target.value))}>
            {DIFFICULTY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Required equipment</label>
        <div className="checkbox-grid">
          {EQUIPMENT_OPTIONS.map((eq) => (
            <label className="checkbox-pill" key={eq}>
              <input
                type="checkbox"
                checked={node.required_equipment.includes(eq)}
                onChange={(e) => onChange(node.id, (n) => (n.required_equipment = toggleSet(n.required_equipment, eq, e.target.checked)))}
              />
              <span className="mono">{eq}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Depends on</label>
        <div className="checkbox-grid checkbox-grid-col">
          {others.length ? (
            others.map((o) => (
              <label className="checkbox-pill" key={o.id}>
                <input
                  type="checkbox"
                  checked={node.depends_on.includes(o.id)}
                  onChange={(e) => onChange(node.id, (n) => (n.depends_on = toggleSet(n.depends_on, o.id, e.target.checked)))}
                />
                <span>{o.label}</span>
              </label>
            ))
          ) : (
            <p className="hint">No other steps yet.</p>
          )}
        </div>
      </div>

      <button type="button" className="btn btn-danger" onClick={() => onDelete(node.id)}>
        Delete step
      </button>
    </div>
  );
}
