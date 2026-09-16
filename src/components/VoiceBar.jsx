// Persistent bottom voice bar — shell-level chrome shown on every
// screen, and now the app's single microphone.
//
// It lives in AppShell, above the router, so one connection follows you
// across routes: moving between pages swaps keyterms via
// UpdateConfiguration rather than reconnecting. Its mute toggle IS the
// connection — unmuted opens the socket, muted closes it. That is not
// just tidiness: AssemblyAI bills for the time the socket is open, not
// the audio sent, so an idle mic is a real charge. Hence muted by
// default (see AppStateContext) — turning it on is a deliberate act.
//
// Muting also switches the conversation page's answer bar into typing
// mode, and typing there mutes this. That contract predates the real
// microphone and still holds.
import { useCallback, useState } from "react";
import { useAppState } from "../state/AppStateContext.jsx";
import { useStreamingTranscript } from "../hooks/useStreamingTranscript.js";
import "./VoiceBar.css";

// Four bars, lit proportionally to the current peak. The old markup
// animated all four on a CSS loop whether or not anyone was speaking;
// these respond to the actual signal.
const METER_BARS = 4;

export default function VoiceBar() {
  const { state, dispatch } = useAppState();
  const { muted, hint } = state.voice;
  const [error, setError] = useState(null);
  const [idled, setIdled] = useState(false);

  const onError = useCallback((message) => setError(message), []);

  // Nobody has spoken for two minutes. Close the socket rather than keep
  // billing for a mic pointed at an empty kitchen, and say why — a mic
  // that switched itself off without explanation reads as a bug.
  const onIdle = useCallback(() => {
    setIdled(true);
    dispatch({ type: "voice/setMuted", payload: { muted: true } });
  }, [dispatch]);
  const onTurn = useCallback((turn) => {
    // Nothing consumes turns yet — navigation commands land here next.
    // Logged rather than dropped so the wiring is visible while the
    // rest is still being built.
    if (turn.transcript) console.info("[voice] turn:", turn.transcript);
  }, []);

  const { status, partial, level } = useStreamingTranscript({
    enabled: !muted,
    onTurn,
    onError,
    onIdle,
  });

  const toggleMuted = () => {
    setError(null);
    setIdled(false);
    dispatch({ type: "voice/setMuted", payload: { muted: !muted } });
  };

  // One source of truth for the three places that describe state, so
  // the pill, the label and the body copy can never disagree.
  const view = describe({ muted, status, error, idled, partial, hint });

  // A peak of ~0.5 is already loud speech, so scale before splitting
  // across bars — otherwise normal talking barely lifts the first one.
  const litBars = Math.round(Math.min(1, level * 2.2) * METER_BARS);

  return (
    <div className="voice-bar" role="status" aria-label="Voice agent status">
      <div className="voice-bar-inner">
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
          <span className="voice-transcript-label mono">{view.label}</span>
          <span className={`voice-transcript-text${view.isPartial ? " is-partial" : ""}`}>
            {view.line}
          </span>
          {view.sub && <span className="voice-transcript-sub">{view.sub}</span>}
        </div>

        <div className="voice-meter" aria-hidden="true">
          {Array.from({ length: METER_BARS }, (_, i) => (
            <span key={i} className={`meter-bar${i < litBars ? " is-lit" : ""}`} />
          ))}
        </div>

        <span className={`voice-status-pill ${view.pillClass}`}>{view.pill}</span>

        <button
          type="button"
          className="voice-mute-btn"
          onClick={toggleMuted}
          // Closing waits for the server's Termination so the last
          // transcript isn't discarded; clicking again mid-close would
          // race that.
          disabled={status === "closing"}
        >
          {muted ? "Unmute" : "Mute"}
        </button>
      </div>
    </div>
  );
}

/** Collapse mute + connection status + error into one view model. */
function describe({ muted, status, error, idled, partial, hint }) {
  if (error) {
    return {
      label: "MIC ERROR",
      line: error,
      sub: "Unmute to try again.",
      pill: "Error",
      pillClass: "is-error",
      isPartial: false,
    };
  }
  if (muted && idled) {
    return {
      label: "MIC OFF",
      line: "Muted after two minutes of quiet, to stop the meter running.",
      sub: "Unmute whenever you're ready.",
      pill: "Muted",
      pillClass: "is-muted",
      isPartial: false,
    };
  }
  if (muted) {
    return {
      label: "MIC MUTED",
      line: "Voice check-ins are paused.",
      sub: null,
      pill: "Muted",
      pillClass: "is-muted",
      isPartial: false,
    };
  }
  if (status === "connecting") {
    return {
      label: "CONNECTING",
      line: "Opening the microphone…",
      sub: null,
      pill: "Connecting",
      pillClass: "is-connecting",
      isPartial: false,
    };
  }
  if (status === "closing") {
    return {
      label: "FINISHING",
      line: "Wrapping up the last thing you said…",
      sub: null,
      pill: "Closing",
      pillClass: "is-connecting",
      isPartial: false,
    };
  }
  // Live. Show what's being heard right now if anything, otherwise the
  // page's hint — which is what `hint` was always for.
  return {
    label: partial ? "HEARING" : "LISTENING",
    line: partial || hint?.line || "Say the word when you're ready for the next step.",
    sub: partial ? null : hint?.sub || null,
    pill: "Listening",
    pillClass: "is-listening",
    isPartial: Boolean(partial),
  };
}
