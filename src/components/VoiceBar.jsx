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
import {
  agentWasSpeakingAt,
  onSpeakingChange,
  preload,
  setVoiceEnabled,
  speak,
  stop as stopSpeaking,
} from "../voice/agentVoice.js";
import GooseVoiceAgent from "./GooseVoiceAgent.jsx";
import { devGooseState } from "../dev/preview.js";
import { navHintFor } from "../utils/navCommands.js";
import {
  getVoiceDictation,
  matchPageCommand,
  subscribeVoiceRegistry,
  voiceCommandsAreExclusive,
} from "../utils/voicePageCommands.js";
import { voiceReachablePaths } from "../utils/routeGuards.js";
import { routeVoiceTurn, turnConfidence } from "../utils/voiceTurn.js";


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
  const { muted, hint, agentVoice, subtitles } = state.voice;
  // The goose's speaking pose follows the TTS module, not the reducer:
  // only agentVoice knows when audio actually starts and stops.
  const [speaking, setSpeaking] = useState(false);
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

  // Where the route guards would let you stay (routeGuards.js is shared
  // with App's guards, so the two cannot disagree). Without it, "go to
  // the live cook" navigates and is immediately bounced back, which reads
  // as the command having failed rather than as being too early.
  const reachable = voiceReachablePaths(state);
  const reachableRef = useRef(reachable);
  reachableRef.current = reachable;
  const hasSessionRef = useRef(false);
  hasSessionRef.current = Boolean(state.session);

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

  useEffect(() => onSpeakingChange(setSpeaking), []);

  // speak() is called from plain modules, so the egg's setting has to be
  // pushed onto agentVoice rather than read from React state there.
  useEffect(() => setVoiceEnabled(agentVoice), [agentVoice]);

  // Browser history for "back" rather than a route table: back after a
  // "go to" should return you where you were, and the session guards
  // already redirect anything unreachable. Whether there is anywhere
  // inside the app to go back to is decided before this is called.
  const run = useCallback(
    (decision) => {
      if (decision.type === "navigate") navigate(decision.path);
      else if (decision.type === "back") navigate(-1);
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
    clearPending();
  }, [pathname, clearPending]);

  // Nobody has spoken for two minutes. Close the socket rather than keep
  // billing for a mic pointed at an empty kitchen, and say why — a mic
  // that switched itself off without explanation reads as a bug.
  const onIdle = useCallback(() => {
    setIdled(true);
    dispatch({ type: "voice/setMuted", payload: { muted: true } });
  }, [dispatch]);

  // `run` gets the match, so a command can act on what was captured
  // rather than only on having fired. It may return a line to show
  // instead of the command's static label — "four burners" and "eight
  // burners, the most this allows" are the same command with different
  // outcomes, and the bar should say which one happened.
  const runPageCommand = useCallback(
    (command) => {
      const spoken = command.run(command.match, command.spoken);
      const line = typeof spoken === "string" ? spoken : command.label;
      if (line) say(line);
    },
    [say],
  );

  // What to do is decided in voiceTurn.js, where it is unit tested; this
  // only gathers the state it needs and carries the answer out.
  const onTurn = useCallback(
    (turn) => {
      const text = turn.transcript?.trim();
      const route = routeRef.current;
      const dictation = getVoiceDictation(route);
      const decision = routeVoiceTurn(text, {
        route,
        reachable: reachableRef.current,
        hasSession: hasSessionRef.current,
        confidence: turnConfidence(turn.words),
        echo: Boolean(text) && agentWasSpeakingAt(turn.startedAt ?? Date.now()),
        dictation,
        pending: pendingRef.current,
        matchPage: matchPageCommand,
        exclusive: voiceCommandsAreExclusive(),
        // react-router numbers its own entries in history.state.idx, and
        // idx 0 is the first page this visit opened.
        canGoBack: (window.history.state?.idx ?? 0) > 0,
      });

      // Read before clearing: "yes" performs the question being closed.
      const answered = pendingRef.current;
      if (decision.clearPending) clearPending();

      switch (decision.type) {
        case "takeover":
          return dictation.onFinal(text, turn);
        case "dictate":
          return dictation.onFinal(text);
        case "perform":
          return answered?.perform();
        case "say":
          return say(decision.line);
        case "navigate":
        case "back":
          return run(decision);
        case "page":
          return runPageCommand(decision.command);
        case "confirm": {
          const { then } = decision;
          const perform = then.type === "page" ? () => runPageCommand(then.command) : () => run(then);
          return askToConfirm(decision.question, perform, decision.phrase);
        }
        default:
          // Silence is the right response to ordinary conversation, and
          // most of what gets said near this app is ordinary
          // conversation. Logged, not announced.
          if (text) console.info(`[voice] ignored (${decision.reason}):`, text);
      }
    },
    // navigate is not listed: run() already closes over it, and
    // including it would rebuild this handler on every route change.
    [say, run, runPageCommand, askToConfirm, clearPending],
  );

  const { status, partial, updateConfig } = useStreamingTranscript({
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
  const view = describe({ muted, status, error, idled, pending, feedback, partial, hint, pathname, reachable });

  const goose = describeGoose({ view, speaking, muted, status, partial, pending, feedback, error });
  // ?goose=<state> pins a pose for design review (dev only).
  const pinned = devGooseState();
  const shown = pinned ? { ...GOOSE_PREVIEW[pinned], state: pinned } : goose;

  return (
    <GooseVoiceAgent
      state={shown.state}
      tag={shown.tag}
      line={shown.line}
      partial={shown.partial}
      listening={!muted && !error}
      micDisabled={status === "closing"}
      micLabel={muted ? "Start listening" : "Mute listening"}
      voiceOn={agentVoice}
      subtitlesOn={subtitles}
      onToggleMic={toggleMuted}
      onToggleVoice={() => dispatch({ type: "voice/setAgentVoice", payload: { on: !agentVoice } })}
      onToggleSubtitles={() => dispatch({ type: "voice/setSubtitles", payload: { on: !subtitles } })}
    />
  );
}

// Sample copy for ?goose=<state>, taken from the design's state sheet.
const GOOSE_PREVIEW = {
  idle: { tag: "Mic off", line: "Hover me and tap the mic to talk.", partial: false },
  listening: { tag: "Listening", line: "Answer out loud. Servings is next.", partial: false },
  thinking: { tag: "Thinking", line: "four of us, maybe five if Sam…", partial: true },
  speaking: { tag: "Speaking", line: "Five it is. I’ll plan for leftovers.", partial: false },
  warning: { tag: "Mic error", line: "I lost the microphone. Tap the mic to try again.", partial: false },
};

/**
 * Which of the five poses the goose is in, and what it is saying.
 *
 * Order matters and follows the design's signal column: a broken mic
 * outranks everything, then the agent's own voice, then what it is
 * hearing, then the resting states. `view` has already collapsed the
 * connection into copy, so this only decides the pose and reuses it.
 */
function describeGoose({ view, speaking, muted, status, partial, pending, feedback, error }) {
  if (error) return { state: "warning", tag: "Mic error", line: error, partial: false };
  // An open question outranks the fact that the goose is reading it out:
  // the answer is what the screen is waiting for, and the design files
  // "pending confirm" under thinking rather than speaking. Ordering this
  // the other way hid every confirmation behind a Speaking tag for as
  // long as the question took to say.
  if (pending) return { state: "thinking", tag: "Confirm", line: pending, partial: false };
  // `feedback` is the line the agent just said — what is coming out of
  // its beak when nothing is waiting on you.
  if (speaking) return { state: "speaking", tag: "Speaking", line: feedback || view.line, partial: false };
  if (muted) return { state: "idle", tag: "Mic off", line: "Hover me and tap the mic to talk.", partial: false };
  if (status === "connecting" || status === "closing") {
    return { state: "thinking", tag: status === "closing" ? "Finishing" : "Connecting", line: view.line, partial: false };
  }
  // A live partial is "still resolving": the turn has not landed yet, so
  // the words can still change.
  if (partial) return { state: "thinking", tag: "Thinking", line: partial, partial: true };
  return { state: "listening", tag: "Listening", line: view.line, partial: false };
}

/** Collapse mute + connection status + error into one view model. */
function describe({ muted, status, error, idled, pending, feedback, partial, hint, pathname, reachable }) {
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
  const navHint = navHintFor(pathname, reachable);
  return {
    label: partial ? "HEARING" : feedback ? "HEARD" : "LISTENING",
    line: partial || feedback || hint?.line || navHint.line,
    sub: partial || feedback ? null : hint?.sub || navHint.sub,
    pill: "Listening",
    pillClass: "is-listening",
    isPartial: Boolean(partial),
  };
}
