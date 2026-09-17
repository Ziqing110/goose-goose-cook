import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { ELICITATION_QUESTIONS } from "../data/dishes.js";
import Icon from "../components/Icon.jsx";
import VoiceInput from "../components/VoiceInput.jsx";
import "./ConversationPage.css";

export default function ConversationPage() {
  const { state, dispatch } = useAppState();
  const navigate = useNavigate();
  const { transcript, answers, questionIndex, complete } = state.session.conversation;
  const transcriptRef = useRef(null);
  const currentQuestion = ELICITATION_QUESTIONS[questionIndex];

  useEffect(() => {
    if (transcript.length === 0) {
      dispatch({
        type: "session/conversation/update",
        payload: { transcript: [{ speaker: "agent", text: ELICITATION_QUESTIONS[0].agentText }] },
      });
    }
    // Re-seeds whenever the transcript is cleared (e.g. "Start over"),
    // not just on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript.length]);

  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [transcript]);

  // This page takes dictation, not commands, so the bar should say so —
  // and should stop advertising navigation you can't use here.
  useEffect(() => {
    dispatch({
      type: "voice/setHint",
      payload: {
        hint: complete
          ? { line: "Say “check the inventory” when you're ready.", sub: null }
          : {
              // Reads correctly in both states: an invitation while
              // muted, a description of what's happening while live.
              line: "Just answer out loud — I'll type it for you.",
              sub: "Nothing to press; it sends when you stop talking.",
            },
      },
    });
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [complete, dispatch]);

  const handleAnswer = (value, label) => {
    const nextAnswers = { ...answers, [currentQuestion.id]: value };
    let nextTranscript = [...transcript, { speaker: "cook", text: label }];
    const nextIndex = questionIndex + 1;

    if (nextIndex < ELICITATION_QUESTIONS.length) {
      nextTranscript = [...nextTranscript, { speaker: "agent", text: ELICITATION_QUESTIONS[nextIndex].agentText }];
      dispatch({
        type: "session/conversation/update",
        payload: { answers: nextAnswers, transcript: nextTranscript, questionIndex: nextIndex },
      });
    } else {
      nextTranscript = [...nextTranscript, { speaker: "agent", text: "Got it — drafting your recipe graph now." }];
      dispatch({
        type: "session/conversation/update",
        payload: { answers: nextAnswers, transcript: nextTranscript, questionIndex: nextIndex, complete: true },
      });
    }
  };

  const restart = () => {
    dispatch({ type: "session/conversation/reset" });
  };

  const total = ELICITATION_QUESTIONS.length;
  const answered = Math.min(questionIndex, total);

  return (
    <section className="page conversation-page">
      <header className="convo-title-row">
        <div className="convo-title">
          <h1>Let&rsquo;s talk about tonight&rsquo;s cook</h1>
          <p className="convo-sub">A few quick questions, then I&rsquo;ll draft your recipe graph.</p>
        </div>
      </header>

      {/* Question progress within this conversation. The stage path
          above tracks the whole session. */}
      <div className={`convo-progress${complete ? " is-complete" : ""}`}>
        <span className="convo-progress-label">
          {complete ? "All questions answered" : `Question ${questionIndex + 1} of ${total}`}
        </span>
        <div
          className="convo-progress-track"
          role="progressbar"
          aria-label="Questions answered"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={answered}
        >
          <span className="convo-progress-fill" style={{ width: `${(answered / total) * 100}%` }} />
        </div>
      </div>

      {/* Session position is shown by the stage path above (SessionProgress),
          so this panel carries only the transcript. */}
      <div className="convo-panel">
        <div className="transcript" ref={transcriptRef} role="log" aria-live="polite">
          {transcript.map((entry, i) => (
            <div key={i} className={`chat-row chat-${entry.speaker}`}>
              <span className="chat-who">{entry.speaker === "agent" ? "Agent" : "You"}</span>
              <p className="chat-bubble">{entry.text}</p>
            </div>
          ))}
          {!complete && (
            <div className="chat-row chat-cook" aria-hidden="true">
              <span className="chat-who">You</span>
              <p className="chat-bubble typing-bubble">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="convo-footer">
        {complete ? (
          <>
            <span className="convo-done">
              <Icon glyph="checkmark-burst" size={20} />
              Conversation complete
            </span>
            <div className="convo-done-actions">
              <button className="btn btn-ghost" onClick={restart}>
                Start over
              </button>
              <button className="btn btn-primary btn-lg" onClick={() => navigate("/session/inventory")}>
                Check the inventory &rarr;
              </button>
            </div>
          </>
        ) : (
          <VoiceInput question={currentQuestion} onAnswer={handleAnswer} />
        )}
      </div>
    </section>
  );
}
