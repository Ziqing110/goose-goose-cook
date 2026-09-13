// One step card in a phase column. Click to open an inline edit
// popover anchored below the card (replaces the old always-visible
// sidebar editor) — matches the reference mockups' in-place editing.
import { formatDuration } from "../utils/graphLayout.js";
import NodeEditorPanel from "./NodeEditorPanel.jsx";
import "./StepCard.css";

export default function StepCard({ node, index, allNodes, isEdited, isSelected, onSelect, onChange, onDelete }) {
  const dependencyLabels = node.depends_on
    .map((id) => allNodes.find((n) => n.id === id)?.label)
    .filter(Boolean);

  return (
    <div className={`step-card-wrap ${isSelected ? "is-open" : ""}`}>
      <button
        type="button"
        className={`step-card ${isSelected ? "is-selected" : ""}`}
        onClick={() => onSelect(isSelected ? null : node.id)}
      >
        <div className="step-card-row step-card-head">
          <span className="step-card-title">
            <span className="step-card-num mono">{index + 1}</span>
            {node.label}
          </span>
          <span className="step-card-duration mono">{formatDuration(node.estimated_duration_sec)}</span>
        </div>

        <div className="step-card-row step-card-tags">
          {node.required_equipment.length > 0 && (
            <span className="tag mono">{node.required_equipment.join(" · ")}</span>
          )}
          <span className={`tag tag-difficulty-${node.difficulty}`}>{node.difficulty}</span>
          {isEdited && <span className="tag step-card-edited">edited by you</span>}
        </div>

        {dependencyLabels.length > 0 && (
          <div className="step-card-row step-card-deps">
            <span aria-hidden="true">&#8627;</span> after {dependencyLabels.join(", ")}
          </div>
        )}
      </button>

      {isSelected && (
        <div className="step-card-popover">
          <NodeEditorPanel node={node} allNodes={allNodes} onChange={onChange} onDelete={onDelete} />
        </div>
      )}
    </div>
  );
}
