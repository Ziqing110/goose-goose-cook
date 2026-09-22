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
// The game layer (design: "Live Cook v4 — game layer"): the background
// is the scoreboard, panels are game pieces (ink border, 4px extrusion,
// one bottom-right chamfer), every card state has its own silhouette,
// and the geese carry the state. Text still sits on white; the colour
// goes around the panels, never under body copy. At most three things
// loop at once. Shared chrome (topbar, SessionProgress, VoiceBar, the
// system buttons) keeps its site-wide look — only this page's own
// pieces get the treatment.
//
// Sub-components live in this file rather than their own (same pattern
// as Schedule) since none of them is used elsewhere.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { registerVoiceDictation } from "../utils/voicePageCommands.js";
import { buildAgentSnapshot } from "../utils/agentSnapshot.js";
import { agentTurn } from "../api/agent.js";
import { AGENT_NAME, speak } from "../voice/agentVoice.js";
import { audioTap } from "../voice/audioTap.js";
import { identifySpeaker } from "../api/speaker.js";
import { decideSpeaker } from "../utils/speakerMatch.js";
import { buildSummary } from "../utils/summaryCard.js";
import { chefAvatar } from "../utils/cooks.js";
import KpIcon from "../components/KpIcon.jsx";
import Modal from "../components/Modal.jsx";
import BabyGoose from "../components/BabyGoose.jsx";
import "./LiveCookPage.css";

// Player colors come from the index in cooks[] — player 1 is "a",
// player 2 is "b" — never stored, never chosen (design-v4.css tokens).
const PLAYER_KEYS = ["a", "b"];
const playerKey = (index) => PLAYER_KEYS[index % PLAYER_KEYS.length];

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

// How long after the agent speaks that an answer needs no name, and the
// word confidence below which a spoken turn is not acted on. From the
// R-core recordings, mishearings bottomed out near 0.2-0.4 and clean
// short commands sat above 0.9.
const ENGAGED_MS = 10_000;
const MIN_VOICE_CONFIDENCE = 0.4;

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

// The goose posture sheet, one per card state (design §05), from the
// approved baby-goose set (assets/baby-goose-final/animated). The
// drawn goose is never recoloured; the player's colour stays on the
// avatar, rail and chip.
const GOOSE = {
  active: "g1-on-it",
  assigned: "g2-up-next",
  waiting: "g3-waiting",
  idle_fill: "g4-free-hands",
  finished: "g5-done-for-the-night",
  grabs: "g6-eyeing-the-offer",
  due: "g7-due-honk",
  victory: "g9-victory",
  defeat: "g14-defeat-good-game",
  onTheMove: "g10-walking",
  handoff: "g11-handoff",
  behind: "g12-behind-plan",
  toque: "g8-toque-neutral",
  listening: "g13-listening",
  toqueLeft: "g8x-toque-speaking-left",
  toqueRight: "g8y-toque-calling-right",
};

// The strip's one sentence about the score: "Mia leads by 20", or
// "Level — 45 each". Nothing else on the page duplicates it.
function leadLine(board, cooks) {
  const pts = (i) => board.find((b) => b.cookId === cooks[i]?.id)?.points ?? 0;
  const a = pts(0);
  const b = pts(1);
  if (a === b) return `Level — ${a} each`;
  const lead = a > b ? 0 : 1;
  return `${cooks[lead]?.name || "Someone"} leads by ${Math.abs(a - b)}`;
}

// The goose reacting at the card's bottom-right corner, under the text
// (z-index below the content, above the panel fill). The card's action
// block leaves room for it. `motion` is the wrapper's loop — bob,
// honk, or none — layered on the sprite's own frame cycle.
function CardGoose({ pose, size = 128, paused, motion = "bob" }) {
  return (
    <span className={`lc-goose is-${motion}`} aria-hidden="true">
      <BabyGoose pose={pose} size={size} paused={paused} decorative />
    </span>
  );
}

// The field: the whole viewport, under every panel. Versus splits it
// exactly down the middle along a skewed seam — one half each, both
// players get the same room; the score lives on the cards, not in the
// ground. Co-op is one warm ground that steps deeper at 50 % and 100 %
// progress; behind plan adds a warning vignette at the edges only.
// Fixed so the shell's chrome floats on it too.
function Field({ isVersus, progress, paused }) {
  if (isVersus) {
    return (
      <div className={`lc-field is-versus ${paused ? "is-paused" : ""}`} aria-hidden="true">
        <div className="lc-seam" />
      </div>
    );
  }
  const ratio = progress.total > 0 ? progress.done / progress.total : 0;
  const step = ratio >= 1 ? 100 : ratio >= 0.5 ? 50 : 0;
  const behind = progress.driftSec > 30;
  return <div className={`lc-field is-coop is-warm-${step} ${behind ? "is-behind" : ""}`} aria-hidden="true" />;
}

// The score moment (design §07): "+20" rises out of the card toward the
// player's score — the 44px counter in the card's head on desktop, the
// strip's pill on mobile; whichever is on screen — 600 ms on the
// spring, then the counter rolls. Positions are measured once on mount
// from the elements the page hands over — the flight is a transform,
// so nothing reflows.
function ScoreFly({ fly, fromEl, toEls, onDone }) {
  const ref = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const toEl = toEls.find((el) => el && el.getClientRects().length > 0) || null;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !fromEl || !toEl) return undefined;
    // Leaves from the card's title, lands on the middle of the counter.
    const from = fromEl.getBoundingClientRect();
    const to = toEl.getBoundingClientRect();
    const fx = from.left + 28;
    const fy = from.top + 72;
    el.style.setProperty("--fx", `${fx}px`);
    el.style.setProperty("--fy", `${fy}px`);
    el.style.setProperty("--dx", `${to.left + to.width / 2 - fx}px`);
    el.style.setProperty("--dy", `${to.top + to.height / 2 - fy}px`);
    // Outlives the flight so the counter's pop (600 ms in) can finish.
    const t = setTimeout(() => doneRef.current(), 1000);
    return () => clearTimeout(t);
  }, [fly, fromEl, toEl]);
  if (!fromEl || !toEl) return null;
  return (
    <span ref={ref} className={`mono lc-fly is-${fly.player}`} aria-hidden="true">
      +{fly.pts}
    </span>
  );
}

// The chef bird the player picked on the Cooks page, ringed in their
// player color; the initial is the fallback for a cook who predates
// avatars. Same identity system either way — the color is the key.
function PlayerAvatar({ cook, index, size = 32 }) {
  const chef = cook?.avatar ? chefAvatar(cook.avatar) : null;
  return (
    <span
      className={`lc-avatar is-${playerKey(index)} lc-avatar-${size} ${chef ? "has-chef" : ""}`}
      style={chef ? { backgroundColor: chef.bg, backgroundImage: `url(${chef.src})` } : undefined}
      aria-hidden="true"
    >
      {!chef && (cook?.name?.[0]?.toUpperCase() || "?")}
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
  // The score moment in flight: which card it left, how many points,
  // and a key so two quick Dones each get their own "+20".
  const [fly, setFly] = useState(null);
  const cardRefs = useRef([]);
  const pillRefs = useRef([]);
  const cardScoreRefs = useRef([]);
  // Versus: Toque is one line under the board; the whole run reads
  // back in a drawer. Opens itself when the agent needs an answer.
  const [logOpen, setLogOpen] = useState(false);
  // "Pass to X": the receiving card's goose takes the handoff (G11)
  // for a beat before settling in at the pot.
  const [handoff, setHandoff] = useState(null); // cookId
  useEffect(() => {
    if (!handoff) return undefined;
    const t = setTimeout(() => setHandoff(null), HANDOFF_MS);
    return () => clearTimeout(t);
  }, [handoff]);
  // A refused claim answers on the tile (or the card's offer) that was
  // tapped, not only in Toque's line — on a 1280×800 counter screen
  // that line is below the fold, and a tap with no visible answer reads
  // as a dead button.
  const [claimNote, setClaimNote] = useState(null); // { stepId, cookId, text, key }
  useEffect(() => {
    if (!claimNote) return undefined;
    const t = setTimeout(() => setClaimNote(null), CLAIM_NOTE_MS);
    return () => clearTimeout(t);
  }, [claimNote]);
  const listening = !state.voice.muted;

  // The shared VoiceBar only carries the hint; who is speaking is the
  // agent column's business (see the speaker toggle there).
  useEffect(() => {
    if (!run) return undefined;
    const hint = finished
      ? { line: "Service done — see the cook card when you're ready.", sub: null }
      : paused
        ? { line: "Paused — say “resume” to pick it back up.", sub: "Every clock is stopped; nothing else lands until then." }
        : {
            line: `Say “${AGENT_NAME}” first — “${AGENT_NAME}, I'm done with the onion.”`,
            sub: pendingConfirm
              ? `${speakerCook?.name || "Someone"} is speaking — waiting on “yes” or “no”.`
              : pending
                ? `${speakerCook?.name || "Someone"} is speaking — waiting on which step they mean.`
                : `${speakerCook?.name || "Someone"} is speaking — everything said is logged under that name.`,
          };
    dispatch({ type: "voice/setHint", payload: { hint } });
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [dispatch, run, finished, paused, speakerCook?.name, pending, pendingConfirm]);

  // The microphone. VoiceBar owns the one connection; this page asks for
  // every turn (takeover) plus the words it would otherwise mishear: the
  // agent's name, the cooks', and every step on the board.
  const keyterms = useMemo(
    () =>
      [AGENT_NAME, ...cooks.map((c) => c.name), ...nodes.map((n) => n.label)]
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

  const commit = (nextRun) => {
    latestRunRef.current = nextRun;
    saveRunNow(nextRun);
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
    if (verdict.code === "no_equipment") return `No ${EQUIPMENT_LABELS[verdict.equipmentType] || verdict.equipmentType} free`;
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
    if (paused) {
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

  // Co-op keeps no score — the honest answer is the progress.
  const scoreLine = () =>
    isVersus
      ? board.map((b) => `${b.name} ${b.points}`).join(", ") + `. ${progress.pending} left.`
      : `No score in co-op. ${progress.done} of ${progress.total} done, ${progress.pending} left.`;
  const statusLine = (base) => {
    const lines = cooks.map((c) => {
      const active = activeStepFor(c.id, base, nodes, now);
      if (active) return `${c.name}: ${byId[active].label}, ${clock(stepVariance(byId[active], base.steps[active], now).actualSec)} in`;
      return `${c.name}: free`;
    });
    return `${lines.join(". ")}. ${progress.done} of ${progress.total} done.`;
  };

  // --- voice, through the agent: the model reads the words, this applies them ---
  //
  // The model only proposes. Each call goes through the same handler a tap
  // uses, on the newest run, so every rule (busy, not ready, equipment,
  // paused) is still enforced by the code that owns it.
  const PAUSED_OK = new Set(["resume", "status", "score", "help"]);
  const applyAgentTurn = (turn, text, cookId) => {
    const at = () => new Date().toISOString();
    commit(appendTranscript(latestRunRef.current, { at: at(), speaker: cookId, text }));
    const spoken = [];

    turn.calls.forEach((call) => {
      const cur = latestRunRef.current;
      const nowPaused = isPaused(cur);
      if (nowPaused && !PAUSED_OK.has(call.name)) {
        commit(say(cur, "We're paused — say \"resume\" when you're ready."));
        return;
      }
      // done, skip and drop without a name mean "the one I'm on".
      const own = ["done", "skip", "drop"].includes(call.name) ? activeStepFor(cookId, cur, nodes) : null;
      const stepId = call.stepId ?? own;
      if (["done", "skip", "drop"].includes(call.name) && !stepId) {
        // Holding nothing and not naming anything: ask which one, with the
        // same tappable options the keyword path offers, instead of just
        // saying no. The pending state is what draws those buttons.
        const question = {
          done: "Which one did you finish?",
          skip: "Which one should I skip?",
          drop: "Which one are you putting back?",
        }[call.name];
        setPending({ intent: call.name, options: claimSuggestions({ nodes, run: cur, cookId }).slice(0, 3), cookId });
        commit(say(cur, question));
        spoken.push(question);
        return;
      }
      switch (call.name) {
        case "claim": return doClaim(stepId, cookId, "voice", cur);
        case "start": return doStart(stepId, cookId, "voice", cur);
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
        case "score": {
          const line = scoreLine();
          spoken.push(line);
          return commit(say(cur, line));
        }
        case "help": return commit(say(cur, HELP_TEXT));
        default: return undefined;
      }
    });

    // Talk that was not addressed by name, only let through because the
    // agent had just asked something, gets a reply only if it turned into
    // an action. Otherwise the room's chatter, or the other cook talking
    // to someone, would be answered out loud, and each answer would open
    // the window for the next.
    const chatter = !turn.named && !turn.calls.length;
    if (turn.reply && !chatter) {
      spoken.unshift(turn.reply);
      commit(say(latestRunRef.current, turn.reply));
    } else if (turn.reply) {
      console.info("[voice] not answering unaddressed talk:", text, "->", turn.reply);
    }
    if (spoken.length) speak(spoken.join(" "));
    // Only a question leaves the door open for an unnamed answer, and only
    // briefly. Statements and refusals don't.
    if (turn.reply && !chatter && /\?\s*$/.test(turn.reply)) engagedUntilRef.current = Date.now() + ENGAGED_MS;
  };

  // Who was that? Asks the local speaker service, which compares the turn's
  // audio with each cook's enrolled voice. Returns a cook id only when the
  // match is clear, otherwise null and the speaker toggle stands: a wrong
  // credit is worse than no answer. Never throws; the service being off is
  // an ordinary state.
  const whoSpoke = async (clip) => {
    if (!clip || cooks.length < 2) return null;
    try {
      const result = await identifySpeaker({ pcm: clip.pcm, rate: clip.rate, candidates: cooks.map((c) => c.id) });
      const verdict = decideSpeaker(result);
      const named = Object.fromEntries(Object.entries(result.scores || {}).map(([id, v]) => [name(id), v]));
      console.info(`[speaker] ${verdict.cookId ? name(verdict.cookId) : "unsure"} (${verdict.reason})`, named, `margin ${result.margin}`);
      return verdict.cookId;
    } catch (err) {
      console.info("[speaker] unavailable, using the speaker toggle:", err.message);
      return null;
    }
  };

  const askAgent = (text, cookId, { engaged = true, clip = null } = {}) => {
    agentQueueRef.current = agentQueueRef.current.then(async () => {
      const heardAs = await whoSpoke(clip);
      if (heardAs && heardAs !== cookId) {
        cookId = heardAs;
        setSpeakerId(heardAs); // so the toggle shows who was heard
      }
      let turn;
      try {
        turn = await agentTurn({
          text,
          agentName: AGENT_NAME,
          // Typed text is aimed at the agent by definition. Spoken words
          // must say its name (checked on the server) unless it just
          // asked a question.
          engaged,
          snapshot: buildAgentSnapshot({ run: latestRunRef.current, nodes, cooks, speakerId: cookId, paused: isPaused(latestRunRef.current) }),
        });
      } catch (err) {
        // Slow, down or unreachable: the keyword grammar still works.
        console.warn("Agent unavailable, using the keyword grammar:", err.message);
        submitKeywordUtterance(text);
        return;
      }
      if (!turn.addressed) {
        // Shows what the recogniser heard instead of the name, which is
        // how a chronically misheard agent name gets caught.
        console.info("[voice] not addressed:", text);
        return;
      }
      applyAgentTurn(turn, text, cookId);
    });
  };

  // An open question ("did you mean…?") is answered by the keyword path,
  // which owns that state; everything else goes to the agent.
  const submitUtterance = (text) => {
    if (!text) return;
    if (pendingConfirm) return submitKeywordUtterance(text);
    askAgent(text, speaker);
  };

  // What the microphone hears. The name check happens on the server, so
  // ordinary kitchen talk never reaches a model. Attribution is still the
  // speaker toggle until speaker identification exists.
  voiceHandlerRef.current = (text, turn) => {
    const confidence = (turn?.words || []).reduce((lowest, w) => Math.min(lowest, w.confidence ?? 1), 1);
    if (confidence < MIN_VOICE_CONFIDENCE) {
      console.info("[voice] too unclear to act on:", text);
      return;
    }
    if (pendingConfirm) return submitKeywordUtterance(text);
    // This turn's audio, cut out by its word timestamps with a little
    // room either side, for the speaker check.
    const words = turn?.words || [];
    const clip = words.length ? audioTap.sliceStream(words[0].start - 150, words[words.length - 1].end + 150) : null;
    // One unnamed answer per question: the window closes once used.
    const engaged = Date.now() < engagedUntilRef.current;
    if (engaged) engagedUntilRef.current = 0;
    askAgent(text, speaker, { engaged, clip });
  };

  const submitKeywordUtterance = (text) => {
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
        return commit(say(heard, scoreLine()));
      case "status":
        return commit(say(heard, statusLine(run)));
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
    <section className={`page live-cook-page ${isVersus ? "is-versus" : "is-coop"} ${paused ? "is-paused" : ""} ${finished ? "is-finished" : ""}`}>
      {!finished && <Field isVersus={isVersus} progress={progress} paused={paused} />}

      <header className="lc-header">
        <div className="lc-title">
          <KpIcon glyph="fork-branch" size={18} className="lc-title-glyph" />
          <h1>{approved?.title || "Untitled cook"}</h1>
          <span className="lc-mode-chip">
            <KpIcon glyph={isVersus ? "trophy" : "fork-branch"} size={14} />
            {isVersus ? "Versus" : "Co-op"}
          </span>
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

      {/* The strip: the run clock and the score, dark so the numbers
          read from across the kitchen. In Versus the two score pills are
          where "+20" lands. */}
      {!finished && (
        <div className="lc-strip lc-piece is-dark" role="group" aria-label="Run clock">
          <span className="lc-clock">
            <KpIcon glyph="timer" size={22} />
            <Mono className="lc-clock-value">{clock(progress.elapsedSec)}</Mono>
          </span>
          {isVersus ? (
            <Mono className="lc-count">
              {progress.done} / {progress.total}
            </Mono>
          ) : (
            <span className="lc-count-pill">
              <Mono className="lc-count-big">{progress.done}</Mono>
              <Mono className="lc-count-of">/ {progress.total} done</Mono>
            </span>
          )}
          {progress.driftSec > 30 && <Mono className="lc-drift">{clock(progress.driftSec)} behind plan</Mono>}
          <span className="lc-strip-spacer" />
          {isVersus ? (
            <>
              {/* One plain sentence — "Mia leads by 20" — with the goose on
                  the move beside it. Each score lives on its own card. */}
              <span className="lc-lead">
                <BabyGoose pose={GOOSE.onTheMove} size={40} paused={paused} className="lc-lead-goose" decorative />
                <span className="lc-lead-line">{leadLine(board, cooks)}</span>
              </span>
              {/* Mobile only: the cards stack, so the scores come back up here. */}
              <span className="lc-strip-scores">
                {cooks.map((cook, i) => {
                  const pts = board.find((b) => b.cookId === cook.id)?.points ?? 0;
                  return (
                    <span key={cook.id} className={`lc-score-pill is-${playerKey(i)}`} ref={(el) => (pillRefs.current[i] = el)}>
                      <span className="lc-score-dot" />
                      <Mono className={`lc-score-num ${fly?.index === i ? "is-landing" : "lc-roll"}`} key={`${cook.id}-${pts}`}>
                        {pts}
                      </Mono>
                    </span>
                  );
                })}
              </span>
            </>
          ) : (
            <span className="lc-strip-note">
              {progress.driftSec > 30 ? (
                <>
                  <BabyGoose pose={GOOSE.behind} size={40} paused={paused} className="lc-lead-goose" decorative />
                  Running behind
                </>
              ) : (
                "On plan"
              )}
            </span>
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
              half each, then (Versus) the board of what's up for grabs,
              then Toque as a single line that opens the drawer. */}
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
                  claimBlock={claimBlock}
                  claimNote={claimNote}
                  onClaim={(stepId, cookId) => doClaim(stepId, cookId)}
                />
              )}

              <ToqueLine cooks={cooks} transcript={run.transcript} paused={paused} listening={listening} onOpen={() => setLogOpen(true)} />
            </div>
          </div>

          <ToqueDrawer open={logOpen || Boolean(pending || pendingConfirm)} onClose={() => setLogOpen(false)}>
            <AgentPanel
              onClose={() => setLogOpen(false)}
              cooks={cooks}
              transcript={run.transcript}
              speaker={speaker}
              onSpeaker={setSpeakerId}
              pending={pending}
              pendingConfirm={pendingConfirm}
              byId={byId}
              paused={paused}
              listening={listening}
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
            </ToqueDrawer>

          <footer className={`lc-footer ${complete ? "is-final lc-piece is-dark" : ""}`}>
            {complete ? (
              <>
                <Mono className="lc-footer-meta">
                  {progress.done} done · {progress.skipped} skipped
                </Mono>
                <button type="button" className="btn btn-primary btn-lg lc-btn-piece" onClick={() => doFinish()}>
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

function PlayerFocusCard({ cardRef, scoreRef, cook, index, cooks, run, nodes, byId, now, isVersus, paused, assignment, points, landing, handoff, claimNote, claimBlock, onStart, onDone, onSkip, onDrop, onClaim, onPass, onUndo }) {
  const key = playerKey(index);
  const other = cooks.find((c) => c.id !== cook.id) || null;
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
  // and the card agree. The one exception is the Start moment: the cook
  // is standing at that pot getting it going, there is nothing to come
  // back to yet, and listing it would only make this card taller than
  // the other one. It joins the list the moment they walk away.
  const cooking = passiveStepsFor(cook.id, run, byId)
    .filter((id) => !(id === activeId && focusMoment?.phase === "initial"))
    .map((id) => ({ id, node: byId[id], state: momentState(byId[id], run.steps[id], now) }))
    .sort((a, b) => (a.state.nextInSec ?? -1) - (b.state.nextInSec ?? -1));

  // Versus has no plan: with nothing in hand the card offers the top
  // suggestion and points at the board for the rest. "Not now" moves
  // to the next one; once every suggestion has been waved off the
  // first comes round again — the board is still there for the rest.
  const [waved, setWaved] = useState(() => new Set());
  const suggestions = isVersus && !activeId ? claimSuggestions({ nodes, run, cookId: cook.id, limit: 6 }) : [];
  const suggestion = suggestions.find((id) => !waved.has(id)) ?? suggestions[0] ?? null;
  const notNow = () => {
    if (!suggestion) return;
    const next = new Set(waved).add(suggestion);
    setWaved(suggestions.every((id) => next.has(id)) ? new Set([suggestion]) : next);
  };
  const otherBusy = other ? Boolean(activeStepFor(other.id, run, byId, now)) : true;
  const reason = activeId ? "active" : isVersus ? (suggestion ? "grabs" : "finished") : assignment?.reason || "waiting";
  const offeredId = reason === "grabs" ? suggestion : reason === "assigned" || reason === "idle_fill" ? assignment?.stepId : null;
  const offered = offeredId ? byId[offeredId] : null;
  // Versus: the offer greys out for the same reasons a board tile would.
  const offerBlock = reason === "grabs" && offeredId && claimBlock ? claimBlock(offeredId, cook.id) : null;
  const undoable = !paused && canUndo({ run, nodes, cookId: cook.id, at: new Date(now).toISOString() });

  const waitingOn = assignment?.waitingOnStepId ? byId[assignment.waitingOnStepId] : null;
  const waitingCookIndex = assignment?.waitingOnCookId ? cooks.findIndex((c) => c.id === assignment.waitingOnCookId) : -1;

  // Due (G7): a check or the finish is open on something this cook
  // has going — the card's own focus or a pot in the list below. The
  // rail flashes amber, the card shakes once (the class change starts
  // it), the goose honks until it's handled.
  const isDue = (m, n) => Boolean(m?.current) && hasDeadline(n) && (m.phase === "checkpoint" || m.phase === "ending");
  const due = !paused && ((focusMoment && isDue(focusMoment, node)) || cooking.some((c) => isDue(c.state, c.node)));

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
  const eyebrowText = paused ? EYEBROW.paused : EYEBROW[reason];

  // The silhouette (design §04): rail + chamfer in the player colour for
  // On it, dashed inset for a dealt card, the tilted card-within-a-card
  // for an offer, cool grey for waiting, green top edge for done, amber
  // for due. Same skeleton every time — avatar, title, goose, one
  // number, one primary — so the eye lands in the same place.
  const silhouette = due ? "due" : reason;
  const goosePose = due ? GOOSE.due : handoff && reason === "active" ? GOOSE.handoff : GOOSE[reason] || GOOSE.waiting;
  const gooseMotion = due ? "honk" : reason === "waiting" || reason === "finished" ? "none" : "bob";
  // Ring fills to est, then turns amber (the "is-over" tint below).
  const heatPct = variance ? Math.min(100, variance.estSec > 0 ? (variance.actualSec / variance.estSec) * 100 : 100) : 0;

  const secondary = (
    <>
      {focusMoment && !inFinish && (
        // Mid-moment the banner holds the slot; Done here ends the step early.
        <button type="button" className="btn btn-ghost lc-btn-accent" disabled={paused} onClick={() => onDone(activeId)}>
          Done
        </button>
      )}
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
    <article
      ref={cardRef}
      className={`lc-card lc-piece is-${key} is-state-${silhouette} ${paused ? "is-paused" : ""}`}
      aria-label={`${cook.name} — ${eyebrowText}`}
    >
      {(reason === "active" || due) && <span className="lc-rail" aria-hidden="true" />}
      {reason === "idle_fill" && !due && <div className="lc-card-brow">Free hands?</div>}

      {/* Versus: the name with its state on a line under it and the
          score at 44 on the right — where "+20" lands. Co-op has no
          score, so the state is a chip on the right instead. */}
      <header className={`lc-card-head ${isVersus ? "is-scored" : ""}`}>
        <PlayerAvatar cook={cook} index={index} size={40} />
        {isVersus ? (
          <span className="lc-card-id">
            <span className="lc-card-name">{cook.name}</span>
            {/* The rail, the Done and the tilted offer already say "on
                it" / "free"; the line only appears when something is
                off the usual — paused, due, or done for the night. */}
            {(paused || due || reason === "finished") && (
              <span className={`lc-card-status ${eyebrowClass} ${due ? "is-due" : ""}`}>
                {reason === "finished" && <KpIcon glyph="checkmark-burst" size={14} />}
                {due && !paused ? (phaseLabel ? `${phaseLabel} — now` : "Due now") : eyebrowText}
              </span>
            )}
          </span>
        ) : (
          <>
            <span className="lc-card-name">{cook.name}</span>
            <span className={`lc-eyebrow ${eyebrowClass} ${due ? "is-due" : ""}`}>
              {reason === "finished" && <KpIcon glyph="checkmark-burst" size={14} />}
              {(reason === "active" || reason === "waiting") && !paused && <span className="lc-eyebrow-dot" />}
              {due && !phaseLabel ? "Due now" : eyebrowText}
            </span>
          </>
        )}
        {isVersus && (
          <span className="lc-card-score" ref={scoreRef}>
            <Mono className={`lc-card-points ${landing ? "is-landing" : "lc-roll"}`} key={points}>
              {points}
            </Mono>
            <Mono className="lc-card-pts">pts</Mono>
          </span>
        )}
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
            {/* The description is the instruction — the one thing on
                the card that says what to do with your hands. */}
            {node.description && <p className="lc-step-desc is-instruction">{node.description}</p>}
            {focusMoment?.current ? (
              // Mid-moment: the moment's own countdown sits in the action
              // slot below, and the whole step's clock is the pot row
              // under the card — nothing more here.
              focusMoment.current.kind === "initial" && isOneShot(node) && <p className="lc-meta">Then it runs on its own — nothing to come back for.</p>
            ) : (
              // Elapsed against est as one rail — the same drawing as
              // the pot rows below, so a hands-on step and a pot read
              // the same way. Past est the rail turns amber and the
              // right end says by how much. Difficulty and equipment
              // are not repeated: they mattered on the board tile when
              // this was chosen, not now.
              <div className={`lc-step-rail is-${key} ${variance.over ? "is-over" : ""}`}>
                <Mono className="lc-timer-value">{clock(variance.actualSec)}</Mono>
                <span className="lc-step-rail-track" aria-hidden="true">
                  <span className="lc-step-rail-fill" style={{ width: `${heatPct.toFixed(1)}%` }} />
                </span>
                <Mono className="lc-timer-est">{variance.over ? `${clock(variance.deltaSec)} over` : clock(variance.estSec)}</Mono>
                {isVersus && <Mono className="lc-chip is-points">+{DIFFICULTY_POINTS[node.difficulty]}</Mono>}
              </div>
            )}
          </>
        )}

        {offered && (
          // Dealt (Up next / Free hands): a dashed inset. The offer (Up for
          // grabs): a card within the card at −2°, with the points big.
          <div className={`lc-offer ${reason === "grabs" ? "is-tilted" : "is-dealt"}`}>
            <div className="lc-step-title-row">
              <h2 className="lc-step-title">{offered.label}</h2>
              <TendingChip node={offered} />
            </div>
            {offered.description && reason !== "grabs" && <p className="lc-step-desc">{offered.description}</p>}
            {/* What deciding takes: how long, what it needs, what it's
                worth. Difficulty is in the points already. */}
            <div className="lc-offer-meta">
              <Mono className="lc-offer-facts">
                {[clock(offered.estimated_duration_sec), ...(offered.required_equipment || []).map((e) => capitalize(EQUIPMENT_LABELS[e] || e))].join(" · ")}
              </Mono>
              {isVersus && <Mono className="lc-chip is-points is-big">+{DIFFICULTY_POINTS[offered.difficulty]}</Mono>}
            </div>
            {reason === "idle_fill" && <p className="lc-step-desc">Fits the gap.</p>}
            {claimNote?.stepId === offeredId && (
              <p key={claimNote.key} className="lc-claim-note" role="status">
                {claimNote.text}
              </p>
            )}
          </div>
        )}

        {reason === "waiting" && (
          // Same skeleton as On it — title, line, then the number in the
          // rail's slot — so the two cards' rows line up. The number is
          // said once, here, not again in the sentence.
          <>
            <div className="lc-step-title-row">
              <h2 className="lc-step-title is-quiet">Nothing to do yet</h2>
            </div>
            <p className="lc-step-desc lc-waiting-copy">
              {waitingOn ? (
                <>
                  Waiting on &ldquo;{waitingOn.label}&rdquo;
                  {waitingCookIndex >= 0 && (
                    <>
                      {" "}&mdash; {cooks[waitingCookIndex].name} has it
                      <PlayerAvatar cook={cooks[waitingCookIndex]} index={waitingCookIndex} size={20} />
                    </>
                  )}
                  .
                </>
              ) : (
                "Waiting on the other player."
              )}
            </p>
            {assignment?.etaSec != null && (
              <div className="lc-step-rail is-countdown">
                <Mono className="lc-timer-value">{clock(assignment.etaSec)}</Mono>
                <Mono className="lc-timer-est">left</Mono>
              </div>
            )}
          </>
        )}

        {reason === "finished" && (
          <>
            <span className="lc-done-chip lc-attend">
              <KpIcon glyph="checkmark-burst" size={16} />
              Done
            </span>
            <p className="lc-waiting-copy">{isVersus && !isRunComplete(run, nodes) ? "Nothing to grab right now." : "Nothing left for you."}</p>
          </>
        )}
      </div>

      {/* The goose lives in the action block's reserved right margin, so
          it stays beside the primary whether or not pots are listed
          below. */}
      <div className="lc-card-actions">
        <CardGoose pose={goosePose} paused={paused} motion={paused ? "none" : gooseMotion} />
        {node && (focusMoment && !inFinish ? (
          // Start / Check: the moment's instruction and countdown take
          // the primary's slot. The card must read "do the thing, then
          // walk away", not "press a button" — so the one thing at
          // button height is a clock, and Done is a ghost in the row.
          <>
            <MomentInstruction state={focusMoment} />
            <div className="lc-card-secondary">{secondary}</div>
          </>
        ) : (
          <>
            <button
              type="button"
              // Finish: the primary IS the Done, and the card pulses once
              // when the window opens.
              className={`btn lc-btn-xl lc-btn-piece lc-btn-done ${inFinish ? "lc-attend" : ""}`}
              key={inFinish ? "finish" : "done"}
              disabled={paused}
              onClick={() => onDone(activeId)}
            >
              {inFinish ? "Checked it" : "Done"}
            </button>
            <div className="lc-card-secondary">{secondary}</div>
          </>
        ))}
        {offered && (
          <button
            type="button"
            // The offer pulses once every 4 s — the only loop on this card.
            className={`btn btn-primary lc-btn-xl lc-btn-piece ${reason === "grabs" && !paused && !offerBlock ? "lc-offer-pulse" : ""}`}
            disabled={paused || Boolean(offerBlock)}
            title={offerBlock || undefined}
            onClick={() => (reason === "grabs" ? onClaim(offeredId) : onStart(offeredId))}
          >
            {reason === "assigned" ? "Start" : reason === "idle_fill" ? "Take this" : "Take it"}
          </button>
        )}
        {/* The secondary slot is always rendered so the primary above it
            sits at the same height on both cards. A player's last
            Done/Skip stays undoable for 60s even though their card has
            already moved on — the button follows them into this slot.
            The offer's own secondaries: wave it off, or hand it across. */}
        {!node && (
          <div className="lc-card-secondary">
            {reason === "grabs" && (
              <>
                <button type="button" className="btn btn-ghost lc-btn-accent" disabled={paused || suggestions.length < 2} onClick={notNow}>
                  Not now
                </button>
                {other && (
                  <button
                    type="button"
                    className="btn btn-ghost lc-btn-accent"
                    disabled={paused || otherBusy}
                    title={otherBusy ? `${other.name} is still on something` : undefined}
                    onClick={() => onPass(offeredId, other.id)}
                  >
                    Pass to {other.name}
                  </button>
                )}
              </>
            )}
            {undoable && (
              <button type="button" className="btn btn-ghost lc-btn-accent lc-btn-undo" onClick={onUndo}>
                Undo
              </button>
            )}
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

// The moment banner, in the action block's primary slot: what to do
// and this moment's countdown. The whole step's clock is the pot row
// under the card.
function MomentInstruction({ state }) {
  const { current, countdownSec } = state;
  const verb = current.kind === "initial" ? "Get it going" : current.kind === "checkpoint" ? "Check on it" : "Pull it off";
  return (
    <div className="lc-moment" role="timer">
      <span className="lc-moment-instruction">
        {verb} — {current.kind === "ending" ? "now." : <><Mono>{clock(current.endSec - current.atSec)}</Mono>.</>}
      </span>
      {current.kind !== "ending" && <Mono className="lc-moment-countdown">{clock(countdownSec)}</Mono>}
    </div>
  );
}

// One "cooking on its own" row: label + tending chip, the live axis,
// and the next moment. Quiet while running; the system's "needs you"
// treatment (warning tint, player-color rail, one pop) when a check or
// the finish is due. Not interactive yet — a tap that reads the next
// moment aloud is reserved for the voice pass.
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

// A claim reads as "Leo took it" for this long, then the tile settles
// into its running state.
const CLAIM_FLASH_MS = 4000;
// How long the receiving goose holds the handoff after "Pass to".
const HANDOFF_MS = 1600;
// How long a refused claim's answer stays on the tile it was tapped on.
const CLAIM_NOTE_MS = 3500;

// The board (design §01): a quiet piece — 1px rules on paper, no ink
// border or extrusion — so the two player cards are the first thing
// the eye lands on. Tiles are white on it; a claim presses the tile
// into the claimant's tint, then it settles to a rail in their colour.
function TaskPoolBoard({ ready, blocked, run, byId, cooks, now, paused, claimBlock, claimNote, onClaim }) {
  const taken = Object.entries(run.steps).filter(([, r]) => r.status === "active");
  return (
    <section className="lc-pool" aria-label="Up for grabs">
      <header className="lc-pool-head">
        <h2 className="lc-agent-eyebrow">Up for grabs</h2>
        <Mono className="lc-meta">
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
            {/* What the claim needs from the kitchen: a step's burner or
                board is what most often refuses a claim, so it's on the
                tile rather than discovered by tapping. */}
            {(tNode.required_equipment || []).length > 0 && (
              <div className="lc-chips lc-tile-chips">
                {tNode.required_equipment.map((e) => (
                  <EquipmentChip key={e} type={e} />
                ))}
              </div>
            )}
            {claimNote?.stepId === id && (
              <p key={claimNote.key} className="lc-claim-note" role="status">
                {claimNote.text}
              </p>
            )}
            <div className="lc-tile-claims">
              {cooks.map((cook, i) => {
                // Greyed for whatever would refuse it — hands full, or
                // the equipment it needs is on something else.
                const block = claimBlock(id, cook.id);
                return (
                  <button
                    key={cook.id}
                    type="button"
                    className={`btn lc-claim is-${playerKey(i)}`}
                    onClick={() => onClaim(id, cook.id)}
                    disabled={paused || Boolean(block)}
                    title={block || undefined}
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
          const fresh = record.startedAt && now - Date.parse(record.startedAt) < CLAIM_FLASH_MS;
          return (
            <div key={id} className={`lc-tile is-taken is-${playerKey(i)} ${fresh ? "is-fresh" : ""}`}>
              <span className="lc-tile-title">
                <span className="lc-tile-label">{tNode?.label}</span>
                {fresh ? <span className="lc-tile-took">{cooks[i]?.name} took it</span> : <TendingChip node={tNode} />}
              </span>
              {fresh ? (
                <Mono className="lc-tile-meta">
                  {clock(tNode.estimated_duration_sec)} · +{DIFFICULTY_POINTS[tNode.difficulty]}
                </Mono>
              ) : (
                <span className="lc-tile-holder">
                  <PlayerAvatar cook={cooks[i]} index={i} size={20} />
                  {cooks[i]?.name}
                  {moment ? <Mono className={ms.current ? "is-due" : ""}>{moment}</Mono> : <Mono>{clock(stepVariance(tNode, record, now).actualSec)}</Mono>}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {/* What's not ready yet is one line, not tiles: the board is for
          what can be taken. Each name carries what it's waiting on. */}
      {blocked.length > 0 && (
        <Mono className="lc-pool-notyet">
          <span className="lc-pool-notyet-label">Not yet:</span>{" "}
          {blocked.map((id, i) => {
            const waiting = (byId[id].depends_on || []).filter((d) => byId[d] && !["done", "skipped"].includes(run.steps[d]?.status));
            return (
              <span key={id} title={`needs ${waiting.map((d) => byId[d]?.label).join(", ")}`}>
                {i > 0 && " · "}
                {byId[id].label}
              </span>
            );
          })}
        </Mono>
      )}
    </section>
  );
}

// Versus: Toque is a single line — the newest utterance only — and a
// tap opens the drawer with the whole run read back. It never steals
// the field.
function ToqueLine({ cooks, transcript, paused, listening, onOpen }) {
  const last = transcript[transcript.length - 1];
  const isAgent = !last || last.speaker === "agent";
  const who = !isAgent ? cooks.find((c) => c.id === last.speaker)?.name : null;
  return (
    <button type="button" className="lc-toque-line" onClick={onOpen} aria-label="Open Toque's log" aria-haspopup="dialog">
      <BabyGoose pose={listening ? GOOSE.listening : GOOSE.toque} size={44} paused={paused} className="lc-toque" decorative />
      <span className="lc-agent-tag">Toque</span>
      <span key={last?.id || "none"} className={`lc-toque-line-text ${isAgent ? "is-agent" : ""}`}>
        {!last ? "Listening." : isAgent ? last.text : `${who ? `${who}: ` : ""}“${last.text}”`}
      </span>
      <span className="lc-toque-line-count">
        {plural(transcript.length, "line")}
        <span className="lc-toque-line-chevron" aria-hidden="true">
          ›
        </span>
      </span>
    </button>
  );
}

// The drawer: a scrim over the field and a 400px panel from the right
// (mobile: the whole width), springing in. Escape or the scrim closes
// it; a pending question keeps it open until it's answered.
function ToqueDrawer({ open, onClose, children }) {
  const panelRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    // aria-modal promises the focus stays in here; Tab has to be told.
    const focusables = () =>
      [...(panelRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])') || [])];
    const previous = document.activeElement;
    focusables()[0]?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab") return undefined;
      const items = focusables();
      if (!items.length) return undefined;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panelRef.current.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !panelRef.current.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
      return undefined;
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="lc-drawer" role="dialog" aria-modal="true" aria-label="Toque, everything said this run">
      <div className="lc-drawer-scrim" onClick={onClose} />
      <div className="lc-drawer-panel" ref={panelRef}>
        {children}
      </div>
    </div>
  );
}

// The agent panel, filling the drawer: who's talking, what's been said,
// and the typed fallback that drives the demo today. The mic itself is
// the shell's VoiceBar; this panel is the record of the conversation.
function AgentPanel({
  onClose,
  cooks,
  transcript,
  speaker,
  onSpeaker,
  pending,
  pendingConfirm,
  byId,
  paused,
  listening,
  onPick,
  onCancel,
  onConfirmYes,
  onConfirmNo,
  input,
  onInput,
  onSubmit,
}) {
  const logRef = useRef(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [transcript.length, pending, pendingConfirm]);

  const speakerCook = cooks.find((c) => c.id === speaker);

  // Toque: neutral (G8) with the mic off, listening (G13) with it on.
  // When a new line addresses a player by name the neck extends toward
  // their card (left for player 1, right for player 2) and comes back.
  // Never on the lines already on screen at mount.
  const last = transcript[transcript.length - 1];
  const lastId = last?.id;
  const [facing, setFacing] = useState(null);
  const seenRef = useRef(lastId);
  useEffect(() => {
    if (!last || last.speaker !== "agent" || seenRef.current === lastId) return undefined;
    seenRef.current = lastId;
    const text = last.text.toLowerCase();
    const idx = cooks.findIndex((c) => c.name && text.includes(c.name.toLowerCase()));
    if (idx < 0) return undefined;
    setFacing(idx === 0 ? "left" : "right");
    const t = setTimeout(() => setFacing(null), 1400);
    return () => clearTimeout(t);
  }, [lastId, last, cooks]);
  const toquePose = facing === "left" ? GOOSE.toqueLeft : facing === "right" ? GOOSE.toqueRight : listening ? GOOSE.listening : GOOSE.toque;

  return (
    <aside className="lc-agent" aria-label="Toque, the agent">
      <header className="lc-agent-head">
        <BabyGoose pose={toquePose} size={48} paused={paused} label="Toque" className="lc-toque" />
        <span className="lc-agent-title">
          <span className="lc-agent-name">Toque</span>
          <Mono className="lc-meta">everything said this run</Mono>
        </span>
        <button type="button" className="lc-agent-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
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
      <div className="lc-agent-controls">
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
      </div>
    </aside>
  );
}

function ServiceDone({ outcome, cooks, isVersus, onExit, saving, saveError }) {
  const winners = outcome.winnerCookIds.map((id) => cooks.find((c) => c.id === id)?.name).filter(Boolean);
  // Celebration (state G): the winner's goose — neck up, wings out, the
  // only time both — and the other one bowing out, good game. Co-op
  // has no loser, so both stand up — unless the run was called off
  // with more skipped than cooked, which is nothing to cheer.
  // Everything else on the page stops.
  const cooked = outcome.doneCount > 0 && outcome.doneCount >= outcome.skippedCount;
  const won = (id) => (isVersus ? outcome.winnerCookIds.includes(id) : cooked);
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
              <div className={`lc-score-tile lc-piece is-${playerKey(i)} ${won(entry.cookId) ? "is-winner" : ""}`} key={entry.cookId}>
                {/* The two sprites fill their frames differently — the
                    victory bird is drawn small to leave room for the
                    trophy — so the boxes differ to make the geese match. */}
                <BabyGoose pose={won(entry.cookId) ? GOOSE.victory : GOOSE.defeat} size={won(entry.cookId) ? 116 : 88} className="lc-score-goose" label={won(entry.cookId) ? `${entry.name} wins` : `${entry.name} — good game`} />
                <PlayerAvatar cook={cooks[i]} index={i} size={40} />
                <span className="lc-score-body">
                  <span className="lc-score-name">{entry.name}</span>
                  <span className="lc-meta">
                    {entry.doneCount} done · {entry.skippedCount} skipped
                  </span>
                </span>
                {isVersus && <Mono className="lc-score-points">{entry.points}</Mono>}
                {isVersus && won(entry.cookId) && <KpIcon glyph="trophy" size={18} className="lc-leader-trophy" />}
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

      {/* The list is as tall as the column beside it and scrolls inside
          — the cell is the grid item, the panel is taken out of flow, so
          nineteen rows never stretch the page past the celebration. */}
      <div className="lc-service-steps-cell">
        <div className="lc-service-steps lc-piece">
          <header className="lc-service-steps-head">
            <h2 className="lc-service-steps-title">Every step</h2>
            <Mono className="lc-meta">
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
    </div>
  );
}
