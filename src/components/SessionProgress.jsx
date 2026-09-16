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
import Icon from "./Icon.jsx";
import "./SessionProgress.css";

const SESSION_STEPS = [
  { key: "kitchen-setup", label: "Kitchen", path: "/session/kitchen-setup" },
  { key: "conversation", label: "Conversation", path: "/session/conversation" },
  { key: "inventory", label: "Main line", path: "/session/inventory" },
  { key: "voice-binding", label: "Cooks", path: "/session/voice-binding" },
  { key: "schedule", label: "Schedule", path: "/session/schedule" },
  { key: "live-cook", label: "Live cook", path: "/session/live-cook" },
  // { key: "diary", label: "Diary", path: "/session/diary" },             // future
];

export default function SessionProgress() {
  const location = useLocation();
  const navigate = useNavigate();
  const isDesignV4 = useDesignV4();

  const stepIndex = Math.max(0, SESSION_STEPS.findIndex((s) => s.path === location.pathname));

  const exitButton = (
    <button type="button" className="btn btn-ghost session-exit-btn" onClick={() => navigate("/")}>
      Exit to Home
    </button>
  );

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
      {exitButton}
    </div>
  );
}
