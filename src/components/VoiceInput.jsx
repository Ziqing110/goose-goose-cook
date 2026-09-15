// Persistent answer bar for the conversation page. Typing and voice
// share one mic-mute state (state.voice.muted, see VoiceBar):
//  - muted   -> this bar is a live, editable text input.
//  - unmuted -> this bar is a disabled "listening" display (the seam
//               for a real live voice-transcript feed later); clicking
//               it mutes the mic and switches to typing.
// Demo-answer options render as template chips that fill the input
// (not submit) so they're a quick starting point, not a shortcut that
// skips the input entirely.
import { useEffect, useRef, useState } from "react";
import { useAppState } from "../state/AppStateContext.jsx";
import "./VoiceInput.css";

export default function VoiceInput({ question, onAnswer }) {
  const { state, dispatch } = useAppState();
  const muted = state.voice.muted;
  const [text, setText] = useState("");
  const inputRef = useRef(null);

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

  const submit = (e) => {
    e.preventDefault();
    const val = text.trim();
    if (!val) return;
    // If the text is exactly one of the demo templates (used as-is),
    // submit its real value/label pair; otherwise treat it as free text.
    const match = question.options.find((o) => o.label === val);
    if (match) onAnswer(match.value, match.label);
    else onAnswer(val, val);
    setText("");
  };

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
          value={muted ? text : ""}
          readOnly={!muted}
          onFocus={startTyping}
          onClick={startTyping}
          onChange={(e) => setText(e.target.value)}
          placeholder={muted ? question.freeTextPlaceholder : "Listening — click to type your answer instead"}
          className={`answer-input ${!muted ? "is-listening" : ""}`}
        />
        <button type="submit" className="btn btn-primary" disabled={!muted || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
