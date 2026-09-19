// Live cook — session step 7 of 7, the run in play (design/
// claude-design-live-cook-prompt.md, "Kitchen Path Live Cook"). The one
// play surface: two PlayerFocusCards, big mono numbers, one agent.
//
// This screen is propped on the counter and shared by both players,
// read from ~1.5m with wet hands: big type, 64px primaries, nothing
// that depends on hover. Every voice command has a button next to the
// thing it acts on, and both paths call the same handlers — parity is
// structural, not a discipline.
//
// The shell's VoiceBar stays the shared one (it only carries the hint
// line); the transcript, speaker toggle and typed fallback live in the
// agent column beside the cards, because on a 1280 counter screen the
// cards must not scroll away behind a tall bar.
//
// Sub-components live in this file rather than their own (same pattern
// as Schedule) since none of them is used elsewhere.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { mergeRecipesForDisplay, formatDuration } from "../utils/graphLayout.js";
import { EQUIPMENT_LABELS, unattendedEvents } from "../utils/scheduleLayout.js";
import { hasDeadline, isOneShot, isAttended, tendingOf, TENDING } from "../utils/tending.js";
import {
  reconcileRun, isReady, readyStepIds, blockedStepIds, activeStepFor, stepVariance, unattendedPhaseNow,
  runProgress, isRunComplete, scoreboard, runOutcome, resolveAssignments, replan,
  arbitrateClaim, claimSuggestions, applyStart, applyDone, applySkip, applyDrop, passiveStepsFor,
  selfFinishingIds,
  applyUndo, canUndo, endRun, appendTranscript, scoreStep, DIFFICULTY_POINTS,
  isPaused, applyPause, applyResume,
} from "../utils/liveCook.js";
import { parseCommand, HELP_TEXT } from "../utils/voiceCommands.js";
import { matchConfirmation } from "../utils/navCommands.js";
import { buildSummary } from "../utils/summaryCard.js";
import KpIcon from "../components/KpIcon.jsx";
import Modal from "../components/Modal.jsx";
import "./LiveCookPage.css";

// Player colors come from the index in cooks[] — player 1 is "a",
// player 2 is "b" — never stored, never chosen (design-v4.css tokens).
const PLAYER_KEYS = ["a", "b"];
const playerKey = (index) => PLAYER_KEYS[index % PLAYER_KEYS.length];

const DIFFICULTY_FLAMES = { low: 1, medium: 2, high: 3 };
const EQUIPMENT_GLYPHS = { cutting_board: "cutting-board", stove_burner: "burner", pot: "pot", wok: "wok", oven: "oven" };

// Copy that is the engine's own — reproduced verbatim on the card.
const EYEBROW = {
  active: "On it",
  assigned: "Up next",
  idle_fill: "Free hands? Take this",
  waiting: "Waiting",
  finished: "Done for the night",
  grabs: "Up for grabs",
  paused: "Paused",
};

// The Schedule's vocabulary for tending kinds and moments, reused
// exactly (design/claude-design-live-cook-v2-unattended.md §1).
const TENDING_LABELS = {
  [TENDING.TENDED]: "Check on it",
  [TENDING.TIMED]: "Timed",
  [TENDING.SET_AND_FORGET]: "Leave it",
};
const tendingLabel = (node) => TENDING_LABELS[tendingOf(node)] || null;
const momentName = (m, count) => (m.kind === "initial" ? "Start" : m.kind === "ending" ? "Finish" : `Check ${m.index + 1}/${count}`);

// A finish that has sat open this long reads as a count-up, not a
// countdown (§3, "Late").
const LATE_AFTER_SEC = 60;

/**
 * Hook point for the voice API: fired once per moment as it becomes
 * due (a check opening, the finish window opening). Nothing is wired
 * yet — the transcript line beside it is the design of what will be
 * said (UNATTENDED_TASK_FRONTEND.md §6, "do not wire voice into this
 * pass").
 */
// eslint-disable-next-line no-unused-vars
function onMomentDue(stepId, phase, index) {}

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "12:48" — every clock on the page. */
const clock = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

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

/**
 * Everything the card and the "cooking on its own" row need to know
 * about one running unattended step, derived per tick from the step's
 * real start — the same numbers unattendedPhaseNow reads, plus the
 * moments laid out from 0 so a time axis can be drawn.
 */
function momentState(node, record, now) {
  const moments = unattendedEvents(node, 0);
  const checkCount = moments.filter((m) => m.kind === "checkpoint").length;
  const { phase, index } = unattendedPhaseNow(node, record, now);
  const elapsedSec = stepVariance(node, record, now).actualSec;
  const estSec = node.estimated_duration_sec || 0;
  const current =
    phase === "initial"
      ? moments.find((m) => m.kind === "initial")
      : phase === "checkpoint"
        ? moments.find((m) => m.kind === "checkpoint" && m.index === index)
        : phase === "ending"
          ? moments.find((m) => m.kind === "ending")
          : null;
  const from = current ? current.endSec : elapsedSec;
  const next = phase === "ending" ? null : moments.find((m) => m !== current && m.atSec >= from) || null;
  // The finish window stays open until Done; past LATE_AFTER_SEC it is
  // a count-up in warning text, never red.
  const lateSec = current?.kind === "ending" ? elapsedSec - current.atSec : 0;
  return {
    moments,
    checkCount,
    phase,
    current,
    next,
    elapsedSec,
    estSec,
    inMoment: Boolean(current),
    countdownSec: current ? Math.max(0, current.endSec - elapsedSec) : null,
    nextInSec: next ? next.atSec - elapsedSec : null,
    late: lateSec > LATE_AFTER_SEC,
    lateSec,
    // Leave it: nothing to come back for, just a moment it becomes usable.
    readyInSec: Math.max(0, estSec - elapsedSec),
    handsOnSec: moments.reduce((sum, m) => sum + (m.endSec - m.atSec), 0),
  };
}

function Mono({ children, className = "" }) {
  return <span className={`mono ${className}`}>{children}</span>;
}

function PlayerAvatar({ cook, index, size = 32 }) {
  return (
    <span className={`lc-avatar is-${playerKey(index)} lc-avatar-${size}`} aria-hidden="true">
      {cook?.name?.[0]?.toUpperCase() || "?"}
    </span>
  );
}

function AgentAvatar({ size = 20 }) {
  return (
    <span className={`lc-agent-avatar lc-agent-avatar-${size}`} aria-hidden="true">
      <KpIcon glyph="mic" size={Math.round(size * 0.6)} />
    </span>
  );
}

function DifficultyChip({ level }) {
  return (
    <span className={`lc-chip is-difficulty is-${level}`} aria-label={`${level} difficulty`}>
      {Array.from({ length: DIFFICULTY_FLAMES[level] || 1 }, (_, i) => (
        <KpIcon key={i} glyph="flame" size={14} />
      ))}
    </span>
  );
}

function EquipmentChip({ type }) {
  const glyph = EQUIPMENT_GLYPHS[type];
  return (
    <span className="lc-chip">
      {glyph && <KpIcon glyph={glyph} size={14} />}
      {capitalize(EQUIPMENT_LABELS[type] || type)}
    </span>
  );
}

function TendingChip({ node, className = "" }) {
  const label = tendingLabel(node);
  if (!label) return null;
  return <span className={`lc-tending-chip ${className}`}>{label}</span>;
}

// The Schedule's rail-and-moments drawing, scaled to a row and made
// live: a 6px rail 0 → est with the elapsed part filled in the player's
// color, a block per moment standing on it (past ones drop to the
// tint), and a 2px now marker.
function MomentAxis({ state, player }) {
  const { moments, elapsedSec, estSec } = state;
  const pct = (sec) => (estSec > 0 ? Math.min(100, Math.max(0, (sec / estSec) * 100)) : 0);
  return (
    <div className={`lc-axis is-${player}`} aria-hidden="true">
      <Mono className="lc-axis-end">0:00</Mono>
      <div className="lc-axis-track">
        <span className="lc-axis-rail" />
        <span className="lc-axis-fill" style={{ width: `${pct(elapsedSec)}%` }} />
        {moments.map((m) => (
          <span
            key={`${m.kind}-${m.index}`}
            className={`lc-axis-moment ${m.endSec <= elapsedSec ? "is-past" : ""}`}
            style={{ left: `${pct(m.atSec)}%`, width: `max(10px, ${pct(m.endSec - m.atSec)}%)` }}
          />
        ))}
        <span className="lc-axis-now" style={{ left: `${pct(elapsedSec)}%` }} />
      </div>
      <Mono className="lc-axis-end">{clock(estSec)}</Mono>
    </div>
  );
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

  const finished = Boolean(run?.endedAt);
  const paused = isPaused(run);
  const now = useNow(finished || paused);
  const [speakerId, setSpeakerId] = useState(cooks[0]?.id);
  // Seeded once, so it can end up pointing at nobody if the line-up
  // changed since. Fall back rather than attributing speech to a ghost.
  const speaker = cooks.some((c) => c.id === speakerId) ? speakerId : cooks[0]?.id;
  const speakerCook = cooks.find((c) => c.id === speaker);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(null); // inline disambiguation buttons
  // A guessed step whose name came back close but not exact — "Cut the
  // onion" against both "Cut the yellow onion" and "Cut the red onion",
  // say. Firing on that guess is how a mishearing finishes the wrong
  // step; asking first is the whole point of this state.
  const [pendingConfirm, setPendingConfirm] = useState(null); // { intent, stepId, cookId, label, candidates }
  const [confirm, setConfirm] = useState(null); // { kind: "finish" } | { kind: "skip", stepId, cookId }
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // The shared VoiceBar only carries the hint; who is speaking is the
  // agent column's business (see the speaker toggle there).
  useEffect(() => {
    if (!run) return undefined;
    const hint = finished
      ? { line: "Service done — see the cook card when you're ready.", sub: null }
      : paused
        ? { line: "Paused — say “resume” to pick it back up.", sub: "Every clock is stopped; nothing else lands until then." }
        : {
            line: HELP_TEXT,
            sub: pendingConfirm
              ? `${speakerCook?.name || "Someone"} is speaking — waiting on “yes” or “no”.`
              : pending
                ? `${speakerCook?.name || "Someone"} is speaking — waiting on which step they mean.`
                : `${speakerCook?.name || "Someone"} is speaking — everything said is logged under that name.`,
          };
    dispatch({ type: "voice/setHint", payload: { hint } });
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [dispatch, run, finished, paused, speakerCook?.name, pending, pendingConfirm]);

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
    // Said once, plainly. It is not an achievement and should not read
    // like one, but the board changing on its own needs explaining.
    next = appendTranscript(next, {
      at: new Date().toISOString(),
      speaker: "agent",
      text: `${ready.map((id) => byId[id]?.label).join(" and ")} — ready whenever you need it.`,
    });
    if (isRunComplete(next, nodes)) {
      next = appendTranscript(next, { at: new Date().toISOString(), speaker: "agent", text: "That's everything. Dinner's up." });
    }
    saveRunNow(next);
    // `now` ticks every second; the guard above is what stops this
    // firing more than once per step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, paused, finished]);

  // A moment coming due is the alarm. The row and the card already show
  // it; this adds the agent's line to the transcript and is the hook
  // point for voice output later (§4: "spoken later, not wired yet").
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
    Object.entries(current).forEach(([stepId, key]) => {
      if (prev[stepId] === key) return;
      const [phase, index] = key.split(":");
      if (phase !== "checkpoint" && phase !== "ending") return;
      const node = byId[stepId];
      if (!hasDeadline(node)) return;
      const who = cooks.find((c) => c.id === run.steps[stepId].cookId)?.name || "Someone";
      const count = node.unattended?.checkpoints?.count || 0;
      const text = phase === "checkpoint" ? `${who} — check on “${node.label}”. ${Number(index) + 1} of ${count}.` : `${who} — finish “${node.label}” now.`;
      onMomentDue(stepId, phase, Number(index));
      next = appendTranscript(next, { at: new Date().toISOString(), speaker: "agent", text });
      fired = true;
    });
    if (fired) saveRunNow(next);
    // `now` ticks every second; the phase diff above is the guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, paused, finished]);

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

  const commit = (nextRun) => saveRunNow(nextRun);



  // --- the handlers every button AND every utterance routes through ---
  // `base` is the run to build on: the closure's `run` for a tap, or the
  // run with the player's utterance already appended for a voice path —
  // so what they said stays in the transcript whether or not it worked.

  const doStart = (stepId, cookId, source = "tap", base = run) => {
    if (paused || !stepId || !isReady(stepId, nodes, base)) return;
    if (activeStepFor(cookId, base, nodes)) return;
    const at = new Date().toISOString();
    let next = applyStart({ run: base, stepId, cookId, at, source });
    next = say(next, `Timer running on ${byId[stepId].label}. Est ${formatDuration(byId[stepId].estimated_duration_sec)}.`);
    commit(next);
  };

  const doDone = (stepId, cookId, source = "tap", base = run) => {
    if (paused || !stepId || base.steps[stepId]?.status !== "active") return;
    const at = new Date().toISOString();
    const v = stepVariance(byId[stepId], { ...base.steps[stepId], endedAt: at });
    let next = applyDone({ run: base, stepId, cookId, at, source });
    // Recompile the rest of the plan on every completion — real times
    // diverge from estimates, so what's left genuinely changes shape.
    if (!isVersus) next = replan({ nodes, run: next, cooks, kitchenProfile });
    const pts = scoreStep(byId[stepId], { record: next.steps[stepId], run: next, nodes, cooks }).points;
    const overNote = v.over ? `, ${clock(v.deltaSec)} over` : "";
    next = say(
      next,
      isVersus
        ? `+${pts} for ${name(cookId)}. ${byId[stepId].label}, ${clock(v.actualSec)}${overNote}.`
        : `${byId[stepId].label} done in ${clock(v.actualSec)}${overNote}.`
    );
    if (isRunComplete(next, nodes)) next = say(next, "That's everything. Dinner's up.");
    commit(next);
  };

  // Skipping something another step depends on gets a confirm Modal
  // (never a browser dialog); the actual write is applySkipNow.
  const doSkip = (stepId, cookId, source = "tap", base = run) => {
    if (paused || !stepId) return;
    const dependents = nodes.filter((n) => (n.depends_on || []).includes(stepId));
    if (dependents.length) {
      // The utterance is logged now; the modal decides the rest.
      if (base !== run) commit(base);
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
        no_equipment: `No ${EQUIPMENT_LABELS[verdict.equipmentType] || verdict.equipmentType} free — something else is on it.`,
      }[verdict.code];
      commit(say(base, text));
      return;
    }
    let next = base;
    if (verdict.stealFrom) next = applyDrop({ run: next, stepId, cookId: verdict.stealFrom, at, source });
    next = applyStart({ run: next, stepId, cookId, at, source });
    commit(say(next, `${name(cookId)} has ${byId[stepId].label}. Go.`));
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
    if (paused) {
      commit(say(applyResume({ run: base, at }), "Back on. Clock's running again."));
    } else {
      commit(say(applyPause({ run: base, at }), "Paused. Nothing's being timed until you say go."));
    }
  };

  const doFinish = (base = run) => {
    if (!complete) {
      if (base !== run) commit(base);
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
    });
    setSaveError(null);
    setSaving(true);
    try {
      await finishSession(summary);
      navigate(`/cook/${sessionId}`);
    } catch (err) {
      setSaving(false);
      setSaveError(err.message || "Couldn't save the card.");
    }
  };

  // --- voice: parse, then call the exact same handlers ---

  // The five intents "which one" and "did you mean" both eventually
  // resolve to — factored out so a tap (runPending), a spoken "yes"
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

  // Both a tap on Yes/No and a spoken "yes"/"no" answer the same
  // question the same way — one path, so the two can't drift apart.
  const resolvePendingConfirm = (answer, base = run) => {
    if (!pendingConfirm) return undefined;
    const { intent, stepId, cookId, label, candidates } = pendingConfirm;
    setPendingConfirm(null);
    if (answer === "yes") return runIntentAction(intent, stepId, cookId, base);
    const options = (candidates.length ? candidates : claimSuggestions({ nodes, run, cookId })).slice(0, 3);
    setPending({ intent, options, cookId });
    return commit(say(base, `Not “${label}” — which one did you mean?`));
  };

  const submitUtterance = (text) => {
    if (!text) return;
    const cookId = speaker;

    // A question is pending: this utterance is the answer, not a new
    // command. Anything that isn't clearly yes or no abandons the
    // question rather than forcing a reading onto it — the cook moved
    // on, they didn't mumble a confirmation.
    if (pendingConfirm) {
      const answer = matchConfirmation(text);
      if (answer === "yes" || answer === "no") {
        const heard = appendTranscript(run, { at: new Date().toISOString(), speaker: pendingConfirm.cookId, text });
        return resolvePendingConfirm(answer, heard);
      }
      setPendingConfirm(null);
      // Falls through: `text` gets parsed fresh below, same as any
      // other utterance.
    }

    setPending(null);
    const activeStepId = activeStepFor(cookId, run, nodes);
    const ownQueue = isVersus
      ? claimSuggestions({ nodes, run, cookId })
      : [assignments?.byCook[cookId]?.stepId].filter(Boolean);
    const result = parseCommand(text, { byId, activeStepId, claimable: ready, ownQueue });

    const heard = appendTranscript(run, { at: new Date().toISOString(), speaker: cookId, text });

    // While paused only "resume" does anything; everything else is
    // logged and answered, never acted on.
    if (paused) {
      if (result.intent === "resume") return togglePause(heard);
      return commit(say(heard, "We're paused — say \"resume\" when you're ready."));
    }

    const needTarget = (message) => {
      const options = (result.candidates.length ? result.candidates : claimSuggestions({ nodes, run, cookId })).slice(0, 3);
      setPending({ intent: result.intent, options, cookId });
      commit(say(heard, message));
    };

    // A close-but-not-exact name match — a word dropped or swapped among
    // steps that read alike — gets checked before it fires, instead of
    // guessing which "cut the onion" was meant.
    if (result.stepId && result.confidence === "confirm" && ["done", "start", "claim", "skip", "drop"].includes(result.intent)) {
      setPendingConfirm({ intent: result.intent, stepId: result.stepId, cookId, label: byId[result.stepId]?.label, candidates: result.candidates });
      return commit(say(heard, `Did you mean “${byId[result.stepId]?.label}”? Say yes or no.`));
    }

    switch (result.intent) {
      case "done":
        if (!result.stepId) return needTarget("Which one did you finish?");
        return doDone(result.stepId, cookId, "voice", heard);
      case "start":
        if (!result.stepId) return needTarget("Which one are you starting?");
        return doStart(result.stepId, cookId, "voice", heard);
      case "claim":
        if (!result.stepId) return needTarget("Which one? Tap it or say the name.");
        return doClaim(result.stepId, cookId, "voice", heard);
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
        return commit(say(heard, board.map((b) => `${b.name} ${b.points}`).join(", ") + `. ${progress.pending} left.`));
      case "status": {
        const lines = cooks.map((c) => {
          const active = activeStepFor(c.id, run, nodes, now);
          if (active) return `${c.name}: ${byId[active].label}, ${clock(stepVariance(byId[active], run.steps[active], now).actualSec)} in`;
          return `${c.name}: free`;
        });
        return commit(say(heard, `${lines.join(". ")}. ${progress.done} of ${progress.total} done.`));
      }
      case "help":
        return commit(say(heard, HELP_TEXT));
      default:
        return commit(say(heard, `I didn't catch that. ${HELP_TEXT}`));
    }
  };

  const runPending = (stepId) => {
    const { intent, cookId } = pending;
    setPending(null);
    runIntentAction(intent, stepId, cookId);
  };

  const stepsLeft = progress.pending + progress.active;

  return (
    <section className={`page live-cook-page ${isVersus ? "is-versus" : "is-coop"} ${paused ? "is-paused" : ""}`}>
      <header className="lc-header">
        <div className="lc-title">
          <h1>{approved?.title || "Untitled cook"}</h1>
          <span className="lc-mode-chip">
            <KpIcon glyph={isVersus ? "trophy" : "fork-branch"} size={16} />
            {isVersus ? "Versus" : "Co-op"}
          </span>
        </div>
        <div className="lc-hud">
          <span className="lc-clock">
            <KpIcon glyph="timer" size={22} />
            <Mono className="lc-clock-value">{clock(progress.elapsedSec)}</Mono>
          </span>
          <Mono className="lc-count">
            {progress.done} / {progress.total}
          </Mono>
          {!isVersus && progress.driftSec > 30 && <Mono className="lc-drift">{clock(progress.driftSec)} behind plan</Mono>}
          {!finished && (
            <>
              <span className="lc-hud-divider" aria-hidden="true" />
              <button type="button" className={`btn ${paused ? "btn-primary" : "btn-ghost lc-btn-accent"}`} onClick={() => togglePause()}>
                {paused ? "Resume" : "Pause"}
              </button>
              <button type="button" className="btn btn-ghost lc-btn-accent" onClick={() => navigate("/session/schedule")}>
                The plan
              </button>
            </>
          )}
        </div>
      </header>

      {finished ? (
        <ServiceDone
          outcome={runOutcome(run, nodes, cooks)}
          cooks={cooks}
          isVersus={isVersus}
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

          {isVersus && <Leaderboard board={board} cooks={cooks} />}

          <div className="lc-play">
            <div className="lc-cards">
              {cooks.map((cook, i) => (
                <PlayerFocusCard
                  key={cook.id}
                  cook={cook}
                  index={i}
                  cooks={cooks}
                  run={run}
                  nodes={nodes}
                  byId={byId}
                  now={clockNow}
                  isVersus={isVersus}
                  paused={paused}
                  points={board.find((b) => b.cookId === cook.id)?.points ?? 0}
                  assignment={assignments?.byCook[cook.id]}
                  onStart={(stepId) => doStart(stepId, cook.id)}
                  onDone={(stepId) => doDone(stepId, cook.id)}
                  onSkip={(stepId) => doSkip(stepId, cook.id)}
                  onDrop={(stepId) => doDrop(stepId, cook.id)}
                  onClaim={(stepId) => doClaim(stepId, cook.id)}
                  onUndo={() => doUndo(cook.id)}
                />
              ))}
            </div>

            <AgentPanel
              cooks={cooks}
              transcript={run.transcript}
              speaker={speaker}
              onSpeaker={setSpeakerId}
              pending={pending}
              pendingConfirm={pendingConfirm}
              byId={byId}
              onPick={runPending}
              onCancel={() => setPending(null)}
              onConfirmYes={() => resolvePendingConfirm("yes")}
              onConfirmNo={() => resolvePendingConfirm("no")}
              input={input}
              onInput={setInput}
              onSubmit={() => {
                const text = input.trim();
                setInput("");
                submitUtterance(text);
              }}
            />
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
              onClaim={(stepId, cookId) => doClaim(stepId, cookId)}
            />
          )}

          <footer className={`lc-footer ${complete ? "is-final" : ""}`}>
            {complete ? (
              <>
                <Mono className="lc-footer-meta">
                  {progress.done} done · {progress.skipped} skipped
                </Mono>
                <button type="button" className="btn btn-primary btn-lg" onClick={() => doFinish()}>
                  Dinner&rsquo;s up &rarr;
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-ghost lc-btn-accent lc-btn-early" onClick={() => doFinish()} disabled={paused}>
                  Call it early &rarr;
                </button>
                <Mono className="lc-footer-meta">
                  {isVersus ? "Versus" : "Co-op"} · {plural(stepsLeft, "step")} left
                </Mono>
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

// ---------------------------------------------------------------------

function PlayerFocusCard({ cook, index, cooks, run, nodes, byId, now, isVersus, paused, points, assignment, onStart, onDone, onSkip, onDrop, onClaim, onUndo }) {
  const key = playerKey(index);
  // The engine says who is occupied by what. If a check comes due while
  // the cook is mid-chop, both steps occupy them and the engine's pick
  // is by record order — the card keeps the hands-on step so it does
  // not flip under a working cook; the due check is the row's alarm
  // (§4). Only with no hands-on step does an unattended moment lead.
  const handsOnId = Object.entries(run.steps).find(([id, r]) => r.status === "active" && r.cookId === cook.id && isAttended(byId[id]))?.[0] || null;
  const activeId = handsOnId || activeStepFor(cook.id, run, byId, now);
  const node = activeId ? byId[activeId] : null;
  const variance = node ? stepVariance(node, run.steps[activeId], now) : null;
  // The card is "On it" on an unattended step only while it is in a
  // moment — the engine never makes a merely-waiting pot anyone's focus.
  const focusMoment = node && !isAttended(node) ? momentState(node, run.steps[activeId], now) : null;
  const inFinish = focusMoment?.phase === "ending";

  // Every unattended step this cook has going, soonest moment first —
  // the pots that need someone back. Whole-step based on purpose: a pot
  // stays listed even while its check is the card's focus, so the row
  // and the card agree.
  const cooking = passiveStepsFor(cook.id, run, byId)
    .map((id) => ({ id, node: byId[id], state: momentState(byId[id], run.steps[id], now) }))
    .sort((a, b) => (a.state.nextInSec ?? -1) - (b.state.nextInSec ?? -1));

  // Versus has no plan: with nothing in hand the card offers the top
  // suggestion and points at the board for the rest.
  const suggestion = isVersus && !activeId ? claimSuggestions({ nodes, run, cookId: cook.id, limit: 1 })[0] : null;
  const reason = activeId ? "active" : isVersus ? (suggestion ? "grabs" : "finished") : assignment?.reason || "waiting";
  const offeredId = reason === "grabs" ? suggestion : reason === "assigned" || reason === "idle_fill" ? assignment?.stepId : null;
  const offered = offeredId ? byId[offeredId] : null;
  const undoable = !paused && canUndo({ run, nodes, cookId: cook.id, at: new Date(now).toISOString() });

  const waitingOn = assignment?.waitingOnStepId ? byId[assignment.waitingOnStepId] : null;
  const waitingCookIndex = assignment?.waitingOnCookId ? cooks.findIndex((c) => c.id === assignment.waitingOnCookId) : -1;

  const eyebrowClass = paused
    ? "is-paused"
    : {
        active: `is-active is-${key}`,
        assigned: "is-next",
        idle_fill: "is-offer",
        waiting: "is-waiting",
        finished: "is-finished",
        grabs: "is-next",
      }[reason];
  const phaseLabel = focusMoment?.current ? momentName(focusMoment.current, focusMoment.checkCount) : null;
  const eyebrowText = paused ? EYEBROW.paused : phaseLabel ? `${EYEBROW.active} · ${phaseLabel}` : EYEBROW[reason];

  const secondary = (
    <>
      <button type="button" className="btn btn-ghost lc-btn-accent" disabled={paused} onClick={() => onSkip(activeId)}>
        Skip
      </button>
      {isVersus && (
        <button type="button" className="btn btn-ghost lc-btn-accent" disabled={paused} onClick={() => onDrop(activeId)}>
          Put it back
        </button>
      )}
      <button type="button" className="btn btn-ghost lc-btn-accent lc-btn-undo" disabled={!undoable} onClick={onUndo}>
        Undo
      </button>
    </>
  );

  return (
    <article className={`lc-card is-${key} ${paused ? "is-paused" : ""}`} aria-label={`${cook.name} — ${eyebrowText}`}>
      <header className="lc-card-head">
        <PlayerAvatar cook={cook} index={index} size={40} />
        <span className="lc-card-name">{cook.name}</span>
        {isVersus && <Mono className="lc-card-pts">{points} pts</Mono>}
        <span className={`lc-eyebrow ${eyebrowClass}`}>
          {reason === "finished" && <KpIcon glyph="checkmark-burst" size={14} />}
          {(reason === "active" || reason === "waiting") && !paused && <span className="lc-eyebrow-dot" />}
          {eyebrowText}
        </span>
      </header>

      {/* Every variant renders the same skeleton — title, body, then an
          action block — so both cards' action blocks line up. The
          "cooking on its own" list below is the one thing allowed to
          make them unequal in height. */}
      <div className="lc-card-body">
        {node && (
          <>
            <div className="lc-step-title-row">
              <h2 className="lc-step-title">{node.label}</h2>
              {phaseLabel && <span className={`lc-phase-chip is-${key}`}>{phaseLabel}</span>}
            </div>
            {node.description && <p className="lc-step-desc">{node.description}</p>}
            {focusMoment?.current && (
              <MomentInstruction state={focusMoment} node={node} />
            )}
            <div className={`lc-timer ${variance.over ? "is-over" : ""}`}>
              <Mono className="lc-timer-value">{clock(variance.actualSec)}</Mono>
              <Mono className="lc-timer-est">
                est {clock(variance.estSec)}
                {variance.over ? ` · ${clock(variance.deltaSec)} over` : ""}
              </Mono>
            </div>
            <div className="lc-chips">
              <DifficultyChip level={node.difficulty} />
              {(node.required_equipment || []).map((e) => (
                <EquipmentChip key={e} type={e} />
              ))}
              {isVersus && <Mono className="lc-chip is-points">worth +{DIFFICULTY_POINTS[node.difficulty]}</Mono>}
            </div>
          </>
        )}

        {offered && (
          <>
            <div className="lc-step-title-row">
              <h2 className="lc-step-title">{offered.label}</h2>
              <TendingChip node={offered} />
            </div>
            {offered.description && <p className="lc-step-desc">{offered.description}</p>}
            <div className="lc-chips">
              <DifficultyChip level={offered.difficulty} />
              <Mono className="lc-chip">{clock(offered.estimated_duration_sec)}</Mono>
              {isVersus && <Mono className="lc-chip is-points">+{DIFFICULTY_POINTS[offered.difficulty]}</Mono>}
              {(offered.required_equipment || []).map((e) => (
                <EquipmentChip key={e} type={e} />
              ))}
            </div>
            {reason === "grabs" && <p className="lc-step-desc">The full pool is on the board below.</p>}
          </>
        )}

        {reason === "waiting" && (
          <>
            <p className="lc-waiting-copy">
              {waitingOn ? (
                <>
                  Waiting on &ldquo;{waitingOn.label}&rdquo;
                  {assignment.etaSec != null && (
                    <>
                      , about <Mono>{clock(assignment.etaSec)}</Mono> left
                    </>
                  )}
                  .{waitingCookIndex >= 0 && <PlayerAvatar cook={cooks[waitingCookIndex]} index={waitingCookIndex} size={20} />}
                </>
              ) : (
                "Waiting on the other player."
              )}
            </p>
            {assignment?.etaSec != null && (
              <div className="lc-timer is-countdown">
                <Mono className="lc-timer-value">{clock(assignment.etaSec)}</Mono>
                <Mono className="lc-timer-est">left</Mono>
              </div>
            )}
          </>
        )}

        {reason === "finished" && (
          <>
            <KpIcon glyph="checkmark-burst" size={32} className="lc-done-burst" />
            <p className="lc-waiting-copy">{isVersus && !isRunComplete(run, nodes) ? "Nothing to grab right now." : "Nothing left for you."}</p>
          </>
        )}
      </div>

      <div className="lc-card-actions">
        {node && (focusMoment && !inFinish ? (
          // Start / Check: no primary. The card must read "do the thing,
          // then walk away", not "press a button" — the ghost Done on the
          // left is for ending the step early.
          <div className="lc-card-secondary is-ghost-row">
            <button type="button" className="btn btn-ghost lc-btn-accent" disabled={paused} onClick={() => onDone(activeId)}>
              Done
            </button>
            <span className="lc-card-secondary-right">{secondary}</span>
          </div>
        ) : (
          <>
            <button
              type="button"
              // Finish: the primary IS the Done, and the card pulses once
              // when the window opens.
              className={`btn lc-btn-xl lc-btn-done ${inFinish ? "lc-attend" : ""}`}
              key={inFinish ? "finish" : "done"}
              disabled={paused}
              onClick={() => onDone(activeId)}
            >
              Done
            </button>
            <div className="lc-card-secondary">{secondary}</div>
          </>
        ))}
        {offered && (
          <button
            type="button"
            className="btn btn-primary lc-btn-xl"
            disabled={paused}
            onClick={() => (reason === "grabs" ? onClaim(offeredId) : onStart(offeredId))}
          >
            {reason === "assigned" ? "Start" : "Take it"}
          </button>
        )}
        {/* A player's last Done/Skip stays undoable for 60s even though
            their card has already moved on — the button follows them. */}
        {!node && undoable && (
          <div className="lc-card-secondary">
            <button type="button" className="btn btn-ghost lc-btn-accent lc-btn-undo" onClick={onUndo}>
              Undo
            </button>
          </div>
        )}
      </div>

      {/* Pinned under the action block: every pot this cook has going,
          with its next moment counting down. Whole-step based, so it
          is still here while a check is the card's focus. */}
      {cooking.length > 0 && (
        <div className="lc-cooking">
          <div className="lc-cooking-head">
            <span className="lc-agent-eyebrow">Cooking on its own</span>
            <Mono className="lc-meta">{cooking.length}</Mono>
          </div>
          {cooking.map(({ id, node: cNode, state }) => (
            <CookingRow
              key={id}
              node={cNode}
              state={state}
              player={key}
              paused={paused}
              // Done never appears twice in one card: the row's ghost Done
              // is suppressed only when this same step is the card's
              // primary (its Finish-phase card).
              showDone={!isOneShot(cNode) && state.phase === "ending" && !(activeId === id && inFinish)}
              onDone={() => onDone(id)}
            />
          ))}
        </div>
      )}
    </article>
  );
}

// The instruction line for a focus card mid-moment: what to do, the
// small countdown for this moment (the big timer keeps counting the
// whole step), and what comes next.
function MomentInstruction({ state, node }) {
  const { current, next, countdownSec, checkCount } = state;
  const verb = current.kind === "initial" ? "Get it going" : current.kind === "checkpoint" ? "Check on it" : "Pull it off";
  const nextText = next ? `Next: ${momentName(next, checkCount)} in ${clock(state.nextInSec)}.` : null;
  return (
    <div className="lc-moment">
      <div className="lc-moment-line">
        <span className="lc-moment-instruction">
          {verb} — {current.kind === "ending" ? "now." : <><Mono>{clock(current.endSec - current.atSec)}</Mono>.</>}
        </span>
        {current.kind !== "ending" && <Mono className="lc-moment-countdown">{clock(countdownSec)}</Mono>}
      </div>
      {current.kind === "initial" && (
        <span className="lc-meta">
          {isOneShot(node) ? "Then it runs on its own — nothing to come back for." : `Then it runs on its own. ${nextText || ""}`}
        </span>
      )}
      {current.kind === "checkpoint" && nextText && <span className="lc-meta">{nextText}</span>}
    </div>
  );
}

// One "cooking on its own" row: label + tending chip, the live axis,
// and the next moment. Quiet while running; the system's "needs you"
// treatment (warning tint, player-color rail, one pop) when a check or
// the finish is due. Tapping does nothing yet — reserved for "agent
// says the next moment".
function CookingRow({ node, state, player, paused, showDone, onDone }) {
  const { phase, current, next, checkCount, countdownSec, late, lateSec, readyInSec } = state;
  const due = hasDeadline(node) && (phase === "checkpoint" || phase === "ending");
  let label = "";
  let value = "";
  if (due) {
    label = `${momentName(current, checkCount)} — now`;
    value = late ? `+${clock(lateSec)}` : clock(countdownSec);
  } else if (isOneShot(node)) {
    label = readyInSec > 0 ? "Ready in" : "";
    value = readyInSec > 0 ? clock(readyInSec) : "Ready";
  } else if (next) {
    label = `${momentName(next, checkCount)} in`;
    value = clock(state.nextInSec);
  } else if (phase === "initial" && current) {
    label = "Starting";
    value = clock(countdownSec);
  }
  return (
    <div
      className={`lc-cooking-row is-${player} ${due ? "is-due" : ""}`}
      key={due ? `${phase}-${current?.index}` : "running"}
      title="reserved: tap → agent says the next moment"
    >
      <div className="lc-cooking-row-title">
        <span className="lc-cooking-row-label">{node.label}</span>
        <TendingChip node={node} />
      </div>
      <MomentAxis state={state} player={player} />
      <div className="lc-cooking-row-next">
        {label && <span className="lc-cooking-row-next-label">{label}</span>}
        <Mono className="lc-cooking-row-next-value">{value}</Mono>
      </div>
      {showDone && (
        <button type="button" className="btn btn-ghost lc-btn-accent lc-cooking-row-done" disabled={paused} onClick={onDone}>
          Done
        </button>
      )}
    </div>
  );
}

function Leaderboard({ board, cooks }) {
  const top = Math.max(1, ...board.map((b) => b.points));
  const tied = board.length > 1 && board[0].points === board[1].points;
  return (
    <div className="lc-leaderboard" aria-label="Leaderboard">
      {board.map((entry, rank) => {
        const i = cooks.findIndex((c) => c.id === entry.cookId);
        return (
          <div className={`lc-leader-row is-${playerKey(i)}`} key={entry.cookId}>
            <PlayerAvatar cook={cooks[i]} index={i} size={32} />
            <span className="lc-leader-name">
              {entry.name}
              {rank === 0 && !tied && entry.points > 0 && <KpIcon glyph="trophy" size={16} className="lc-leader-trophy" />}
            </span>
            <span className="lc-leader-bar" aria-hidden="true">
              <span className="lc-leader-fill" style={{ width: `${(entry.points / top) * 100}%` }} />
            </span>
            <Mono className="lc-leader-points lc-roll" key={`${entry.cookId}-${entry.points}`}>
              {entry.points}
            </Mono>
          </div>
        );
      })}
    </div>
  );
}

function TaskPoolBoard({ ready, blocked, run, byId, cooks, now, paused, onClaim }) {
  const taken = Object.entries(run.steps).filter(([, r]) => r.status === "active");
  return (
    <section className="lc-pool" aria-label="Up for grabs">
      <header className="lc-pool-head">
        <h2>Up for grabs</h2>
        <Mono className="lc-meta is-tertiary">
          {ready.length} ready · {blocked.length} not yet
        </Mono>
      </header>
      <div className="lc-pool-grid">
        {/* One button per player rather than a single "Claim" that scores
            for whoever the speaker toggle happened to be left on. On a
            screen two people share, a tap has to say who tapped. */}
        {ready.map((id) => {
          const tNode = byId[id];
          // What a claim actually costs: an unattended step is mostly
          // waiting, so the tile says its hands-on total, not its span.
          const handsOnSec = isAttended(tNode) ? null : unattendedEvents(tNode, 0).reduce((sum, m) => sum + (m.endSec - m.atSec), 0);
          return (
          <div key={id} className="lc-tile is-claimable">
            <span className="lc-tile-title">
              <span className="lc-tile-label">{tNode.label}</span>
              <TendingChip node={tNode} />
            </span>
            <Mono className="lc-tile-meta">
              {handsOnSec != null ? (
                <>
                  <span className="lc-tile-meta-strong">{clock(handsOnSec)}</span> hands-on of {clock(tNode.estimated_duration_sec)}
                </>
              ) : (
                clock(tNode.estimated_duration_sec)
              )}{" "}
              · +{DIFFICULTY_POINTS[tNode.difficulty]}
            </Mono>
            <div className="lc-tile-claims">
              {cooks.map((cook, i) => {
                const busy = Boolean(activeStepFor(cook.id, run, byId, now));
                return (
                  <button
                    key={cook.id}
                    type="button"
                    className={`btn lc-claim is-${playerKey(i)}`}
                    onClick={() => onClaim(id, cook.id)}
                    disabled={paused || busy}
                    title={busy ? `${cook.name} is still on something` : undefined}
                    aria-label={`${cook.name} takes ${tNode.label}`}
                  >
                    {cook.name}
                  </button>
                );
              })}
            </div>
          </div>
          );
        })}
        {taken.map(([id, record]) => {
          const i = cooks.findIndex((c) => c.id === record.cookId);
          const tNode = byId[id];
          // An unattended step's tile says its next moment, never a plain
          // running time — the same right-column copy as the card's row.
          const ms = tNode && !isAttended(tNode) ? momentState(tNode, record, now) : null;
          let moment = null;
          if (ms) {
            if (ms.current?.kind === "initial") moment = "Starting";
            else if (ms.current && hasDeadline(tNode)) moment = `${momentName(ms.current, ms.checkCount)} — now`;
            else if (ms.next) moment = `${momentName(ms.next, ms.checkCount)} in ${clock(ms.nextInSec)}`;
            else if (isOneShot(tNode)) moment = ms.readyInSec > 0 ? `Ready in ${clock(ms.readyInSec)}` : "Ready";
          }
          return (
            <div key={id} className={`lc-tile is-taken is-${playerKey(i)}`}>
              <span className="lc-tile-title">
                <span className="lc-tile-label">{tNode?.label}</span>
                <TendingChip node={tNode} />
              </span>
              <span className="lc-tile-holder">
                <PlayerAvatar cook={cooks[i]} index={i} size={20} />
                {cooks[i]?.name}
                {moment ? <Mono className={ms.current ? "is-due" : ""}>{moment}</Mono> : <Mono>{clock(stepVariance(tNode, record, now).actualSec)}</Mono>}
              </span>
            </div>
          );
        })}
        {blocked.map((id) => {
          const waiting = (byId[id].depends_on || []).filter((d) => byId[d] && !["done", "skipped"].includes(run.steps[d]?.status));
          return (
            <div key={id} className="lc-tile is-blocked">
              <span className="lc-tile-label">{byId[id].label}</span>
              <Mono className="lc-tile-meta">needs {waiting.map((d) => byId[d]?.label).join(", ")}</Mono>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// The agent column: who's talking, what's been said, and the typed
// fallback that drives the demo today. The mic itself is the shell's
// VoiceBar; this panel is the record of the conversation.
function AgentPanel({
  cooks,
  transcript,
  speaker,
  onSpeaker,
  pending,
  pendingConfirm,
  byId,
  onPick,
  onCancel,
  onConfirmYes,
  onConfirmNo,
  input,
  onInput,
  onSubmit,
}) {
  const logRef = useRef(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [transcript.length, pending, pendingConfirm, expanded]);

  const speakerCook = cooks.find((c) => c.id === speaker);

  return (
    <aside className={`lc-agent ${expanded ? "is-expanded" : ""}`} aria-label="The agent">
      <header className="lc-agent-head">
        <span className="lc-agent-eyebrow">The agent</span>
        <span className="lc-agent-tag">AI</span>
      </header>

      <div className="lc-log" ref={logRef} role="log" aria-live="polite">
        {transcript.map((entry) => {
          const i = cooks.findIndex((c) => c.id === entry.speaker);
          const isAgent = entry.speaker === "agent";
          return (
            <div key={entry.id} className={`lc-line ${isAgent ? "is-agent" : "is-player"}`}>
              {isAgent ? <AgentAvatar size={20} /> : <PlayerAvatar cook={cooks[i]} index={Math.max(0, i)} size={20} />}
              <span className="lc-line-text">{isAgent ? entry.text : `“${entry.text}”`}</span>
            </div>
          );
        })}
        {pendingConfirm && (
          <div className="lc-pending">
            <button type="button" className="btn lc-pending-option" onClick={onConfirmYes}>
              Yes, {byId[pendingConfirm.stepId]?.label}
            </button>
            <button type="button" className="btn btn-ghost lc-btn-accent" onClick={onConfirmNo}>
              No, someone else
            </button>
          </div>
        )}
        {pending && (
          <div className="lc-pending">
            {pending.options.map((id) => (
              <button key={id} type="button" className="btn lc-pending-option" onClick={() => onPick(id)}>
                {byId[id]?.label}
              </button>
            ))}
            <button type="button" className="btn btn-ghost lc-btn-accent" onClick={onCancel}>
              Cancel
            </button>
          </div>
        )}
      </div>
      <button type="button" className="btn btn-ghost lc-agent-more" onClick={() => setExpanded((v) => !v)}>
        {expanded ? "Less" : "More"}
      </button>

      {/* Temporary until voice ID lands: the backend can't tell voices
          apart, so whoever is selected here owns everything said. */}
      <div className="lc-speaker" role="radiogroup" aria-label="Who is speaking">
        {cooks.map((cook, i) => (
          <button
            key={cook.id}
            type="button"
            role="radio"
            aria-checked={speaker === cook.id}
            className={`lc-speaker-seg is-${playerKey(i)} ${speaker === cook.id ? "is-selected" : ""}`}
            onClick={() => onSpeaker(cook.id)}
          >
            <PlayerAvatar cook={cook} index={i} size={24} />
            <span>{cook.name}</span>
          </button>
        ))}
      </div>

      <form
        className="lc-say"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <input
          type="text"
          className="lc-say-input"
          value={input}
          onChange={(e) => onInput(e.target.value)}
          placeholder="Type it instead…"
          aria-label={`Say something as ${speakerCook?.name || "a player"}`}
        />
        <button type="submit" className="btn" disabled={!input.trim()}>
          Say it
        </button>
      </form>
    </aside>
  );
}

function ServiceDone({ outcome, cooks, isVersus, onExit, saving, saveError }) {
  const winners = outcome.winnerCookIds.map((id) => cooks.find((c) => c.id === id)?.name).filter(Boolean);
  return (
    <div className="lc-service">
      <div className="lc-service-main">
        <span className="lc-agent-eyebrow">Service done</span>
        <Mono className="lc-service-clock">{clock(outcome.totalSec)}</Mono>
        <span className="lc-meta">
          on the clock
          {outcome.estimatedSec != null && (
            <>
              {" "}· planned <Mono>{clock(outcome.estimatedSec)}</Mono>
            </>
          )}
        </span>

        <div className="lc-service-scores">
          {outcome.scoreboard.map((entry) => {
            const i = cooks.findIndex((c) => c.id === entry.cookId);
            return (
              <div className={`lc-score-tile is-${playerKey(i)}`} key={entry.cookId}>
                <PlayerAvatar cook={cooks[i]} index={i} size={40} />
                <span className="lc-score-body">
                  <span className="lc-score-name">{entry.name}</span>
                  <span className="lc-meta">
                    {entry.doneCount} done · {entry.skippedCount} skipped
                  </span>
                </span>
                {isVersus && <Mono className="lc-score-points">{entry.points}</Mono>}
              </div>
            );
          })}
        </div>

        {isVersus && winners.length > 0 && (
          <p className="lc-service-winner">
            {winners.length > 1 ? `Tied — ${winners.join(" and ")}, ${outcome.scoreboard[0].points} each` : `${winners[0]} wins it`}
          </p>
        )}

        <button type="button" className="btn btn-primary btn-lg lc-service-cta" onClick={onExit} disabled={saving}>
          {saving ? "Saving…" : saveError ? "Try again" : "See the cook card →"}
        </button>
        {saveError && (
          <p className="lc-service-error" role="alert">
            {saveError} Nothing is lost — try again.
          </p>
        )}
      </div>

      <div className="lc-service-steps">
        <header className="lc-pool-head">
          <span className="lc-agent-eyebrow">Every step</span>
          <Mono className="lc-meta is-tertiary">
            {outcome.doneCount} done · {outcome.skippedCount} skipped
          </Mono>
        </header>
        <ul className="lc-step-list">
          {outcome.perStep.map((s) => (
            <li key={s.id} className={`lc-step-row ${s.status === "skipped" ? "is-skipped" : ""} ${s.deltaSec > 0 ? "is-over" : ""}`}>
              <span className="lc-step-row-label">{s.label}</span>
              <Mono className="lc-step-row-meta">
                {s.status === "skipped"
                  ? "skipped"
                  : `est ${clock(s.estSec)} · actual ${clock(s.actualSec)}${s.deltaSec > 0 ? ` · ${clock(s.deltaSec)} over` : ""}`}
              </Mono>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
