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
// The look (design: "Kitchen Path Live Cook v7 — the hand, played"):
// the Schedule's Versus opening-hand tickets scaled up into live
// stations — cream paper, punch holes, a player-coloured rule — on a
// white page under a light scoreboard strip. Every card state fills the
// same four zones, so the two tickets line up whatever either is doing.
// Text still sits on paper; the colour goes around it. Shared chrome
// (topbar, SessionProgress, VoiceBar, the system buttons) keeps its
// site-wide look.
//
// Sub-components live in this file rather than their own (same pattern
// as Schedule) since none of them is used elsewhere.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { parseCommand, HELP_TEXT, isBareResume } from "../utils/voiceCommands.js";
import { matchConfirmation } from "../utils/navCommands.js";
import { routeConfirmReply } from "../utils/confirmReply.js";
import { opensFollowUp } from "../utils/followUp.js";
import { rejectionLines } from "../utils/agentRejection.js";
import { registerVoiceDictation } from "../utils/voicePageCommands.js";
import { buildAgentSnapshot } from "../utils/agentSnapshot.js";
import { agentTurn, agentAside, collectAnswer } from "../api/agent.js";
import { shouldCommentate } from "../utils/commentary.js";

// Often enough that a lull is noticed while it is still a lull, rarely
// enough to be free -- the decision it drives is pure and local. Module
// scope because the interval is set up before this component's early
// return, and a const declared after that would be in its TDZ.
const ASIDE_CHECK_MS = 5000;
import { AGENT_NAME, speak, takeInterrupted } from "../voice/agentVoice.js";
import { explainStep } from "../utils/stepExplain.js";
import { audioTap } from "../voice/audioTap.js";
import { identifySpeaker } from "../api/speaker.js";
import { decideSpeaker, hasHandover } from "../utils/speakerMatch.js";
import { cookFromTurn } from "../utils/speakerLabels.js";
import { isNameOnlyTurn } from "../utils/addressing.js";
import { buildSummary } from "../utils/summaryCard.js";
import { clock, playerKey, resultPlayers } from "../utils/serviceResults.js";
import { chefAvatar, CHEF_AVATARS } from "../utils/cooks.js";
import { CoopResult, PlayerAvatar, Stamp, StepReceipt, VersusResults } from "../components/ServiceResults.jsx";
import KpIcon from "../components/KpIcon.jsx";
import { GoosePrint, GooseTracks } from "../components/GooseMarks.jsx";
import Modal from "../components/Modal.jsx";
import BabyGoose from "../components/BabyGoose.jsx";
import summaryVersusArt from "../assets/summary-versus-v2-blue.png";
import summaryCoopArt from "../assets/summary-coop-v2-blue.png";
import "./LiveCookPage.css";

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
  // Who the chip tints for, alongside the sentence. Level = no tint.
  if (a === b) return { text: `Level — ${a} each`, lead: null };
  const lead = a > b ? 0 : 1;
  return { text: `${cooks[lead]?.name || "Someone"} leads by ${Math.abs(a - b)}`, lead: playerKey(lead) };
}

// The goose reacting at the card's bottom-right corner, under the text
// (z-index below the content, above the panel fill). The card's action
// block leaves room for it. `motion` is the wrapper's loop — bob,
// honk, or none — layered on the sprite's own frame cycle.
export function CardGoose({ pose, size = 128, paused, motion = "bob" }) {
  return (
    <span className={`lc-goose is-${motion}`} aria-hidden="true">
      <BabyGoose pose={pose} size={size} paused={paused} decorative />
    </span>
  );
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
function MomentAxis({ state, player, compact = false }) {
  const { moments, elapsedSec, estSec } = state;
  const pct = (sec) => (estSec > 0 ? Math.min(100, Math.max(0, (sec / estSec) * 100)) : 0);
  return (
    <div className={`lc-axis is-${player} ${compact ? "is-compact" : ""}`} aria-hidden="true">
      {!compact && <Mono className="lc-axis-end">0:00</Mono>}
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
      {!compact && <Mono className="lc-axis-end">{clock(estSec)}</Mono>}
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
  const closeLog = useCallback(() => setLogOpen(false), []);
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
      dishOfStep: (s) => dishOf(byId[s.id]),
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
  // Three actions in one breath is already an unusual turn; reading back
  // more than that stops being a confirmation and becomes a recital.
  const MAX_SPOKEN_LINES = 3;
  const PAUSED_OK = new Set(["resume", "status", "score", "help", "explain"]);
  const applyAgentTurn = (turn, text, cookId) => {
    const at = () => new Date().toISOString();
    commit(appendTranscript(latestRunRef.current, { at: at(), speaker: cookId, text }));
    const spoken = [];
    // Where the run log stands before any of this turn's actions. Each
    // handler already writes the right sentence for what it did -- and,
    // just as importantly, for what it refused -- so the confirmation
    // below is a diff of the log rather than a second account that could
    // disagree with it.
    const logBefore = (latestRunRef.current.transcript || []).length;

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
        case "explain": {
          // The recipe's own words, not the model's recollection of them:
          // the snapshot only carries the first 120 characters of a
          // description, and a cook who asks what a step means should get
          // what the plan actually says.
          const line = explainStep(byId[stepId], {
            skill: state.session.conversation?.answers?.skill,
            equipmentLabel: (type) => EQUIPMENT_LABELS[type] || type,
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

    // Talk that was not addressed by name, only let through because the
    // agent had just asked something, gets a reply only if it turned into
    // an action. Otherwise the room's chatter, or the other cook talking
    // to someone, would be answered out loud, and each answer would open
    // the window for the next.
    const chatter = !turn.named && !turn.calls.length;

    // The app refused something the model asked for, and the model
    // cannot see refusals -- so its reply is written around a call that
    // did not happen. Saying what actually stopped it OUTRANKS that.
    //
    // This is the "I'm done with the onion" case in competition mode:
    // the step was never claimed, so it was never in the done enum, so
    // the call was dropped and the model asked a confused question
    // about dicing other things. The app knew the answer all along.
    const refusals = rejectionLines(turn.rejected, byId);
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
    if (!spoken.length) {
      const added = (latestRunRef.current.transcript || [])
        .slice(logBefore)
        .filter((entry) => entry.speaker === "agent" && entry.text)
        .map((entry) => entry.text)
        .slice(0, MAX_SPOKEN_LINES);
      spoken.push(...added);
    }

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
    // Still never for unaddressed chatter: a turn only let through
    // because the door was already open must not hold it open for the
    // rest of the room.
    if (!chatter && opensFollowUp(turn)) engagedUntilRef.current = Date.now() + ENGAGED_MS;
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
  const whoSpoke = async (clip, turn) => {
    if (cooks.length < 2) return null;
    if (!clip) return cookFromTurn(turn, cooks).cookId;
    try {
      const result = await identifySpeaker({ pcm: clip.pcm, rate: clip.rate, candidates: cooks.map((c) => c.id) });
      const verdict = decideSpeaker(result);
      const named = Object.fromEntries(Object.entries(result.scores || {}).map(([id, v]) => [name(id), v]));
      console.info(`[speaker] ${verdict.cookId ? name(verdict.cookId) : "unsure"} (${verdict.reason})`, named, `margin ${result.margin}`);
      // A voiceprint outranks a label: it was measured against this
      // cook's own voice, not inferred from who else is in the room.
      return verdict.cookId ?? cookFromTurn(turn, cooks).cookId;
    } catch (err) {
      console.info("[speaker] unavailable, trying the diarization label:", err.message);
      return cookFromTurn(turn, cooks).cookId;
    }
  };

  // `sttTurn` is the recogniser's turn, not the agent's reply -- the
  // inner scope already calls that one `turn`, and shadowing it here put
  // the read before the declaration.
  const askAgent = (text, cookId, { engaged = true, clip = null, shared = false, sttTurn = null } = {}) => {
    agentQueueRef.current = agentQueueRef.current.then(async () => {
      const heardAs = await whoSpoke(clip, sttTurn);
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
          // Two voices ended up in this one turn, so the words cannot be
          // trusted to belong to one person asking for one thing.
          shared,
          snapshot: buildAgentSnapshot({ run: latestRunRef.current, nodes, cooks, speakerId: cookId, paused: isPaused(latestRunRef.current), conversation: state.session.conversation }),
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
      // The agent is reading something up. Collect it OUTSIDE this
      // queue: the whole point is that the next command does not wait
      // behind a question. Deliberately not awaited here.
      if (turn.pendingId) awaitAnswer(turn.pendingId, cookId);
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
  const submitUtterance = (text) => {
    if (!text) return;
    if (pendingConfirm) {
      // An answer is an answer, and the keyword path owns resolving it.
      if (routeConfirmReply(text).type === "resolve") return submitKeywordUtterance(text);
      // Anything else means they moved on. The question goes, and what
      // they said instead is handled on its own merits -- by the model,
      // as it would have been if the question had never been asked.
      // Sending it to the keyword grammar answered a fair question with
      // "I didn't catch that". voiceTurn.js has always done this on
      // every other page; the live cook's own confirmation predated it.
      setPendingConfirm(null);
    }
    askAgent(text, speaker);
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

  voiceHandlerRef.current = (text, turn) => {
    // Somebody spoke. Whatever comes of it, the room is not quiet.
    lastVoiceAtRef.current = Date.now();
    const confidence = (turn?.words || []).reduce((lowest, w) => Math.min(lowest, w.confidence ?? 1), 1);
    if (confidence < MIN_VOICE_CONFIDENCE) {
      console.info("[voice] too unclear to act on:", text);
      return;
    }
    if (pendingConfirm) return submitKeywordUtterance(text);
    // Paused, and all they said was "resume" — exactly what the paused
    // screen tells them to say. It needs no name and no model round trip:
    // it is the only thing that does anything until the clock is back on.
    if (paused && isBareResume(text)) return submitKeywordUtterance(text);
    // "Goose." on its own is somebody getting the agent's attention before
    // saying the thing. The recogniser ends the turn in that pause, so the
    // instruction lands in the NEXT turn with no name on it — and would be
    // thrown away as kitchen chatter. Hold the door open instead of acting
    // on a turn that asked for nothing.
    if (isNameOnlyTurn(text, AGENT_NAME)) {
      engagedUntilRef.current = Date.now() + NAME_CARRY_MS;
      console.info("[voice] name only, waiting for the rest:", text);
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
    if (shared) console.info("[voice] two cooks in one turn:", text);
    askAgent(text, speaker, { engaged, clip, shared, sttTurn: turn });
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
    const result = parseCommand(text, { byId, activeStepId, claimable: ready, ownQueue, agentName: AGENT_NAME });

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

              <ToqueLine cooks={cooks} transcript={run.transcript} paused={paused} listening={listening} onOpen={() => setLogOpen(true)} />
            </div>
          </div>

          <ToqueDrawer open={logOpen || Boolean(pending || pendingConfirm)} onClose={closeLog}>
            <AgentPanel
              onClose={closeLog}
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

// ---------------------------------------------------------------------

// What a cook's card is about right now, shared by the card and the page
// (which needs to know whether ANY card has a pot going, so both cards
// reserve the "on its own" slot together). The engine says who is
// occupied by what. If a check comes due while the cook is mid-chop,
// both steps occupy them and the engine's pick is by record order — the
// card keeps the hands-on step so it does not flip under a working
// cook; the due check is the row's alarm. Only with no hands-on step
// does an unattended moment lead.
function cardFocus(cookId, run, byId, now) {
  const handsOnId = Object.entries(run.steps).find(([id, r]) => r.status === "active" && r.cookId === cookId && isAttended(byId[id]))?.[0] || null;
  const activeId = handsOnId || activeStepFor(cookId, run, byId, now);
  const node = activeId ? byId[activeId] : null;
  // The card is "On it" on an unattended step only while it is in a
  // moment — the engine never makes a merely-waiting pot anyone's focus.
  const focusMoment = node && !isAttended(node) ? momentState(node, run.steps[activeId], now) : null;
  // Every unattended step this cook has going, soonest moment first.
  // A pot stays listed even while its check is the card's focus, so the
  // row and the card agree — except during Start: the cook is standing
  // at that pot getting it going, and there is nothing to come back to.
  const cooking = passiveStepsFor(cookId, run, byId)
    .filter((id) => !(id === activeId && focusMoment?.phase === "initial"))
    .map((id) => ({ id, node: byId[id], state: momentState(byId[id], run.steps[id], now) }))
    .sort((a, b) => (a.state.nextInSec ?? -1) - (b.state.nextInSec ?? -1));
  return { activeId, node, focusMoment, cooking };
}

// What a step is worth, as a dashed tag pinned to the ticket's corner.
function PointsTag({ pts, player }) {
  return <span className={`lc-pts-tag ${player ? `is-${player}` : ""}`}>+{pts}</span>;
}

// Coop's head stamp, one per state.
const STAMP = {
  active: "On it",
  assigned: "Up next",
  idle_fill: "Free hands",
  waiting: "Waiting",
  finished: "Done",
};

// The station ticket (design: "Live cook v7"): the Schedule's opening-
// hand paper scaled up. Four zones in a fixed order on every state —
// head, the order, the action block, the pots cooking on their own —
// and both cards share the row tracks, so like sits level with like
// whatever state either card is in. A state may leave a zone quiet; it
// never removes one.
function PlayerFocusCard({ cardRef, scoreRef, cook, index, cooks, run, nodes, byId, now, isVersus, paused, assignment, points, doneCount, dishOf, ownSlot, landing, handoff, claimNote, claimBlock, onStart, onDone, onSkip, onDrop, onClaim, onPass, onUndo }) {
  const key = playerKey(index);
  const other = cooks.find((c) => c.id !== cook.id) || null;
  const { activeId, node, focusMoment, cooking } = cardFocus(cook.id, run, byId, now);
  const variance = node ? stepVariance(node, run.steps[activeId], now) : null;
  const inFinish = focusMoment?.phase === "ending";

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

  // Due: a check or the finish is open on something this cook has going
  // — the card's own focus or a pot in the row below. The card shakes
  // once (the class change starts it), the goose honks until it's handled.
  const isDue = (m, n) => Boolean(m?.current) && hasDeadline(n) && (m.phase === "checkpoint" || m.phase === "ending");
  const due = !paused && ((focusMoment && isDue(focusMoment, node)) || cooking.some((c) => isDue(c.state, c.node)));

  const phaseLabel = focusMoment?.current ? momentName(focusMoment.current, focusMoment.checkCount) : null;
  const eyebrowText = paused ? EYEBROW.paused : EYEBROW[reason];
  const stampText = paused ? "Paused" : due ? "Due" : STAMP[reason];

  const silhouette = due ? "due" : reason;
  // The head band fills with the player's tint while their hands are on
  // something — "this is my station" at a glance.
  const active = reason === "active" || due;
  const goosePose = due ? GOOSE.due : handoff && reason === "active" ? GOOSE.handoff : GOOSE[reason] || GOOSE.waiting;
  const gooseMotion = due ? "honk" : reason === "waiting" ? "none" : "bob";
  // The rail fills to est, then turns amber (the "is-over" tint).
  const heatPct = variance ? Math.min(100, variance.estSec > 0 ? (variance.actualSec / variance.estSec) * 100 : 100) : 0;
  const bodyNode = node || offered;
  // The ticket number: where this step sits in the night, like the
  // numbered tickets on Schedule's timeline.
  const ticketNo = bodyNode ? `#${String(nodes.indexOf(bodyNode) + 1).padStart(2, "0")} / ${nodes.length}` : `${doneCount} done`;

  const secondary = (
    <>
      {focusMoment && !inFinish && (
        // Mid-moment the banner holds the slot; Done here ends the step early.
        <button type="button" className="btn btn-ghost" disabled={paused} onClick={() => onDone(activeId)}>
          Done
        </button>
      )}
      <button type="button" className="btn btn-ghost" disabled={paused} onClick={() => onSkip(activeId)}>
        Skip
      </button>
      {isVersus && (
        <button type="button" className="btn btn-ghost" disabled={paused} onClick={() => onDrop(activeId)}>
          Put it back
        </button>
      )}
      <button type="button" className="btn btn-ghost lc-btn-undo" disabled={!undoable} onClick={onUndo}>
        Undo
      </button>
    </>
  );

  return (
    <article
      ref={cardRef}
      className={`lc-card is-${key} is-state-${silhouette} ${active ? "is-active" : ""} ${reason === "grabs" ? "is-offer" : ""} ${paused ? "is-paused" : ""}`}
      aria-label={`${cook.name} — ${eyebrowText}`}
    >
      {/* A — the ticket head: who, which ticket, and (Versus) the score
          roundel where "+20" lands, or (Co-op) the state as a stamp. */}
      <header className="lc-card-head">
        <PlayerAvatar cook={cook} index={index} size={44} />
        <span className="lc-card-id">
          <span className="lc-card-name">{cook.name}</span>
          <Mono className="lc-card-ticket">{ticketNo}</Mono>
        </span>
        {isVersus ? (
          <span className="lc-card-score" ref={scoreRef}>
            <span className={`lc-card-points ${landing ? "is-landing" : "lc-roll"}`} key={points}>
              {points}
            </span>
            <span className="lc-card-pts">pts</span>
          </span>
        ) : (
          <Stamp key={stampText} tone={due ? "due" : key}>
            {stampText}
          </Stamp>
        )}
      </header>

      {/* B — the order: what it is, what it needs, what to do with your
          hands, and the clock pinned to the bottom of the zone. */}
      <div className="lc-card-body">
        {bodyNode && (
          <>
            <div className="lc-order-brow">
              {due && (
                <span className="lc-chip is-due">
                  <KpIcon glyph="timer" size={14} />
                  {phaseLabel ? `${phaseLabel} — now` : "Due now"}
                </span>
              )}
              {!due && phaseLabel && <span className={`lc-chip is-phase is-${key}`}>{phaseLabel}</span>}
              {dishOf(bodyNode) && <span className="lc-order-dish">{dishOf(bodyNode)}</span>}
              {(bodyNode.required_equipment || []).map((e) => (
                <EquipmentChip key={e} type={e} />
              ))}
              <TendingChip node={bodyNode} />
            </div>
            {isVersus && <PointsTag pts={DIFFICULTY_POINTS[bodyNode.difficulty]} player={key} />}
            <h2 className="lc-step-title">{bodyNode.label}</h2>
            {/* The description is the instruction — the one thing on the
                card that says what to do with your hands. */}
            {bodyNode.description && <p className="lc-step-desc">{bodyNode.description}</p>}
            {node && focusMoment?.current?.kind === "initial" && isOneShot(node) && (
              <p className="lc-meta">Then it runs on its own — nothing to come back for.</p>
            )}
            {claimNote?.stepId === offeredId && offeredId && (
              <p key={claimNote.key} className="lc-claim-note" role="status">
                {claimNote.text}
              </p>
            )}
            <span className="lc-order-spacer" />
            {node ? (
              // Elapsed against est. Past est the rail turns amber and the
              // right end says by how much.
              <div className={`lc-step-rail is-${key} ${variance.over ? "is-over" : ""}`}>
                <Mono className="lc-timer-value">{clock(variance.actualSec)}</Mono>
                <span className="lc-step-rail-track" aria-hidden="true">
                  <span className="lc-step-rail-fill" style={{ width: `${heatPct.toFixed(1)}%` }} />
                </span>
                <Mono className="lc-timer-est">{variance.over ? `${clock(variance.deltaSec)} over` : clock(variance.estSec)}</Mono>
              </div>
            ) : reason === "grabs" ? (
              <div className="lc-step-rail is-offer">
                <Mono className="lc-timer-value">{clock(offered.estimated_duration_sec)}</Mono>
                <span className="lc-meta">if you take it</span>
                <Stamp tone={key} className="lc-offer-stamp">
                  Up for grabs
                </Stamp>
              </div>
            ) : (
              <div className={`lc-step-rail is-${key}`}>
                <Mono className="lc-timer-value is-idle">0:00</Mono>
                <span className="lc-step-rail-track" aria-hidden="true" />
                <Mono className="lc-timer-est">{clock(offered.estimated_duration_sec)}</Mono>
              </div>
            )}
          </>
        )}

        {reason === "waiting" && (
          // Hands free: the countdown takes the title's place, big — it
          // is the one thing a waiting cook wants to know.
          <>
            <div className="lc-order-brow">
              <span className="lc-order-dish">Hands free</span>
            </div>
            {assignment?.etaSec != null ? (
              <div className="lc-wait">
                <span className="lc-wait-num">{clock(assignment.etaSec)}</span>
                <span className="lc-wait-unit">left</span>
              </div>
            ) : (
              <h2 className="lc-step-title is-quiet">Nothing to do yet</h2>
            )}
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
            <GooseTracks variant="up" />
          </>
        )}

        {reason === "finished" && (
          <div className="lc-rest">
            <BabyGoose pose={GOOSE.finished} size={96} paused={paused} decorative />
            <span className="lc-rest-copy">
              <h2 className="lc-step-title">Done for the night</h2>
              <span className="lc-rest-tally">
                <Mono>{doneCount}</Mono> done
                {isVersus && (
                  <>
                    {" "}· <Mono className="lc-rest-pts">{points}</Mono> pts
                  </>
                )}
              </span>
              <span className="lc-meta">{isVersus && !isRunComplete(run, nodes) ? "Nothing to grab right now." : "Nothing left for you."}</span>
            </span>
          </div>
        )}
      </div>

      {/* C — the action block: two fixed slots, a 56px primary and a
          row of quiet ghosts, on every state whether or not it fills
          them. The goose lives in the reserved right margin. */}
      <div className="lc-card-actions">
        {reason !== "finished" && <CardGoose pose={goosePose} size={100} paused={paused} motion={paused ? "none" : gooseMotion} />}
        <div className="lc-primary-slot">
          {node &&
            (focusMoment && !inFinish ? (
              // Start / Check: the moment's instruction and countdown take
              // the primary's slot — "do the thing, then walk away".
              <MomentInstruction state={focusMoment} />
            ) : (
              <button
                type="button"
                // Finish: the primary IS the Done, and it springs once
                // when the window opens.
                className={`btn lc-btn-xl lc-btn-done ${inFinish ? "lc-attend" : ""}`}
                key={inFinish ? "finish" : "done"}
                disabled={paused}
                onClick={() => onDone(activeId)}
              >
                {inFinish ? "Checked it" : "Done"}
              </button>
            ))}
          {offered && (
            <button
              type="button"
              // The offer pulses once every 4 s — the only loop on this card.
              className={`btn lc-btn-xl lc-btn-go ${reason === "grabs" && !paused && !offerBlock ? "lc-offer-pulse" : ""}`}
              disabled={paused || Boolean(offerBlock)}
              title={offerBlock || undefined}
              onClick={() => (reason === "grabs" ? onClaim(offeredId) : onStart(offeredId))}
            >
              {reason === "assigned" ? "Start" : reason === "idle_fill" ? "Take this" : "Take it"}
            </button>
          )}
        </div>
        {/* Always rendered, so the primary above it sits at the same
            height on both cards. A player's last Done/Skip stays
            undoable for 60s even after their card has moved on. */}
        <div className="lc-card-secondary">
          {node ? (
            secondary
          ) : (
            <>
              {reason === "grabs" && (
                <>
                  <button type="button" className="btn btn-ghost" disabled={paused || suggestions.length < 2} onClick={notNow}>
                    Not now
                  </button>
                  {other && (
                    <button
                      type="button"
                      className="btn btn-ghost"
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
                <button type="button" className="btn btn-ghost lc-btn-undo" onClick={onUndo}>
                  Undo
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* D — every pot this cook has going, its next moment counting
          down. When either card has one, both reserve the slot, so the
          cards stay one height; the empty one says so quietly. */}
      {cooking.length > 0 ? (
        <div className="lc-cooking">
          {cooking.map(({ id, node: cNode, state }) => (
            <CookingRow
              key={id}
              node={cNode}
              state={state}
              player={key}
              paused={paused}
              // Done never appears twice in one card: the row's Done is
              // suppressed only when this same step is the card's
              // primary (its Finish-phase card).
              showDone={!isOneShot(cNode) && state.phase === "ending" && !(activeId === id && inFinish)}
              onDone={() => onDone(id)}
            />
          ))}
        </div>
      ) : (
        ownSlot && (
          <div className="lc-cooking-empty">
            <GoosePrint depth="mid" size={12} />
            <span className="lc-own-eyebrow">On its own</span>
            <span>Nothing on the burner</span>
          </div>
        )
      )}
    </article>
  );
}

// The moment banner, in the action block's primary slot: what to do
// and this moment's countdown. The whole step's clock is the rail.
function MomentInstruction({ state }) {
  const { current, countdownSec } = state;
  const verb = current.kind === "initial" ? "Get it going" : current.kind === "checkpoint" ? "Check on it" : "Pull it off";
  return (
    <div className="lc-moment" role="timer">
      <KpIcon glyph="timer" size={22} />
      <span className="lc-moment-instruction">
        {verb} — {current.kind === "ending" ? "now." : <><Mono>{clock(current.endSec - current.atSec)}</Mono>.</>}
      </span>
      {current.kind !== "ending" && <Mono className="lc-moment-countdown">{clock(countdownSec)}</Mono>}
    </div>
  );
}

// One "on its own" row: the pot, its live axis, and the next moment.
// Quiet while running; the system's "needs you" treatment (warning
// tint, one pop) when a check or the finish is due.
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
    <div className={`lc-cooking-row is-${player} ${due ? "is-due" : ""}`} key={due ? `${phase}-${current?.index}` : "running"}>
      <KpIcon glyph="pot" size={14} />
      <span className="lc-own-eyebrow">On its own</span>
      <span className="lc-cooking-row-label">{node.label}</span>
      <MomentAxis state={state} player={player} compact />
      <span className="lc-cooking-row-next">
        {label && <span className="lc-cooking-row-next-label">{label}</span>}
        <Mono className="lc-cooking-row-next-value">{value}</Mono>
      </span>
      {showDone && (
        <button type="button" className="btn lc-cooking-row-done" disabled={paused} onClick={onDone}>
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

// The board (design v7): small paper tickets on a bg-secondary panel —
// the station ticket's language at tile size. Every tile has the same
// rows (title + points, facts, a tool row that is always reserved, the
// claim halves pinned to the bottom), so a row of tiles shares its
// edges whatever each one holds. A claim stamps the tile with who took
// it, then it settles to the holder and their next moment.
function TaskPoolBoard({ ready, blocked, run, byId, cooks, now, paused, dishOf, claimBlock, claimNote, onClaim }) {
  const taken = Object.entries(run.steps).filter(([, r]) => r.status === "active");
  return (
    <section className="lc-pool" aria-label="Up for grabs">
      <header className="lc-pool-head">
        <h2 className="lc-eyebrow-label">Up for grabs</h2>
        <span className="lc-meta">
          <Mono>{ready.length}</Mono> ready · <Mono>{blocked.length}</Mono> not yet
        </span>
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
              <div className="lc-tile-top">
                <span className="lc-tile-label">{tNode.label}</span>
                <PointsTag pts={DIFFICULTY_POINTS[tNode.difficulty]} />
              </div>
              <span className="lc-tile-meta">
                <Mono>{clock(handsOnSec ?? tNode.estimated_duration_sec)}</Mono>
                {handsOnSec != null && <> hands-on of <Mono>{clock(tNode.estimated_duration_sec)}</Mono></>}
                {dishOf(tNode) && <> · {dishOf(tNode)}</>}
              </span>
              {/* What the claim needs from the kitchen: a step's burner or
                  board is what most often refuses a claim, so it's on the
                  tile rather than discovered by tapping. */}
              <div className="lc-chips lc-tile-chips">
                {(tNode.required_equipment || []).map((e) => (
                  <EquipmentChip key={e} type={e} />
                ))}
                <TendingChip node={tNode} />
              </div>
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
                  const why = block ? (block.startsWith("No ") ? block.replace(/^No (.*) free$/, "no $1").toLowerCase() : "busy") : null;
                  // The half wears whichever bird this cook picked, so it
                  // matches the avatar inside it whatever the pair is —
                  // green against purple reads as well as blue against
                  // amber. A cook who never picked one borrows the bird
                  // at their seat rather than the unclaimed grey, which
                  // is what "can't claim" already looks like.
                  const bird = (cook.avatar && chefAvatar(cook.avatar)) || CHEF_AVATARS[i % CHEF_AVATARS.length];
                  return (
                    <button
                      key={cook.id}
                      type="button"
                      className={`btn lc-claim is-${playerKey(i)}`}
                      style={{ "--claim": bird.bg, "--claim-ink": bird.ink }}
                      onClick={() => onClaim(id, cook.id)}
                      disabled={paused || Boolean(block)}
                      title={block || undefined}
                      aria-label={`${cook.name} takes ${tNode.label}`}
                    >
                      <PlayerAvatar cook={cook} index={i} size={20} />
                      <span className="lc-claim-name">
                        {cook.name}
                        {why && <span className="lc-claim-why"> · {why}</span>}
                      </span>
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
          // running time — the same copy as the card's pot row.
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
              <div className="lc-tile-top">
                <span className="lc-tile-label">{tNode?.label}</span>
                <PointsTag pts={DIFFICULTY_POINTS[tNode.difficulty]} player={playerKey(i)} />
              </div>
              <span className="lc-tile-meta">
                <Mono>{clock(tNode.estimated_duration_sec)}</Mono>
                {dishOf(tNode) && <> · {dishOf(tNode)}</>}
              </span>
              {fresh ? (
                <Stamp tone={playerKey(i)} className="lc-tile-took">
                  {cooks[i]?.name} took it
                </Stamp>
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
      {/* What's not ready yet is a row of locked chips (Schedule's NOT
          YET), not tiles: the board is for what can be taken. Each one
          carries what it's waiting on. */}
      {blocked.length > 0 && (
        <div className="lc-pool-notyet">
          <span className="lc-eyebrow-label">Not yet</span>
          {blocked.map((id, i) => {
            const waiting = (byId[id].depends_on || []).filter((d) => byId[d] && !["done", "skipped"].includes(run.steps[d]?.status));
            // Same tilt as the step's chip on Schedule (hashed from its id),
            // on its own beat, so the row reads as steps waiting their turn.
            const hash = String(id).split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 5381);
            const tiltDeg = ((hash % 26) - 13) / 10;
            return (
              <span
                key={id}
                className="lc-notyet-chip"
                title={`needs ${waiting.map((d) => byId[d]?.label).join(", ")}`}
                style={{ "--lc-locked-index": i, "--lc-locked-tilt": `${tiltDeg}deg` }}
              >
                {byId[id].label}
              </span>
            );
          })}
        </div>
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
      <GoosePrint />
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

// Service done (design v7): a results screen, not a summary. The
// illustration across the top, then — Versus — the two players' tickets
// either side of the final score, the winner marked by a banner and a
// tinted head, never by being bigger; — Co-op — how the night went
// against the plan and one shared bar of who did what. The receipt on
// the right is every step, in the order the night went.
function ServiceDone({ outcome, cooks, isVersus, title, byId, dishOf, onExit, saving, saveError }) {
  const players = resultPlayers({ outcome, cooks, dishOfStep: (s) => dishOf(byId[s.id]) });

  return (
    <div className={`lc-service ${isVersus ? "is-versus" : "is-coop"}`}>
      <div className="lc-service-main">
        <div className="lc-service-top">
          <span className="lc-eyebrow-label">Service done · {isVersus ? "Versus" : "Co-op"}</span>
          <span className="lc-meta">
            <Mono className="lc-service-clock">{clock(outcome.totalSec)}</Mono> on the clock
          </span>
        </div>
        <img className="lc-service-art" src={isVersus ? summaryVersusArt : summaryCoopArt} alt="" />

        {isVersus ? (
          <VersusResults players={players} winnerCookIds={outcome.winnerCookIds} />
        ) : (
          <CoopResult outcome={outcome} players={players} />
        )}
      </div>

      {/* The receipt is as tall as the column beside it and scrolls
          inside — the cell is the grid item, the roll is taken out of
          flow, so twenty rows never stretch the page past the results.
          The way on is the receipt's own tear-off stub: the receipt is
          what becomes the cook card, so taking it is the handoff. */}
      <div className="lc-service-steps-cell">
        <div className="lc-receipt-roll">
        <StepReceipt outcome={outcome} cooks={cooks} players={players} isVersus={isVersus} title={title} />
        <div className={`lc-receipt-stub ${saving ? "is-tearing" : ""}`}>
          <span className="lc-perforation" aria-hidden="true">
            <span>Tear here</span>
          </span>
          <button type="button" className="btn lc-btn-xl lc-btn-go lc-service-cta" onClick={onExit} disabled={saving}>
            {saving ? "Saving…" : saveError ? "Try again" : "Take the cook card →"}
          </button>
          {saveError && (
            <p className="lc-service-error" role="alert">
              {saveError} Nothing is lost — try again.
            </p>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
