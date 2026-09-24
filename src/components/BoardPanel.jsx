// The recipe graph's one overlay panel. It floats over the board's
// right edge (no scrim — the board stays live behind it) and holds one
// of three things: the impact list, a step's fields, or the add-a-task
// form. The page decides which; this is the shell plus the few form
// controls the editor and the add form share.
import { useState } from "react";
import { MATERIAL_CATEGORY_ORDER, MATERIAL_CATEGORY_LABELS } from "../data/dishes.js";
import "./BoardPanel.css";

const ADD_NEW = "__new__";

export default function BoardPanel({ label, title, tone, mark, onClose, closeLabel = "Close panel", footer, children }) {
  return (
    <section className="board-panel" role="dialog" aria-label={label}>
      <header className={`board-panel-head${tone ? ` is-${tone}` : ""}`}>
        {mark}
        <span className="board-panel-title">{title}</span>
        <button type="button" className="board-panel-close" onClick={onClose} aria-label={closeLabel}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>
      <div className="board-panel-body">{children}</div>
      {footer && <footer className="board-panel-foot">{footer}</footer>}
    </section>
  );
}

/** Mono uppercase label over a control. `as="label"` wraps a single input. */
export function PanelField({ label, as: Tag = "div", className = "", children }) {
  return (
    <Tag className={`panel-field ${className}`}>
      <span className="panel-field-label">{label}</span>
      {children}
    </Tag>
  );
}

/** Single choice from a short list — the tab bar's control at field size. */
export function Segmented({ label, options, value, onChange }) {
  return (
    <div className="panel-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`panel-seg-btn${value === o.value ? " is-on" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A toggle pill for multi-select lists (equipment, materials, runs-after). */
export function ChoiceChip({ on, disabled, title, onToggle, children }) {
  return (
    <button
      type="button"
      className={`panel-chip${on ? " is-on" : ""}`}
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={onToggle}
    >
      {children}
    </button>
  );
}

// The steps on one side of this one, as chips you can take off. Only
// what is actually linked: the old list showed every other step on the
// board with the linked ones ticked, which at eighteen steps was a wall
// to read a single arrow out of.
export function LinkRow({ ids, allNodes, numberOf, empty, removeHint, onRemove }) {
  if (!ids.length) return <span className="panel-empty">{empty}</span>;
  return (
    <div className="panel-links">
      {ids.map((id) => {
        const step = allNodes.find((n) => n.id === id);
        if (!step) return null;
        return (
          <span key={id} className="panel-link">
            {numberOf && <span className="panel-chip-num">{numberOf(id)}</span>}
            <span className="panel-link-label">{step.label}</span>
            <button
              type="button"
              className="panel-link-remove"
              aria-label={`${step.label} ${removeHint}`}
              onClick={() => onRemove(id)}
            >
              &times;
            </button>
          </span>
        );
      })}
    </div>
  );
}

// Only steps that could legally go on this side — the ones that would
// make a loop are not offered at all, rather than offered and refused.
export function LinkPicker({ label, options, numberOf, onPick }) {
  if (!options.length) return null;
  return (
    <select
      className="panel-select panel-link-picker"
      value=""
      aria-label={label.replace("+ ", "")}
      onChange={(e) => {
        const v = e.target.value;
        e.target.value = "";
        if (v) onPick(v);
      }}
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {numberOf ? `${numberOf(o.id)}  ${o.label}` : o.label}
        </option>
      ))}
    </select>
  );
}

/* The materials on a step: what it uses, how much of each, and a menu
   for the rest of the catalog. Shared by the step editor and the add
   form — a task that can't name its ingredients when it is created
   would have to be saved and reopened just to get them, and anything
   added here has to reach the Ingredients tab the same way either
   panel's does. */
export function MaterialsField({
  materialsInfo,
  selected,
  amountFor,
  onSetAmount,
  onRemove,
  onPick,
  onRegisterMaterial,
  onStepIds,
}) {
  const [adding, setAdding] = useState(false);
  if (!materialsInfo) return null;

  const ids = Object.keys(materialsInfo).sort((a, b) => materialsInfo[a].label.localeCompare(materialsInfo[b].label));
  const unselected = ids.filter((m) => !selected.includes(m));
  const nameOf = (m) => materialsInfo[m]?.label || m;

  return (
    <PanelField label="Materials">
      <div className="panel-material-rows">
        {selected.map((m) => {
          const amount = amountFor(m);
          return (
            <div key={m} className={`panel-material-row${onStepIds?.has(m) ? " is-on-step" : ""}`}>
              <span className="panel-material-name">{nameOf(m)}</span>
              <input
                className="panel-input panel-material-amount mono"
                type="number"
                min="0"
                step="any"
                aria-label={`Amount of ${nameOf(m)} for this step`}
                value={amount.amount ?? ""}
                onChange={(e) => onSetAmount(m, { amount: e.target.value })}
              />
              <input
                className="panel-input panel-material-unit"
                type="text"
                aria-label={`Unit for ${nameOf(m)}`}
                value={amount.unit || ""}
                onChange={(e) => onSetAmount(m, { unit: e.target.value })}
              />
              <button
                type="button"
                className="panel-material-remove"
                aria-label={`Remove ${nameOf(m)} from this step`}
                onClick={() => onRemove(m)}
              >
                &times;
              </button>
            </div>
          );
        })}
        {selected.length === 0 && <span className="panel-empty">No materials yet.</span>}
      </div>
      {adding ? (
        <AddMaterialForm
          onAdd={(draft) => {
            const id = onRegisterMaterial?.(draft);
            if (id) onPick(id);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        // Picking from the catalog keeps the rows to what this step
        // actually uses; the full list lives in the menu.
        <select
          className="panel-select node-editor-add-material"
          value=""
          aria-label="Add a material"
          onChange={(e) => {
            const v = e.target.value;
            e.target.value = "";
            if (v === ADD_NEW) setAdding(true);
            else if (v) onPick(v);
          }}
        >
          <option value="">+ Add a material</option>
          {unselected.map((m) => (
            <option key={m} value={m}>
              {nameOf(m)}
            </option>
          ))}
          {onRegisterMaterial && <option value={ADD_NEW}>New material…</option>}
        </select>
      )}
    </PanelField>
  );
}

// A material nobody has named yet. Registering it puts it on the dish,
// available to every other step too, and turns it on for this one.
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
