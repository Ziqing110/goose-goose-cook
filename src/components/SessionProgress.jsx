// Minimal in-session chrome: "Step N of 6" + a fill bar, plus Back and
// an explicit exit that returns to Home without discarding the session
// (it stays resumable). Rendered once by SessionLayout, not per page.
//
// This used to fork on useDesignV4 into a second "stage path" layout.
// Home (the main page) never adopted that look, so this now renders the
// same bar everywhere the plain variant did, matching Home's chrome.
import { useLocation, useNavigate } from "react-router-dom";
import { SESSION_STEPS } from "../utils/sessionSteps.js";
import "./SessionProgress.css";

export default function SessionProgress() {
  const location = useLocation();
  const navigate = useNavigate();

  const stepIndex = Math.max(0, SESSION_STEPS.findIndex((s) => s.path === location.pathname));
  // Live cook is the play surface, shared from across the counter — a
  // run in progress isn't something to back out of from this bar.
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
