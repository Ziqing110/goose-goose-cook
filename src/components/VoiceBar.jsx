// Persistent bottom voice bar — shell-level chrome shown on every
// screen, matching the reference mockups. This is a presentational
// placeholder (idle/muted status only, no live transcript feed yet);
// same swap-for-real-AssemblyAI seam as VoiceInput.jsx.
import { useState } from "react";
import "./VoiceBar.css";

export default function VoiceBar() {
  const [muted, setMuted] = useState(false);

  const status = muted ? "Muted" : "Listening";

  return (
    <div className="voice-bar" role="status" aria-label="Voice agent status">
      <span className="voice-avatar" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
          <path
            d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>

      <div className="voice-transcript">
        <span className="voice-transcript-label mono">
          {muted ? "MIC MUTED" : "STANDING BY"}
        </span>
        <span className="voice-transcript-text">
          {muted ? "Voice check-ins are paused." : "Say the word when you're ready for the next step."}
        </span>
      </div>

      <div className="voice-meter" aria-hidden="true">
        <span className={`meter-bar ${muted ? "" : "is-live"}`} />
        <span className={`meter-bar ${muted ? "" : "is-live"}`} />
        <span className={`meter-bar ${muted ? "" : "is-live"}`} />
        <span className={`meter-bar ${muted ? "" : "is-live"}`} />
      </div>

      <span className={`voice-status-pill ${muted ? "is-muted" : "is-listening"}`}>{status}</span>

      <button type="button" className="voice-mute-btn" onClick={() => setMuted((m) => !m)}>
        {muted ? "Unmute" : "Mute"}
      </button>
    </div>
  );
}
