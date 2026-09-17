// "What I understood" — the agent's running reading of the cook's
// answers, beside the conversation transcript. One card per question:
//  - confirmed       white card, Edit opens an inline field
//  - low-confidence  warning card with the raw words it heard, plus
//                    "That's right" (accept) and "Fix it" (inline field)
//  - asking          dashed outline, the question on screen now
//  - asking-again    dashed outline, the agent asked a follow-up because
//                    the answer was not enough to fill the slot yet
//  - pending         dashed outline, not asked yet
// The page owns the readings (conversation.understanding); this only
// holds which card is being edited and its draft.
import { useRef, useState } from "react";
import Icon from "./Icon.jsx";
import "./UnderstandingSidecar.css";

const PLACEHOLDER = {
  asking: "Asking now…",
  // Distinct from "Asking now…" on purpose: the cook said something, it
  // just was not enough. A card that reverted to the plain asking state
  // would look like their answer had been thrown away.
  "asking-again": "Just checking…",
  pending: "Not asked yet",
};

export default function UnderstandingSidecar({ slots, locked = false, onConfirm, onCorrect }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  // Enter/Esc close the field, and the blur that follows must not commit
  // a second time (or commit a cancelled draft).
  const editingRef = useRef(null);

  const confirmedCount = slots.filter((s) => s.status === "confirmed").length;

  const startEditing = (slot) => {
    editingRef.current = slot.id;
    setEditingId(slot.id);
    setDraft(slot.display || "");
  };

  const stopEditing = () => {
    editingRef.current = null;
    setEditingId(null);
  };

  const commit = (id) => {
    if (editingRef.current !== id) return;
    const text = draft.trim();
    stopEditing();
    if (text) onCorrect(id, text);
  };

  const onFieldKeyDown = (e, id) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      stopEditing();
    }
  };

  return (
    <aside className="us-sidecar" aria-label="What the agent understood">
      <header className="us-head">
        <span className="us-head-mark" aria-hidden="true">
          <Icon glyph="waveform" size={14} />
        </span>
        <span className="us-head-title">What I understood</span>
        <span className="us-head-count" aria-label={`${confirmedCount} of ${slots.length} confirmed`}>
          {confirmedCount}/{slots.length}
        </span>
      </header>

      <ul className="us-rail" aria-live="polite">
        {slots.map((slot) => {
          const editing = editingId === slot.id;
          const isLow = slot.status === "low-confidence";
          const isOpen =
            slot.status === "asking" || slot.status === "asking-again" || slot.status === "pending";
          return (
            // Keyed by status too, so a card that just got written (or
            // confirmed) re-enters with the reveal.
            <li key={`${slot.id}-${slot.status}`} className={`us-card is-${slot.status}${editing ? " is-editing" : ""}`}>
              <div className="us-card-head">
                <span className="us-label">{slot.label}</span>
                {isLow && !editing && <span className="us-check-pill">check this</span>}
                {slot.status === "confirmed" && !editing && !locked && (
                  <button type="button" className="us-edit-btn" onClick={() => startEditing(slot)}>
                    Edit
                  </button>
                )}
              </div>

              {isOpen && (
                <>
                  <span className="us-placeholder">{PLACEHOLDER[slot.status]}</span>
                  {slot.status === "asking-again" && slot.display && (
                    <span className="us-heard">heard: &ldquo;{slot.display}&rdquo;</span>
                  )}
                </>
              )}

              {!isOpen &&
                (editing ? (
                  <input
                    className="us-field"
                    type="text"
                    value={draft}
                    aria-label={`Correct ${slot.label.toLowerCase()}`}
                    autoFocus
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => onFieldKeyDown(e, slot.id)}
                    onBlur={() => commit(slot.id)}
                  />
                ) : (
                  <span className="us-value">{slot.display}</span>
                ))}

              {isLow && !editing && (
                <>
                  <span className="us-heard">heard: &ldquo;{slot.heard}&rdquo;</span>
                  {!locked && (
                    <div className="us-actions">
                      <button type="button" className="us-action us-action-accept" onClick={() => onConfirm(slot.id)}>
                        That&rsquo;s right
                      </button>
                      <button type="button" className="us-action us-action-fix" onClick={() => startEditing(slot)}>
                        Fix it
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
