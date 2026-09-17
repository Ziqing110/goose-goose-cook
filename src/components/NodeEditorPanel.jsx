import { useEffect, useState } from "react";
import { EQUIPMENT_OPTIONS, DIFFICULTY_OPTIONS, PHASE_OPTIONS, MATERIAL_CATEGORY_ORDER, MATERIAL_CATEGORY_LABELS, equipmentLabel } from "../data/dishes.js";
import "./NodeEditorPanel.css";

// Edits are staged locally and only committed to the graph when Save
// is clicked — closing without saving (the drawer's own close/backdrop)
// just discards the draft. Adding a brand-new material is the one
// exception: it registers immediately on the recipe (via
// onRegisterMaterial) so it's available to every other step too, but
// still only turns on for *this* step once Saved.
export default function NodeEditorPanel({ node, allNodes, onSave, onDelete, materialsInfo, onRegisterMaterial, blockedDependencyIds }) {
  const [draft, setDraft] = useState(node);

  // Keyed on node.id deliberately, NOT on node. Re-seeding the draft
  // whenever the node object changes identity would discard whatever the
  // person has typed the moment anything upstream re-renders. Switching
  // to a different step is the only time the draft should be replaced.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(node), [node.id]);

  const others = allNodes.filter((n) => n.id !== node.id);

  const patch = (patchFn) => {
    setDraft((d) => {
      const next = { ...d };
      patchFn(next);
      return next;
    });
  };

  const toggleSet = (list, value, checked) => {
    const set = new Set(list);
    checked ? set.add(value) : set.delete(value);
    return [...set];
  };

  const handleAddMaterial = (materialDraft) => {
    const id = onRegisterMaterial?.(materialDraft);
    if (id) patch((n) => (n.required_materials = toggleSet(n.required_materials, id, true)));
  };

  return (
    <div className="editor-panel">
      <span className="mini-title">Edit step</span>

      <div className="field">
        <label htmlFor="f-label">Label</label>
        <input id="f-label" type="text" value={draft.label} onChange={(e) => patch((n) => (n.label = e.target.value))} />
      </div>

      <div className="field">
        <label htmlFor="f-desc">Description</label>
        <textarea id="f-desc" value={draft.description} onChange={(e) => patch((n) => (n.description = e.target.value))} />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="f-phase">Phase</label>
          <select id="f-phase" value={draft.phase || "prep"} onChange={(e) => patch((n) => (n.phase = e.target.value))}>
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
            value={Number((draft.estimated_duration_sec / 60).toFixed(2))}
            onChange={(e) => {
              const minutes = Math.max(0.25, Number(e.target.value) || 0);
              patch((n) => (n.estimated_duration_sec = Math.round(minutes * 60)));
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="f-difficulty">Difficulty</label>
          <select id="f-difficulty" value={draft.difficulty} onChange={(e) => patch((n) => (n.difficulty = e.target.value))}>
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
                checked={draft.required_equipment.includes(eq)}
                onChange={(e) => patch((n) => (n.required_equipment = toggleSet(n.required_equipment, eq, e.target.checked)))}
              />
              <span>{equipmentLabel(eq)}</span>
            </label>
          ))}
        </div>
      </div>

      {materialsInfo && (
        <div className="field">
          <label>Required materials</label>
          <div className="checkbox-grid">
            {Object.keys(materialsInfo)
              .sort((a, b) => materialsInfo[a].label.localeCompare(materialsInfo[b].label))
              .map((m) => (
                <label className="checkbox-pill" key={m}>
                  <input
                    type="checkbox"
                    checked={draft.required_materials.includes(m)}
                    onChange={(e) => patch((n) => (n.required_materials = toggleSet(n.required_materials, m, e.target.checked)))}
                  />
                  <span>{materialsInfo[m].label}</span>
                </label>
              ))}
          </div>
          {onRegisterMaterial && <AddMaterialForm onAdd={handleAddMaterial} />}
        </div>
      )}

      <div className="field">
        <label>Depends on</label>
        <div className="checkbox-grid checkbox-grid-col">
          {others.length ? (
            others.map((o) => {
              // Ticking this would make the step wait on something that
              // is already waiting on it — offered but refused, so the
              // reason is visible rather than the option just missing.
              const wouldLoop = blockedDependencyIds?.has(o.id) && !draft.depends_on.includes(o.id);
              return (
                <label
                  className={`checkbox-pill ${wouldLoop ? "is-locked" : ""}`}
                  key={o.id}
                  title={wouldLoop ? `"${o.label}" already comes after this step` : undefined}
                >
                  <input
                    type="checkbox"
                    disabled={wouldLoop}
                    checked={draft.depends_on.includes(o.id)}
                    onChange={(e) => patch((n) => (n.depends_on = toggleSet(n.depends_on, o.id, e.target.checked)))}
                  />
                  <span>
                    {o.label}
                    {wouldLoop && <span className="hint"> — comes after</span>}
                  </span>
                </label>
              );
            })
          ) : (
            <p className="hint">No other steps yet.</p>
          )}
        </div>
      </div>

      <div className="editor-actions">
        <button type="button" className="btn btn-danger" onClick={() => onDelete(node.id)}>
          Delete step
        </button>
        <button type="button" className="btn btn-primary" onClick={() => onSave(node.id, draft)}>
          Save
        </button>
      </div>
    </div>
  );
}

// Inline "add a material this step needs but isn't in the list yet" —
// registers it on the graph (available to every other step too, not
// just this one) and turns it on for this step's in-progress draft.
function AddMaterialForm({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState(MATERIAL_CATEGORY_ORDER[0]);
  const [amount, setAmount] = useState(1);
  const [unit, setUnit] = useState("");

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost add-material-toggle" onClick={() => setOpen(true)}>
        + New material
      </button>
    );
  }

  const submit = (e) => {
    e.preventDefault();
    if (!label.trim()) return;
    onAdd({ label, category, amount, unit });
    setLabel("");
    setAmount(1);
    setUnit("");
    setOpen(false);
  };

  return (
    <form className="add-material-form" onSubmit={submit}>
      <input type="text" placeholder="Material name" value={label} autoFocus onChange={(e) => setLabel(e.target.value)} />
      <select value={category} onChange={(e) => setCategory(e.target.value)}>
        {MATERIAL_CATEGORY_ORDER.map((cat) => (
          <option key={cat} value={cat}>
            {MATERIAL_CATEGORY_LABELS[cat] || cat}
          </option>
        ))}
      </select>
      <input
        type="number"
        min="0"
        step="any"
        className="add-material-amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <input
        type="text"
        placeholder="unit"
        className="add-material-unit"
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
      />
      <button type="submit" className="btn btn-primary">
        Add
      </button>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}
