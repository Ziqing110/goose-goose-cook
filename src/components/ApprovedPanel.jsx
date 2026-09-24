// The draft-vs-approved diff, shown once a run's recipe graph is locked
// in. Moved out of RecipeGraphPage when approval followed the step list
// onto the Inventory page.
import { useNavigate } from "react-router-dom";
import { diffGraphs } from "../utils/graphLayout.js";
import Icon from "./Icon.jsx";
import "./ApprovedPanel.css";

export default function ApprovedPanel({ draft, approved, onRevise }) {
  const navigate = useNavigate();
  const diff = diffGraphs(draft, approved);
  const hasChanges = diff.added.length || diff.removed.length || diff.edited.length;

  return (
    <section className="approved-panel" aria-labelledby="approved-title">
      <div className="approved-main">
        <span id="approved-title" className="approved-title">
          <Icon glyph="checkmark-burst" size={20} />
          Approved
        </span>
        <div className="diff-block">
          <DiffSection title="Added" items={diff.added} tone="success" />
          <DiffSection title="Removed" items={diff.removed} tone="danger" />
          <DiffSection title="Edited" items={diff.edited} tone="warning" />
          {!hasChanges && <p className="diff-none">No changes &mdash; approved exactly as drafted.</p>}
        </div>
      </div>

      <div className="approved-actions">
        <button type="button" className="btn btn-ghost" onClick={onRevise}>
          &larr; Revise
        </button>
        {/* Named for where it lands. It used to read "Continue to
            schedule" while going to the cooks, which is the step before
            scheduling — so the button described a page it does not open,
            and saying its own words out loud sent the voice agent at the
            schedule route, which the session guards refuse. */}
        <button type="button" className="btn btn-primary" onClick={() => navigate("/session/voice-binding")}>
          Continue to the cooks &rarr;
        </button>
      </div>
    </section>
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
