// "What this changes" — the steps an out ingredient costs, blocked first
// then at risk, each with the agent's reason. Rendered twice on the
// Inventory page: as the standing rail beside the ingredient list, and
// inside the board panel on the recipe graph. Every row is a button that
// takes you to that step on the board.
import { useState } from "react";
import Icon from "./Icon.jsx";
import { GooseTracks } from "./GooseMarks.jsx";
import { formatMinutes } from "../utils/inventory.js";
import "./ImpactList.css";

// Blocked entries and the first few at-risk ones always show; pure
// downstream cascades fold past this so the list stays a summary.
const VISIBLE = 5;

export function ImpactMark() {
  return (
    <span className="impact-mark" aria-hidden="true">
      <Icon glyph="waveform" size={14} />
    </span>
  );
}

export default function ImpactList({ entries, onPick, hint }) {
  const [showAll, setShowAll] = useState(false);

  if (entries.length === 0) {
    return (
      <div className="impact-empty">
        <Icon glyph="checkmark-burst" size={24} />
        <span>Nothing &mdash; everything&rsquo;s craftable.</span>
        {/* Nobody has been through here: the goose walked across the
            empty panel instead, the same prints it leaves in an
            unanswered slot on the conversation page. */}
        <GooseTracks variant="up" />
      </div>
    );
  }

  const visible = showAll ? entries : entries.slice(0, VISIBLE);
  const hidden = entries.length - visible.length;

  return (
    <>
      <ul className="impact-list" aria-live="polite">
        {visible.map((e, i) => (
          <li key={e.id} style={{ animationDelay: `${i * 60}ms` }}>
            <button
              type="button"
              className={`impact-row is-${e.status}`}
              onClick={onPick ? () => onPick(e.id) : undefined}
              disabled={!onPick}
            >
              <span className="impact-row-line">
                <span className="impact-dot" aria-label={e.status === "blocked" ? "Blocked" : "At risk"} />
                <span className="impact-num">{e.number}</span>
                <span className="impact-label">{e.label}</span>
                <span className="impact-dur">{formatMinutes(e.durationSec)}</span>
              </span>
              <span className="impact-reason">{e.reason}</span>
            </button>
          </li>
        ))}
        {hidden > 0 && (
          <li>
            <button type="button" className="impact-more" onClick={() => setShowAll(true)}>
              + {hidden} more at risk downstream
            </button>
          </li>
        )}
      </ul>
      {hint && <p className="impact-hint">{hint}</p>}
    </>
  );
}
