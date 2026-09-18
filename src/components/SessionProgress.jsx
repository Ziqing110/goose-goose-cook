// Minimal in-session chrome: "Step N of 6" + a fill bar, plus an
// explicit exit that returns to Home without discarding the session
// (it stays resumable). Rendered once by SessionLayout, not per page.
// On v4 design-system routes the bar is replaced by the stage path.
//
// TODO(design discussion): the two variants are deliberate and temporary.
// This is shared chrome and should render one way across every session
// page; pick the bar or the stage path and drop the useDesignV4 branch
// (see utils/designV4.js).
import { useLocation, useNavigate } from "react-router-dom";
import { useDesignV4 } from "../utils/designV4.js";
import { SESSION_STEPS } from "../utils/sessionSteps.js";
import Icon from "./Icon.jsx";
import "./SessionProgress.css";

export default function SessionProgress() {
  const location = useLocation();
  const navigate = useNavigate();
  const isDesignV4 = useDesignV4();

  const stepIndex = Math.max(0, SESSION_STEPS.findIndex((s) => s.path === location.pathname));
  // Live cook is the play surface: it's shared from across the counter,
  // and its two player cards must fit the screen with the VoiceBar. The
  // stage path folds to one line there — the count says where you are.
  const compact = SESSION_STEPS[stepIndex]?.key === "live-cook";

  // Only steps already completed are worth stepping back to — the route
  // guards would just bounce anywhere further ahead. Live cook is
  // excluded by staying compact: a run in progress isn't something to
  // back out of from this bar.
  const prevPath = !compact && stepIndex > 0 ? SESSION_STEPS[stepIndex - 1].path : null;
  const backButton = prevPath ? (
    <button type="button" className="btn btn-ghost session-back-btn" onClick={() => navigate(prevPath)}>
      Back
    </button>
  ) : null;

  const exitButton = (
    <button type="button" className="btn btn-ghost session-exit-btn" onClick={() => navigate("/")}>
      Exit to Home
    </button>
  );

  if (isDesignV4 && compact) {
    return (
      <div className="stage-progress is-compact">
        <span className="mono stage-compact-label">
          Step {stepIndex + 1} of {SESSION_STEPS.length} &middot; {SESSION_STEPS[stepIndex].label}
        </span>
        {exitButton}
      </div>
    );
  }

  if (isDesignV4) {
    return (
      <div className="stage-progress">
        <ol className="stage-path" aria-label="Session progress">
          {SESSION_STEPS.map((step, i) => {
            const status = i < stepIndex ? "done" : i === stepIndex ? "current" : "waiting";
            const node = (
              <>
                <span className="stage-node" aria-hidden="true">
                  {status === "done" && <Icon glyph="checkmark-burst" size={16} />}
                  {status === "waiting" && <span className="stage-dot" />}
                </span>
                <span className="stage-label">{step.label}</span>
              </>
            );
            return (
              <li
                key={step.key}
                className={`stage stage-${status}`}
                aria-current={status === "current" ? "step" : undefined}
              >
                {/* Only completed stages are worth revisiting — the
                    current and upcoming ones aren't a click target. */}
                {status === "done" ? (
                  <button type="button" className="stage-link" onClick={() => navigate(step.path)}>
                    {node}
                  </button>
                ) : (
                  node
                )}
              </li>
            );
          })}
        </ol>
        {backButton}
        {exitButton}
      </div>
    );
  }

  return (
    <div className="session-progress">
      <span className="hint mono">
        Step {stepIndex + 1} of {SESSION_STEPS.length} &middot; {SESSION_STEPS[stepIndex].label}
      </span>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${((stepIndex + 1) / SESSION_STEPS.length) * 100}%` }} />
      </div>
      {backButton}
      {exitButton}
    </div>
  );
}
