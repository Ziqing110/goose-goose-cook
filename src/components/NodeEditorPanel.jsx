import { useEffect, useState } from "react";
import { EQUIPMENT_OPTIONS, DIFFICULTY_OPTIONS, PHASE_OPTIONS, MATERIAL_CATEGORY_ORDER, MATERIAL_CATEGORY_LABELS, equipmentLabel } from "../data/dishes.js";
import BoardPanel, { ChoiceChip, PanelField, Segmented } from "./BoardPanel.jsx";
import "./NodeEditorPanel.css";

export const DIFFICULTY_SEGMENTS = DIFFICULTY_OPTIONS.map((d) => ({
  value: d,
  label: { low: "Low", medium: "Med", high: "High" }[d] || d,
}));

const ADD_NEW = "__new__";

// Edits are staged locally and only committed to the graph when Save
// is clicked — closing the panel just discards the draft. Adding a
// brand-new material is the one exception: it registers immediately on
// the recipe (via onRegisterMaterial) so it's available to every other
// step too, but still only turns on for *this* step once Saved.
export default function NodeEditorPanel({
  node,
  allNodes,
  numberOf,
  onSave,
  onDelete,
  onClose,
  materialsInfo,
  onRegisterMaterial,
  blockedDependencyIds,
}) {
  const [draft, setDraft] = useState(node);
  const [addingMaterial, setAddingMaterial] = useState(false);

  // Keyed on node.id deliberately, NOT on node. Re-seeding the draft
  // whenever the node object changes identity would discard whatever the
  // person has typed the moment anything upstream re-renders. Switching
  // to a different step is the only time the draft should be replaced.
  useEffect(() => {
    setDraft(node);
    setAddingMaterial(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const others = allNodes
    .filter((n) => n.id !== node.id)
    .sort((a, b) => (numberOf?.(a.id) || "").localeCompare(numberOf?.(b.id) || ""));

  const patch = (patchFn) => {
    setDraft((d) => {
      const next = { ...d };
      patchFn(next);
      return next;
    });
  };

  const toggleIn = (list, value) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  const handleAddMaterial = (materialDraft) => {
    const id = onRegisterMaterial?.(materialDraft);
    if (id) patch((n) => (n.required_materials = [...new Set([...n.required_materials, id])]));
    setAddingMaterial(false);
  };

  const materialIds = Object.keys(materialsInfo || {}).sort((a, b) =>
    materialsInfo[a].label.localeCompare(materialsInfo[b].label)
  );
  const unselectedMaterials = materialIds.filter((m) => !draft.required_materials.includes(m));
  const number = numberOf?.(node.id);

  return (
    <BoardPanel
      label="Edit step"
      title={number ? `Editing step ${number}` : "Editing step"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn panel-btn-danger" onClick={() => onDelete(node.id)}>
            Delete
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(node.id, draft)}>
            Save
          </button>
        </>
      }
    >
      <PanelField as="label" label="Label">
        <input className="panel-input" type="text" value={draft.label} onChange={(e) => patch((n) => (n.label = e.target.value))} />
      </PanelField>

      <PanelField as="label" label="Description">
        <textarea
          className="panel-textarea"
          rows={2}
          value={draft.description}
          onChange={(e) => patch((n) => (n.description = e.target.value))}
        />
      </PanelField>

      <PanelField label="Phase">
        <Segmented label="Phase" options={PHASE_OPTIONS} value={draft.phase || "prep"} onChange={(v) => patch((n) => (n.phase = v))} />
      </PanelField>

      <div className="panel-field-row">
        <PanelField as="label" label="Takes">
          <span className="panel-minutes">
            <input
              className="panel-input"
              type="number"
              min="0.25"
              step="0.25"
              value={Number((draft.estimated_duration_sec / 60).toFixed(2))}
              onChange={(e) => {
                const minutes = Math.max(0.25, Number(e.target.value) || 0);
                patch((n) => (n.estimated_duration_sec = Math.round(minutes * 60)));
              }}
            />
            <span className="panel-minutes-unit">min</span>
          </span>
        </PanelField>
        <PanelField label="Difficulty">
          <Segmented
            label="Difficulty"
            options={DIFFICULTY_SEGMENTS}
            value={draft.difficulty}
            onChange={(v) => patch((n) => (n.difficulty = v))}
          />
        </PanelField>
      </div>

      <PanelField label="Needs">
        <div className="panel-chips">
          {EQUIPMENT_OPTIONS.map((eq) => (
            <ChoiceChip
              key={eq}
              on={draft.required_equipment.includes(eq)}
              onToggle={() => patch((n) => (n.required_equipment = toggleIn(n.required_equipment, eq)))}
            >
              {equipmentLabel(eq)}
            </ChoiceChip>
          ))}
        </div>
      </PanelField>

      {materialsInfo && (
        <PanelField label="Materials">
          <div className="panel-chips">
            {draft.required_materials.map((m) => (
              <ChoiceChip
                key={m}
                on
                title="Remove from this step"
                onToggle={() => patch((n) => (n.required_materials = n.required_materials.filter((x) => x !== m)))}
              >
                {materialsInfo[m]?.label || m}
                {materialsInfo[m]?.amount != null && (
                  <span className="panel-chip-amount">
                    {materialsInfo[m].amount} {materialsInfo[m].unit}
                  </span>
                )}
              </ChoiceChip>
            ))}
            {draft.required_materials.length === 0 && <span className="panel-empty">No materials yet.</span>}
          </div>
          {addingMaterial ? (
            <AddMaterialForm onAdd={handleAddMaterial} onCancel={() => setAddingMaterial(false)} />
          ) : (
            // Picking from the catalog keeps the chip row to what this
            // step actually uses; the full list lives in the menu.
            <select
              className="panel-select node-editor-add-material"
              value=""
              aria-label="Add a material"
              onChange={(e) => {
                const v = e.target.value;
                if (v === ADD_NEW) setAddingMaterial(true);
                else if (v) patch((n) => (n.required_materials = [...n.required_materials, v]));
              }}
            >
              <option value="">+ Add a material</option>
              {unselectedMaterials.map((m) => (
                <option key={m} value={m}>
                  {materialsInfo[m].label}
                </option>
              ))}
              {onRegisterMaterial && <option value={ADD_NEW}>New material…</option>}
            </select>
          )}
        </PanelField>
      )}

      <PanelField label="Runs after">
        <div className="panel-chips">
          {others.length ? (
            others.map((o) => {
              // Ticking this would make the step wait on something that
              // is already waiting on it — offered but refused, so the
              // reason is visible rather than the option just missing.
              const wouldLoop = blockedDependencyIds?.has(o.id) && !draft.depends_on.includes(o.id);
              return (
                <ChoiceChip
                  key={o.id}
                  on={draft.depends_on.includes(o.id)}
                  disabled={wouldLoop}
                  title={wouldLoop ? `Would create a cycle — "${o.label}" already comes after this step` : undefined}
                  onToggle={() => patch((n) => (n.depends_on = toggleIn(n.depends_on, o.id)))}
                >
                  {numberOf && <span className="panel-chip-num">{numberOf(o.id)}</span>}
                  {o.label}
                </ChoiceChip>
              );
            })
          ) : (
            <span className="panel-empty">No other steps yet.</span>
          )}
        </div>
      </PanelField>
    </BoardPanel>
  );
}

// Inline "add a material this step needs but isn't in the list yet" —
// registers it on the graph (available to every other step too, not
// just this one) and turns it on for this step's in-progress draft.
function AddMaterialForm({ onAdd, onCancel }) {
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState(MATERIAL_CATEGORY_ORDER[0]);
  const [amount, setAmount] = useState(1);
  const [unit, setUnit] = useState("");

  // Not a <form>: this sits inside the panel, and Enter should add the
  // material rather than submit anything around it.
  const submit = () => {
    if (!label.trim()) return;
    onAdd({ label, category, amount, unit });
  };

  return (
    <div
      className="add-material-form"
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      }}
    >
      <input
        className="panel-input add-material-name"
        type="text"
        placeholder="Material name"
        value={label}
        autoFocus
        onChange={(e) => setLabel(e.target.value)}
      />
      <select className="panel-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
        {MATERIAL_CATEGORY_ORDER.map((cat) => (
          <option key={cat} value={cat}>
            {MATERIAL_CATEGORY_LABELS[cat] || cat}
          </option>
        ))}
      </select>
      <div className="add-material-qty">
        <input
          className="panel-input"
          type="number"
          min="0"
          step="any"
          aria-label="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input className="panel-input" type="text" placeholder="unit" aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
      </div>
      <div className="add-material-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn" onClick={submit} disabled={!label.trim()}>
          Add material
        </button>
      </div>
    </div>
  );
}
