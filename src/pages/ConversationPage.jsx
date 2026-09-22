import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { ELICITATION_QUESTIONS } from "../data/dishes.js";
// interpretAnswer is still used directly by correctReading below: a typed
// correction in the sidecar is the cook's own word for the slot, so it is
// taken as given rather than sent back to a model to be re-read.
import { conversationSlots, echoFor, interpretAnswer } from "../utils/understanding.js";
import { readAnswer } from "../api/understanding.js";
import { UNCLAIMED_AVATAR } from "../utils/cooks.js";
import VoiceInput from "../components/VoiceInput.jsx";
import UnderstandingSidecar from "../components/UnderstandingSidecar.jsx";
import { GooseProfile, GoosePrint } from "../components/GooseMarks.jsx";
import { registerVoiceCommands } from "../utils/voicePageCommands.js";
import "./ConversationPage.css";

// Each agent bubble is tilted a fraction of a degree, authored per
// message rather than randomised: a Math.random() here re-rolls on every
// render, so the whole transcript jitters whenever anything changes.
const BUBBLE_TILTS = [-0.9, 1.1, -1.1];
const NUDGE_TILTS = [-1.3, 1.2];

// The goose refuses to sit in silence: one unprompted line once it has
// been waiting this long for an answer.
const NUDGE_LINES = [
  "Answer me. I have a whole graph waiting.",
  "Still there? The tofu isn’t going to marinate itself.",
  "I’ll just stand here then. Judging your fridge.",
  "Hello? I can hear you breathing.",
];
const NUDGE_AFTER_MS = 30000;
// Past this the goose has made its point, and a transcript that is more
// nagging than conversation helps nobody.
const NUDGE_MAX = 10;

// A HONK rides the corner of some of the goose's messages. Its longer
// lines carry one far more often than its one-liners do, but neither is
// a certainty — a pill that always lands on the same kind of bubble is
// just that bubble's border again.
const HONK_CHANCE_LONG = 80;
const HONK_CHANCE_SHORT = 60;

// Stable string hash, used to seed a conversation and to draw a value
// per message within it.
function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Which transcript indexes wear a HONK.
 *
 * Each of the goose's messages draws a number from the session seed and
 * its own turn, and honks if the draw comes in under its chance: a line
 * that runs past one row of the bubble is far likelier to get one than a
 * one-liner, without either being guaranteed. Wrapping is measured from
 * the laid out bubble, since where a line breaks depends on the width
 * the panel got rather than on a character count.
 *
 * The draw is on the turn, NOT on the message text: the questions are a
 * fixed script, so hashing the words meant the same two questions came
 * up bare in every conversation anyone ever had. Seeding per session
 * varies that while keeping it stable inside a session, so a pill never
 * moves once it is on a bubble.
 *
 * The opening question is the exception and never honks — it is the
 * first thing on screen, and it keeps one bubble plain whatever the
 * draws do.
 */
function honkIndexes(transcript, wrapped, seed) {
  const chosen = new Set();
  let agentTurn = 0;
  transcript.forEach((entry, i) => {
    if (entry.speaker !== "agent") return;
    const turn = agentTurn;
    agentTurn += 1;
    if (turn === 0) return;
    const draw = hashText(`${seed}:${turn}`) % 100;
    if (draw < (wrapped.has(i) ? HONK_CHANCE_LONG : HONK_CHANCE_SHORT)) chosen.add(i);
  });
  return chosen;
}

export default function ConversationPage() {
  const { state, dispatch } = useAppState();
  const navigate = useNavigate();
  const { conversation } = state.session;
  const { transcript, answers, questionIndex, complete } = conversation;
  // Memoized because `|| {}` builds a NEW object whenever understanding
  // is absent, which changes handleAnswer's identity every render — and
  // VoiceInput re-registers its dictation handler, and the live socket
  // gets an UpdateConfiguration, each time. Exactly the bug already
  // fixed for handleAnswer; this was the other half of it.
  const understanding = useMemo(() => conversation.understanding || {}, [conversation.understanding]);
  const transcriptRef = useRef(null);
  // The follow-up currently outstanding, if any. Held here rather than in
  // session state because it is about this turn, not about the run — a
  // reload should re-ask the question, not resume half of it.
  const [pendingFollowUp, setPendingFollowUp] = useState(null);
  // True while the reader is thinking. The answer bar shows it, so a
  // network round trip does not look like the app ignoring you.
  const [reading, setReading] = useState(false);
  // The goose's unprompted lines: [{ id, text, tilt, after }], where
  // `after` is how many messages stood above it when it was sent, so it
  // keeps its place as the conversation carries on. Once said, a line
  // stays said — including across a trip to Home, which is why these
  // live in the session conversation rather than in component state.
  // Start over empties them with the rest of it.
  const nudges = useMemo(() => conversation.nudges || [], [conversation.nudges]);
  // Read inside the timer, which is armed once per turn and would
  // otherwise close over the list as it stood when it was armed.
  const nudgesRef = useRef(nudges);
  nudgesRef.current = nudges;
  // Transcript indexes whose bubble runs to more than one line, measured
  // after layout — the goose's longer lines take a HONK first.
  const [wrapped, setWrapped] = useState(() => new Set());
  const bubbleRefs = useRef(new Map());
  const currentQuestion = ELICITATION_QUESTIONS[questionIndex];
  // Recipes are drafted once, from the answers as they stand
  // (useSessionRecipes), so a correction after that would never reach
  // them — the readings freeze instead.
  const readingsLocked = state.session.recipes.length > 0;

  const total = ELICITATION_QUESTIONS.length;
  const answered = Math.min(questionIndex, total);
  // A session started before a question was removed can sit past the end
  // of the (now shorter) list without being flagged complete; there's
  // nothing left to ask, so treat it as done rather than rendering an
  // answer bar for a question that no longer exists.
  const isComplete = complete || !currentQuestion;
  const slots = conversationSlots(conversation);
  // Readings the agent is not sure of. The footer names them rather than
  // repeating the tally the progress bar and the notes rail both carry.
  const lowReadings = slots.filter((s) => s.status === "low-confidence").length;

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

  // A bubble's line count is a layout fact, not a property of its text:
  // the same sentence wraps or doesn't depending on the width the panel
  // got. So it is read back off the laid out element and re-read
  // whenever the transcript or the panel's size changes.
  const measureWrapped = useCallback(() => {
    const next = new Set();
    bubbleRefs.current.forEach((el, index) => {
      if (!el || !el.isConnected) return;
      const style = getComputedStyle(el);
      const lineHeight = parseFloat(style.lineHeight);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      if (!lineHeight) return;
      if (Math.round((el.clientHeight - padding) / lineHeight) > 1) next.add(index);
    });
    setWrapped((current) =>
      current.size === next.size && [...next].every((i) => current.has(i)) ? current : next,
    );
  }, []);

  const pinTranscript = useCallback(() => {
    const log = transcriptRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, []);

  useEffect(() => {
    measureWrapped();
    pinTranscript();
    // `reading` too: the thinking bubble is appended below the last
    // message, so without this it can appear just off the bottom edge.
  }, [transcript, reading, nudges, measureWrapped, pinTranscript]);

  // On mount the log has no final height yet, so one pass (or one
  // requestAnimationFrame) lands before the bubbles, the web fonts and
  // the avatars have settled and leaves the transcript scrolled short of
  // the bottom. Re-pin across that whole settle instead.
  useEffect(() => {
    const settle = () => {
      measureWrapped();
      pinTranscript();
    };
    const timers = [0, 60, 200, 600, 1200].map((delay) => setTimeout(settle, delay));
    if (document.fonts?.ready) document.fonts.ready.then(settle);
    const log = transcriptRef.current;
    const observer = log ? new ResizeObserver(settle) : null;
    if (log && observer) observer.observe(log);
    return () => {
      timers.forEach(clearTimeout);
      observer?.disconnect();
    };
  }, [measureWrapped, pinTranscript]);

  // Idle nudges. The clock runs on the conversation, not on the cook:
  // only sending an answer restarts it. Typing, clicking and scrolling
  // deliberately do not — a cook who has been staring at the composer
  // for half a minute is exactly who the goose is talking to. Each line
  // is picked at random and stays where it was said.
  useEffect(() => {
    if (isComplete) return undefined;
    let timer;
    const arm = () => {
      if (nudgesRef.current.length >= NUDGE_MAX) return;
      timer = setTimeout(() => {
        const current = nudgesRef.current;
        if (current.length >= NUDGE_MAX) return;
        // Random, but never the line it just used — twice in a row reads
        // as a stuck app rather than an impatient bird.
        const previous = current[current.length - 1]?.text;
        const pool = NUDGE_LINES.filter((line) => line !== previous);
        const text = pool[Math.floor(Math.random() * pool.length)];
        dispatch({
          type: "session/conversation/update",
          payload: {
            nudges: [
              ...current,
              {
                id: `${transcript.length}-${current.length}`,
                text,
                tilt: NUDGE_TILTS[current.length % NUDGE_TILTS.length],
                after: transcript.length,
              },
            ],
          },
        });
        arm();
      }, NUDGE_AFTER_MS);
    };
    arm();
    return () => clearTimeout(timer);
    // An answer — typed or spoken — lands in the transcript, which is
    // what restarts the wait.
  }, [isComplete, transcript.length, dispatch]);

  // Which messages wear a pill (see honkIndexes). Seeded from the
  // session, so two cooks do not get the same bubbles pilled.
  const honkSeed = useMemo(() => hashText(state.session.id || "goose"), [state.session.id]);
  const honks = useMemo(() => honkIndexes(transcript, wrapped, honkSeed), [transcript, wrapped, honkSeed]);

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
    const current = understanding[id];
    if (!current) return;
    dispatch({
      type: "session/conversation/update",
      payload: { understanding: { ...understanding, [id]: { ...current, status: "confirmed", heard: undefined } } },
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

  // Voice equivalent of "Check the inventory" — the hint above promises
  // this exact phrase, and VoiceInput's dictation unmounts once the
  // conversation is done, so without a command it just falls through to
  // navigation, which doesn't know "check" as a movement verb. Said and
  // ignored is worse than not promised at all.
  useEffect(() => {
    if (!isComplete) return undefined;
    return registerVoiceCommands([
      {
        phrases: [/\bcheck (?:the )?inventory\b/, /\bcontinue to (?:the )?inventory\b/, /\bgo to (?:the )?inventory\b/],
        run: () => navigate("/session/inventory"),
      },
    ]);
  }, [isComplete, navigate]);

  return (
    <section className="page conversation-page">
      <header className="convo-title-row">
        <span className="ds-run-eyebrow">Tonight&rsquo;s run</span>
        <span className="ds-title-mark convo-title-mark">
          <h1>What are we cooking tonight?</h1>
          <svg className="ds-underline ds-underline-title" viewBox="0 0 430 10" preserveAspectRatio="none" fill="none" aria-hidden="true">
            <path d="M2 7c68-4 144 1 220-2 58-2.5 134 3 206 .5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        </span>
        <p className="convo-sub">
          {total} questions &middot; answer out loud or type &middot; correct me in the notes
        </p>
        <span className="ds-aside">
          <GoosePrint />
          <span className="mono">Feed me answers. I&rsquo;ll spit out a graph.</span>
        </span>
      </header>

      {/* Transcript column (progress, panel, answer row) beside the
          understanding sidecar. The four are grid siblings so narrow
          screens can slot the sidecar between the panel and the answer
          row — see ConversationPage.css. */}
      <div className="convo-split">
        {/* Question progress within this conversation, as wide as the
            transcript. The stage path above tracks the whole session. */}
        <div className={`convo-progress${isComplete ? " is-complete" : ""}`}>
          {/* No "question 3 of 5" here: the bar already shows how far in
              you are, and a count invites counting rather than talking.
              The finish is worth saying out loud, so that line stays. */}
          {isComplete && <span className="convo-progress-label">All questions answered</span>}
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
            {transcript.map((entry, i) => {
              // Any nudges the goose got in before this message. They
              // hold the place they were said in, rather than sliding to
              // the foot of the log as the conversation carries on.
              const before = nudges
                .filter((n) => n.after === i)
                .map((n) => (
                  <div className="chat-row chat-agent chat-nudge anim" key={n.id}>
                    <span className="chat-nudge-spacer" aria-hidden="true" />
                    <div className="chat-msg">
                      <p className="chat-bubble" style={{ transform: `rotate(${n.tilt}deg)` }}>
                        {n.text}
                      </p>
                    </div>
                  </div>
                ));

              if (entry.speaker !== "agent") {
                return (
                  <Fragment key={i}>
                    {before}
                      <div className="chat-row chat-cook">
                      <span
                        className="chat-avatar"
                        role="img"
                        aria-label="You"
                        style={{ backgroundImage: `url(${UNCLAIMED_AVATAR.src})` }}
                      />
                      <div className="chat-msg">
                        <span className="chat-who">You</span>
                        <p className="chat-bubble">{entry.text}</p>
                      </div>
                    </div>
                  </Fragment>
                );
              }
              // Tilt and wiggle phase are keyed to the message's place
              // among the agent's turns, so a bubble keeps the same
              // angle for as long as it is on screen.
              const turn = transcript.slice(0, i).filter((e) => e.speaker === "agent").length;
              return (
                <Fragment key={i}>
                  {before}
                  <div className="chat-row chat-agent">
                    <GooseProfile size={36} delay={(turn % 2) * 300} aria-hidden="true" />
                    <div className="chat-msg">
                      <span className="chat-who">Goose</span>
                      {/* The tilt goes on a wrapper so the HONK pill rides
                          the bubble's corner instead of being rotated
                          twice. */}
                      <div
                        className="chat-bubble-wrap"
                        style={{ transform: `rotate(${BUBBLE_TILTS[turn % BUBBLE_TILTS.length]}deg)` }}
                      >
                        <p
                          className="chat-bubble"
                          ref={(el) => {
                            if (el) bubbleRefs.current.set(i, el);
                            else bubbleRefs.current.delete(i);
                          }}
                        >
                          {entry.text}
                        </p>
                        {honks.has(i) && <span className="chat-honk">HONK</span>}
                      </div>
                    </div>
                  </div>
                </Fragment>
              );
            })}

            {/* Anything said after the last message. */}
            {nudges
              .filter((n) => n.after >= transcript.length)
              .map((n) => (
                <div className="chat-row chat-agent chat-nudge anim" key={n.id}>
                  <span className="chat-nudge-spacer" aria-hidden="true" />
                  <div className="chat-msg">
                    <p className="chat-bubble" style={{ transform: `rotate(${n.tilt}deg)` }}>
                      {n.text}
                    </p>
                  </div>
                </div>
              ))}
            {/* Dots mean someone is composing a message. This used to sit
                on the cook's side and render whenever the conversation
                was unfinished, so it claimed YOU were talking the entire
                time — including while the agent was the one thinking.
                Back when nothing was actually thinking it was just decor;
                now that a real read happens between turns, it was
                pointing at the wrong speaker.

                It belongs to the agent, and only while it is genuinely
                reading. The answer bar already says what the cook's side
                is doing ("Listening…", "Reading…"). */}
            {reading && (
              <div className="chat-row chat-agent" aria-live="polite" aria-label="Goose is thinking">
                <GooseProfile size={36} aria-hidden="true" />
                <div className="chat-msg">
                  <span className="chat-who">Goose</span>
                  <p className="chat-bubble typing-bubble" aria-hidden="true">
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
          slots={slots}
          locked={readingsLocked}
          onConfirm={confirmReading}
          onCorrect={correctReading}
        />

        <div className="convo-footer">
          {isComplete ? (
            <>
              {/* The green "all answered" line already sits on the
                  progress bar, so this says the thing that bar cannot:
                  whether anything still wants a second look. */}
              <span className="convo-done mono">
                {lowReadings
                  ? `${lowReadings} note${lowReadings > 1 ? "s" : ""} still need a look. Or don’t. I’ll guess.`
                  : `${total} for ${total}. Graph’s on the way.`}
              </span>
              <div className="convo-done-actions">
                <button className="btn btn-ghost" onClick={restart}>
                  Start over
                </button>
                <span className="ds-tracks" aria-hidden="true">
                  <GoosePrint depth="pale" size={16} rotate={78} style={{ position: "absolute", left: 4, bottom: 4 }} />
                  <GoosePrint depth="deep" size={19} rotate={98} style={{ position: "absolute", left: 34, bottom: 16 }} />
                </span>
                <button className="btn btn-primary btn-lg btn-key" onClick={() => navigate("/session/inventory")}>
                  Check the inventory
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
