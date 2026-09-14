import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { ELICITATION_QUESTIONS } from "../data/dishes.js";
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

  const answered = Math.min(questionIndex, ELICITATION_QUESTIONS.length);

  return (
    <section className="page conversation-page">
      <div className="band-header">
        <div className="band-header-left">
          <div>
            <p className="band-eyebrow">Kitchen Path Agent</p>
            <h1>Let&rsquo;s talk about tonight&rsquo;s cook</h1>
          </div>
        </div>
        <div className="band-header-right">
          <span className="tag mono">
            {answered}/{ELICITATION_QUESTIONS.length}
          </span>
        </div>
      </div>

      <div className="card convo-card">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${(answered / ELICITATION_QUESTIONS.length) * 100}%` }} />
        </div>

        <div className="transcript" ref={transcriptRef} role="log" aria-live="polite">
          {transcript.map((entry, i) => (
            <div key={i} className={`chat-row chat-${entry.speaker}`}>
              <span className="chat-who mono">{entry.speaker === "agent" ? "Agent" : "You"}</span>
              <p className="chat-bubble">{entry.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="band-footer">
        {complete ? (
          <>
            <div className="band-footer-left">
              <span className="hint">Conversation complete.</span>
            </div>
            <div className="band-footer-right">
              <button className="btn btn-ghost" onClick={restart}>
                Start over
              </button>
              <button className="btn btn-primary btn-lg" onClick={() => navigate("/session/recipe-graph")}>
                Generate recipe graph &rarr;
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
