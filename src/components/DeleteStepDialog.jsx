// Deleting a step that other steps wait on. The old behaviour just
// scrubbed the link, which quietly changed the plan: a step that was
// third in a chain became startable immediately, and the schedule got
// shorter for a reason nobody chose.
//
// So the dependents get somewhere to go. The default is to inherit what
// the deleted step was itself waiting on — deleting B from A -> B -> C
// leaves A -> C, which is what "remove this step" almost always means.
import { useEffect, useRef, useState } from "react";
import { useAppState } from "../state/AppStateContext.jsx";
import Modal from "./Modal.jsx";
import { ChoiceChip } from "./BoardPanel.jsx";
import { cyclicDependencyIds } from "../utils/graphLayout.js";
import { registerVoiceCommands } from "../utils/voicePageCommands.js";
import "./BoardPanel.css";
import "./DeleteStepDialog.css";

export default function DeleteStepDialog({ node, dependents, allNodes, onCancel, onConfirm }) {
  const { dispatch } = useAppState();
  const inherited = node.depends_on || [];

  // Each mode rewrites one dependent's whole depends_on list, so every
  // mode has to carry that dependent's OTHER links across. Replacing
  // the list with just the inherited ones drops them: a step waiting on
  // three things came out waiting on one, and the plan silently lost
  // two orderings.
  const withoutRemoved = (dep) => (dep.depends_on || []).filter((d) => d !== node.id && d !== dep.id);
  const inheritFor = (dep) => [...new Set([...withoutRemoved(dep), ...inherited.filter((d) => d !== dep.id)])];

  const [mode, setMode] = useState("inherit");
  const [picks, setPicks] = useState(() => Object.fromEntries(dependents.map((d) => [d.id, inheritFor(d)])));

  const labelOf = (id) => allNodes.find((n) => n.id === id)?.label || id;
  // What a dependent may attach to: anything except the step being
  // removed, itself, or anything that already waits on it.
  const optionsFor = (dep) => {
    const blocked = cyclicDependencyIds(allNodes, dep.id);
    return allNodes.filter((candidate) => candidate.id !== node.id && !blocked.has(candidate.id));
  };

  const confirm = () => {
    if (mode === "inherit") onConfirm(Object.fromEntries(dependents.map((d) => [d.id, inheritFor(d)])));
    else if (mode === "drop") onConfirm(Object.fromEntries(dependents.map((d) => [d.id, withoutRemoved(d)])));
    else {
      const safePicks = Object.fromEntries(
        dependents.map((dep) => {
          const allowed = new Set(optionsFor(dep).map((candidate) => candidate.id));
          return [dep.id, (picks[dep.id] || []).filter((id) => allowed.has(id))];
        })
      );
      onConfirm(safePicks);
    }
  };

  // Registered once (the dialog's own node/dependents don't change while
  // it's open); mode and the confirm/cancel actions read through refs so
  // voice always acts on the latest picks, including ones made by mouse.
  const confirmRef = useRef();
  confirmRef.current = confirm;
  const actionsRef = useRef();
  actionsRef.current = { onCancel };

  useEffect(() => {
    const commands = [
      {
        phrases: [/\bmove them to what (?:it|this step) was waiting on\b/, /\binherit\b/, /\bmove (?:it|them) (?:to|onto) (?:its|the) (?:old )?dependencies\b/],
        label: "Moving dependents to what this step was waiting on.",
        run: () => setMode("inherit"),
      },
      {
        phrases: [/\bchoose for each\b/, /\blet me choose\b/, /\bpick (?:it|them) myself\b/],
        label: "Choose for each — pick them in the panel.",
        run: () => setMode("choose"),
      },
      {
        phrases: [/\bjust drop (?:the )?link\b/, /\bdrop (?:the )?links?\b/],
        label: "Dropping the link.",
        run: () => setMode("drop"),
      },
      {
        phrases: [/\bremove (?:the )?step\b/, /\bdelete (?:the )?step\b/, /\bconfirm\b/],
        run: () => {
          confirmRef.current();
          return null; // the dialog is closing; the page will speak next
        },
      },
      {
        phrases: [/\bkeep it\b/, /\bcancel\b/, /\bnever ?mind\b/],
        run: () => {
          actionsRef.current.onCancel();
          return null;
        },
      },
    ];

    return registerVoiceCommands(commands, { priority: 10, exclusive: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    dispatch({
      type: "voice/setHint",
      payload: {
        hint: {
          line: "Say “move them to what it was waiting on”, “choose for each”, or “just drop the link”.",
          sub: "Then “remove the step”, or “keep it”.",
        },
      },
    });
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [dispatch]);

  return (
    // Portaled to <body>, outside the app shell — the layer classes bring
    // the v4 tokens and control styles along.
    <Modal label="Remove step" onClose={onCancel} panelClassName="delete-step-panel ds-v4 ds-v4-layer">
      <span className="delete-step-title">Remove &ldquo;{node.label}&rdquo;</span>
      <p className="delete-step-copy">
        {dependents.length} step{dependents.length === 1 ? "" : "s"} wait{dependents.length === 1 ? "s" : ""} on this
        one. Tell me where {dependents.length === 1 ? "it" : "they"} should go instead, or the plan changes shape
        without anyone deciding to.
      </p>

      <ul className="delete-step-dependents">
        {dependents.map((d) => (
          <li key={d.id}>{d.label}</li>
        ))}
      </ul>

      <div className="delete-step-modes">
        <label className={`delete-step-mode ${mode === "inherit" ? "is-on" : ""}`}>
          <input type="radio" name="reattach" checked={mode === "inherit"} onChange={() => setMode("inherit")} />
          <span>
            <strong>Move them to what this step was waiting on</strong>
            <span className="delete-step-mode-hint">
              {inherited.length
                ? `they'll wait on ${inherited.map(labelOf).join(", ")} instead, keeping everything else`
                : "it waits on nothing, so they just lose this link"}
            </span>
          </span>
        </label>

        <label className={`delete-step-mode ${mode === "choose" ? "is-on" : ""}`}>
          <input type="radio" name="reattach" checked={mode === "choose"} onChange={() => setMode("choose")} />
          <span>
            <strong>Choose for each</strong>
            <span className="delete-step-mode-hint">Pick what each one should wait on.</span>
          </span>
        </label>

        <label className={`delete-step-mode ${mode === "drop" ? "is-on" : ""}`}>
          <input type="radio" name="reattach" checked={mode === "drop"} onChange={() => setMode("drop")} />
          <span>
            <strong>Just drop the link</strong>
            <span className="delete-step-mode-hint">
              They keep every other step they wait on, and simply stop waiting on this one.
            </span>
          </span>
        </label>
      </div>

      {mode === "choose" && (
        <div className="delete-step-picker">
          {dependents.map((dep) => (
            <div className="delete-step-pick" key={dep.id}>
              <span className="panel-field-label">{dep.label} runs after</span>
              <div className="panel-chips">
                {optionsFor(dep).map((o) => {
                  const on = (picks[dep.id] || []).includes(o.id);
                  return (
                    <ChoiceChip
                      key={o.id}
                      on={on}
                      onToggle={() =>
                        setPicks((cur) => ({
                          ...cur,
                          [dep.id]: on ? (cur[dep.id] || []).filter((x) => x !== o.id) : [...(cur[dep.id] || []), o.id],
                        }))
                      }
                    >
                      {o.label}
                    </ChoiceChip>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="delete-step-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Keep it
        </button>
        <button type="button" className="btn delete-step-confirm" onClick={confirm}>
          Remove the step
        </button>
      </div>
    </Modal>
  );
}
