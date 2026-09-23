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
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { useStreamingTranscript } from "../hooks/useStreamingTranscript.js";
import { agentWasSpeakingAt, preload, speak, stop as stopSpeaking } from "../voice/agentVoice.js";
import {
  matchConfirmation,
  matchesConfirmationPhrase,
  matchNavCommand,
  navCommandList,
  isLikelyConversation,
  navHintFor,
  normalizeUtterance,
  pathLabel,
} from "../utils/navCommands.js";
import {
  getVoiceDictation,
  matchPageCommand,
  subscribeVoiceRegistry,
  voiceCommandsAreExclusive,
} from "../utils/voicePageCommands.js";
import { sessionStageStates } from "../utils/sessionSteps.js";
import "./VoiceBar.css";

// Four bars, lit proportionally to the current peak. The old markup
// animated all four on a CSS loop whether or not anyone was speaking;
// these respond to the actual signal.
const METER_BARS = 4;

// Long enough to read, short enough that the bar goes back to being a
// hint rather than a log of what you just did.
const FEEDBACK_MS = 3500;

// How long an unanswered question stays open. Long enough to think,
// short enough that a later "next" isn't read as an answer to something
// asked a minute ago.
const CONFIRM_WINDOW_MS = 10_000;

// Reading a sentence back takes longer than saying "yes", and being cut
// off mid-phrase on the one command that destroys a run would be its own
// small cruelty. Generous on purpose: the window expiring is harmless,
// since expiring means nothing happens.
const PHRASE_WINDOW_MS = 25_000;

// The live-cook page has its own command grammar, where "next" and
// "back" mean something else entirely. Navigation stands down there.
const NAV_OFF_ROUTES = ["/session/live-cook"];

// Turn detection for the pages that take commands rather than dictation.
//
// The `balanced` preset ends a turn after 128ms of silence, which is
// tuned for a voice agent interrupting a conversation, not for someone
// naming a thing. A kitchen called "Flat 3 galley" has ordinary gaps
// between its words, and at 128ms the first gap ends the turn — you say
// three words and the app hears one.
//
// 400ms is the figure the docs give for balanced on Universal Streaming
// and is still well inside "responsive": a finished command ends as soon
// as it reads as finished, because the end-of-turn check is semantic.
// This is only the floor before that check runs at all.
const COMMAND_TURN = { min_turn_silence: 400, max_turn_silence: 1280 };

const STREAM_CONFIG = {
  speechModel: "universal-3-5-pro",
  // Steer the model toward the two languages actually spoken here. It
  // still code-switches — universal-3-5-pro does that by default — but
  // naming the pair biases it and improves accuracy on both.
  languageCodes: ["en", "zh"],
  // This runs in a kitchen: extractor fans, running water, a second
  // person talking, a laptop mic across the counter. Voice Focus strips
  // that before the audio reaches the model, and far-field is the
  // variant for exactly this capture distance (the docs name laptop mics
  // under it). universal-3-5-pro only, which is what we're on — on any
  // other model it would no-op silently, so buildParams throws instead.
  voiceFocus: "far-field",
  // Above the default (0.2–0.3 depending on which doc table you read),
  // so room noise is less likely to open a turn that then never closes.
  // NOT as high as it was: 0.55 also classified the quiet gaps between
  // words as silence, so "Flat 3 galley" finalized as "Flat". Suppressing
  // noise is worth a little sensitivity; it is not worth losing every
  // command longer than one word.
  vadThreshold: 0.45,
  turnDetection: COMMAND_TURN,
  // Who said it, decided server-side, with no voice enrolled anywhere.
  // Two things came out of turning this on, measured by replaying the
  // kitchen takes with and without it:
  //
  // Every word carries a speaker confidence, and on a turn where one
  // cook cut across another it steps down exactly at the handover —
  // which is the only reliable way we have found to notice that a single
  // turn holds two people (see hasHandover in speakerMatch.js).
  //
  // And the diarization-tuned silence defaults (640ms rather than our
  // 400) turn out to MERGE the split after the agent's name that scene 4
  // shows, rather than aggravate it: "Goose." plus "I'm done with the
  // mincing" came back as one turn.
  speakerLabels: true,
  maxSpeakers: 2,
};

export default function VoiceBar() {
  const { state, dispatch } = useAppState();
  const { muted, hint } = state.voice;
  const [error, setError] = useState(null);
  const [idled, setIdled] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [pending, setPending] = useState(null);
  const pendingRef = useRef(null);
  const pendingTimer = useRef(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const feedbackTimer = useRef(null);
  // Read inside the turn handler, which must not be rebuilt on every
  // route change or session edit — that would churn the connection.
  const routeRef = useRef(pathname);
  routeRef.current = pathname;

  // Where the session guards would let you go: everything finished, plus
  // the stage you're on. Home is always reachable — it's the entry
  // point, not a wizard step.
  const reachableRef = useRef([]);
  reachableRef.current = [
    "/",
    ...sessionStageStates(state.session)
      .filter((s) => s.state !== "future")
      .map((s) => s.path),
  ];

  const onError = useCallback((message) => setError(message), []);

  const say = useCallback((line) => {
    speak(line);
    clearTimeout(feedbackTimer.current);
    setFeedback(line);
    feedbackTimer.current = setTimeout(() => setFeedback(null), FEEDBACK_MS);
  }, []);

  useEffect(() => () => clearTimeout(feedbackTimer.current), []);

  // Warm the voice up front so the first line isn't late, and never leave
  // it talking after the bar is gone.
  useEffect(() => {
    preload();
    return stopSpeaking;
  }, []);

  const run = useCallback(
    (action, path) => {
      // Browser history rather than a route table: "next" after a "back"
      // should return you where you were, and the session guards already
      // redirect anything unreachable.
      if (action === "goto") navigate(path);
      else navigate(action === "back" ? -1 : 1);
    },
    [navigate],
  );

  const clearPending = useCallback(() => {
    clearTimeout(pendingTimer.current);
    pendingRef.current = null;
    setPending(null);
  }, []);

  /**
   * Ask before doing something, then do it if the answer is yes.
   *
   * `phrase` upgrades that to a passphrase: the normalized sentence the
   * person has to read back, word for word, instead of answering yes.
   * For actions where a misheard "yeah" from across the kitchen would
   * destroy something — the words themselves become the authorisation,
   * and nobody says them by accident.
   */
  const askToConfirm = useCallback((question, perform, phrase) => {
    pendingRef.current = { perform, phrase };
    setPending(question);
    speak(question);
    clearTimeout(pendingTimer.current);
    // Expires on its own. A question left hanging would make a later
    // "yes" get read as an answer to something asked a minute ago.
    pendingTimer.current = setTimeout(() => {
      pendingRef.current = null;
      setPending(null);
    }, phrase ? PHRASE_WINDOW_MS : CONFIRM_WINDOW_MS);
  }, []);

  useEffect(() => () => clearTimeout(pendingTimer.current), []);

  // A pending question must not survive a page change — whatever it was
  // about is no longer what you're looking at.
  useEffect(() => {
    pendingRef.current = null;
    setPending(null);
  }, [pathname]);

  // Nobody has spoken for two minutes. Close the socket rather than keep
  // billing for a mic pointed at an empty kitchen, and say why — a mic
  // that switched itself off without explanation reads as a bug.
  const onIdle = useCallback(() => {
    setIdled(true);
    dispatch({ type: "voice/setMuted", payload: { muted: true } });
  }, [dispatch]);

  const onTurn = useCallback(
    (turn) => {
      const text = turn.transcript?.trim();
      if (!text) return;
      // The mic hears the agent's own voice. Judged by when the words
      // were spoken, since the transcript lands after the agent is done.
      if (agentWasSpeakingAt(turn.startedAt ?? Date.now())) {
        console.info("[voice] the agent's own voice, ignored:", text);
        return;
      }
      const route = routeRef.current;

      // A page with its own conversation gets every turn untouched, and
      // navigation stays out of it.
      const takeover = getVoiceDictation(route);
      if (takeover?.takeover) {
        takeover.onFinal(text, turn);
        return;
      }
      if (NAV_OFF_ROUTES.includes(route)) return;

      // Two signals the matcher can't get from the words alone.
      //
      // confidence: the lowest word confidence in the turn. A garbled
      // transcript should not move anyone — from the R-core recording,
      // genuine mishearings bottomed out near 0.2-0.4 while clean short
      // commands sat above 0.9.
      //
      // reachable: the stages the session guards would actually allow.
      // Without it, "go to the live cook" navigates and is immediately
      // bounced back, which reads as the command having failed rather
      // than as being too early.
      const confidence = (turn.words || []).reduce(
        (lowest, w) => Math.min(lowest, w.confidence ?? 1),
        1,
      );

      // A page taking dictation wants the words, not a command read of
      // them — "go back to basics" is an answer, and typing it is right.
      //
      // But "go back to home" is not an answer to anything, and typing
      // it strands you on a page you asked to leave with no way out but
      // the mouse. So navigation still gets a look first, in strict
      // mode: only a named destination, said briefly and heard clearly.
      // Bare "back" and "previous" never count here — they're ordinary
      // words in an answer.
      const dictating = getVoiceDictation(route);
      if (dictating) {
        const nav = matchNavCommand(text, {
          route,
          confidence,
          reachable: reachableRef.current,
          strict: true,
        });
        if (nav.action === "goto") return run("goto", nav.path);
        // Naming a page you can't reach yet, or are already on, is still
        // navigation — it just doesn't move you. Saying so beats typing
        // "go to the live cook" into the answer box.
        if (nav.action === "already") return say("You're already here.");
        if (nav.action === "blocked") return say("Not yet — finish this step first.");
        dictating.onFinal(text);
        return;
      }

      // A question is open: this turn is an answer, not a command.
      // Anything that isn't yes or no abandons it — someone who moved on
      // to another subject has answered by not answering, and leaving
      // the prompt up would make the next "next" ambiguous all over
      // again.
      if (pendingRef.current) {
        const { perform, phrase } = pendingRef.current;
        // A passphrase is not a yes/no question. Anything that isn't the
        // phrase leaves the run alone — including "yes", which is the
        // whole point: saying yes is exactly what a passphrase is meant
        // to stop being sufficient.
        if (phrase) {
          clearPending();
          if (matchesConfirmationPhrase(text, phrase)) return perform();
          return say("That didn't match, so nothing changed.");
        }
        const answer = matchConfirmation(text);
        clearPending();
        if (answer === "yes") return perform();
        if (answer === "no") return say("Cancelled.");
        return;
      }

      // The page gets first refusal. Home can "resume the run", Inventory
      // can mark an ingredient out, and neither is navigation — but both
      // are things those pages already advertise in the hint, so they
      // have to be heard before anything generic looks at the words.
      const said = normalizeUtterance(text);
      const pageCommand = matchPageCommand(said);
      if (pageCommand) {
        // Page commands get the same guards as navigation. Without this
        // "resume" was protected but "we should resume later" fired.
        if (!isLikelyConversation(said, confidence, { allowSubject: pageCommand.allowSubject })) {
          // Irreversible commands ask first. You said "start cooking" —
          // being misheard into starting a cook costs more than one
          // extra sentence.
          const done = () => {
            // `run` gets the match, so a command can act on what was
            // captured rather than only on having fired. It may return a
            // line to show instead of the command's static label — "four
            // burners" and "eight burners, the most this allows" are the
            // same command with different outcomes, and the bar should
            // say which one happened.
            const spoken = pageCommand.run(pageCommand.match);
            const line = typeof spoken === "string" ? spoken : pageCommand.label;
            if (line) say(line);
          };
          if (pageCommand.confirmPhrase) {
            askToConfirm(
              `To confirm, say: “${pageCommand.confirmPhrase}”`,
              done,
              normalizeUtterance(pageCommand.confirmPhrase),
            );
          } else if (pageCommand.confirm) {
            askToConfirm(pageCommand.confirm, done);
          } else {
            done();
          }
        }
        return;
      }

      // A dialog is open and the words were not one of its commands.
      // Navigating away now would abandon a half-filled form and read as
      // the app throwing your work away, so nothing generic gets a look:
      // the way out is the dialog's own "cancel".
      if (voiceCommandsAreExclusive()) {
        console.info("[voice] not a command for the open dialog:", text);
        return;
      }

      const { action, path, confirm } = matchNavCommand(text, {
        route,
        confidence,
        reachable: reachableRef.current,
      });

      // Plausible but not solid. Ask instead of guessing, and instead of
      // dropping it — silence on a real command reads as the app
      // ignoring you, which is its own kind of broken.
      if (confirm && (action === "back" || action === "goto")) {
        const what = action === "goto" ? `go to ${pathLabel(path)}` : "go back";
        return askToConfirm(`Did you mean ${what}? Say yes or no.`, () => run(action, path));
      }

      switch (action) {
        case "goto":
        case "back":
          run(action, path);
          break;
        case "already":
          say("You're already here.");
          break;
        case "blocked":
          say("Not yet — finish this step first.");
          break;
        case "help":
          say(`Try: next, back, or go to ${navCommandList().slice(0, 3).join(", ")}.`);
          break;
        default:
          // Silence is the right response to ordinary conversation, and
          // most of what gets said near this app is ordinary
          // conversation. Logged, not announced.
          console.info("[voice] not a command:", text);
      }
    },
    // navigate is not listed: run() already closes over it, and
    // including it would rebuild this handler on every route change.
    [say, run, askToConfirm, clearPending],
  );

  const { status, partial, level, updateConfig } = useStreamingTranscript({
    enabled: !muted,
    config: STREAM_CONFIG,
    onTurn,
    onError,
    onIdle,
  });

  // A page can ask for different turn detection while it listens — the
  // conversation page wants long thinking pauses, the live cook will
  // want the opposite. Applied on connect and whenever a page starts or
  // stops dictating; restoring means re-applying the mode preset, which
  // is what the docs prescribe.
  const keytermsSentRef = useRef(false);
  const [registryVersion, setRegistryVersion] = useState(0);
  useEffect(() => subscribeVoiceRegistry(() => setRegistryVersion((v) => v + 1)), []);
  useEffect(() => {
    if (status !== "live") return;
    // Restoring means re-applying OUR command preset, not `mode:
    // balanced`. Re-applying the mode is what the docs prescribe for
    // undoing a mid-stream override, but it would reset min_turn_silence
    // to the preset's 128ms and bring back the one-word truncation this
    // page sets 400ms to avoid.
    const listening = getVoiceDictation(pathname);
    const patch = { ...(listening?.turnDetection || COMMAND_TURN) };
    // Names and step labels the recogniser would otherwise have to guess.
    // Cleared once, on the way out, so they don't follow you to the next
    // page.
    if (listening?.keyterms?.length) {
      patch.keyterms_prompt = listening.keyterms;
      keytermsSentRef.current = true;
    } else if (keytermsSentRef.current) {
      patch.keyterms_prompt = [];
      keytermsSentRef.current = false;
    }
    updateConfig(patch);
  }, [status, registryVersion, pathname, updateConfig]);

  // Forward partials to a page taking dictation, so its input fills as
  // you speak instead of jumping all at once when the turn ends.
  useEffect(() => {
    getVoiceDictation(pathname)?.onPartial?.(partial);
  }, [partial, pathname]);

  const toggleMuted = () => {
    setError(null);
    setIdled(false);
    dispatch({ type: "voice/setMuted", payload: { muted: !muted } });
  };

  // One source of truth for the three places that describe state, so
  // the pill, the label and the body copy can never disagree.
  const view = describe({ muted, status, error, idled, pending, feedback, partial, hint, pathname });

  // A peak of ~0.5 is already loud speech, so scale before splitting
  // across bars — otherwise normal talking barely lifts the first one.
  const litBars = Math.round(Math.min(1, level * 2.2) * METER_BARS);

  const isLiveCook = pathname === "/session/live-cook";

  return (
    <div
      className={`voice-bar${isLiveCook ? " is-live-cook" : ""}${muted ? " is-muted" : ""}`}
      role="status"
      aria-label="Voice agent status"
    >
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
          title={muted ? "Unmute" : "Mute"}
        >
          {/* Only shown when Live cook folds the muted bar into a round
              button (see VoiceBar.css); the label stays for AT. */}
          <svg className="voice-mute-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
            <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" stroke="currentColor" strokeWidth="1.6" />
            <path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3M4 4l16 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span className="voice-mute-label">{muted ? "Unmute" : "Mute"}</span>
        </button>
      </div>
    </div>
  );
}

/** Collapse mute + connection status + error into one view model. */
function describe({ muted, status, error, idled, pending, feedback, partial, hint, pathname }) {
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
  // Live. Priority: what's being said right now, then what just
  // happened, then what this page offers. The page's own hint wins over
  // the generic navigation one — it knows more about where you are.
  // A pending question outranks a live partial: the question is what
  // you need to see while you answer it.
  if (pending) {
    return {
      label: "CONFIRM",
      line: pending,
      sub: null,
      pill: "Listening",
      pillClass: "is-listening",
      isPartial: false,
    };
  }
  const navHint = navHintFor(pathname);
  return {
    label: partial ? "HEARING" : feedback ? "HEARD" : "LISTENING",
    line: partial || feedback || hint?.line || navHint.line,
    sub: partial || feedback ? null : hint?.sub || navHint.sub,
    pill: "Listening",
    pillClass: "is-listening",
    isPartial: Boolean(partial),
  };
}
