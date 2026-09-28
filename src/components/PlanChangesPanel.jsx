// What's changed since the drafted plan. Used to be the "Approved"
// panel — a diff against a frozen snapshot taken only once you'd locked
// the board. There's no lock any more (the board is always editable,
// and "Continue to the cooks" is what snapshots the plan for the
// schedule and live cook to read — see continueToCooks in
// InventoryPage.jsx), so this diffs against `working` directly: it's a
// running summary, live as you edit, not a one-time gate.
import { diffGraphs } from "../utils/graphLayout.js";
import "./PlanChangesPanel.css";

export default function PlanChangesPanel({ draft, working }) {
  const diff = diffGraphs(draft, working);
  const hasChanges = diff.added.length || diff.removed.length || diff.edited.length;

  return (
    <section className="changes-panel" aria-labelledby="changes-title">
      <span id="changes-title" className="changes-title">
        Changes from the draft
      </span>
      <div className="diff-block">
        <DiffSection title="Added" items={diff.added} tone="success" />
        <DiffSection title="Removed" items={diff.removed} tone="danger" />
        <DiffSection title="Edited" items={diff.edited} tone="warning" />
        {!hasChanges && <p className="diff-none">No changes yet &mdash; exactly as drafted.</p>}
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
