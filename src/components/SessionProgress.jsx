// Minimal in-session chrome: "Step N of 5" + a fill bar, plus an
// explicit exit that returns to Home without discarding the session
// (it stays resumable). Rendered once by SessionLayout, not per page.
import { useLocation, useNavigate } from "react-router-dom";
import "./SessionProgress.css";

const SESSION_STEPS = [
  { key: "kitchen-setup", label: "Kitchen", path: "/session/kitchen-setup" },
  { key: "conversation", label: "Conversation", path: "/session/conversation" },
  { key: "recipe-graph", label: "Recipe graph", path: "/session/recipe-graph" },
  { key: "voice-binding", label: "Cooks", path: "/session/voice-binding" },
  { key: "schedule", label: "Schedule", path: "/session/schedule" },
  // { key: "live-cook", label: "Live cook", path: "/session/live-cook" }, // future
  // { key: "diary", label: "Diary", path: "/session/diary" },             // future
];

export default function SessionProgress() {
  const location = useLocation();
  const navigate = useNavigate();

  const stepIndex = Math.max(0, SESSION_STEPS.findIndex((s) => s.path === location.pathname));

  return (
    <div className="session-progress">
      <span className="hint mono">
        Step {stepIndex + 1} of {SESSION_STEPS.length} &middot; {SESSION_STEPS[stepIndex].label}
      </span>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${((stepIndex + 1) / SESSION_STEPS.length) * 100}%` }} />
      </div>
      <button type="button" className="btn btn-ghost session-exit-btn" onClick={() => navigate("/")}>
        Exit to Home
      </button>
    </div>
  );
}
