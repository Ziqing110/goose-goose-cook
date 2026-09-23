import { useCallback, useEffect, useRef, useState } from "react";
import idleArt from "../assets/goose-voice/idle.webp";
import listeningArt from "../assets/goose-voice/listening.webp";
import thinkingArt from "../assets/goose-voice/thinking.webp";
import speakingArt from "../assets/goose-voice/speaking.webp";
import warningArt from "../assets/goose-voice/warning.webp";
import hoverArt from "../assets/goose-voice/hover.webp";
import "./GooseVoiceAgent.css";

// The goose that replaced the voice bar — "Goose Agent States" from the
// design project, wired to the real voice stack.
//
// Five states, one goose. The pose and the status tab's colour change
// together; speaking and warning grow the goose 8% so it reads as
// "talking to you now". Hovering swaps to the hover pose and fans out
// three eggs: mic, the agent's own voice, subtitles.
//
// This renders state — it owns none of it. VoiceBar still holds the
// connection, the command grammar and the transcript, and hands the
// finished picture down. See VoiceBar.jsx for why mute is the socket.

const ART = {
  idle: idleArt,
  listening: listeningArt,
  thinking: thinkingArt,
  speaking: speakingArt,
  warning: warningArt,
  hover: hoverArt,
};

// Tag copy and tab colour per state, from the design's `S` table with
// the "peach" tab palette applied (its default).
const STATES = {
  idle: { tag: "Mic off", tab: "#1a1a1a", tabFg: "#ffffff", scale: 1 },
  listening: { tag: "Listening", tab: "#3f8f5a", tabFg: "#ffffff", scale: 1 },
  thinking: { tag: "Thinking", tab: "#f6dc86", tabFg: "#1a1a1a", scale: 1 },
  speaking: { tag: "Speaking", tab: "#d4552a", tabFg: "#ffffff", scale: 1.08 },
  warning: { tag: "Mic error", tab: "#b3261e", tabFg: "#ffffff", scale: 1.08 },
};

// The goose is 160px wide and parks bottom-right, clear of the edge.
const BOX = { w: 160, h: 204 };
const MARGIN = 16;
const POS_KEY = "gooseVoice.pos";

/** Last dragged position, clamped into the current window. */
function readPos() {
  const fallback = () => ({
    x: Math.max(MARGIN, window.innerWidth - BOX.w - MARGIN),
    y: Math.max(MARGIN, window.innerHeight - BOX.h - MARGIN),
  });
  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY));
    if (!saved || typeof saved.x !== "number" || typeof saved.y !== "number") return fallback();
    return {
      x: Math.max(MARGIN, Math.min(window.innerWidth - BOX.w - MARGIN, saved.x)),
      y: Math.max(MARGIN, Math.min(window.innerHeight - BOX.h - MARGIN, saved.y)),
    };
  } catch {
    return fallback();
  }
}

export default function GooseVoiceAgent({
  state = "idle",
  tag,
  line,
  partial = false,
  listening = false,
  micDisabled = false,
  micLabel = "Toggle microphone",
  voiceOn = true,
  subtitlesOn = true,
  onToggleMic,
  onToggleVoice,
  onToggleSubtitles,
}) {
  const [engaged, setEngaged] = useState(false);
  const [pos, setPos] = useState(readPos);
  const [dragging, setDragging] = useState(false);
  const leaveTimer = useRef(null);
  const drag = useRef(null);

  const spec = STATES[state] ?? STATES.idle;
  // While the pointer is on the goose it shows the hover pose at rest
  // scale, so the eggs fan out from a steady silhouette.
  const pose = engaged && !dragging ? "hover" : state;
  const scale = engaged && !dragging ? 1 : spec.scale;

  // A short close delay keeps the eggs reachable while the pointer
  // travels down from the goose to them.
  const enter = () => {
    clearTimeout(leaveTimer.current);
    setEngaged(true);
  };
  const leave = () => {
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setEngaged(false), 450);
  };

  const onPointerMove = useCallback((event) => {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.sx;
    const dy = event.clientY - d.sy;
    // A click is a press that never travelled: below the threshold this
    // is still a tap, so the eggs can be opened by touch.
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    setDragging(true);
    setPos({
      x: Math.max(MARGIN, Math.min(window.innerWidth - BOX.w - MARGIN, d.ox + dx)),
      y: Math.max(MARGIN, Math.min(window.innerHeight - BOX.h - MARGIN, d.oy + dy)),
    });
  }, []);

  const onPointerUp = useCallback(() => {
    const d = drag.current;
    drag.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    if (!d) return;
    if (d.moved) {
      setDragging(false);
      setPos((p) => {
        try {
          localStorage.setItem(POS_KEY, JSON.stringify(p));
        } catch {
          /* private window, or storage is full — the goose just forgets */
        }
        return p;
      });
    } else {
      setEngaged((e) => !e);
    }
  }, [onPointerMove]);

  const onPointerDown = (event) => {
    event.preventDefault();
    drag.current = { sx: event.clientX, sy: event.clientY, ox: pos.x, oy: pos.y, moved: false };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  useEffect(
    () => () => {
      clearTimeout(leaveTimer.current);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    },
    [onPointerMove, onPointerUp],
  );

  // Keep the goose on screen when the window resizes under it.
  useEffect(() => {
    const onResize = () =>
      setPos((p) => ({
        x: Math.max(MARGIN, Math.min(window.innerWidth - BOX.w - MARGIN, p.x)),
        y: Math.max(MARGIN, Math.min(window.innerHeight - BOX.h - MARGIN, p.y)),
      }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The bubble flips to whichever side has room.
  const onRight = pos.x + BOX.w / 2 > window.innerWidth / 2;
  // Idle and warning always speak up: one says how to start, the other
  // says the mic is gone. Neither is something subtitles should hide.
  const showBubble = !dragging && Boolean(line) && (subtitlesOn || state === "idle" || state === "warning");

  return (
    <div
      className={`goose-agent${dragging ? " is-dragging" : ""}`}
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) leave();
      }}
      role="status"
      aria-label="Voice agent status"
    >
      {showBubble && (
        <div className={`goose-bubble ${onRight ? "is-left" : "is-right"}`}>
          <span className="goose-bubble-tab mono" style={{ background: spec.tab, color: spec.tabFg }}>
            {tag ?? spec.tag}
          </span>
          <span className="goose-bubble-tail" aria-hidden="true" />
          {/* Partial words are italic: the transcript can still change
              before the turn ends, and the shape says "not final yet". */}
          <span className={`goose-bubble-line mono${partial ? " is-partial" : ""}`}>{line}</span>
        </div>
      )}

      <div
        className="goose-figure"
        onPointerDown={onPointerDown}
        onFocus={enter}
        tabIndex={0}
        role="button"
        aria-expanded={engaged}
        aria-label="Chef Goose — open voice controls"
      >
        <span className="goose-art-wrap" style={{ transform: `scale(${scale})` }}>
          {/* The hard offset shadow is the same art, flattened to black
              and nudged down-right — the design's ink-print look. */}
          <span className="goose-art-shadow" aria-hidden="true" style={{ backgroundImage: `url(${ART[pose]})` }} />
          <span className="goose-art" role="img" aria-label="Chef Goose" style={{ backgroundImage: `url(${ART[pose]})` }} />
        </span>
      </div>

      <div className={`goose-eggs${engaged && !dragging ? " is-open" : ""}`} aria-label="Voice controls">
        <button
          type="button"
          className={`goose-egg${listening ? " is-live" : ""}`}
          onClick={onToggleMic}
          disabled={micDisabled}
          aria-label={micLabel}
          aria-pressed={listening}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
            <path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8" />
          </svg>
        </button>

        <button
          type="button"
          className={`goose-egg${voiceOn ? " is-on" : " is-off"}`}
          onClick={onToggleVoice}
          aria-label={voiceOn ? "Mute goose voice" : "Unmute goose voice"}
          aria-pressed={voiceOn}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H2v6h4l5 4V5Z" />
            <path d="M15 9.5a4 4 0 0 1 0 5M18 7a8 8 0 0 1 0 10" />
            {!voiceOn && <path d="M3 3l18 18" />}
          </svg>
        </button>

        <button
          type="button"
          className={`goose-egg${subtitlesOn ? " is-on" : " is-off"}`}
          onClick={onToggleSubtitles}
          aria-label={subtitlesOn ? "Hide subtitles" : "Show subtitles"}
          aria-pressed={subtitlesOn}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="3" />
            <path d="M10 10a2 2 0 1 0 0 4M18 10a2 2 0 1 0 0 4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
