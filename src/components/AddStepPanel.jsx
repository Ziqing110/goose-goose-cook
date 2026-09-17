// "Add a task" — the board panel in add mode. A new step can't close a
// loop — nothing depends on it yet — so every existing step is a legal
// "runs after". The cycle rule only bites when editing an existing
// step's dependencies, which NodeEditorPanel handles.
//
// A step belongs to exactly one dish, so with more than one dish in the
// run the target is picked explicitly rather than guessed.
import { useState } from "react";
import { PHASE_OPTIONS, EQUIPMENT_OPTIONS, equipmentLabel } from "../data/dishes.js";
import BoardPanel, { ChoiceChip, PanelField, Segmented } from "./BoardPanel.jsx";
import { DIFFICULTY_SEGMENTS } from "./NodeEditorPanel.jsx";
import "./AddStepPanel.css";

export default function AddStepPanel({ recipes, nodes, numberOf, onAdd, onClose }) {
  const [label, setLabel] = useState("");
  const [recipeId, setRecipeId] = useState(recipes[0]?.id || "");
  const [phase, setPhase] = useState("prep");
  // The scheduler reads duration and equipment as fact, so both are
  // asked for here rather than invented and quietly scheduled.
  const [minutes, setMinutes] = useState(2);
  const [difficulty, setDifficulty] = useState("low");
  const [equipment, setEquipment] = useState([]);
  const [dependsOn, setDependsOn] = useState([]);

  const toggleIn = (list, value) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  const sortedNodes = [...nodes].sort((a, b) => (numberOf?.(a.id) || "").localeCompare(numberOf?.(b.id) || ""));

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
  };

  return (
    <form className="add-step-form" onSubmit={submit}>
      <BoardPanel
        label="Add a task"
        title="Add a task"
        onClose={onClose}
        footer={
          <div className="add-step-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!label.trim()}>
              Add to the board
            </button>
          </div>
        }
      >
        <PanelField as="label" label="Task">
          <input
            className="panel-input"
            type="text"
            value={label}
            autoFocus
            placeholder="e.g. Toast the sesame seeds"
            onChange={(e) => setLabel(e.target.value)}
          />
        </PanelField>

        {recipes.length > 1 && (
          <PanelField as="label" label="Dish">
            <select className="panel-select" value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.working.title}
                </option>
              ))}
            </select>
          </PanelField>
        )}

        <PanelField label="Phase">
          <Segmented label="Phase" options={PHASE_OPTIONS} value={phase} onChange={setPhase} />
        </PanelField>

        <div className="panel-field-row">
          <PanelField as="label" label="Takes">
            <span className="panel-minutes">
              <input
                className="panel-input"
                type="number"
                min="0.25"
                step="0.25"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
              <span className="panel-minutes-unit">min</span>
            </span>
          </PanelField>
          <PanelField label="Difficulty">
            <Segmented label="Difficulty" options={DIFFICULTY_SEGMENTS} value={difficulty} onChange={setDifficulty} />
          </PanelField>
        </div>

        <PanelField label="Needs">
          <div className="panel-chips">
            {EQUIPMENT_OPTIONS.map((eq) => (
              <ChoiceChip key={eq} on={equipment.includes(eq)} onToggle={() => setEquipment((cur) => toggleIn(cur, eq))}>
                {equipmentLabel(eq)}
              </ChoiceChip>
            ))}
          </div>
        </PanelField>

        <PanelField label="Runs after">
          <div className="panel-chips">
            {sortedNodes.length === 0 ? (
              <span className="panel-empty">Nothing to wait on yet.</span>
            ) : (
              sortedNodes.map((n) => (
                <ChoiceChip key={n.id} on={dependsOn.includes(n.id)} onToggle={() => setDependsOn((cur) => toggleIn(cur, n.id))}>
                  {numberOf && <span className="panel-chip-num">{numberOf(n.id)}</span>}
                  {n.label}
                </ChoiceChip>
              ))
            )}
          </div>
        </PanelField>
      </BoardPanel>
    </form>
  );
}
