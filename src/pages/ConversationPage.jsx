import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { ELICITATION_QUESTIONS } from "../data/dishes.js";
import { conversationSlots, echoFor, interpretAnswer } from "../utils/understanding.js";
import Icon from "../components/Icon.jsx";
import VoiceInput from "../components/VoiceInput.jsx";
import UnderstandingSidecar from "../components/UnderstandingSidecar.jsx";
import "./ConversationPage.css";

export default function ConversationPage() {
  const { state, dispatch } = useAppState();
  const navigate = useNavigate();
  const { conversation } = state.session;
  const { transcript, answers, questionIndex, complete } = conversation;
  const understanding = conversation.understanding || {};
  const transcriptRef = useRef(null);
  const currentQuestion = ELICITATION_QUESTIONS[questionIndex];
  // Recipes are drafted once, from the answers as they stand
  // (useSessionRecipes), so a correction after that would never reach
  // them — the readings freeze instead.
  const readingsLocked = state.session.recipes.length > 0;

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

  // The transcript keeps the cook's words as said; `answers` gets the
  // agent's reading of them, which is what the rest of the session uses.
  const handleAnswer = (text) => {
    const reading = interpretAnswer(currentQuestion, text);
    const nextAnswers = { ...answers, [currentQuestion.id]: reading.value };
    const nextUnderstanding = { ...understanding, [currentQuestion.id]: reading };
    const nextIndex = questionIndex + 1;
    const isLast = nextIndex >= ELICITATION_QUESTIONS.length;
    const nextLine = isLast ? "Got it — drafting your recipe graph now." : ELICITATION_QUESTIONS[nextIndex].agentText;
    const agentText = reading.status === "low-confidence" ? `${echoFor(reading)} ${nextLine}` : nextLine;

    dispatch({
      type: "session/conversation/update",
      payload: {
        answers: nextAnswers,
        understanding: nextUnderstanding,
        transcript: [...transcript, { speaker: "cook", text }, { speaker: "agent", text: agentText }],
        questionIndex: nextIndex,
        ...(isLast ? { complete: true } : {}),
      },
    });
  };

  const confirmReading = (id) => {
    const reading = understanding[id];
    if (!reading) return;
    dispatch({
      type: "session/conversation/update",
      payload: { understanding: { ...understanding, [id]: { ...reading, status: "confirmed", heard: undefined } } },
    });
  };

  // A correction is the cook's word, so it's confirmed however it parses.
  const correctReading = (id, text) => {
    const question = ELICITATION_QUESTIONS.find((q) => q.id === id);
    const { value, display } = interpretAnswer(question, text);
    dispatch({
      type: "session/conversation/update",
      payload: {
        answers: { ...answers, [id]: value },
        understanding: { ...understanding, [id]: { value, display, status: "confirmed" } },
      },
    });
  };

  const restart = () => {
    dispatch({ type: "session/conversation/reset" });
  };

  const total = ELICITATION_QUESTIONS.length;
  const answered = Math.min(questionIndex, total);
  // A session started before a question was removed can sit past the end
  // of the (now shorter) list without being flagged complete; there's
  // nothing left to ask, so treat it as done rather than rendering an
  // answer bar for a question that no longer exists.
  const isComplete = complete || !currentQuestion;

  return (
    <section className="page conversation-page">
      <header className="convo-title-row">
        <div className="convo-title">
          <h1>Let&rsquo;s talk about tonight&rsquo;s cook</h1>
          <p className="convo-sub">A few quick questions, then I&rsquo;ll draft your recipe graph.</p>
        </div>
      </header>

      {/* Transcript column (progress, panel, answer row) beside the
          understanding sidecar. The four are grid siblings so narrow
          screens can slot the sidecar between the panel and the answer
          row — see ConversationPage.css. */}
      <div className="convo-split">
        {/* Question progress within this conversation, as wide as the
            transcript. The stage path above tracks the whole session. */}
        <div className={`convo-progress${isComplete ? " is-complete" : ""}`}>
          <span className="convo-progress-label">
            {isComplete ? "All questions answered" : `Question ${questionIndex + 1} of ${total}`}
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

        <div className="convo-panel">
          <div className="transcript" ref={transcriptRef} role="log" aria-live="polite">
            {transcript.map((entry, i) => (
              <div key={i} className={`chat-row chat-${entry.speaker}`}>
                <span className="chat-avatar" aria-hidden="true">
                  {entry.speaker === "agent" && <Icon glyph="waveform" size={16} />}
                </span>
                <div className="chat-msg">
                  <span className="chat-who">{entry.speaker === "agent" ? "Agent" : "You"}</span>
                  <p className="chat-bubble">{entry.text}</p>
                </div>
              </div>
            ))}
            {!isComplete && (
              <div className="chat-row chat-cook" aria-hidden="true">
                <span className="chat-avatar" />
                <div className="chat-msg">
                  <span className="chat-who">You</span>
                  <p className="chat-bubble typing-bubble">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <UnderstandingSidecar
          slots={conversationSlots(conversation)}
          locked={readingsLocked}
          onConfirm={confirmReading}
          onCorrect={correctReading}
        />

        <div className="convo-footer">
          {isComplete ? (
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
      </div>
    </section>
  );
}
