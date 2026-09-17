import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { ELICITATION_QUESTIONS } from "../data/dishes.js";
// interpretAnswer is still used directly by correctReading below: a typed
// correction in the sidecar is the cook's own word for the slot, so it is
// taken as given rather than sent back to a model to be re-read.
import { conversationSlots, echoFor, interpretAnswer } from "../utils/understanding.js";
import { readAnswer } from "../api/understanding.js";
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
  // The follow-up currently outstanding, if any. Held here rather than in
  // session state because it is about this turn, not about the run — a
  // reload should re-ask the question, not resume half of it.
  const [pendingFollowUp, setPendingFollowUp] = useState(null);
  // True while the reader is thinking. The answer bar shows it, so a
  // network round trip does not look like the app ignoring you.
  const [reading, setReading] = useState(false);
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

  // The transcript keeps the cook's words as said; `answers` gets the
  // agent's reading of them, which is what the rest of the session uses.
  // Memoized deliberately. VoiceInput re-registers its dictation handler
  // whenever this identity changes, and an unmemoized version changed on
  // every render — including every partial transcript, since partials set
  // state there. That meant unregister/re-register per partial, and with
  // it an UpdateConfiguration sent over the live socket each time.
  const handleAnswer = useCallback(
    async (text) => {
      // The cook's words go up immediately, before the read comes back.
      // A network round trip is long enough that waiting to echo them
      // makes the app look like it did not hear.
      const heardTranscript = [...transcript, { speaker: "cook", text }];
      dispatch({ type: "session/conversation/update", payload: { transcript: heardTranscript } });
      setReading(true);

      let result;
      try {
        result = await readAnswer(currentQuestion, text, pendingFollowUp);
      } finally {
        setReading(false);
      }

      // The answer was not enough to fill the slot, so the agent asks
      // rather than guessing. The question index does NOT advance: we are
      // still on this slot, and the next thing they say is an answer to
      // the follow-up, which is passed back so a bare "three" is read as
      // answering it.
      if (result.status === "needs-followup" && result.followUp) {
        setPendingFollowUp(result.followUp);
        dispatch({
          type: "session/conversation/update",
          payload: {
            transcript: [...heardTranscript, { speaker: "agent", text: result.followUp }],
            understanding: {
              ...understanding,
              [currentQuestion.id]: { ...result, status: "asking-again" },
            },
          },
        });
        return;
      }

      setPendingFollowUp(null);
      const nextIndex = questionIndex + 1;
      const isLast = nextIndex >= ELICITATION_QUESTIONS.length;
      const nextLine = isLast ? "Got it — drafting your recipe graph now." : ELICITATION_QUESTIONS[nextIndex].agentText;
      const agentText = result.status === "low-confidence" ? `${echoFor(result)} ${nextLine}` : nextLine;

      dispatch({
        type: "session/conversation/update",
        payload: {
          answers: { ...answers, [currentQuestion.id]: result.value },
          understanding: { ...understanding, [currentQuestion.id]: result },
          transcript: [...heardTranscript, { speaker: "agent", text: agentText }],
          questionIndex: nextIndex,
          ...(isLast ? { complete: true } : {}),
        },
      });
    },
    [answers, understanding, questionIndex, transcript, currentQuestion, pendingFollowUp, dispatch],
  );

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
            <VoiceInput question={currentQuestion} onAnswer={handleAnswer} busy={reading} />
          )}
        </div>
      </div>
    </section>
  );
}
