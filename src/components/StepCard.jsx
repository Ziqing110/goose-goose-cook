// One step card in a phase column. Click to select it — the editor
// itself opens in a side drawer (RecipeGraphPage), not inline here,
// so a long edit form doesn't push the rest of the page down.
import { formatDuration } from "../utils/graphLayout.js";
import "./StepCard.css";

export default function StepCard({
  node,
  index,
  allNodes,
  isEdited,
  isSelected,
  onSelect,
  isImpossible = false,
  impossibleReason = null,
  isAffected = false,
  affectedReason = null,
}) {
  const dependencyLabels = node.depends_on
    .map((id) => allNodes.find((n) => n.id === id)?.label)
    .filter(Boolean);

  return (
    <button
      type="button"
      className={`step-card ${isSelected ? "is-selected" : ""} ${isAffected ? "is-affected" : ""} ${isImpossible ? "is-impossible" : ""}`}
      onClick={() => !isImpossible && onSelect(isSelected ? null : node.id)}
      disabled={isImpossible}
      aria-disabled={isImpossible || undefined}
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

      {isImpossible && (
        <div className="step-card-row step-card-missing step-card-impossible-text">
          &#10005; not doable — {impossibleReason}
        </div>
      )}
      {isAffected && <div className="step-card-row step-card-missing">&#9888; {affectedReason}</div>}
    </button>
  );
}
