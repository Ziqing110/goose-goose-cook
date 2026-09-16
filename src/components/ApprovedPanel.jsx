// The draft-vs-approved diff, shown once a run's main line is locked in.
// Moved out of RecipeGraphPage when approval followed the step list onto
// the Inventory page.
import { useNavigate } from "react-router-dom";
import { diffGraphs } from "../utils/graphLayout.js";
import "./ApprovedPanel.css";

export default function ApprovedPanel({ draft, approved, onRevise }) {
  const navigate = useNavigate();
  const diff = diffGraphs(draft, approved);
  const hasChanges = diff.added.length || diff.removed.length || diff.edited.length;

  return (
    <div className="card approved-panel">
      <span className="mini-title">Approved &check;</span>

      <div className="diff-block">
        <DiffSection title="Added" items={diff.added} tone="success" />
        <DiffSection title="Removed" items={diff.removed} tone="danger" />
        <DiffSection title="Edited" items={diff.edited} tone="warning" />
        {!hasChanges && <p className="hint">No changes — approved exactly as drafted.</p>}
      </div>

      <div className="approve-row approve-row-split">
        <button className="btn btn-ghost" onClick={onRevise}>
          &larr; Revise
        </button>
        <button className="btn btn-primary" onClick={() => navigate("/session/voice-binding")}>
          Continue to schedule &rarr;
        </button>
      </div>
    </div>
  );
}

function DiffSection({ title, items, tone }) {
  if (!items.length) return null;
  return (
    <div className="diff-group">
      <span className={`diff-group-title diff-${tone}`}>
        {title} ({items.length})
      </span>
      <ul className="diff-list">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
