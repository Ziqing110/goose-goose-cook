// The one stage path in the app: 28px checkpoints joined by a 2px line,
// done → current → waiting. Rendered both as in-session chrome
// (SessionProgress) and inside Home's run card, which used to draw its
// own copy — same geometry, its own class names and its own CSS, so the
// two drifted every time either was touched.
//
// Callers hand it stages already resolved to a state; where that state
// comes from is their business (the route, for the session chrome; the
// session's own progress, for Home's card).
import Icon from "./Icon.jsx";
import "./StagePath.css";

/**
 * @param {{ key: string, label: string, state: "done"|"current"|"waiting", onClick?: () => void }[]} stages
 *   A stage with an `onClick` renders as a button — the one checkpoint
 *   you can walk back to.
 * @param {string} label  what the list is called to assistive tech
 */
export default function StagePath({ stages, label = "Session progress" }) {
  return (
    <ol className="stage-path" aria-label={label}>
      {stages.map((stage) => {
        const body = (
          <>
            <span className="stage-node" aria-hidden="true">
              {stage.state === "done" && <Icon glyph="checkmark-burst" size={16} />}
              {stage.state === "waiting" && <span className="stage-dot" />}
            </span>
            <span className="stage-label">{stage.label}</span>
          </>
        );
        return (
          <li
            key={stage.key}
            className={`stage stage-${stage.state}`}
            aria-current={stage.state === "current" ? "step" : undefined}
          >
            {stage.onClick ? (
              <button type="button" className="stage-btn" onClick={stage.onClick}>
                {body}
              </button>
            ) : (
              body
            )}
            <span className="sr-only">
              {stage.state === "done" ? " — done" : stage.state === "current" ? " — in progress" : " — not started"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
