// Live cook: the run in play. The one play surface, propped on the
// counter and shared by both cooks: two station cards, a scoreboard strip
// and one agent. Read from a metre and a half with wet hands, so big type,
// big targets and nothing that depends on hover.
//
// Every voice command has a button next to the thing it acts on, and both
// paths call the same handlers (doStart, doDone, ...), so voice and touch
// cannot drift apart. What was said and done lives in the shell's
// conversation rail, not on this page.
//
// The cards, the Versus board and the results screen are in ./liveCook/.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { mergeRecipesForDisplay } from "../utils/graphLayout.js";
import { hasDeadline, isAttended } from "../utils/tending.js";
import {
  reconcileRun, isReady, readyStepIds, blockedStepIds, activeStepFor, stepVariance, unattendedPhaseNow,
  runProgress, isRunComplete, scoreboard, runOutcome, resolveAssignments, replan,
  arbitrateClaim, claimSuggestions, applyStart, applyDone, applySkip, applyDrop, selfFinishingIds,
  applyUndo, endRun, appendTranscript, scoreStep, isPaused, applyPause, applyResume,
} from "../utils/liveCook.js";
import { parseCommand, HELP_TEXT } from "../utils/voiceCommands.js";
import { matchConfirmation, hasSubject, normalizeUtterance } from "../utils/navCommands.js";
import { routeConfirmReply } from "../utils/confirmReply.js";
import { routeModalReply, FINISH_PHRASE } from "../utils/modalReply.js";
import { findSelfIntro } from "../utils/selfIntro.js";
import { joinSpelledLetters, impliedAssignee, resolveCookRef } from "../utils/cookVoice.js";
import { opensFollowUp } from "../utils/followUp.js";
import { rejectionLines } from "../utils/agentRejection.js";
import { registerVoiceDictation } from "../utils/voicePageCommands.js";
import { buildAgentSnapshot } from "../utils/agentSnapshot.js";
import { shouldCommentate } from "../utils/commentary.js";
import { recentRoomTalk, shouldBanter } from "../utils/banter.js";
import { explainStep } from "../utils/stepExplain.js";
import { availableLine, checkupLine, kitchenAnswer, matchKitchenQuestion, newlyOpenLine, whereLine } from "../utils/kitchenReport.js";
import { decideSpeaker, hasHandover, shouldLearn } from "../utils/speakerMatch.js";
import { cookFromTurn } from "../utils/speakerLabels.js";
import { isNameOnlyTurn } from "../utils/addressing.js";
import { buildSummary } from "../utils/summaryCard.js";
import { playerKey } from "../utils/serviceResults.js";
import { clock } from "../utils/time.js";
import { equipmentName } from "../data/dishes.js";
import { agentTurn, agentAside, agentBanter, collectAnswer } from "../api/agent.js";
import { identifySpeaker, learnVoice, SPEAKER_SERVICE } from "../api/speaker.js";
import { AGENT_NAME, speak, takeInterrupted } from "../voice/agentVoice.js";
import { audioTap } from "../voice/audioTap.js";
import { voiceLog } from "../voice/voiceLog.js";
import { speakerSelection, resolveSpeaker } from "../voice/speakerSelection.js";
import { PlayerAvatar } from "../components/ServiceResults.jsx";
import KpIcon from "../components/KpIcon.jsx";
import { GoosePrint } from "../components/GooseMarks.jsx";
import Modal from "../components/Modal.jsx";
import BabyGoose from "../components/BabyGoose.jsx";
import Mono from "../components/Mono.jsx";
import PlayerFocusCard, { cardFocus } from "./liveCook/PlayerFocusCard.jsx";
import TaskPoolBoard from "./liveCook/TaskPoolBoard.jsx";
import ServiceDone from "./liveCook/ServiceDone.jsx";
import ScoreFly from "./liveCook/ScoreFly.jsx";
import { GOOSE } from "./liveCook/parts.jsx";
import "./LiveCookPage.css";

// How often the page asks whether a quiet kitchen has earned an aside.
// Cheap: the decision it drives is pure and local.
const ASIDE_CHECK_MS = 5000;
// How long the receiving goose holds the handoff after "Pass to".
const HANDOFF_MS = 1600;
// How long a refused claim's answer stays on the tile it was tapped on.
const CLAIM_NOTE_MS = 3500;

// How long after the agent speaks that an answer needs no name, and the
// word confidence below which a spoken turn is not acted on. From the
// R-core recordings, mishearings bottomed out near 0.2-0.4 and clean
// short commands sat above 0.9.
const ENGAGED_MS = 10_000;
const MIN_VOICE_CONFIDENCE = 0.4;

// Mandarin the cooks actually use mid-service, primed so the recogniser
// writes it down rather than translating it.
//
// PHRASES, not single nouns, and that distinction is the whole finding.
// Replaying the code-switching take four ways:
//
//   language_codes en only     Chinese content DESTROYED — "Goose, 豆腐切好了"
//                              came back as "Goose", and "蒜蓉 done" as "Goose,,"
//   en+zh, no Chinese keyterms 4/5 addressed, mostly translated rather than
//                              transcribed (我来做 -> "I'll do")
//   en+zh, noun keyterms       verbatim, but 豆腐 wrongly inserted into 4 of 5 turns
//   en+zh, phrase keyterms     5/5 addressed, 5/5 verbatim, nothing inserted
//
// Short common nouns get over-applied by the keyterm bias and appear in
// sentences nobody said them in. Phrases of three characters or more do
// not. 蒜蓉 earns its place as the exception: without it the recogniser
// hears the homophone 算容.
//
// Addressing improves too, for an unobvious reason — with the phrases
// primed, "Goose豆腐切好了" comes back with a space after the name, so
// "goose" is its own word and the addressing gate sees it.
const MANDARIN_KEYTERMS = [
  "切好了", "做好了", "弄好了", "我来做", "我来切",
  "还要多久", "接下来做什么", "都好了", "可以上菜", "蒜蓉",
];

// How long a turn that was only the agent's name keeps the door open for
// the rest of the sentence. Shorter than ENGAGED_MS: this is someone
// mid-breath, not someone thinking about an answer. Measured on the
// kitchen recordings the gap between "Goose." and the command ran 2-3s.
const NAME_CARRY_MS = 5_000;

// How to say a step verb with the step in it, for when the goose cannot
// tell which step was meant. Said as a whole command, so the answer is
// heard like any other turn and nothing has to be held open waiting for
// it. No name in it: the goose no longer needs one to act (see
// requestTurn), and asking for it taught cooks a rule that isn't there.
const NAMED_FORM = { done: "done with", start: "start", claim: "I'll take", skip: "skip", drop: "put back" };
const sayWithStep = (intent) => `Say “${NAMED_FORM[intent] || intent}” and the step.`;

/** One clock for the page — not one per card. */
function useNow(paused) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (paused) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [paused]);
  return now;
}

// The strip's one sentence about the score: "Mia leads by 20", or
// "Level — 45 each". Nothing else on the page duplicates it.
function leadLine(board, cooks) {
  const pts = (i) => board.find((b) => b.cookId === cooks[i]?.id)?.points ?? 0;
  const a = pts(0);
  const b = pts(1);
  // Who the chip tints for, alongside the sentence. Level = no tint.
  if (a === b) return { text: `Level — ${a} each`, lead: null };
  const lead = a > b ? 0 : 1;
  return { text: `${cooks[lead]?.name || "Someone"} leads by ${Math.abs(a - b)}`, lead: playerKey(lead) };
}

export default function LiveCookPage() {
  const { state, dispatch, saveRunNow, finishSession } = useAppState();
  const navigate = useNavigate();
  const { recipes, sharedSteps, cooks } = state.session;
  const kitchenProfile = state.kitchenProfiles.find((p) => p.id === state.session.kitchenProfileId) || null;

  const approved = useMemo(() => mergeRecipesForDisplay(recipes, sharedSteps).approved, [recipes, sharedSteps]);
  const nodes = useMemo(() => approved?.nodes || [], [approved]);
  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const storedRun = state.session.run;
  const run = useMemo(() => (storedRun ? reconcileRun(storedRun, nodes) : null), [storedRun, nodes]);

  // The newest run, including writes that have not rendered yet. An agent
  // turn awaits the network, so the closure's `run` is stale by the time
  // it answers, and several calls in one turn must chain rather than each
  // overwrite the last. Every commit updates it synchronously.
  const latestRunRef = useRef(null);
  latestRunRef.current = run;
  // One agent turn at a time, in the order things were said.
  const agentQueueRef = useRef(Promise.resolve());
  // Speech handler, re-pointed every render so the microphone always
  // reaches the current closure without re-registering.
  const voiceHandlerRef = useRef(null);
  // For a while after the agent asks something, "yes" or "the garlic one"
  // is an answer to it and needs no name.
  const engagedUntilRef = useRef(0);

  const finished = Boolean(run?.endedAt);
  const paused = isPaused(run);
  const now = useNow(finished || paused);
  // The speaker toggle lives in the conversation rail, which the shell
  // mounts, so the choice is kept where both can read it.
  const speakerId = useSyncExternalStore(speakerSelection.subscribe, speakerSelection.get);
  const setSpeakerId = speakerSelection.set;
  const speaker = resolveSpeaker(speakerId, cooks);
  const speakerCook = cooks.find((c) => c.id === speaker);
  // A dialog opened by voice asks its question aloud. The agent path
  // reads this after the turn so the question is not talked over by the
  // model's own reply about a call that is now waiting on an answer.
  const askedRef = useRef([]);
  // A guessed step whose name came back close but not exact — "Cut the
  // onion" against both "Cut the yellow onion" and "Cut the red onion",
  // say. Firing on that guess is how a mishearing finishes the wrong
  // step; asking first is the whole point of this state.
  // { intent, stepId, cookId, label, candidates }, or for "are you Toni?"
  // { who: true, cookId, actions: [{ intent, stepId }] }.
  const [pendingConfirm, setPendingConfirm] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind: "finish" } | { kind: "skip", stepId, cookId }
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  // The score moment in flight: which card it left, how many points,
  // and a key so two quick Dones each get their own "+20".
  const [fly, setFly] = useState(null);
  const cardRefs = useRef([]);
  const pillRefs = useRef([]);
  const cardScoreRefs = useRef([]);
  // "Pass to X": the receiving card's goose takes the handoff (G11)
  // for a beat before settling in at the pot.
  const [handoff, setHandoff] = useState(null); // cookId
  useEffect(() => {
    if (!handoff) return undefined;
    const t = setTimeout(() => setHandoff(null), HANDOFF_MS);
    return () => clearTimeout(t);
  }, [handoff]);
  // A refused claim answers on the tile (or the card's offer) that was
  // tapped, not only in the conversation rail — on a 1280×800 counter
  // screen the rail may be collapsed, and a tap with no visible answer
  // reads as a dead button.
  const [claimNote, setClaimNote] = useState(null); // { stepId, cookId, text, key }
  useEffect(() => {
    if (!claimNote) return undefined;
    const t = setTimeout(() => setClaimNote(null), CLAIM_NOTE_MS);
    return () => clearTimeout(t);
  }, [claimNote]);

  // The shared VoiceBar only carries the hint; who is speaking is the
  // conversation rail's business (see the speaker toggle there).
  useEffect(() => {
    if (!run) return undefined;
    const hint = finished
      ? { line: "Service done — see the cook card when you're ready.", sub: null }
      : paused
        ? { line: "Paused — say “resume” to pick it back up.", sub: "Or say “back to the schedule”." }
        : {
            line: "Just say it — “I'm done with the onion.” No need for my name.",
            sub: confirm?.kind === "finish"
              ? `Say “${FINISH_PHRASE}” to end now, or “keep cooking”.`
              : confirm?.kind === "skip" || pendingConfirm
                ? `${speakerCook?.name || "Someone"} is speaking — waiting on “yes” or “no”.`
                : `${speakerCook?.name || "Someone"} is speaking — everything said is logged under that name.`,
          };
    dispatch({ type: "voice/setHint", payload: { hint } });
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [dispatch, run, finished, paused, speakerCook?.name, confirm?.kind, pendingConfirm]);

  // The microphone. VoiceBar owns the one connection; this page asks for
  // every turn (takeover) plus the words it would otherwise mishear: the
  // agent's name, the cooks', and every step on the board.
  const keyterms = useMemo(
    () =>
      [AGENT_NAME, ...cooks.map((c) => c.name), ...nodes.map((n) => n.label), ...MANDARIN_KEYTERMS]
        .map((t) => String(t || "").trim())
        .filter((t) => t && t.length <= 50)
        .slice(0, 100),
    [cooks, nodes],
  );
  const keytermsKey = keyterms.join("|");
  const hasRun = Boolean(run);
  useEffect(() => {
    if (!hasRun) return undefined;
    return registerVoiceDictation({
      route: "/session/live-cook",
      takeover: true,
      keyterms,
      onFinal: (text, turn) => voiceHandlerRef.current?.(text, turn),
    });
    // keyterms is keyed by content so a re-render doesn't re-register.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRun, keytermsKey]);

  // Rice closes itself. Nobody finishes a set-and-forget step — the end
  // of it belongs to whatever plates it — so once its time is up it
  // completes without being asked, and its dependents become ready. The
  // alternative is a Done button for a task that does not exist, holding
  // the rest of the board hostage until somebody notices it.
  useEffect(() => {
    // Above the early return below, so it has to tolerate no run yet.
    if (!run || paused || finished) return;
    const ready = selfFinishingIds(run, nodes, now);
    if (!ready.length) return;
    let next = run;
    ready.forEach((stepId) => {
      next = applyDone({ run: next, stepId, cookId: run.steps[stepId]?.cookId ?? null, at: new Date().toISOString(), source: "auto" });
    });
    // Said once, plainly, and out loud. It is not an achievement and
    // should not read like one, but the board changing on its own needs
    // explaining -- to a room that is not looking at the board.
    const lines = [`${ready.map((id) => byId[id]?.label).join(" and ")} — ready whenever you need it.`];
    // In versus, what that just opened is worth racing for.
    const opened = run.mode === "competition" ? newlyOpenLine(nodes, run, next) : "";
    if (opened) lines.push(opened);
    if (isRunComplete(next, nodes)) lines.push("That's everything. Dinner's up.");
    lines.forEach((text) => {
      next = appendTranscript(next, { at: new Date().toISOString(), speaker: "agent", text });
    });
    saveRunNow(next);
    speak(lines.join(" "));
    // `now` ticks every second; the guard above is what stops this
    // firing more than once per step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, paused, finished]);

  // A moment coming due is the alarm. The row and the card already show
  // it; this adds the agent's line to the transcript and SAYS it. With
  // the cooks' backs to the screen, a check-in only on the card is a
  // check-in nobody sees -- this cue is how the rice gets stirred.
  // Phase transitions are detected here, not stored — the run has no
  // moment state, same as everything else derived from the clock.
  const phasesRef = useRef(null);
  useEffect(() => {
    if (!run || paused || finished) return;
    const current = {};
    nodes.forEach((n) => {
      const record = run.steps[n.id];
      if (isAttended(n) || record?.status !== "active") return;
      const { phase, index } = unattendedPhaseNow(n, record, now);
      current[n.id] = `${phase}:${index}`;
    });
    const prev = phasesRef.current;
    phasesRef.current = current;
    // First tick after a load: nothing is "newly" due.
    if (!prev) return;
    let next = run;
    let fired = false;
    const cues = [];
    Object.entries(current).forEach(([stepId, key]) => {
      if (prev[stepId] === key) return;
      const [phase, index] = key.split(":");
      if (phase !== "checkpoint" && phase !== "ending") return;
      const node = byId[stepId];
      if (!hasDeadline(node)) return;
      const who = cooks.find((c) => c.id === run.steps[stepId].cookId)?.name || "Someone";
      const count = node.unattended?.checkpoints?.count || 0;
      const text = phase === "checkpoint" ? `${who} — check on “${node.label}”. ${Number(index) + 1} of ${count}.` : `${who} — finish “${node.label}” now.`;
      next = appendTranscript(next, { at: new Date().toISOString(), speaker: "agent", text });
      cues.push(text);
      fired = true;
    });
    if (fired) {
      saveRunNow(next);
      speak(cues.join(" "));
    }
    // `now` ticks every second; the phase diff above is the guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, paused, finished]);

  // --- an unprompted remark into a quiet kitchen ---------------------
  //
  // Long silences are where a live cook stops feeling live. When it is
  // welcome is decided in utils/commentary.js, and deliberately meanly;
  // this supplies the clock and the state.
  //
  // Barge-in applies as to everything else: the line goes out through
  // the same speak(), so a cook talking over it stops it dead. That is
  // the backstop rather than the plan.
  //
  // Split in two because the hooks must run before this component's
  // early return, while the work needs commit() and say(), which are
  // declared after it. Same shape as voiceHandlerRef below.


  const lastVoiceAtRef = useRef(Date.now());
  const lastAsideAtRef = useRef(0);
  const asideBusyRef = useRef(false);
  const asideRunnerRef = useRef(null);
  // The cooks' own talk, not meant for the goose, kept briefly so it can
  // occasionally join in (see utils/banter.js).
  const roomTalkRef = useRef([]);
  const lastBanterAtRef = useRef(0);
  const banterBusyRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => asideRunnerRef.current?.(), ASIDE_CHECK_MS);
    return () => clearInterval(id);
  }, []);

  if (!run) {
    return (
      <section className="page live-cook-page">
        <div className="lc-empty">
          <span className="lc-meta">No cook in progress.</span>
          <button type="button" className="btn btn-primary" onClick={() => navigate("/session/schedule")}>
            Back to the plan
          </button>
        </div>
      </section>
    );
  }

  const isVersus = run.mode === "competition";
  // Frozen at the moment of the pause, so a reload mid-break shows the
  // same numbers as the tab that paused rather than counting the break.
  const clockNow = paused ? Date.parse(run.pausedAt) : now;

  const progress = runProgress(run, nodes, clockNow);
  const board = scoreboard(run, nodes, cooks);
  const ready = readyStepIds(nodes, run);
  const blocked = blockedStepIds(nodes, run);
  const complete = isRunComplete(run, nodes);
  const assignments = isVersus ? null : resolveAssignments({ nodes, run, cooks, now });
  const name = (id) => cooks.find((c) => c.id === id)?.name ?? "someone";

  const say = (nextRun, text, actions) =>
    appendTranscript(nextRun, { at: new Date().toISOString(), speaker: "agent", text, actions });

  const commit = (nextRun) => {
    latestRunRef.current = nextRun;
    saveRunNow(nextRun);
  };

  // A question for somebody whose hands are busy: on the record, said
  // aloud, and noted so the agent path does not talk over it.
  const askAloud = (base, line) => {
    commit(say(base, line));
    askedRef.current.push(line);
    speak(line);
  };

  // Taking work on for somebody the app only GUESSED was talking -- a
  // diarization label or the toggle, with no voiceprint behind it (the
  // demo never has one) -- asks first: "Are you Toni?". A wrong claim
  // puts a step, and in versus its points, on the wrong cook, and
  // nobody may notice until it matters. Skipped when the step is
  // already this cook's dealt ticket: the plan and the guess agree.
  const WHO_CHECKED = new Set(["claim", "start"]);
  // Who the plan deals each step to, on whichever run is being built on:
  // a voice turn lands after an await, when the render's run is stale.
  const assignmentsFor = (base) =>
    base === run || isVersus ? assignments : resolveAssignments({ nodes, run: base, cooks, now: Date.now() });
  const guessMatchesPlan = (stepId, cookId, base = run) => assignmentsFor(base)?.byCook?.[cookId]?.stepId === stepId;
  const askWho = (base, cookId, actions) => {
    setPendingConfirm({ who: true, cookId, actions });
    askAloud(base, `Are you ${name(cookId)}? Say yes or no.`);
  };



  // --- the handlers every button AND every utterance routes through ---
  // `base` is the run to build on: the closure's `run` for a tap, or the
  // run with the player's utterance already appended for a voice path —
  // so what they said stays in the transcript whether or not it worked.

  const doStart = (stepId, cookId, source = "tap", base = run) => {
    if (paused || !stepId || !isReady(stepId, nodes, base)) return;
    if (activeStepFor(cookId, base, nodes)) return;
    const at = new Date().toISOString();
    let next = applyStart({ run: base, stepId, cookId, at, source });
    next = say(next, `Timer running on ${byId[stepId].label}. Est ${clock(byId[stepId].estimated_duration_sec)}.`);
    commit(next);
  };

  // `reporter` is whoever said or tapped it. The points are the
  // holder's, whoever reports it -- see the credit rule at applyDone.
  const doDone = (stepId, reporter, source = "tap", base = run) => {
    if (paused || !stepId) return;
    const at = new Date().toISOString();
    // A co-op ticket reported finished before anyone pressed Start
    // ("Toni is done"): it was cooked, just never started on screen.
    // Started now for the cook it was dealt to, so the points follow
    // that cook rather than whoever said it.
    const unstarted = base.steps[stepId]?.status === "pending";
    if (unstarted) {
      const owner = Object.entries(assignmentsFor(base)?.byCook || {}).find(([, a]) => a?.stepId === stepId && a.reason === "assigned")?.[0];
      if (!owner) return;
      base = applyStart({ run: base, stepId, cookId: owner, at, source });
    }
    if (base.steps[stepId]?.status !== "active") return;
    const cookId = base.steps[stepId].cookId ?? reporter;
    const v = stepVariance(byId[stepId], { ...base.steps[stepId], endedAt: at });
    let next = applyDone({ run: base, stepId, cookId: reporter, at, source });
    // Recompile the rest of the plan on every completion — real times
    // diverge from estimates, so what's left genuinely changes shape.
    if (!isVersus) next = replan({ nodes, run: next, cooks, kitchenProfile });
    const pts = scoreStep(byId[stepId], { record: next.steps[stepId], run: next, nodes, cooks }).points;
    const overNote = v.over ? `, ${clock(v.deltaSec)} over` : "";
    next = say(
      next,
      isVersus
        ? `+${pts} for ${name(cookId)}. ${byId[stepId].label}, ${clock(v.actualSec)}${overNote}.`
        : unstarted
          ? `${byId[stepId].label} done, ${name(cookId)}.` // never timed, so no time to read out
          : `${byId[stepId].label} done in ${clock(v.actualSec)}${overNote}.`
    );
    // Versus deals nobody a ticket, so a cook who is not watching the
    // board only learns there is a new step to race for by hearing it.
    const opened = isVersus && !isRunComplete(next, nodes) ? newlyOpenLine(nodes, base, next) : "";
    if (opened) next = say(next, opened);
    if (isRunComplete(next, nodes)) next = say(next, "That's everything. Dinner's up.");
    commit(next);
    // One press, four things: the points fly, the counter rolls, the bar
    // and its goose walk, the seam slides. The last three follow the
    // state change; this is the first.
    if (isVersus && pts > 0) {
      const index = cooks.findIndex((c) => c.id === cookId);
      setFly({ key: at, pts, index, player: playerKey(Math.max(0, index)) });
    }
  };

  // Skipping something another step depends on gets a confirm Modal
  // (never a browser dialog); the actual write is applySkipNow.
  const doSkip = (stepId, cookId, source = "tap", base = run) => {
    if (paused || !stepId) return;
    const dependents = nodes.filter((n) => (n.depends_on || []).includes(stepId));
    if (dependents.length) {
      // The utterance is logged now; the modal decides the rest.
      if (source === "voice") {
        const names = dependents.map((d) => d.label).join(", ");
        askAloud(base, `${names} ${dependents.length === 1 ? "needs" : "need"} ${byId[stepId].label}. Skip it anyway? Say yes or no.`);
      } else if (base !== run) commit(base);
      setConfirm({ kind: "skip", stepId, cookId, source, dependents });
      return;
    }
    applySkipNow(stepId, cookId, source, base);
  };
  const applySkipNow = (stepId, cookId, source, base = run) => {
    const at = new Date().toISOString();
    let next = applySkip({ run: base, stepId, cookId, at, source });
    if (!isVersus) next = replan({ nodes, run: next, cooks, kitchenProfile });
    next = say(next, `Skipped ${byId[stepId].label}. No points for that one.`);
    const opened = isVersus ? newlyOpenLine(nodes, base, next) : "";
    if (opened) next = say(next, opened);
    setConfirm(null);
    commit(next);
  };

  const doDrop = (stepId, cookId, source = "tap", base = run) => {
    if (paused || !stepId) return;
    const at = new Date().toISOString();
    let next = applyDrop({ run: base, stepId, cookId, at, source });
    if (!isVersus) next = replan({ nodes, run: next, cooks, kitchenProfile });
    commit(say(next, `Back in the pool. ${byId[stepId].label} is open again.`));
  };

  const doClaim = (stepId, cookId, source = "tap", base = run) => {
    if (paused) return;
    const at = new Date().toISOString();
    const verdict = arbitrateClaim({ run: base, nodes, cooks, stepId, cookId, at, kitchenProfile });
    if (!verdict.ok) {
      const text = {
        busy: `You're still on ${byId[verdict.holdingStepId]?.label}. Finish it first.`,
        already_claimed: verdict.tie
          ? `Dead heat. ${name(verdict.holderCookId)} is behind, so ${name(verdict.holderCookId)} takes it.`
          : `${name(verdict.holderCookId)} called it first.`,
        not_ready: `Not yet — that needs ${(verdict.blockedBy || []).map((d) => byId[d]?.label).join(", ")} first.`,
        already_done: "That one's already finished.",
        noop: "You've already got that one.",
        unknown_step: "I don't know that step.",
        no_equipment: `No ${equipmentName(verdict.equipmentType).toLowerCase()} free — something else is on it.`,
      }[verdict.code];
      setClaimNote({ stepId, cookId, text, key: at });
      commit(say(base, text));
      return;
    }
    let next = base;
    if (verdict.stealFrom) next = applyDrop({ run: next, stepId, cookId: verdict.stealFrom, at, source });
    next = applyStart({ run: next, stepId, cookId, at, source });
    commit(say(next, `${name(cookId)} has ${byId[stepId].label}. Go.`));
  };

  // Why a claim would be refused right now, or null if it would go
  // through — the same arbitration the tap runs, minus the write. The
  // board greys a button that can't work instead of offering it.
  const claimBlock = (stepId, cookId) => {
    const verdict = arbitrateClaim({ run, nodes, cooks, stepId, cookId, at: new Date(clockNow).toISOString(), kitchenProfile });
    if (verdict.ok) return null;
    if (verdict.code === "busy") return `${name(cookId)} is still on something`;
    if (verdict.code === "no_equipment") return `No ${equipmentName(verdict.equipmentType).toLowerCase()} free`;
    return null;
  };

  const doUndo = (cookId, base = run) => {
    if (paused) return;
    const result = applyUndo({ run: base, nodes, cookId, at: new Date().toISOString() });
    if (result.rejected) {
      const text = {
        too_late: "Too late to undo that one.",
        downstream_started: "Can't undo — something downstream already started.",
        nothing: "Nothing of yours to undo.",
      }[result.rejected];
      commit(say(base, text));
      return;
    }
    commit(say(result.run, `Rolled back — ${result.label} is active again.`));
  };

  const togglePause = (base = run) => {
    const at = new Date().toISOString();
    // Read the run being acted on, not the render's `paused`. Voice
    // reaches this after an await, by which time the flag captured at
    // render can be a pause older than the one on screen -- and getting
    // it wrong here pauses a run somebody just asked to resume.
    if (isPaused(base)) {
      commit(say(applyResume({ run: base, at }), "Back on. Clock's running again."));
    } else {
      commit(say(applyPause({ run: base, at }), "Paused. Nothing's being timed until you say go."));
    }
  };

  const openPlan = () => {
    if (!paused) {
      const at = new Date().toISOString();
      commit(say(applyPause({ run, at }), "Paused while you check the plan. Resume here when you're ready."));
    }
    navigate("/session/schedule");
  };

  const doFinish = (base = run) => {
    if (!complete) {
      // A voice turn arrives with its utterance already on the run.
      if (base !== run) askAloud(base, `${stepsLeft} ${stepsLeft === 1 ? "step isn't" : "steps aren't"} done. To end now, say “${FINISH_PHRASE}”. Or say “keep cooking”.`);
      setConfirm({ kind: "finish" });
      return;
    }
    finishNow(base);
  };
  const finishNow = (base = run) => {
    setConfirm(null);
    commit(endRun({ run: base, nodes, at: new Date().toISOString() }));
  };

  // Freeze the card, persist it with the session, then hand over to it.
  // The wait matters: the card page fetches this session back by id, so
  // navigating before the write lands shows "no card for this cook" for
  // a cook that saved perfectly well. If the write fails, stay put and
  // say so rather than handing over to a page that has nothing to show.
  const saveAndSeeCard = async () => {
    const sessionId = state.session.id;
    const summary = buildSummary({
      outcome: runOutcome(run, nodes, cooks),
      cooks,
      dish: approved?.title || "Untitled cook",
      mode: run.mode,
      dishOfStep: (s) => dishOf(byId[s.id]),
      transcript: run.transcript,
    });
    setSaveError(null);
    setSaving(true);
    try {
      await finishSession(summary);
      navigate(`/cook/${sessionId}`, { state: { fromLiveCook: true } });
    } catch (err) {
      setSaving(false);
      setSaveError(err.message || "Couldn't save the page.");
    }
  };

  // --- voice: parse, then call the exact same handlers ---

  // The five intents "which one" and "did you mean" both eventually
  // resolve to — factored out so a spoken step name, a spoken "yes"
  // (pendingConfirm below) and a clean first-try match all funnel
  // through the exact same call.
  const runIntentAction = (intent, stepId, cookId, base = run) => {
    if (intent === "claim") return doClaim(stepId, cookId, "voice", base);
    if (intent === "done") return doDone(stepId, cookId, "voice", base);
    if (intent === "start") return doStart(stepId, cookId, "voice", base);
    if (intent === "skip") return doSkip(stepId, cookId, "voice", base);
    if (intent === "drop") return doDrop(stepId, cookId, "voice", base);
    return commit(base);
  };

  // A spoken "yes"/"no" answers the question. There are no buttons for
  // it: every question comes from speech, and a cook whose voice is not
  // getting through has the cards' own buttons instead.
  const resolvePendingConfirm = (answer, base = run) => {
    if (!pendingConfirm) return undefined;
    if (pendingConfirm.who) {
      const { cookId, actions } = pendingConfirm;
      setPendingConfirm(null);
      if (answer === "yes") {
        // Settled: whoever is talking IS this cook, so the toggle says so
        // and the rest of their turns stop needing the question.
        setSpeakerId(cookId);
        let cur = base;
        actions.forEach(({ intent, stepId }) => {
          runIntentAction(intent, stepId, cookId, cur);
          cur = latestRunRef.current;
        });
        return undefined;
      }
      const line = `Sorry. Who's taking it? Say “I'm” and your name, then the step.`;
      commit(say(base, line));
      speak(line);
      return undefined;
    }
    const { intent, stepId, cookId, label, candidates } = pendingConfirm;
    setPendingConfirm(null);
    if (answer === "yes") return runIntentAction(intent, stepId, cookId, base);
    const others = candidates.filter((id) => id !== stepId).map((id) => byId[id]?.label).filter(Boolean).slice(0, 2);
    return commit(say(base, `Not “${label}”. ${others.length ? `Maybe ${others.join(" or ")}? ` : ""}${sayWithStep(intent)}`));
  };

  // Co-op keeps no score — the honest answer is the progress.
  const scoreLine = () =>
    isVersus
      ? board.map((b) => `${b.name} ${b.points}`).join(", ") + `. ${progress.pending} left.`
      : `No score in co-op. ${progress.done} of ${progress.total} done, ${progress.pending} left.`;
  // Spoken answers to "where is everyone", "what's available" and "does
  // anything need checking" (utils/kitchenReport.js). The status line
  // used to call a cook with rice on "free" and stop there; it now says
  // what they have cooking too, since that is half of where they are.
  const reportCtx = (base) => ({ nodes, run: base, cooks, now: isPaused(base) ? Date.parse(base.pausedAt) : Date.now() });
  const statusLine = (base) => whereLine(reportCtx(base));

  // --- voice, through the agent: the model reads the words, this applies them ---
  //
  // The model only proposes. Each call goes through the same handler a tap
  // uses, on the newest run, so every rule (busy, not ready, equipment,
  // paused) is still enforced by the code that owns it.
  // Three actions in one breath is already an unusual turn; reading back
  // more than that stops being a confirmation and becomes a recital.
  const MAX_SPOKEN_LINES = 3;
  // Lines the board says for itself that must be heard, whoever else
  // is talking: see the end of applyAgentTurn.
  const isCue = (line) => /^Now up for grabs:|^That's everything\. Dinner's up\./.test(line);
  const PAUSED_OK = new Set(["resume", "status", "available", "checkup", "score", "help", "explain"]);
  const applyAgentTurn = (turn, text, cookId, via = null) => {
    const at = () => new Date().toISOString();
    // Captured before this turn's own line goes on -- otherwise it would
    // be looking at itself. See impliedAssignee: a bare "yes" answering
    // the agent's own "should I give it to Zeina?", or an answer that
    // only settles WHICH STEP after a request that already named a
    // cook ("assign Zina the latest task" -> "which step?" -> "add
    // sauce"), both need this to hand the step to Zeina rather than to
    // whoever is speaking.
    const priorTranscript = latestRunRef.current.transcript || [];
    const priorAgentEntry = priorTranscript[priorTranscript.length - 1];
    const entryBeforeThat = priorTranscript[priorTranscript.length - 2];
    const impliedCookId = impliedAssignee(text, priorAgentEntry, entryBeforeThat, cooks);
    commit(appendTranscript(latestRunRef.current, { at: at(), speaker: cookId, text, via }));
    const spoken = [];
    // Where the run log stands before any of this turn's actions. Each
    // handler already writes the right sentence for what it did -- and,
    // just as importantly, for what it refused -- so the confirmation
    // below is a diff of the log rather than a second account that could
    // disagree with it.
    const logBefore = (latestRunRef.current.transcript || []).length;
    // A handler that refuses (doUndo past its window, doDone on a step
    // that isn't yours) commits a new run for the transcript line alone
    // and leaves `steps` untouched -- so its identity is a cheap, honest
    // "did anything actually happen", independent of which tool was
    // named. A rejection turn.calls names ("undo") is not in ANSWERING,
    // and looks exactly like a completed one to opensFollowUp otherwise.
    const stepsBefore = latestRunRef.current.steps;
    askedRef.current = [];
    const guessed = cooks.length > 1 && (via === "label" || via === "toggle");
    const unsure = [];

    turn.calls.forEach((call) => {
      const cur = latestRunRef.current;
      const nowPaused = isPaused(cur);
      if (nowPaused && !PAUSED_OK.has(call.name)) {
        commit(say(cur, "We're paused — say \"resume\" when you're ready."));
        return;
      }
      // "Zoe will take the garlic." The server only allows a name on
      // claim and start, and only one of the cooks present, so this is
      // a lookup rather than a decision.
      //
      // It matters most where speaker recognition is absent -- the
      // deployed build has no sidecar, so every turn is credited to
      // whoever the toggle was left on, and saying whose it is was the
      // only way to give the other cook anything.
      const named = call.cookName ? cooks.find((c) => c.name === call.cookName)?.id : null;
      // The model's own cook_name wins when it gave one; otherwise, on
      // claim/start only, a bare "yes" to the agent's own question falls
      // back to whoever that question named, before defaulting to the
      // speaker.
      const actor = named ?? (["claim", "start"].includes(call.name) ? impliedCookId : null) ?? cookId;

      // done, skip and drop without a name mean "the one I'm on".
      const own = ["done", "skip", "drop"].includes(call.name) ? activeStepFor(cookId, cur, nodes) : null;
      const stepId = call.stepId ?? own;
      if (["done", "skip", "drop"].includes(call.name) && !stepId) {
        // Holding nothing and not naming anything: say how to name it,
        // rather than asking a question and waiting on an answer. A held
        // question needed a tap to answer or dismiss; a whole command
        // with the step in it needs nothing held at all.
        const question = `${{
          done: "Which one did you finish?",
          skip: "Which one should I skip?",
          drop: "Which one are you putting back?",
        }[call.name]} ${sayWithStep(call.name)}`;
        commit(say(cur, question));
        spoken.push(question);
        return;
      }
      // Held back for "are you ...?" when who is talking was a guess and
      // nobody named whose it is. Asked once, below, for all of them.
      // A cook named in the sentence itself ("Toni will take the task")
      // is never asked about, even when the model left cook_name out
      // because the toggle already said Toni.
      const saidWho = resolveCookRef(text, cooks)?.id === actor;
      if (guessed && WHO_CHECKED.has(call.name) && !named && !saidWho && !impliedCookId && !guessMatchesPlan(stepId, actor, cur)) {
        unsure.push({ intent: call.name, stepId });
        return;
      }
      switch (call.name) {
        case "claim": return doClaim(stepId, actor, "voice", cur);
        case "start": return doStart(stepId, actor, "voice", cur);
        case "done": return doDone(stepId, cookId, "voice", cur);
        case "skip": return doSkip(stepId, cookId, "voice", cur);
        case "drop": return doDrop(stepId, cookId, "voice", cur);
        case "undo": return doUndo(cookId, cur);
        case "pause":
          return commit(say(applyPause({ run: cur, at: at() }), "Paused. Nothing's being timed until you say go."));
        case "resume":
          return nowPaused ? commit(say(applyResume({ run: cur, at: at() }), "Back on. Clock's running again.")) : undefined;
        case "finish_run": return doFinish(cur);
        case "status": {
          const line = statusLine(cur);
          spoken.push(line);
          return commit(say(cur, line));
        }
        case "available": {
          const line = availableLine(reportCtx(cur));
          spoken.push(line);
          return commit(say(cur, line));
        }
        case "checkup": {
          const line = checkupLine(reportCtx(cur));
          spoken.push(line);
          return commit(say(cur, line));
        }
        case "explain": {
          // The recipe's own words, not the model's recollection of them:
          // the snapshot only carries the first 120 characters of a
          // description, and a cook who asks what a step means should get
          // what the plan actually says.
          const line = explainStep(byId[stepId], {
            skill: state.session.conversation?.answers?.skill,
            equipmentLabel: (type) => equipmentName(type).toLowerCase(),
          });
          if (!line) return undefined;
          spoken.push(line);
          return commit(say(cur, line));
        }
        case "score": {
          const line = scoreLine();
          spoken.push(line);
          return commit(say(cur, line));
        }
        case "help": return commit(say(cur, HELP_TEXT));
        default: return undefined;
      }
    });
    if (unsure.length) askWho(latestRunRef.current, cookId, unsure);

    // Talk that was not addressed by name, only let through because the
    // agent had just asked something, gets a reply only if it turned into
    // an action. Otherwise the room's chatter, or the other cook talking
    // to someone, would be answered out loud, and each answer would open
    // the window for the next.
    //
    // Trouble is the exception: "the water's boiling over, what do I
    // do?" was let through without the name precisely so it gets an
    // answer, and the model was told to reply empty if it misheard.
    //
    // `inferred`: no name was heard, but the model read the turn and
    // judged it was for the goose anyway (see requestTurn) -- a mangled
    // wake word, not room talk, so its reply is said like any other.
    const chatter = !turn.named && !turn.urgent && !turn.inferred && !turn.calls.length;

    // The app refused something the model asked for, and the model
    // cannot see refusals -- so its reply is written around a call that
    // did not happen. Saying what actually stopped it OUTRANKS that.
    //
    // This is the "I'm done with the onion" case in competition mode:
    // the step was never claimed, so it was never in the done enum, so
    // the call was dropped and the model asked a confused question
    // about dicing other things. The app knew the answer all along.
    const refusals = rejectionLines(turn.rejected, byId);
    // A call opened a dialog, and the dialog has already asked its
    // question aloud. The model's reply was written as if the call went
    // through, and the log diff below would repeat the question -- both
    // would talk over the one thing the cook needs to answer.
    if (askedRef.current.length) {
      if (turn.reply) console.info("[voice] waiting on a confirmation, so not saying:", turn.reply);
      if (!chatter) engagedUntilRef.current = Date.now() + ENGAGED_MS;
      return;
    }
    if (refusals.length) {
      refusals.forEach((line) => {
        spoken.push(line);
        commit(say(latestRunRef.current, line));
      });
      if (turn.reply) console.info("[voice] refused, so not saying:", turn.reply);
    } else if (turn.reply && !chatter) {
      spoken.unshift(turn.reply);
      commit(say(latestRunRef.current, turn.reply));
    } else if (turn.reply) {
      console.info("[voice] not answering unaddressed talk:", text, "->", turn.reply);
    }
    // Say what changed.
    //
    // The model is told to keep replies to fifteen words and that an
    // empty one is right after a plain action. In a quiet room that is
    // good manners; over an extractor fan it leaves a cook who asked for
    // two things unable to tell whether one, both or neither landed,
    // short of looking at the screen -- the thing the voice interface
    // exists to avoid.
    //
    // These lines are the handlers' own, so a refusal speaks as a
    // refusal: "You're still on Cut tofu. Finish it first." A
    // confirmation built from the model's tool calls would have
    // announced that claim as granted.
    //
    // Only when the model said nothing itself -- two accounts of one
    // action is worse than none.
    const added = (latestRunRef.current.transcript || [])
      .slice(logBefore)
      .filter((entry) => entry.speaker === "agent" && entry.text)
      .map((entry) => entry.text);
    if (!spoken.length) spoken.push(...added.slice(0, MAX_SPOKEN_LINES));
    // Cues are the exception to "only when the model said nothing":
    // what just opened up and "Dinner's up" are the board telling a room
    // that is not watching it, and a model's "Nice one!" is no stand-in.
    added.filter(isCue).forEach((line) => {
      if (!spoken.includes(line)) spoken.push(line);
    });

    if (spoken.length) {
      lastVoiceAtRef.current = Date.now();
      speak(spoken.join(" "));
    } else {
      // Nothing to say, so finish the sentence somebody talked over.
      // Taking it clears it: offered once, then forgotten, because a
      // line two turns stale is not worth saying.
      const resumed = takeInterrupted();
      if (resumed) speak(resumed);
    }
    // Answering opens the door for an unnamed follow-up; acting does not.
    // See utils/followUp.js -- demanding the name again for the obvious
    // next question is what made this a command line you speak at rather
    // than something you talk to.
    //
    // A call that named a tool but changed nothing is a refusal wearing
    // an action's clothes -- "I can't undo that anymore" is exactly the
    // kind of half-an-exchange a question or an explain is, not the end
    // of a thing the way a completed claim or done is. Without this, the
    // very next thing anyone says needs the name again, on what reads as
    // the same exchange to whoever is talking.
    const acted = latestRunRef.current.steps !== stepsBefore;
    //
    // Still never for unaddressed chatter: a turn only let through
    // because the door was already open must not hold it open for the
    // rest of the room.
    if (!chatter && (opensFollowUp(turn) || !acted)) engagedUntilRef.current = Date.now() + ENGAGED_MS;
  };

  // Who was that? Asks the local speaker service, which compares the turn's
  // audio with each cook's enrolled voice. Returns a cook id only when the
  // match is clear, otherwise null and the speaker toggle stands: a wrong
  // credit is worse than no answer. Never throws; the service being off is
  // an ordinary state.
  //
  // Below it sits AssemblyAI's own diarization, bound to a cook on the
  // voice-binding page. It cannot name a voice by itself, but the label
  // was tied to a cook there, and it is the only attribution the
  // deployed app has -- the sidecar does not run there.
  //
  // Returns how it decided as well as who. A claim that went to the
  // wrong cook is almost impossible to unpick without knowing whether
  // the voice was matched or the toggle was simply left where it was.
  const whoSpoke = async (clip, turn) => {
    if (cooks.length < 2) return null;
    if (!clip || !SPEAKER_SERVICE) {
      const byLabel = cookFromTurn(turn, cooks).cookId;
      return byLabel ? { cookId: byLabel, via: "label" } : null;
    }
    try {
      const result = await identifySpeaker({ pcm: clip.pcm, rate: clip.rate, candidates: cooks.map((c) => c.id) });
      const verdict = decideSpeaker(result);
      const named = Object.fromEntries(Object.entries(result.scores || {}).map(([id, v]) => [name(id), v]));
      console.info(`[speaker] ${verdict.cookId ? name(verdict.cookId) : "unsure"} (${verdict.reason})`, named, `margin ${result.margin}`);
      // A voiceprint outranks a label: it was measured against this
      // cook's own voice, not inferred from who else is in the room.
      if (verdict.cookId) return { cookId: verdict.cookId, via: "voiceprint", result };
      const byLabel = cookFromTurn(turn, cooks).cookId;
      return byLabel ? { cookId: byLabel, via: "label" } : null;
    } catch (err) {
      console.info("[speaker] unavailable, trying the diarization label:", err.message);
      const byLabel = cookFromTurn(turn, cooks).cookId;
      return byLabel ? { cookId: byLabel, via: "label" } : null;
    }
  };

  // `sttTurn` is the recogniser's turn, not the agent's reply -- the
  // inner scope already calls that one `turn`, and shadowing it here put
  // the read before the declaration.
  const askAgent = (text, cookId, { engaged = false, clip = null, shared = false, sttTurn = null, saidBy = null } = {}) => {
    agentQueueRef.current = agentQueueRef.current.then(async () => {
      // Cleared at every exit below -- answered, refused, unaddressed or
      // thrown. A thinking row that never clears is worse than none.
      voiceLog.setThinking(Date.now());
      // Somebody who just said who they are outranks every guess about
      // it: not knowing their voice is precisely why they had to say so.
      const heard = saidBy ? { cookId: saidBy, via: "said so" } : await whoSpoke(clip, sttTurn);
      // A turn we are sure about is another reading of that cook's
      // voice, and a print built from more readings credits more turns
      // (see shouldLearn). Not awaited: nobody waits on this.
      if (clip && heard?.cookId && shouldLearn({ via: heard.via, result: heard.result, seconds: clip.pcm.length / clip.rate, shared })) {
        learnVoice({ cookId: heard.cookId, pcm: clip.pcm, rate: clip.rate })
          .then((r) => console.info(`[speaker] learned ${name(heard.cookId)} (${heard.via}), ${r.learned} turns so far`))
          .catch(() => {});
      }
      // Nothing recognised it, so the turn belongs to whoever the
      // toggle was left on. Worth recording as such: it is a guess
      // nobody made deliberately.
      const via = heard?.via ?? "toggle";
      if (heard?.cookId && heard.cookId !== cookId) {
        cookId = heard.cookId;
        setSpeakerId(heard.cookId); // so the toggle shows who was heard
      }
      let turn;
      try {
        turn = await agentTurn({
          text,
          agentName: AGENT_NAME,
          // Spoken words must say its name (checked on the server)
          // unless it just asked a question.
          engaged,
          // Two voices ended up in this one turn, so the words cannot be
          // trusted to belong to one person asking for one thing.
          shared,
          snapshot: buildAgentSnapshot({ run: latestRunRef.current, nodes, cooks, speakerId: cookId, paused: isPaused(latestRunRef.current), conversation: state.session.conversation }),
        });
      } catch (err) {
        // Slow, down or unreachable: the keyword grammar still works.
        console.warn("Agent unavailable, using the keyword grammar:", err.message);
        voiceLog.setThinking(null);
        const logBefore = (latestRunRef.current.transcript || []).length;
        submitKeywordUtterance(text, saidBy);
        // And it answers out loud, like the agent would. It used to only
        // write to the notes, so with the model down the goose went
        // silent -- exactly when the room most needs to hear it.
        const replies = (latestRunRef.current.transcript || [])
          .slice(logBefore)
          .filter((entry) => entry.speaker === "agent" && entry.text)
          .map((entry) => entry.text)
          .slice(0, MAX_SPOKEN_LINES);
        if (replies.length) speak(replies.join(" "));
        return;
      }
      if (!turn.addressed) {
        // Shows what the recogniser heard instead of the name, which is
        // how a chronically misheard agent name gets caught.
        console.info("[voice] not addressed:", text);
        voiceLog.setThinking(null);
        // Not awaited: the queue must not wait on a joke.
        overheard(text, cookId);
        return;
      }
      applyAgentTurn(turn, text, cookId, via);
      // The agent is reading something up. Collect it OUTSIDE this
      // queue: the whole point is that the next command does not wait
      // behind a question. Deliberately not awaited here.
      if (turn.pendingId) awaitAnswer(turn.pendingId, cookId);
      voiceLog.setThinking(null);
    });
  };

  /**
   * A looked-up answer, spoken whenever it arrives.
   *
   * It is reply-only by the time it gets here — the server drops any
   * action the model proposed on the second pass, because the board has
   * had several seconds to move on and acting on a stale snapshot is
   * worse than not acting. So this just says the thing and logs it.
   */
  const awaitAnswer = async (pendingId, cookId) => {
    let answer;
    try {
      answer = await collectAnswer(pendingId);
    } catch (err) {
      // Expired, failed, or the search timed out. Goose simply has
      // nothing to add; it already said it would look.
      console.info("[agent] no answer came back:", err.message);
      return;
    }
    const line = answer?.reply?.trim();
    if (!line) return;
    // latestRunRef, not `run`: this resolves long after the closure that
    // started it, and the cook has very likely done something since.
    commit(say(latestRunRef.current, line));
    speak(line);
    console.info(`[agent] answered after ${answer.ms}ms`, { cookId });
  };

  // An open question ("did you mean…?") is answered by the keyword path,
  // which owns that state; everything else goes to the agent.
  // Everything decided before addressing, ownership or the model get a
  // look in.
  //
  // Returns null when the utterance is already dealt with; otherwise
  // what is left of it and who said it.
  const preRoute = (text) => {
    // "I'm Toni, and I'll start the bay leaf." Who is talking and what
    // they want, in one breath. Taking only the second is how a step
    // ended up with whoever the toggle was last left on -- which, with
    // no voiceprint sidecar deployed, is every turn.
    //
    // Ahead of the addressing gate on purpose: telling the app who you
    // are is addressed to the app, and needing the agent's name first
    // would make the fix for a misattributed turn depend on the thing
    // that is already going wrong.
    const intro = findSelfIntro(text, cooks, { agentName: AGENT_NAME });
    // A name spelled out ("as Z-E-I-N-A") reaches the model as the name.
    let said = joinSpelledLetters(text);
    let saidBy = null;
    if (intro) {
      setSpeakerId(intro.cookId);
      saidBy = intro.cookId;
      said = intro.rest;
      commit(appendTranscript(latestRunRef.current, {
        at: new Date().toISOString(),
        speaker: intro.cookId,
        text,
        via: "said so",
      }));
      // Nothing but the introduction: say hello and stop. Anything more
      // is now theirs, and carries on as them.
      if (!said) {
        const line = `Got it, ${name(intro.cookId)}. You're the one I'm hearing now.`;
        commit(say(latestRunRef.current, line));
        speak(line);
        return null;
      }
    }

    // Resuming is heard here, by the app, before anything else looks at
    // the words. The hint says to say "resume" and does not ask for the
    // agent's name -- correctly, since a paused kitchen has nothing else
    // going on -- but the addressing gate lives on the server and threw
    // the turn away for want of one. Locally it also survives having no
    // network, no key and no model, which is when you need it most.
    // parseCommand covers the Mandarin forms too.
    if (isPaused(latestRunRef.current)) {
      const { intent } = parseCommand(said, {
        byId,
        activeStepId: null,
        claimable: [],
        ownQueue: [],
        agentName: AGENT_NAME,
      });
      // Only the bare word. "We'll resume after the call" is two cooks
      // talking about resuming, and with no name needed here it would
      // otherwise restart every clock mid-conversation. A sentence with a
      // subject in it goes on to the addressing gate like anything else,
      // so "Goose, let's resume" still does it.
      if (intent === "resume" && !hasSubject(normalizeUtterance(said))) {
        togglePause(appendTranscript(latestRunRef.current, {
          at: new Date().toISOString(),
          speaker: saidBy ?? speaker,
          text: said,
        }));
        return null;
      }
      // Leaving mid-cook by voice must not happen -- but nothing is
      // running while paused, so heading back to the plan is safe here
      // the same way resuming is, and heard the same way: no name needed.
      if (intent === "schedule" && !hasSubject(normalizeUtterance(said))) {
        commit(appendTranscript(latestRunRef.current, {
          at: new Date().toISOString(),
          speaker: saidBy ?? speaker,
          text: said,
        }));
        navigate("/session/schedule");
        return null;
      }
    }

    // A confirm dialog is up. Answered here, before the addressing gate,
    // like "Did you mean X?": the goose just asked, so the reply needs no
    // name. How much must be said depends on what is lost -- see
    // utils/modalReply.js.
    if (confirm) {
      const reply = routeModalReply(said, confirm.kind, AGENT_NAME);
      if (reply.type !== "moved-on") {
        const heard = appendTranscript(latestRunRef.current, { at: new Date().toISOString(), speaker: saidBy ?? speaker, text: said });
        if (reply.type === "confirm" && confirm.kind === "finish") {
          finishNow(heard);
        } else if (reply.type === "confirm") {
          applySkipNow(confirm.stepId, confirm.cookId, "voice", heard);
          speak(`Skipped ${byId[confirm.stepId]?.label}.`);
        } else if (reply.type === "cancel") {
          setConfirm(null);
          const line = confirm.kind === "finish" ? "Okay, still cooking." : `Okay, keeping ${byId[confirm.stepId]?.label}.`;
          commit(say(heard, line));
          speak(line);
        } else {
          const line = `To end the cook now, say “${FINISH_PHRASE}”. Or say “keep cooking”.`;
          commit(say(heard, line));
          speak(line);
        }
        return null;
      }
      // Not an answer: they moved on, and the dialog goes. What they said
      // is handled below as if it had never been asked.
      setConfirm(null);
    }

    if (pendingConfirm) {
      // An answer is an answer, and the keyword path owns resolving it.
      if (routeConfirmReply(said).type === "resolve") {
        submitKeywordUtterance(said, saidBy);
        return null;
      }
      // Anything else means they moved on. The question goes and what
      // they said instead is handled on its own merits -- by the model,
      // as it would have been had the question never been asked.
      // Sending it to the keyword grammar answered a fair question with
      // "I didn't catch that". voiceTurn.js has always done this on
      // every other page; the live cook's confirmation predated the rule.
      setPendingConfirm(null);
    }

    return { said, saidBy };
  };

  // What the microphone hears. The name check happens on the server, so
  // ordinary kitchen talk never reaches a model. Attribution is still the
  // speaker toggle until speaker identification exists.
  asideRunnerRef.current = async () => {
    const current = latestRunRef.current;
    if (!current || asideBusyRef.current || finished || !cooks.length) return;
    const now = Date.now();
    const verdict = shouldCommentate({
      busyCooks: cooks.filter((c) => activeStepFor(c.id, current, nodes, now)).length,
      cookCount: cooks.length,
      paused: isPaused(current),
      ended: Boolean(current.endedAt),
      msSinceVoice: now - lastVoiceAtRef.current,
      msSinceComment: lastAsideAtRef.current ? now - lastAsideAtRef.current : Infinity,
    });
    if (!verdict.ok) return;

    // Marked before the request, not after: the call takes seconds and a
    // second tick inside that window would ask twice.
    asideBusyRef.current = true;
    lastAsideAtRef.current = now;
    try {
      const { line } = await agentAside({
        agentName: AGENT_NAME,
        snapshot: buildAgentSnapshot({ run: latestRunRef.current, nodes, cooks, speakerId: null, paused: false }),
      });
      // The kitchen may have started talking while this was in flight.
      // Speaking now would be exactly the interruption the feature is
      // trying not to be.
      if (!line || Date.now() - lastVoiceAtRef.current < ASIDE_CHECK_MS) return;
      lastVoiceAtRef.current = Date.now();
      commit(say(latestRunRef.current, line));
      speak(line);
    } finally {
      asideBusyRef.current = false;
    }
  };

  // Talk that wasn't for the goose. Mostly it stays out of it; now and
  // then, when the cooks are joking with each other, it chimes in.
  const overheard = async (text, cookId) => {
    const now = Date.now();
    roomTalkRef.current = recentRoomTalk([...roomTalkRef.current, { speaker: name(cookId), text, at: now }], now);
    const current = latestRunRef.current;
    const lastAgent = [...(current?.transcript || [])].reverse().find((e) => e.speaker === "agent");
    const verdict = shouldBanter({
      roomLines: roomTalkRef.current,
      paused: isPaused(current),
      ended: Boolean(current?.endedAt) || finished,
      busy: banterBusyRef.current,
      msSinceBanter: lastBanterAtRef.current ? now - lastBanterAtRef.current : Infinity,
      msSinceAgent: lastAgent ? now - Date.parse(lastAgent.at) : Infinity,
    });
    if (!verdict.ok) return;

    // Marked before the request, as with asides: a second line inside
    // the call's window would ask twice.
    banterBusyRef.current = true;
    lastBanterAtRef.current = now;
    const heardAt = lastVoiceAtRef.current;
    try {
      const { line } = await agentBanter({
        agentName: AGENT_NAME,
        lines: roomTalkRef.current.map(({ speaker, text: said }) => ({ speaker, text: said })),
      });
      // Somebody has spoken since: the moment has passed, and a joke
      // about the line before last lands on the wrong thing.
      if (!line || lastVoiceAtRef.current !== heardAt) {
        if (line) console.info("[voice] banter too late, dropped:", line);
        return;
      }
      console.info("[voice] chiming in:", line);
      lastVoiceAtRef.current = Date.now();
      commit(say(latestRunRef.current, line));
      speak(line);
    } finally {
      banterBusyRef.current = false;
    }
  };

  // One of the three eyes-off questions (see voiceHandlerRef below):
  // logged as the cook's line, answered from the newest run, said aloud,
  // and the door held open so "and after that?" needs no name.
  const answerKitchenQuestion = (kind, text, cookId, { logged = false } = {}) => {
    const cur = latestRunRef.current;
    const heard = logged ? cur : appendTranscript(cur, { at: new Date().toISOString(), speaker: cookId, text });
    const line = kitchenAnswer(kind, reportCtx(cur));
    commit(say(heard, line));
    lastVoiceAtRef.current = Date.now();
    speak(line);
    engagedUntilRef.current = Date.now() + ENGAGED_MS;
  };

  voiceHandlerRef.current = (text, turn) => {
    // Somebody spoke. Whatever comes of it, the room is not quiet.
    lastVoiceAtRef.current = Date.now();
    const confidence = (turn?.words || []).reduce((lowest, w) => Math.min(lowest, w.confidence ?? 1), 1);
    if (confidence < MIN_VOICE_CONFIDENCE) {
      console.info("[voice] too unclear to act on:", text);
      return;
    }
    // Introductions, resuming and open questions, before anything else.
    const routed = preRoute(text);
    if (!routed) return;

    // "Goose." on its own is somebody getting the agent's attention before
    // saying the thing. The recogniser ends the turn in that pause, so the
    // instruction lands in the NEXT turn with no name on it — and would be
    // thrown away as kitchen chatter. Hold the door open instead of acting
    // on a turn that asked for nothing.
    if (isNameOnlyTurn(routed.said, AGENT_NAME)) {
      engagedUntilRef.current = Date.now() + NAME_CARRY_MS;
      console.info("[voice] name only, waiting for the rest:", routed.said);
      return;
    }
    // "What's available?", "where is everyone?", "does anything need
    // checking?" -- answered here, from the board, every time. These are
    // what a cook with their back to the screen lives on, and the model
    // could drop them: reply empty, get rate limited, or decide an
    // unnamed question was the cooks talking to each other. None of
    // that is acceptable for these three, so they never reach it. No
    // name needed either: whoever asked, the answer is the same.
    const asked = matchKitchenQuestion(routed.said);
    if (asked) {
      // An introduction ("I'm Zeina, what's left?") was already logged
      // whole by preRoute.
      answerKitchenQuestion(asked, text, routed.saidBy ?? speaker, { logged: Boolean(routed.saidBy) });
      return;
    }
    // This turn's audio, cut out by its word timestamps with a little
    // room either side, for the speaker check.
    const words = turn?.words || [];
    const clip = words.length ? audioTap.sliceStream(words[0].start - 150, words[words.length - 1].end + 150) : null;
    // One unnamed answer per question: the window closes once used.
    const engaged = Date.now() < engagedUntilRef.current;
    if (engaged) engagedUntilRef.current = 0;
    // Two cooks inside one turn. Whatever this gets credited to, half of
    // it is wrong, so nothing is acted on: the agent is told what
    // happened and asks which of them meant it.
    const shared = hasHandover(turn?.words);
    if (shared) console.info("[voice] two cooks in one turn:", routed.said);
    // Saying who you are is talking to the app, whether or not the rest
    // of the sentence names the goose: "Goose, I'm Zeina, I'll wash the
    // tofu" reaches the model as "I'll wash the tofu", and the name gate
    // would otherwise throw it away.
    askAgent(routed.said, routed.saidBy ?? speaker, { engaged: engaged || Boolean(routed.saidBy), clip, shared, sttTurn: turn, saidBy: routed.saidBy });
  };

  const submitKeywordUtterance = (text, saidBy = null) => {
    if (!text) return;
    // setSpeakerId has not reached `speaker` yet when somebody has just
    // introduced themselves -- it is state, and this runs in the same
    // turn -- so who they are is passed in rather than read back.
    const cookId = saidBy ?? speaker;
    // The newest run, not the render's: this also runs as the fallback
    // after an agent request failed, seconds after that render, and
    // building on the stale run would drop everything logged since.
    const base = latestRunRef.current;

    // A question is pending: this utterance is the answer, not a new
    // command. Anything that isn't clearly yes or no abandons the
    // question rather than forcing a reading onto it — the cook moved
    // on, they didn't mumble a confirmation.
    if (pendingConfirm) {
      const answer = matchConfirmation(text);
      if (answer === "yes" || answer === "no") {
        const heard = appendTranscript(base, { at: new Date().toISOString(), speaker: pendingConfirm.cookId, text });
        return resolvePendingConfirm(answer, heard);
      }
      setPendingConfirm(null);
      // Falls through: `text` gets parsed fresh below, same as any
      // other utterance.
    }

    const activeStepId = activeStepFor(cookId, base, nodes);
    const ownQueue = isVersus
      ? claimSuggestions({ nodes, run: base, cookId })
      : [assignmentsFor(base)?.byCook[cookId]?.stepId].filter(Boolean);
    const result = parseCommand(text, { byId, activeStepId, claimable: readyStepIds(nodes, base), ownQueue, agentName: AGENT_NAME, cooks });
    // "Zoe will take the garlic", with no model in the loop. Same rule
    // as the agent path: a name only ever redirects taking work on.
    const actor = result.cookId ?? cookId;

    const heard = appendTranscript(base, { at: new Date().toISOString(), speaker: cookId, text });

    // While paused only "resume" and heading back to the plan do
    // anything -- nothing is running, so leaving is safe; everything
    // else is logged and answered, never acted on.
    if (isPaused(base)) {
      if (result.intent === "resume") return togglePause(heard);
      if (result.intent === "schedule") {
        commit(heard);
        navigate("/session/schedule");
        return;
      }
      return commit(say(heard, "We're paused — say \"resume\" when you're ready."));
    }

    const needTarget = (message) => commit(say(heard, `${message} ${sayWithStep(result.intent)}`));

    // A close-but-not-exact name match — a word dropped or swapped among
    // steps that read alike — gets checked before it fires, instead of
    // guessing which "cut the onion" was meant.
    if (result.stepId && result.confidence === "confirm" && ["done", "start", "claim", "skip", "drop"].includes(result.intent)) {
      // `actor`, not the speaker: "Mia will take the tofu" that has to
      // be confirmed is still Mia’s when the yes arrives. Storing the
      // speaker here quietly handed the step back to whoever was talking.
      setPendingConfirm({ intent: result.intent, stepId: result.stepId, cookId: actor, label: byId[result.stepId]?.label, candidates: result.candidates });
      return commit(say(heard, `Did you mean “${byId[result.stepId]?.label}”? Say yes or no.`));
    }

    // Same check as the model path: nobody named, nobody introduced
    // themselves, and the toggle is all this has to go on.
    if (WHO_CHECKED.has(result.intent) && result.stepId && cooks.length > 1 && !saidBy && !result.cookId && !guessMatchesPlan(result.stepId, actor, base)) {
      return askWho(heard, actor, [{ intent: result.intent, stepId: result.stepId }]);
    }

    switch (result.intent) {
      case "done":
        if (!result.stepId) return needTarget("Which one did you finish?");
        return doDone(result.stepId, cookId, "voice", heard);
      case "start":
        if (!result.stepId) return needTarget("Which one are you starting?");
        return doStart(result.stepId, actor, "voice", heard);
      case "claim":
        if (!result.stepId) return needTarget("Which one? Tap it or say the name.");
        return doClaim(result.stepId, actor, "voice", heard);
      case "skip":
        if (!result.stepId) return needTarget("Which one should I skip?");
        return doSkip(result.stepId, cookId, "voice", heard);
      case "drop":
        if (!result.stepId) return needTarget("Which one are you putting back?");
        return doDrop(result.stepId, cookId, "voice", heard);
      case "undo":
        return doUndo(cookId, heard);
      case "pause":
        return togglePause(heard);
      case "finish_run":
        return doFinish(heard);
      case "score":
        return commit(say(heard, scoreLine()));
      case "status":
        return commit(say(heard, statusLine(base)));
      case "help":
        return commit(say(heard, HELP_TEXT));
      default:
        return commit(say(heard, `I didn't catch that. ${HELP_TEXT}`));
    }
  };

  const stepsLeft = progress.pending + progress.active;
  const lead = leadLine(board, cooks);
  // The tug-of-war split: each side's share of the points, level at 0–0.
  const tug = cooks.slice(0, 2).map((c) => (board.find((b) => b.cookId === c.id)?.points ?? 0) + 1);
  // Co-op's pips, in the order the night went: finished (in the
  // finisher's colour), skipped, in hand (outlined), then what's left.
  const pips = (() => {
    const who = (cookId) => playerKey(Math.max(0, cooks.findIndex((c) => c.id === cookId)));
    const recs = nodes.map((n) => run.steps[n.id]).filter(Boolean);
    const done = recs
      .filter((r) => r.status === "done")
      .sort((a, b) => Date.parse(a.endedAt || 0) - Date.parse(b.endedAt || 0))
      .map((r) => `is-done is-${who(r.cookId)}`);
    const skipped = recs.filter((r) => r.status === "skipped").map(() => "is-skipped");
    const live = recs.filter((r) => r.status === "active").map((r) => `is-live is-${who(r.cookId)}`);
    return [...done, ...skipped, ...live, ...Array(Math.max(0, nodes.length - done.length - skipped.length - live.length)).fill("")];
  })();
  // "Mapo Tofu" — which dish a step belongs to, for a ticket's eyebrow.
  const dishOf = (n) => {
    if (!n) return null;
    if (n._shared) return "Shared step";
    const recipe = recipes.find((r) => r.id === n._recipeId);
    return (recipe?.approved || recipe?.working)?.title || null;
  };
  // Both cards reserve the "on its own" slot if either has a pot going.
  const ownSlot = cooks.some((c) => cardFocus(c.id, run, byId, clockNow).cooking.length > 0);

  return (
    <section className={`page live-cook-page ${isVersus ? "is-versus" : "is-coop"} ${paused ? "is-paused" : ""} ${finished ? "is-finished" : ""}`}>
      <div className="lc-demo" role="note">
        <span className="lc-demo-tag">Honk!</span>
        <span className="lc-demo-body">
          <span>No need to say {AGENT_NAME} first. Voiceprints are off in this demo, so say who&rsquo;s doing it:</span>
          <Mono className="lc-demo-say">&ldquo;{cooks[0]?.name || "Mia"} finished the garlic&rdquo;</Mono>
          <span className="lc-demo-sep" aria-hidden="true">&middot;</span>
          <Mono className="lc-demo-say">&ldquo;{cooks[1]?.name || "Leo"} will take the rice&rdquo;</Mono>
        </span>
      </div>
      {/* The same header every stage has: the run eyebrow, the title
          with its crooked underline, the run's facts, and one line of
          the goose's own. His aside here is the standing rule of the
          mode; the live line under the cards is what he is saying now. */}
      <header className="lc-header">
        <div className="lc-title">
          <span className="ds-run-eyebrow">Tonight&rsquo;s run</span>
          <h1>Live cook</h1>
          <p className="ds-run-facts">
            {approved?.title || "Untitled cook"}
            <span className="ds-mode-chip">
              <KpIcon glyph={isVersus ? "trophy" : "fork-branch"} size={14} />
              {isVersus ? "Versus" : "Co-op"}
            </span>
          </p>
          {!finished && (
            <span className="ds-aside">
              <GoosePrint />
              <span>
                {isVersus
                  ? "Grab what you can. I\u2019m keeping score."
                  : "Say \u201cdone\u201d and I\u2019ll deal you the next one."}
              </span>
            </span>
          )}
        </div>
        {!finished && (
          <div className="lc-hud">
            <button type="button" className={`btn ${paused ? "btn-primary" : "btn-ghost lc-btn-accent"}`} onClick={() => togglePause()}>
              {paused ? "Resume" : "Pause"}
            </button>
            <button type="button" className="btn btn-ghost lc-btn-plan" onClick={openPlan} title="Pauses the cook before opening the plan">
              View plan
            </button>
          </div>
        )}
      </header>

      {/* The strip — the scoreboard (design v7): a light panel like every
          other panel in the flow, carried by big numerals and the two
          player colours rather than a dark fill. Versus: head to head,
          the run clock between the scores and a tug-of-war bar under it
          that slides when points land; the scores here are where "+20"
          lands on a phone. Co-op: one pip per step, filled in the colour
          of whoever finished it, the clock, and how the night is going
          against the plan. */}
      {!finished && (
        <div className={`lc-strip ${isVersus ? "is-versus" : "is-coop"}`} role="group" aria-label={isVersus ? "Scoreboard" : "Run clock"}>
          {isVersus ? (
            <>
              {cooks.slice(0, 2).map((cook, i) => {
                const pts = board.find((b) => b.cookId === cook.id)?.points ?? 0;
                return (
                  <div key={cook.id} className={`lc-strip-side is-${playerKey(i)}`}>
                    <PlayerAvatar cook={cook} index={i} size={28} />
                    <span className="lc-strip-name">{cook.name}</span>
                    <span className={`lc-score-pill is-${playerKey(i)}`} ref={(el) => (pillRefs.current[i] = el)}>
                      <span className={`lc-score-num ${fly?.index === i ? "is-landing" : "lc-roll"}`} key={`${cook.id}-${pts}`}>
                        {pts}
                      </span>
                    </span>
                  </div>
                );
              })}
              <div className="lc-strip-center">
                <span className="lc-clock-value">{clock(progress.elapsedSec)}</span>
                {/* A goose print walks the seam as the lead changes hands. */}
                <div className="lc-tug" aria-hidden="true">
                  <span className="lc-tug-a" style={{ flexGrow: tug[0] }} />
                  <GoosePrint depth="deep" size={14} rotate={tug[0] >= tug[1] ? 90 : -90} className="lc-tug-print" />
                  <span className="lc-tug-b" style={{ flexGrow: tug[1] }} />
                </div>
                <span className={`lc-lead ${lead.lead ? `is-${lead.lead}` : ""}`}>
                  <span className="lc-lead-line">{lead.text}</span>
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="lc-strip-side is-pips">
                <div className="lc-pips" aria-hidden="true">
                  {pips.map((cls, i) => (
                    <span key={i} className={`lc-pip ${cls}`} />
                  ))}
                </div>
                <span className="lc-strip-caption">
                  <Mono className="lc-count-big">{progress.done}</Mono> <Mono>/ {progress.total}</Mono> steps done together
                </span>
              </div>
              <div className="lc-strip-center">
                <span className="lc-clock-value">{clock(progress.elapsedSec)}</span>
                {run.plan?.makespanSec != null && (
                  <span className="lc-strip-caption">
                    <Mono>{clock(run.plan.makespanSec)}</Mono> planned
                  </span>
                )}
              </div>
              <div className="lc-strip-side is-status">
                {progress.driftSec > 30 ? (
                  <span className="lc-status-chip lc-drift">
                    <BabyGoose pose={GOOSE.behind} size={28} paused={paused} className="lc-lead-goose" decorative />
                    Running <Mono>{clock(progress.driftSec)}</Mono> behind
                  </span>
                ) : (
                  <span className="lc-status-chip is-on">
                    <span className="lc-status-dot" />
                    On plan
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {fly && (
        <ScoreFly
          fly={fly}
          fromEl={cardRefs.current[fly.index]}
          toEls={[cardScoreRefs.current[fly.index], pillRefs.current[fly.index]]}
          onDone={() => setFly(null)}
        />
      )}

      {finished ? (
        <ServiceDone
          outcome={runOutcome(run, nodes, cooks)}
          cooks={cooks}
          isVersus={isVersus}
          title={approved?.title || "Untitled cook"}
          byId={byId}
          dishOf={dishOf}
          onExit={saveAndSeeCard}
          saving={saving}
          saveError={saveError}
        />
      ) : (
        <>
          {paused && (
            <div className="lc-paused" role="status">
              <KpIcon glyph="timer" size={20} />
              <span>
                Paused — every clock is stopped and the break won&rsquo;t count against anyone. Nothing can be started or
                finished until you resume.
              </span>
            </div>
          )}

          {/* The arena: one column in both modes — the two cards, one
              half each, then (Versus) the board of what's up for grabs.
              What was said and done lives in the shell's conversation
              rail, beside the page rather than in it. */}
          <div className="lc-arena">
            <div className="lc-main">
              <div className="lc-cards">
                {cooks.map((cook, i) => (
                  <PlayerFocusCard
                    key={cook.id}
                    cardRef={(el) => (cardRefs.current[i] = el)}
                    scoreRef={(el) => (cardScoreRefs.current[i] = el)}
                    cook={cook}
                    index={i}
                    cooks={cooks}
                    run={run}
                    nodes={nodes}
                    byId={byId}
                    now={clockNow}
                    isVersus={isVersus}
                    paused={paused}
                    assignment={assignments?.byCook[cook.id]}
                    points={board.find((b) => b.cookId === cook.id)?.points ?? 0}
                    doneCount={board.find((b) => b.cookId === cook.id)?.doneCount ?? 0}
                    dishOf={dishOf}
                    ownSlot={ownSlot}
                    landing={fly?.index === i}
                    handoff={handoff === cook.id}
                    claimNote={claimNote?.cookId === cook.id ? claimNote : null}
                    claimBlock={isVersus ? claimBlock : null}
                    onStart={(stepId) => doStart(stepId, cook.id)}
                    onDone={(stepId) => doDone(stepId, cook.id)}
                    onSkip={(stepId) => doSkip(stepId, cook.id)}
                    onDrop={(stepId) => doDrop(stepId, cook.id)}
                    onClaim={(stepId) => doClaim(stepId, cook.id)}
                    onPass={(stepId, toCookId) => {
                      doClaim(stepId, toCookId);
                      setHandoff(toCookId);
                    }}
                    onUndo={() => doUndo(cook.id)}
                  />
                ))}
              </div>

              {isVersus && (
                <TaskPoolBoard
                  ready={ready}
                  blocked={blocked}
                  run={run}
                  byId={byId}
                  cooks={cooks}
                  now={clockNow}
                  paused={paused}
                  dishOf={dishOf}
                  claimBlock={claimBlock}
                  claimNote={claimNote}
                  onClaim={(stepId, cookId) => doClaim(stepId, cookId)}
                />
              )}
            </div>
          </div>

          <footer className={`lc-footer ${complete ? "is-final" : ""}`}>
            {complete ? (
              <>
                <span className="lc-footer-meta">
                  <Mono>{progress.done}</Mono> done · <Mono>{progress.skipped}</Mono> skipped
                </span>
                <button type="button" className="btn btn-primary btn-lg btn-key" onClick={() => doFinish()}>
                  Dinner&rsquo;s up &rarr;
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-ghost lc-btn-accent lc-btn-early" onClick={() => doFinish()} disabled={paused}>
                  Call it early &rarr;
                </button>
                <span className="lc-footer-meta">
                  {isVersus ? "Versus" : "Co-op"} · <Mono>{stepsLeft}</Mono> {stepsLeft === 1 ? "step" : "steps"} left
                </span>
              </>
            )}
          </footer>
        </>
      )}

      {confirm?.kind === "finish" && (
        <Modal label="Call it early?" onClose={() => setConfirm(null)} panelClassName="lc-modal">
          <span className="lc-modal-title">Call it early?</span>
          <p className="lc-modal-body">
            <Mono className="lc-modal-num">{stepsLeft}</Mono> {stepsLeft === 1 ? "step isn't" : "steps aren't"} done — they&rsquo;ll be
            marked skipped.
          </p>
          <div className="lc-modal-actions">
            <button type="button" className="btn lc-btn-keep" onClick={() => setConfirm(null)}>
              Keep cooking
            </button>
            <button type="button" className="btn lc-btn-danger" onClick={() => finishNow()}>
              Call it
            </button>
          </div>
        </Modal>
      )}

      {confirm?.kind === "skip" && (
        <Modal label="Skip this step?" onClose={() => setConfirm(null)} panelClassName="lc-modal">
          <span className="lc-modal-title">Skip &ldquo;{byId[confirm.stepId]?.label}&rdquo;?</span>
          <p className="lc-modal-body">
            {confirm.dependents.map((d) => d.label).join(", ")} {confirm.dependents.length === 1 ? "was" : "were"} counting on
            this. Skip anyway?
          </p>
          <div className="lc-modal-actions">
            <button type="button" className="btn lc-btn-keep" onClick={() => setConfirm(null)}>
              Keep it
            </button>
            <button type="button" className="btn lc-btn-danger" onClick={() => applySkipNow(confirm.stepId, confirm.cookId, confirm.source)}>
              Skip
            </button>
          </div>
        </Modal>
      )}

    </section>
  );
}
