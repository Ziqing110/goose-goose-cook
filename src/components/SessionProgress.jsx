// In-session chrome: the stage path (numbered checkpoints with icons) on
// the design-v4 session routes, or a "Step N of 6" fill bar elsewhere,
// plus Back and an explicit exit that returns to Home without discarding
// the session (it stays resumable). Rendered once by SessionLayout, not
// per page.
//
// TODO(design discussion): the two variants are deliberate and temporary
// (see utils/designV4.js). Every stage page is a v4 route, so the stage
// path is what people see; the bar only remains for the kitchen-setup
// fallback route.
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
  // stage path folds to one line there — the count says where you are. A
  // run in progress also isn't something to back out of from this bar.
  const isLiveCook = SESSION_STEPS[stepIndex]?.key === "live-cook";

  // Only steps already completed are worth stepping back to — the route
  // guards would just bounce anywhere further ahead.
  const prevPath = !isLiveCook && stepIndex > 0 ? SESSION_STEPS[stepIndex - 1].path : null;
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

  if (isDesignV4 && isLiveCook) {
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
            return (
              <li
                key={step.key}
                className={`stage stage-${status}`}
                aria-current={status === "current" ? "step" : undefined}
              >
                <span className="stage-node" aria-hidden="true">
                  {status === "done" && <Icon glyph="checkmark-burst" size={16} />}
                  {status === "waiting" && <span className="stage-dot" />}
                </span>
                <span className="stage-label">{step.label}</span>
              </li>
            );
          })}
        </ol>
        <span className="stage-actions">
          {backButton}
          {exitButton}
        </span>
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
