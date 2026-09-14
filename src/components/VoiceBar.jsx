// Persistent bottom voice bar — shell-level chrome shown on every
// screen, matching the reference mockups. Mute state is shared app
// state (state.voice.muted): muting here switches the conversation
// page's answer bar into typing mode, and typing there mutes this.
import { useAppState } from "../state/AppStateContext.jsx";
import "./VoiceBar.css";

export default function VoiceBar() {
  const { state, dispatch } = useAppState();
  const muted = state.voice.muted;
  const status = muted ? "Muted" : "Listening";

  const toggleMuted = () => dispatch({ type: "voice/setMuted", payload: { muted: !muted } });

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

      <button type="button" className="voice-mute-btn" onClick={toggleMuted}>
        {muted ? "Unmute" : "Mute"}
      </button>
    </div>
  );
}
