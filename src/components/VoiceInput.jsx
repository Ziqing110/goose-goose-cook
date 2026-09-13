// Voice-input control: a mic button that opens a small reply panel.
// This is the one seam meant to be swapped for real AssemblyAI
// realtime STT later — everything downstream only cares that
// onAnswer(value, label) eventually fires.
import { useState } from "react";
import "./VoiceInput.css";

export default function VoiceInput({ question, onAnswer }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const submit = (value, label) => {
    onAnswer(value, label);
    setOpen(false);
    setText("");
  };

  const handleFreeText = (e) => {
    e.preventDefault();
    const val = text.trim();
    if (!val) return;
    submit(val, val);
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-mic" onClick={() => setOpen(true)}>
        <span className="mic-dot" aria-hidden="true" />
        Hold to answer
      </button>
    );
  }

  return (
    <div className="voice-panel" role="dialog" aria-label="Voice reply">
      {question.options.length > 0 && (
        <div className="option-grid">
          {question.options.map((o) => (
            <button key={o.value} type="button" className="btn option-btn" onClick={() => submit(o.value, o.label)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
      <form className="free-text-row" onSubmit={handleFreeText}>
        <input
          type="text"
          autoFocus
          value={text}
          placeholder={question.freeTextPlaceholder}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn">
          Say it
        </button>
      </form>
      <button type="button" className="btn btn-ghost popup-cancel" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}
