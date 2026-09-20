// In-session chrome: the stage path (StagePath, shared with Home's run
// card), plus Back and an explicit exit that returns to Home without
// discarding the session (it stays resumable). Rendered once by
// SessionLayout, not per page.
//
// Every session route gets the same path now, including the
// kitchen-setup fallback, which used to fall through to a separate
// "Step N of 5" fill bar because it is not a design-v4 route. Two
// chromes for one piece of furniture is what let them drift.
import { useLocation, useNavigate } from "react-router-dom";
import { SESSION_STEPS } from "../utils/sessionSteps.js";
import StagePath from "./StagePath.jsx";
import "./SessionProgress.css";

export default function SessionProgress() {
  const location = useLocation();
  const navigate = useNavigate();
  // Not a stage route at all (kitchen-setup): the path shows Conversation
  // as current, which is where this page sends you next.
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

  if (isLiveCook) {
    return (
      <div className="stage-progress is-compact">
        <span className="mono stage-compact-label">
          Step {stepIndex + 1} of {SESSION_STEPS.length} &middot; {SESSION_STEPS[stepIndex].label}
        </span>
        {exitButton}
      </div>
    );
  }

  return (
    <div className="stage-progress">
      <StagePath
        label="Session progress"
        stages={[
          // Home is not a session stage (it is where you were before one
          // existed), but it is the first stop on the path and the way
          // back out, so it leads the line as a finished step.
          { key: "home", label: "Home", state: "done", onClick: () => navigate("/") },
          ...SESSION_STEPS.map((step, i) => ({
            key: step.key,
            label: step.label,
            state: i < stepIndex ? "done" : i === stepIndex ? "current" : "waiting",
          })),
        ]}
      />
      <span className="stage-actions">
        {backButton}
        {exitButton}
      </span>
    </div>
  );
}
