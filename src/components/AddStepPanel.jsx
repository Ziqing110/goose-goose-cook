// "Add a task", sitting above the board. A new step can't close a loop
// — nothing depends on it yet — so every existing step is a legal
// "runs after". The cycle rule only bites when editing an existing
// step's dependencies, which NodeEditorPanel handles.
//
// A step belongs to exactly one dish, so with more than one dish in the
// run the target is picked explicitly rather than guessed.
import { useState } from "react";
import { PHASE_OPTIONS, DIFFICULTY_OPTIONS, EQUIPMENT_OPTIONS, equipmentLabel } from "../data/dishes.js";
import "./AddStepPanel.css";

export default function AddStepPanel({ recipes, nodes, onAdd }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [recipeId, setRecipeId] = useState(recipes[0]?.id || "");
  const [phase, setPhase] = useState("prep");
  // The scheduler reads duration and equipment as fact, so both are
  // asked for here rather than invented and quietly scheduled.
  const [minutes, setMinutes] = useState(2);
  const [difficulty, setDifficulty] = useState("low");
  const [equipment, setEquipment] = useState([]);
  const [dependsOn, setDependsOn] = useState([]);

  const reset = () => {
    setLabel("");
    setPhase("prep");
    setMinutes(2);
    setDifficulty("low");
    setEquipment([]);
    setDependsOn([]);
    setRecipeId(recipes[0]?.id || "");
  };

  const submit = (e) => {
    e.preventDefault();
    const name = label.trim();
    if (!name || !recipeId) return;
    onAdd(recipeId, {
      label: name,
      phase,
      dependsOn,
      difficulty,
      equipment,
      durationSec: Math.max(15, Math.round(Number(minutes) * 60) || 0),
    });
    reset();
    setOpen(false);
  };

  if (!open) {
    return (
      <div className="add-step-bar">
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
          + Add a task
        </button>
        <span className="hint">{nodes.length} steps on the board</span>
      </div>
    );
  }

  return (
    <form className="add-step-bar add-step-form" onSubmit={submit}>
      <div className="add-step-row">
        <label className="add-step-field add-step-grow">
          <span className="mini-title">Task</span>
          <input
            type="text"
            value={label}
            autoFocus
            placeholder="e.g. Toast the sesame seeds"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>

        {recipes.length > 1 && (
          <label className="add-step-field">
            <span className="mini-title">Dish</span>
            <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.working.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="add-step-field">
          <span className="mini-title">Phase</span>
          <select value={phase} onChange={(e) => setPhase(e.target.value)}>
            {PHASE_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="add-step-row">
        <label className="add-step-field">
          <span className="mini-title">Takes (minutes)</span>
          <input
            type="number"
            min="0.25"
            step="0.25"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </label>
        <label className="add-step-field">
          <span className="mini-title">Difficulty</span>
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            {DIFFICULTY_OPTIONS.map((d) => (
              <option key={d.value ?? d} value={d.value ?? d}>
                {d.label ?? d}
              </option>
            ))}
          </select>
        </label>
        <div className="add-step-field add-step-grow">
          <span className="mini-title">Needs</span>
          <div className="add-step-deps">
            {EQUIPMENT_OPTIONS.map((eq) => (
              <label className="checkbox-pill" key={eq}>
                <input
                  type="checkbox"
                  checked={equipment.includes(eq)}
                  onChange={(e) =>
                    setEquipment((cur) => (e.target.checked ? [...cur, eq] : cur.filter((x) => x !== eq)))
                  }
                />
                <span>{equipmentLabel(eq)}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="add-step-field">
        <span className="mini-title">Runs after</span>
        <div className="add-step-deps">
          {nodes.length === 0 ? (
            <span className="hint">Nothing to wait on yet.</span>
          ) : (
            nodes.map((n) => (
              <label className="checkbox-pill" key={n.id}>
                <input
                  type="checkbox"
                  checked={dependsOn.includes(n.id)}
                  onChange={(e) =>
                    setDependsOn((cur) => (e.target.checked ? [...cur, n.id] : cur.filter((d) => d !== n.id)))
                  }
                />
                <span>{n.label}</span>
              </label>
            ))
          )}
        </div>
      </div>

      <div className="add-step-actions">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!label.trim()}>
          Add to the board
        </button>
      </div>
    </form>
  );
}
