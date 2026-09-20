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
import { GooseProfile, GooseFeather, GooseTracks } from "./GooseMarks.jsx";
import "./UnderstandingSidecar.css";

const PLACEHOLDER = {
  asking: "Asking now…",
  // Distinct from "Asking now…" on purpose: the cook said something, it
  // just was not enough. A card that reverted to the plain asking state
  // would look like their answer had been thrown away.
  "asking-again": "Just checking…",
  pending: "Not asked yet",
};

// Cycled down the rail so no two neighbouring empty slots carry the same
// track. See GooseTracks.
const TRACK_VARIANTS = ["up", "down", "few"];

export default function UnderstandingSidecar({ slots, locked = false, onConfirm, onCorrect }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  // Slots the cook has checked off since this page was opened. A reading
  // the agent was sure of and one the cook just approved are both
  // "confirmed" in session state, but only the second earns the goose's
  // nod and the falling feather.
  const [approved, setApproved] = useState([]);
  // Enter/Esc close the field, and the blur that follows must not commit
  // a second time (or commit a cancelled draft).
  const editingRef = useRef(null);

  const confirmedCount = slots.filter((s) => s.status === "confirmed").length;

  const accept = (id) => {
    setApproved((ids) => (ids.includes(id) ? ids : [...ids, id]));
    onConfirm(id);
  };

  const startEditing = (slot) => {
    editingRef.current = slot.id;
    setEditingId(slot.id);
    setDraft(slot.display || "");
  };

  const stopEditing = () => {
    editingRef.current = null;
    setEditingId(null);
  };

  // Blur commits, except when focus is moving to this card's own
  // "That's right" — that click would otherwise close the field before
  // it landed.
  const onFieldBlur = (e, id) => {
    if (e.relatedTarget && e.currentTarget.closest(".us-card")?.contains(e.relatedTarget)) return;
    commit(id);
  };

  const commit = (id) => {
    if (editingRef.current !== id) return;
    const text = draft.trim();
    stopEditing();
    if (!text) return;
    // A correction the cook typed themselves is as checked as a reading
    // they accepted, so the card comes back with the same nod and the
    // same feather.
    setApproved((ids) => (ids.includes(id) ? ids : [...ids, id]));
    onCorrect(id, text);
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
        <GooseProfile size={24} aria-hidden="true" />
        <span className="us-head-title">My notes</span>
        <span className="us-head-count" aria-label={`${confirmedCount} of ${slots.length} confirmed`}>
          {confirmedCount}/{slots.length}
        </span>
      </header>

      <ul className="us-rail" aria-live="polite">
        {slots.map((slot, i) => {
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
                {(isLow || editing) && <span className="us-check-pill">check this</span>}
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
                  {/* Nobody has walked through this slot yet. Neighbouring
                      slots never share an arrangement, so a rail of empty
                      cards reads as the goose wandering through rather
                      than as the same stamp repeated. */}
                  <GooseTracks variant={TRACK_VARIANTS[i % TRACK_VARIANTS.length]} />
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
                    onBlur={(e) => onFieldBlur(e, slot.id)}
                  />
                ) : (
                  <span className="us-value">{slot.display}</span>
                ))}

              {editing && (
                <div className="us-actions">
                  <button type="button" className="us-action us-action-accept" onClick={() => commit(slot.id)}>
                    That&rsquo;s right
                  </button>
                </div>
              )}

              {isLow && !editing && (
                <>
                  <span className="us-heard">heard: &ldquo;{slot.heard}&rdquo;</span>
                  {!locked && (
                    <div className="us-actions">
                      <button type="button" className="us-action us-action-fix" onClick={() => startEditing(slot)}>
                        Fix it
                      </button>
                      <button type="button" className="us-action us-action-accept" onClick={() => accept(slot.id)}>
                        That&rsquo;s right
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* The nod for a reading the cook just checked off, with a
                  feather falling across the card. The card is keyed by
                  status, so it remounts on confirm and the feather plays
                  once rather than on every later render. */}
              {slot.status === "confirmed" && approved.includes(slot.id) && !editing && (
                <>
                  <span className="us-approved">
                    Locked in<span className="us-approved-dot" aria-hidden="true" />the goose approves
                  </span>
                  <GooseFeather />
                </>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
