// Persistent answer bar for the conversation page. Typing and voice
// share one mic-mute state (state.voice.muted, see VoiceBar):
//  - muted   -> this bar is a live, editable text input.
//  - unmuted -> this bar is a disabled "listening" display (the seam
//               for a real live voice-transcript feed later); clicking
//               it mutes the mic and switches to typing.
// Demo-answer options render as template chips that fill the input
// (not submit) so they're a quick starting point, not a shortcut that
// skips the input entirely.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { registerVoiceDictation } from "../utils/voicePageCommands.js";
import "./VoiceInput.css";

// Someone answering "how many servings?" says "uh... four, I think" with
// a real gap in the middle. The `balanced` preset ends a turn after
// 128ms of silence and force-ends at 1280ms, which turns one answer into
// two and submits the first half.
//
//   min_turn_silence  how long to wait before even CHECKING whether the
//                     turn is over. Below this, a pause is just a pause.
//   max_turn_silence  the hard ceiling: end the turn regardless.
//
// A finished sentence still ends promptly, because the check runs at
// 700ms and a complete thought reads as complete. It's the UNfinished
// ones that now get room — up to 4s — instead of being cut off.
//
// The cost is honest: every answer takes ~600ms longer to submit than it
// did. That is the trade being made deliberately.
const THINKING_PAUSE = { min_turn_silence: 700, max_turn_silence: 4000 };

export default function VoiceInput({ question, onAnswer, busy = false }) {
  const { state, dispatch } = useAppState();
  const { pathname } = useLocation();
  const muted = state.voice.muted;
  const [text, setText] = useState("");
  const inputRef = useRef(null);
  // Read inside send(), which is memoized on [onAnswer] and must not be
  // rebuilt every time busy flips — that would re-register dictation.
  const busyRef = useRef(busy);
  busyRef.current = busy;

  // Clear the draft when moving on to a new question.
  useEffect(() => setText(""), [question.id]);

  const startTyping = () => {
    if (!muted) dispatch({ type: "voice/setMuted", payload: { muted: true } });
  };

  const applyTemplate = (label) => {
    startTyping();
    setText(label);
    // Clicking a chip focuses the chip button, not the input — without
    // this, Enter re-clicks the chip instead of submitting the answer.
    inputRef.current?.focus();
  };

  // One place both paths go through, so a spoken answer and a typed one
  // are handled identically.
  //
  // It passes the words through untouched: reading an answer — mapping
  // "two" to the value 2, spotting a low-confidence one — belongs to the
  // page now (utils/understanding.js). This bar used to do that matching
  // itself, which would have quietly given spoken answers a different
  // interpretation from typed ones.
  const send = useCallback(
    (raw) => {
      const val = (raw ?? "").trim();
      if (!val) return;
      // A second turn arriving while the first is still being read would
      // answer the wrong question: the page has not advanced yet.
      if (busyRef.current) return;
      onAnswer(val);
      setText("");
    },
    [onAnswer],
  );

  const submit = (e) => {
    e.preventDefault();
    send(text);
  };

  // While the mic is on, this bar takes dictation instead of typing.
  //
  // There is no Enter to press: end_of_turn IS the "I've finished
  // speaking" signal, and asking someone to confirm it with a keystroke
  // would defeat the point of talking. Partials fill the field as you
  // speak so you can see it being heard, then the final turn submits and
  // the agent asks the next question.
  useEffect(() => {
    if (muted) return undefined;
    return registerVoiceDictation({
      // Tagged with the page it belongs to. A registration that somehow
      // outlives this component is then inert rather than stealing the
      // microphone from whatever page you moved to.
      route: pathname,
      onPartial: (partial) => setText(partial || ""),
      onFinal: (final) => send(final),
      turnDetection: THINKING_PAUSE,
    });
  }, [muted, send, pathname]);

  return (
    <div className="answer-bar">
      {question.options.length > 0 && (
        <div className="answer-templates">
          <span className="answer-templates-label">Quick answers</span>
          {question.options.map((o) => {
            const active = muted && text === o.label;
            return (
              <button
                key={o.value}
                type="button"
                className={`btn template-chip${active ? " is-active" : ""}`}
                aria-pressed={active}
                onClick={() => applyTemplate(o.label)}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}

      <form className="answer-input-row" onSubmit={submit}>
        <input
          ref={inputRef}
          type="text"
          // Shows the dictated text now rather than staying blank while
          // "listening" — the whole point is watching your answer arrive.
          value={text}
          readOnly={!muted}
          onFocus={startTyping}
          onClick={startTyping}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            busy
              ? "Reading that…"
              : muted
                ? question.freeTextPlaceholder
                : "Listening — just answer, or click here to type instead"
          }
          className={`answer-input ${!muted ? "is-listening" : ""}`}
        />
        {/* Nothing to press while the mic is on: the end of your
            sentence is the send. The button stays for typing. */}
        {/* Busy beats both states: the answer has gone, and pressing
            Send again would submit it twice. */}
        <button type="submit" className="btn btn-primary" disabled={busy || !muted || !text.trim()}>
          {busy ? "Reading…" : muted ? "Send" : "Listening…"}
        </button>
      </form>
    </div>
  );
}
