// Schedule — session step 6 of 7, the game plan before going live
// (design/claude-design-schedule-prompt.md, "Kitchen Path - Schedule").
// The player's job, in order: pick a mode, read the plan the agent made
// for it, go live. Nothing here is authored by hand — the plan is
// computed by utils/scheduleLayout.js from the approved main line, the
// two players and the kitchen; this page only renders it. Mode is
// session state (persisted through the debounced sync); the run is
// written straight through saveRunNow.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { createRun, runProgress } from "../utils/liveCook.js";
import { mergeRecipesForDisplay } from "../utils/graphLayout.js";
import {
  computeSchedule,
  computeOpeningAssignment,
  missingEquipment,
  equipmentLanes,
  unattendedEvents,
  cookFreeWindows,
  isAttended,
  EQUIPMENT_LABELS,
} from "../utils/scheduleLayout.js";
import { registerVoiceCommands } from "../utils/voicePageCommands.js";
import { CONFIRM_YES_PATTERN, CONFIRM_NO_PATTERN } from "../utils/navCommands.js";
import { matchStepName } from "../utils/stepNameMatch.js";
import { tendingOf, TENDING } from "../utils/tending.js";
import { formatClock } from "../utils/inventory.js";
import KpIcon from "../components/KpIcon.jsx";
import Modal from "../components/Modal.jsx";
import KitchenProfileFormModal from "../components/KitchenProfileFormModal.jsx";
import ChefWorkingScreen from "../components/ChefWorkingScreen.jsx";
import { devPreview } from "../dev/preview.js";
import "./SchedulePage.css";

// Abandoning destroys the run, so voice makes you read the sentence back.
const ABANDON_PHRASE = "I want to abandon this cook";

// Player colors come from the index in cooks[] — player 1 is "a",
// player 2 is "b" — never stored, never chosen (design-v4.css tokens).
const PLAYER_KEYS = ["a", "b"];
const playerKey = (index) => PLAYER_KEYS[index % PLAYER_KEYS.length];

// Zoom is a three-stop slider (Fit · 1× · 2×), no pixel readout. "Fit"
// is the real thing — measured from the track's width so the whole plan
// is on screen — while 1× and 2× are the design's fixed densities.
const ZOOM_STOPS = ["Fit", "1×", "2×"];
const ZOOM_PX_PER_MIN = { "1×": 78, "2×": 108 };
const FIT_FALLBACK_PX_PER_MIN = 56;
// On a phone a true fit is ~7px/min — every block a bare sliver — so
// "Fit" bottoms out here and scrolls a little instead.
const FIT_MIN_PX_PER_MIN = 16;
const TRACK_END_PADDING = 24;

// Whole-minute ruler ticks, stepped up until the labels can't collide.
const TICK_STEPS_MIN = [1, 2, 5, 10, 15, 30];
const TICK_MIN_PX = 56;

// A block shows as much as it can without clipping a word into
// nonsense ("Cut tof…"): name + meta → name → duration → bare bar.
const RUNG_FULL_PX = 130;
const RUNG_NAME_PX = 76;
const RUNG_DURATION_PX = 48;
const RUNG_WAIT_PX = 88;
// Rough glyph width at the 13px block font, used to cut labels at a
// word boundary instead of letting CSS leave "Dice oni…".
const LABEL_PX_PER_CHAR = 6.6;
const BLOCK_TEXT_INSET_PX = 18;

// The longest run of whole words that fits `widthPx`; the first word
// (ellipsized by CSS) if none do.
function fitLabel(label, widthPx) {
  const words = (label || "").split(" ");
  const fits = (text) => text.length * LABEL_PX_PER_CHAR <= widthPx - BLOCK_TEXT_INSET_PX;
  let out = words[0] || "";
  for (let i = 1; i < words.length; i++) {
    const next = `${out} ${words[i]}`;
    if (!fits(next + "…") && !(i === words.length - 1 && fits(next))) break;
    out = next;
  }
  return out === label ? label : `${out}…`;
}

// An unattended step's hands-on moments are much narrower than a step
// block, so they degrade on their own ladder: "Check 1/2" → "1/2" → the
// mono duration → a bare bar. The 10px floor keeps a 20-second check
// visible at Fit zoom (design/claude-design-schedule-v2-unattended.md §2).
const MOMENT_MIN_PX = 10;
const MOMENT_LABEL_PX_PER_CHAR = 6.8;
const MOMENT_MONO_PX_PER_CHAR = 8.3;
const RAIL_LABEL_MIN_PX = 44;
const RAIL_LABEL_PX_PER_CHAR = 6.4;

// What the page calls each tending kind. Hands-on is the default and
// says nothing; the rail is the signal, the chip only names it.
const TENDING_LABELS = {
  [TENDING.TENDED]: "Check on it",
  [TENDING.TIMED]: "Timed",
  [TENDING.SET_AND_FORGET]: "Leave it",
};
const tendingLabel = (node) => TENDING_LABELS[tendingOf(node)] || null;

// Equipment lane glyphs come from the 14-glyph sheet only; the lane for
// steps that need no equipment (resting, chilling) borrows the timer.
const EQUIPMENT_GLYPHS = {
  cutting_board: "cutting-board",
  stove_burner: "burner",
  wok: "wok",
  pot: "pot",
  oven: "oven",
  __unattended__: "timer",
};

const momentName = (m, count) => (m.kind === "initial" ? "Start" : m.kind === "ending" ? "Finish" : `Check ${m.index + 1}/${count}`);
const momentShort = (m, count) => (m.kind === "initial" ? "Start" : m.kind === "ending" ? "Finish" : `${m.index + 1}/${count}`);

const DIFFICULTY_FLAMES = { low: 1, medium: 2, high: 3 };

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const equipmentLabel = (type) => capitalize(EQUIPMENT_LABELS[type] || type);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Mono({ children, className = "" }) {
  return <span className={`mono ${className}`}>{children}</span>;
}

// System Chip, neutral: names the tending kind wherever a step is listed
// off the timeline (detail panel, Versus rows). Renders nothing for
// hands-on steps.
function TendingChip({ node, className = "" }) {
  const label = tendingLabel(node);
  if (!label) return null;
  return <span className={`sch-tending-chip ${className}`}>{label}</span>;
}

function PlayerAvatar({ cook, index, size = 32 }) {
  return (
    <span className={`sch-avatar is-${playerKey(index)} sch-avatar-${size}`} aria-hidden="true">
      {cook?.name?.[0]?.toUpperCase() || "?"}
    </span>
  );
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    onChange();
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export default function SchedulePage() {
  const { state, dispatch, saveRunNow, editKitchenProfile } = useAppState();
  const navigate = useNavigate();
  const { recipes, sharedSteps, cooks, mode, run } = state.session;
  const kitchenProfile = state.kitchenProfiles.find((p) => p.id === state.session.kitchenProfileId) || null;

  // 1× by default: "Fit" squeezes a 40-minute plan into bare slivers.
  const [zoom, setZoom] = useState("1×");
  const [selectedStepId, setSelectedStepId] = useState(null);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [editingKitchen, setEditingKitchen] = useState(false);
  const [kitchenError, setKitchenError] = useState(null);

  const approved = useMemo(() => mergeRecipesForDisplay(recipes, sharedSteps).approved, [recipes, sharedSteps]);
  const nodes = useMemo(() => approved?.nodes || [], [approved]);
  const schedule = useMemo(() => computeSchedule(nodes, cooks, kitchenProfile), [nodes, cooks, kitchenProfile]);
  const opening = useMemo(() => computeOpeningAssignment(nodes, cooks, kitchenProfile), [nodes, cooks, kitchenProfile]);
  const lacking = useMemo(() => missingEquipment(nodes, kitchenProfile), [nodes, kitchenProfile]);

  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const stepById = useMemo(() => Object.fromEntries(schedule.steps.map((s) => [s.id, s])), [schedule]);
  const cookById = Object.fromEntries(cooks.map((c) => [c.id, c]));
  const cookIndexById = Object.fromEntries(cooks.map((c, i) => [c.id, i]));
  const dishOf = (nodeId) => {
    const node = byId[nodeId];
    if (!node) return null;
    if (node._shared) return "Shared";
    return recipes.find((r) => r.id === node._recipeId)?.working.title || null;
  };

  const finish = formatClock(schedule.makespanSec);
  const isCoop = mode === "cooperation";
  const isVersus = mode === "competition";
  const hasLoop = schedule.unscheduledIds.length > 0;
  const runEnded = Boolean(run?.endedAt);
  const canStart = Boolean(mode) && !hasLoop;

  const grabsCount = opening.poolIds.length + opening.lockedIds.length;

  useEffect(() => {
    if (!approved) return undefined;
    const sub = isCoop
      ? `Plan's ready — ${finish} with ${cooks.length} players.`
      : isVersus
        ? `${grabsCount} steps up for grabs — first to claim wins.`
        : "Pick a mode and I'll deal the plan.";
    const line = run
      ? runEnded
        ? "Say “see the result”."
        : "Say “back to the cook”."
      : isCoop
        ? "Say “go live”, “select the simmer”, or “when am I free”."
        : "Say “co-op” or “versus”, then “go live”.";
    dispatch({ type: "voice/setHint", payload: { hint: { line, sub } } });
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [dispatch, approved, finish, cooks.length, isCoop, isVersus, grabsCount, run, runEnded]);

  // Mode is snapshotted into the run, so changing it mid-cook would
  // desync what's already happened — the cards lock once a run exists.
  const setMode = (nextMode) => {
    if (run) return;
    dispatch({ type: "session/update", payload: { mode: nextMode } });
  };

  const goLive = () => {
    // schedule/opening are already memoized above — no extra solver run.
    saveRunNow(createRun({ nodes, mode, schedule, opening, now: new Date() }));
    navigate("/session/live-cook");
  };
  const abandonRun = () => {
    saveRunNow(null);
    setConfirmAbandon(false);
  };
  const saveKitchen = async (draft) => {
    setKitchenError(null);
    try {
      await editKitchenProfile(kitchenProfile.id, draft);
      setEditingKitchen(false);
    } catch (err) {
      setKitchenError(err.message);
    }
  };

  // Any gap between a player's previous block and their next one is a
  // wait — labeled from the next step's startCause (what actually held
  // it), so a step waiting on its own dependency chain says so too.
  // `cookId` is whose lane the label is drawn on: an unattended step
  // keeps its equipment while its owner does other things, so the
  // holder can be the reader — "Leo has it" on Leo's own lane reads as
  // nonsense, so name the step instead.
  const waitLabelFor = (cause, cookId) => {
    if (cause.type === "equipment") {
      const holderStep = cause.refStepId ? stepById[cause.refStepId] : null;
      const holderCook = holderStep ? cookById[holderStep.cookId] : null;
      const holder = !holderCook ? "" : holderCook.id === cookId ? ` — your “${byId[holderStep.id]?.label || holderStep.id}” has it` : ` — ${holderCook.name} has it`;
      return `Waiting · ${EQUIPMENT_LABELS[cause.equipmentType] || cause.equipmentType}${holder}`;
    }
    if (cause.type === "dependency" && cause.refStepId) {
      return `Waiting on “${byId[cause.refStepId]?.label || cause.refStepId}”`;
    }
    return "Waiting";
  };

  // A cook's lane carries everything they own, drawn two ways. A
  // hands-on step is one solid block. An unattended step is a thin rail
  // for its whole span (the pot is on, the cook is not there) with a
  // small block for each hands-on moment — start, every check, finish —
  // so the lane reads "free from 6:00 to 8:30 even though the broth is
  // on". Waits fill the gaps between hands-on occupancy up to the next
  // step START; a gap before a checkpoint is free time, not a wait, and
  // the rail already says so.
  const lanes = cooks.map((cook, index) => {
    const steps = schedule.steps.filter((s) => s.cookId === cook.id).sort((a, b) => a.startSec - b.startSec);
    const blocks = [];
    // Everything that actually occupies the cook, in time order.
    const occupied = [];
    steps.forEach((s) => {
      const node = byId[s.id];
      if (isAttended(node)) {
        blocks.push({ kind: "task", id: s.id, startSec: s.startSec, endSec: s.endSec, step: s, node });
        occupied.push({ startSec: s.startSec, endSec: s.endSec, stepStart: s });
      } else {
        const moments = unattendedEvents(node, s.startSec);
        blocks.push({ kind: "unattended", id: s.id, startSec: s.startSec, endSec: s.endSec, step: s, node, moments });
        moments.forEach((m) => occupied.push({ startSec: m.atSec, endSec: m.endSec, stepStart: m.kind === "initial" ? s : null }));
        // A step with no breakdown (older data) still needs its start
        // marked, or the wait before it would run under the rail.
        if (!moments.length) occupied.push({ startSec: s.startSec, endSec: s.startSec, stepStart: s });
      }
    });
    occupied.sort((a, b) => a.startSec - b.startSec);

    // Wait segments: from the end of one occupancy to the next STEP
    // START, labelled from that step's startCause. A gap that ends at a
    // check or a finish is not a wait — it is the free stretch the rail
    // is there to show — and neither is any part of a gap that runs
    // under one of this cook's own rails: hatched means stuck on a tool
    // or a dependency, and "stuck on my own simmer" is just cooking.
    const rails = blocks.filter((b) => b.kind === "unattended").map((b) => [b.startSec, b.endSec]);
    const minusRails = (startSec, endSec) => {
      let pieces = [[startSec, endSec]];
      rails.forEach(([rs, re]) => {
        pieces = pieces.flatMap(([ps, pe]) => {
          if (re <= ps || rs >= pe) return [[ps, pe]];
          const out = [];
          if (rs > ps) out.push([ps, rs]);
          if (re < pe) out.push([re, pe]);
          return out;
        });
      });
      return pieces;
    };
    let prevEnd = 0;
    occupied.forEach((o) => {
      if (o.stepStart && o.startSec > prevEnd) {
        minusRails(prevEnd, o.startSec).forEach(([startSec, endSec], j) => {
          blocks.push({
            kind: "wait",
            id: `wait-${o.stepStart.id}-${j}`,
            startSec,
            endSec,
            label: waitLabelFor(o.stepStart.startCause, cook.id),
          });
        });
      }
      prevEnd = Math.max(prevEnd, o.endSec);
    });
    blocks.sort((a, b) => a.startSec - b.startSec);

    // Two unattended steps can overlap on one lane (a broth and a
    // marinade both going), and the design assumes one rail at a time.
    // Pack overlapping rails into rows, first free row wins; the lane
    // grows by a row for each extra rail rather than drawing them on
    // top of each other.
    const rowEnds = [];
    blocks
      .filter((b) => b.kind === "unattended")
      .forEach((b) => {
        let row = rowEnds.findIndex((end) => end <= b.startSec);
        if (row === -1) row = rowEnds.push(0) - 1;
        rowEnds[row] = b.endSec;
        b.row = row;
      });
    const railRows = Math.max(1, rowEnds.length);

    // Busy = hands-on time only: whole hands-on steps plus the moments of
    // unattended ones. Rail time is free and does not count.
    const busySec = occupied.reduce((sum, o) => sum + (o.endSec - o.startSec), 0);
    return { cook, index, steps, blocks, busySec, railRows };
  });

  // One track per physical burner, pot, board, wok, oven actually used.
  // This is where the long unattended work lives, and it also exposes
  // equipment contention the scheduler has always enforced silently.
  const gearLanes = equipmentLanes(schedule.steps, nodes).map((lane) => ({
    ...lane,
    steps: lane.stepIds
      .map((id) => schedule.steps.find((s) => s.id === id))
      .filter(Boolean)
      .sort((a, b) => a.startSec - b.startSec)
      .map((s) => {
        const node = byId[s.id];
        const attended = isAttended(node);
        return { ...s, node, attended, moments: attended ? [] : unattendedEvents(node, s.startSec) };
      }),
  }));

  const progress = run ? runProgress(run, nodes, Date.now()) : null;

  // A guessed step name ("select the simmer" heard as a near match) asks
  // before it opens anything — same reasoning and same shape as the
  // recipe graph's step matching.
  const [pendingConfirm, setPendingConfirm] = useState(null);
  useEffect(() => {
    if (!pendingConfirm) return undefined;
    const answer = (yes) => () => {
      setPendingConfirm(null);
      if (yes) pendingConfirm.onYes();
    };
    const unregister = registerVoiceCommands(
      [
        { phrases: [CONFIRM_YES_PATTERN], label: "Got it.", run: answer(true) },
        { phrases: [CONFIRM_NO_PATTERN], label: "Okay.", run: answer(false) },
      ],
      { priority: 20, exclusive: true }
    );
    // Expires on its own so a stray "yes" later isn't read as an answer.
    const timer = setTimeout(() => setPendingConfirm(null), 10_000);
    return () => {
      unregister();
      clearTimeout(timer);
    };
  }, [pendingConfirm]);

  // Voice. Only the top layer listens, so the abandon dialog and the
  // kitchen form (which register their own exclusive layers) already
  // silence this set while open; nothing is live while the plan is still syncing.
  useEffect(() => {
    if (!approved) return undefined;
    const lockedMsg = "Mode is locked while a cook is in progress.";
    const pickMode = (nextMode, name) => () => {
      if (run) return lockedMsg;
      setMode(nextMode);
      return `${name} selected.`;
    };
    const needsCoop = (what) => `${what} only applies to the co-op timeline — pick co-op first.`;

    const commands = [
      { phrases: [/\bco ?-?op(?:eration)?\b/, /\bcooperat(?:ive|ion)\b/], run: pickMode("cooperation", "Co-op") },
      { phrases: [/\bversus\b/, /\bcompetition\b/, /\bcompetitive\b/, /\bvs\b/], run: pickMode("competition", "Versus") },
    ];

    if (run) {
      commands.push({
        phrases: [/\bgo live\b/, /\bback to the cook\b/, /\b(?:see|show) (?:the )?result\b/],
        label: runEnded ? "Opening the result." : "Back to the cook.",
        run: () => navigate("/session/live-cook"),
      });
      if (!runEnded) {
        commands.push({
          // Destroys the run, so a yes/no is not enough — same as Home.
          phrases: [/\b(?:abandon|abort|discard) (?:the |this )?(?:cook|run|session)\b/],
          confirmPhrase: ABANDON_PHRASE,
          label: "Cook abandoned.",
          run: abandonRun,
        });
      }
    } else if (canStart) {
      commands.push({
        phrases: [/\bgo live\b/, /\bstart (?:the )?(?:cook|cooking)\b/],
        confirm: "Go live? Say yes or no.",
        label: "Going live.",
        run: goLive,
      });
    } else {
      commands.push({
        phrases: [/\bgo live\b/, /\bstart (?:the )?(?:cook|cooking)\b/],
        run: () =>
          hasLoop
            ? "Can't go live yet — some steps depend on each other in a loop. Say “back to the recipe graph” to fix it."
            : "Pick co-op or versus first, then say go live.",
      });
    }

    commands.push({
      phrases: [/\b(?:back to|go to|open|show) (?:the )?recipe (?:graph|board)\b/, /\bfix (?:the )?loop\b/],
      label: "Opening the recipe graph.",
      run: () => navigate("/session/inventory"),
    });

    if (kitchenProfile) {
      commands.push({
        phrases: [/\bedit (?:the )?kitchen(?: profile)?\b/],
        label: "Opening the kitchen form.",
        run: () => setEditingKitchen(true),
      });
    }

    // ---- Co-op timeline: zoom, details, free time ----
    const zoomBy = (delta) => () => {
      if (!isCoop) return needsCoop("Zoom");
      const next = ZOOM_STOPS[Math.min(ZOOM_STOPS.length - 1, Math.max(0, ZOOM_STOPS.indexOf(zoom) + delta))];
      if (next === zoom) return delta > 0 ? "Already at the closest zoom." : "Already zoomed all the way out.";
      setZoom(next);
      return next === "Fit" ? "Fit to screen." : `Zoom ${next}.`;
    };
    commands.push(
      {
        phrases: [/\bzoom (?:to )?fit\b/, /\bfit (?:the )?(?:timeline|plan|schedule|screen)\b/, /^fit$/, /\breset zoom\b/],
        run: () => {
          if (!isCoop) return needsCoop("Zoom");
          setZoom("Fit");
          return "Fit to screen.";
        },
      },
      { phrases: [/\bzoom in\b/, /\bzoom closer\b/], run: zoomBy(1) },
      { phrases: [/\bzoom out\b/], run: zoomBy(-1) },
      {
        phrases: [/\b(?:close|hide|dismiss) (?:the )?(?:details|panel|sheet|step)\b/],
        run: () => {
          if (!selectedStepId) return "Nothing is open.";
          setSelectedStepId(null);
          return "Closed.";
        },
      },
      {
        phrases: [/\b(?:select|open|show details (?:for|on|of)|details (?:for|on|of)) (?:the )?(?:step |task )?(.+)$/],
        run: (m) => {
          if (!isCoop) return needsCoop("Step details");
          const ids = schedule.steps.map((s) => s.id);
          const labelOf = (id) => byId[id]?.label;
          const match = matchStepName((m?.[1] || "").trim(), ids, labelOf);
          if (match.confidence === "none") return "I couldn't tell which step you meant.";
          const open = () => setSelectedStepId(match.stepId);
          if (match.confidence === "exact") {
            open();
            return `Showing “${match.label}.”`;
          }
          const question = `Show “${match.label}”? Say yes or no.`;
          setPendingConfirm({ question, onYes: open });
          return question;
        },
      },
      {
        // "When do I get free" has a subject in it, which the conversation
        // filter would otherwise throw away.
        allowSubject: true,
        phrases: [
          /\bwhen (?:am i|are we|do i|do we|can i|can we|is \S+) (?:get |be )?(?:a )?(?:free|break)\b/,
          /\bfree time\b/,
          /\bwho(?:'s| is) free\b/,
        ],
        run: () => {
          if (!isCoop) return needsCoop("Free time");
          const lines = cooks
            .map((cook) => {
              const windows = cookFreeWindows(
                schedule.steps.filter((s) => s.cookId === cook.id),
                byId
              ).slice(0, 3);
              if (!windows.length) return null;
              const spans = windows
                .map((w) => `${formatClock(w.startSec)}–${formatClock(w.endSec)} while “${byId[w.stepIds[0]]?.label}” cooks`)
                .join(", ");
              return `${cook.name}: ${spans}`;
            })
            .filter(Boolean);
          return lines.length ? `Free stretches — ${lines.join(". ")}.` : "Nobody gets free time — nothing runs on its own in this plan.";
        },
      }
    );

    return registerVoiceCommands(commands);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approved, run, runEnded, mode, canStart, hasLoop, kitchenProfile, zoom, selectedStepId, schedule, byId, cooks, isCoop]);

  // `approved` is null only while the session is still syncing; the plan
  // itself is one synchronous pass, so this is a short wait, not a staged
  // beat. It uses the same chef screen as the recipe generation on
  // Inventory, with no "done" hold: the page is simply there once ready.
  // ?preview=loading pins this screen (dev only, see dev/preview.js).
  if (!approved || devPreview()) {
    const who = cooks.map((c) => c.name).filter(Boolean);
    return (
      <ChefWorkingScreen
        eyebrow="Lining up the kitchen"
        title={<>Who does what,<br />and when.</>}
        desc={<>Your chef is sorting the steps between you,<br /> so the timing works out.</>}
        live="Building your plan"
        details={[who.length ? who.join(" + ") : "Your cooks", kitchenProfile?.name || "Your kitchen"]}
      />
    );
  }

  const selectedStep = selectedStepId ? stepById[selectedStepId] : null;
  const selectedNode = selectedStepId ? byId[selectedStepId] : null;
  const selected =
    selectedStep && selectedNode
      ? {
          step: selectedStep,
          node: selectedNode,
          dish: dishOf(selectedStep.id),
          cook: cookById[selectedStep.cookId],
          cookIndex: cookIndexById[selectedStep.cookId],
          isCritical: schedule.criticalStepIds.has(selectedStep.id),
          waitLabel: selectedStep.startSec > selectedStep.dependsReadySec ? waitLabelFor(selectedStep.startCause) : null,
        }
      : null;

  const metaBits = [approved.title];
  if (approved.servings != null) metaBits.push(<><Mono>{approved.servings}</Mono> servings</>);
  metaBits.push(<><Mono>{nodes.length}</Mono> steps</>);
  if (kitchenProfile?.name) metaBits.push(kitchenProfile.name);

  return (
    <section className="page schedule-page">
      <header className="sch-title-row">
        <h1>Schedule</h1>
        <span className="sch-meta">
          {metaBits.map((bit, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {bit}
            </span>
          ))}
        </span>
      </header>

      {/* ---- Mode picker — first, because everything below changes with it ---- */}
      <div className="sch-modes-wrap">
        <div className="sch-modes" role="radiogroup" aria-label="Mode">
          <ModeCard
            glyph="fork-branch"
            title="Co-op"
            body="Follow the agent's assignment. Every “done” re-plans the rest. Goal: fastest dinner."
            selected={isCoop}
            locked={Boolean(run)}
            onSelect={() => setMode("cooperation")}
          />
          <ModeCard
            glyph="trophy"
            title="Versus"
            body="Only the opening hand is dealt. Claim the rest by voice. Score on difficulty."
            selected={isVersus}
            locked={Boolean(run)}
            onSelect={() => setMode("competition")}
          />
        </div>
        {run && <span className="sch-meta">{runEnded ? "This cook is finished — the mode is part of its record." : "Mode is locked while a cook is in progress."}</span>}
      </div>

      {mode && (
        <>
          {/* ---- Plan HUD ---- */}
          <div className="sch-hud">
            <div className="sch-tiles">
              {isCoop ? (
                <>
                  <div className="sch-tile sch-roll">
                    <span className="sch-tile-value-row">
                      <KpIcon glyph="timer" size={20} />
                      <Mono className="sch-tile-value">{finish}</Mono>
                    </span>
                    <span className="sch-tile-label">finish in</span>
                  </div>
                  {schedule.savedSec > 0 && (
                    <div className="sch-tile sch-roll" style={{ animationDelay: "60ms" }}>
                      <Mono className="sch-tile-value">{formatClock(schedule.savedSec)}</Mono>
                      <span className="sch-tile-label">faster than solo</span>
                    </div>
                  )}
                  <div className="sch-tile sch-roll" style={{ animationDelay: "120ms" }}>
                    <Mono className="sch-tile-value">{schedule.steps.length}</Mono>
                    <span className="sch-tile-label">steps</span>
                  </div>
                </>
              ) : (
                <div className="sch-tile sch-roll">
                  <Mono className="sch-tile-value">{opening.poolIds.length + opening.lockedIds.length}</Mono>
                  <span className="sch-tile-label">steps up for grabs</span>
                </div>
              )}
            </div>
            <div className="sch-player-chips">
              {lanes.map(({ cook, index, steps, busySec }) => {
                const bundle = opening.bundles.find((b) => b.cookId === cook.id);
                return (
                  <span className="sch-player-chip" key={cook.id}>
                    <PlayerAvatar cook={cook} index={index} size={20} />
                    <span className="sch-player-chip-name">{cook.name}</span>
                    <Mono className="sch-player-chip-meta">
                      {isCoop ? (
                        <>
                          {steps.length} steps · {formatClock(busySec)}
                        </>
                      ) : (
                        <>{formatClock(bundle?.totalSec || 0)} hands-on to open</>
                      )}
                    </Mono>
                  </span>
                );
              })}
            </div>
          </div>

          {/* ---- Warnings ---- */}
          {lacking.length > 0 && (
            <div className="sch-notice is-warning" role="status">
              <span>
                Planned with {lacking.map((e) => `a ${EQUIPMENT_LABELS[e] || e}`).join(" and ")} {kitchenProfile?.name || "this kitchen"} doesn&rsquo;t
                have — timings assume you&rsquo;ll manage one. Real waits will be longer.
              </span>
              {kitchenProfile && (
                <button type="button" className="btn btn-ghost sch-notice-btn" onClick={() => setEditingKitchen(true)}>
                  Edit kitchen
                </button>
              )}
            </div>
          )}
          {hasLoop && (
            <div className="sch-notice is-error" role="alert">
              <span>
                <Mono>{schedule.unscheduledIds.length}</Mono> steps depend on each other in a loop — there&rsquo;s no order that works. Break the
                loop on the recipe graph: {schedule.unscheduledIds.map((id) => byId[id]?.label || id).join(", ")}.
              </span>
              <button type="button" className="btn sch-notice-btn" onClick={() => navigate("/session/inventory")}>
                Back to the recipe graph
              </button>
            </div>
          )}

          {/* ---- The plan ---- */}
          {isCoop ? (
            <Timeline
              lanes={lanes}
              gearLanes={gearLanes}
              cookIndexById={cookIndexById}
              makespanSec={schedule.makespanSec}
              criticalStepIds={schedule.criticalStepIds}
              zoom={zoom}
              onZoom={setZoom}
              selectedStepId={selectedStepId}
              onSelect={(id) => setSelectedStepId((cur) => (cur === id ? null : id))}
              selected={selected}
              onClose={() => setSelectedStepId(null)}
            />
          ) : (
            <OpeningHand opening={opening} cooks={cooks} byId={byId} dishOf={dishOf} />
          )}
        </>
      )}

      {/* ---- Footer band ---- */}
      <div className="sch-footer">
        {mode ? (
          <Mono className="sch-footer-tag">
            {isCoop ? `Co-op · finish in ${finish}` : `Versus · ${opening.poolIds.length + opening.lockedIds.length} steps to claim`}
          </Mono>
        ) : (
          <span className="sch-footer-hint">Pick Co-op or Versus to go live.</span>
        )}
        <div className="sch-footer-actions">
          {run && !runEnded && (
            <button type="button" className="btn btn-ghost sch-btn-abandon" onClick={() => setConfirmAbandon(true)}>
              Abandon this cook
            </button>
          )}
          {run ? (
            <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate("/session/live-cook")}>
              {runEnded ? "See the result" : "Back to the cook"} &rarr;
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-lg" disabled={!canStart} onClick={goLive}>
              Go live &rarr;
            </button>
          )}
        </div>
      </div>

      {confirmAbandon && progress && (
        <Modal label="Abandon this cook?" onClose={() => setConfirmAbandon(false)} panelClassName="sch-modal">
          <span className="sch-modal-title">Abandon this cook?</span>
          <p className="sch-modal-body">
            You lose <Mono className="sch-modal-num">{progress.done}</Mono> completed {progress.done === 1 ? "step" : "steps"} and{" "}
            <Mono className="sch-modal-num">{formatClock(progress.elapsedSec)}</Mono> on the clock. This can&rsquo;t be undone.
          </p>
          <div className="sch-modal-actions">
            <button type="button" className="btn btn-ghost sch-btn-keep" onClick={() => setConfirmAbandon(false)}>
              Keep cooking
            </button>
            <button type="button" className="btn sch-btn-danger" onClick={abandonRun}>
              Abandon
            </button>
          </div>
        </Modal>
      )}

      {editingKitchen && kitchenProfile && (
        <KitchenProfileFormModal
          profile={kitchenProfile}
          error={kitchenError}
          onSave={saveKitchen}
          onClose={() => {
            setEditingKitchen(false);
            setKitchenError(null);
          }}
        />
      )}
    </section>
  );
}

function ModeCard({ glyph, title, body, selected, locked, onSelect }) {
  // The radio is named by its title alone; the body is its description
  // and the "Selected" chip is decorative (aria-checked already says so).
  const bodyId = `sch-mode-body-${title.toLowerCase().replace(/[^a-z]/g, "")}`;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={title}
      aria-describedby={bodyId}
      className={`sch-mode ${selected ? "is-selected" : ""} ${locked ? "is-locked" : ""}`}
      disabled={locked}
      onClick={onSelect}
    >
      {selected && (
        <span className="sch-mode-chip" aria-hidden="true">
          <KpIcon glyph="checkmark-burst" size={16} />
          <span className="sch-mode-chip-text">Selected</span>
        </span>
      )}
      <KpIcon glyph={glyph} size={24} className="sch-mode-glyph" />
      <span className="sch-mode-title">{title}</span>
      <span className="sch-mode-body" id={bodyId}>
        {body}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------
// Co-op → timeline ("Who does what, when")
// ---------------------------------------------------------------

function pickTickStepMinutes(pxPerMin) {
  return TICK_STEPS_MIN.find((s) => s * pxPerMin >= TICK_MIN_PX) || TICK_STEPS_MIN[TICK_STEPS_MIN.length - 1];
}

function Timeline({ lanes, gearLanes, cookIndexById, makespanSec, criticalStepIds, zoom, onZoom, selectedStepId, onSelect, selected, onClose }) {
  const scrollRef = useRef(null);
  const [fitPxPerMin, setFitPxPerMin] = useState(FIT_FALLBACK_PX_PER_MIN);
  const makespanMin = Math.max(makespanSec / 60, 1);

  // "Fit" means the whole plan is visible: measure the scroll container
  // and size the track to it (re-measured on resize).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const measure = () => {
      const width = el.clientWidth - TRACK_END_PADDING;
      if (width > 0) setFitPxPerMin(Math.max(FIT_MIN_PX_PER_MIN, width / makespanMin));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [makespanMin]);

  const pxPerMin = zoom === "Fit" ? fitPxPerMin : ZOOM_PX_PER_MIN[zoom];
  const pxFor = (sec) => (sec / 60) * pxPerMin;
  const trackWidth = Math.round(pxFor(makespanSec)) + TRACK_END_PADDING;
  const tickStep = pickTickStepMinutes(pxPerMin);
  const ticks = [];
  // The last regular tick stays clear of the end label.
  for (let m = 0; m * 60 <= makespanSec - tickStep * 30; m += tickStep) ticks.push(m);

  const isMobile = useMediaQuery("(max-width: 720px)");

  return (
    <div className="sch-card">
      <div className="sch-card-head">
        <span className="sch-card-title">Who does what, when</span>
        <div className="sch-card-tools">
          <span className="sch-legend">
            <span className="sch-legend-item">
              <span className="sch-legend-swatch is-critical" /> Critical path
            </span>
            <span className="sch-legend-item">
              <span className="sch-legend-swatch is-wait" /> Waiting
            </span>
            <span className="sch-legend-item">
              <span className="sch-legend-swatch is-rail" /> Cooking on its own
            </span>
            <span className="sch-legend-item">
              <span className="sch-legend-swatch is-moment" /> Hands-on moment
            </span>
          </span>
          <span className="sch-zoom">
            <span className={`mono sch-zoom-stop ${zoom === "Fit" ? "is-on" : ""}`}>Fit</span>
            <input
              type="range"
              className="sch-zoom-slider"
              min={0}
              max={ZOOM_STOPS.length - 1}
              step={1}
              value={ZOOM_STOPS.indexOf(zoom)}
              onChange={(e) => onZoom(ZOOM_STOPS[Number(e.target.value)])}
              aria-label="Timeline zoom"
              aria-valuetext={zoom}
            />
            <span className={`mono sch-zoom-stop ${zoom === "1×" ? "is-on" : ""}`}>1×</span>
            <span className={`mono sch-zoom-stop ${zoom === "2×" ? "is-on" : ""}`}>2×</span>
          </span>
        </div>
      </div>

      <div className="sch-track-wrap">
        <div className="sch-lane-labels">
          <div className="sch-ruler-spacer" />
          {lanes.map(({ cook, index, busySec, railRows }) => (
            <div className={`sch-lane-label is-${playerKey(index)}`} key={cook.id} style={{ "--sch-rail-rows": railRows }}>
              <PlayerAvatar cook={cook} index={index} size={32} />
              <span className="sch-lane-label-text">
                <span className="sch-lane-name">{cook.name}</span>
                <Mono className="sch-lane-busy">
                  {formatClock(busySec)}
                  <span className="sch-long"> busy</span>
                </Mono>
              </span>
            </div>
          ))}

          {gearLanes.length > 0 && (
            <div className="sch-lane-group-head">
              <span className="sch-eyebrow">Equipment</span>
            </div>
          )}
          {gearLanes.map((lane) => (
            <div className="sch-lane-label is-equipment" key={`${lane.type}-${lane.index}`} title={lane.label}>
              <KpIcon glyph={EQUIPMENT_GLYPHS[lane.type] || "timer"} size={20} className="sch-lane-glyph" />
              <span className="sch-lane-name sch-long">{capitalize(lane.label)}</span>
              {/* Glyph-only on a phone: two burners still need telling apart. */}
              {/\d$/.test(lane.label) && <Mono className="sch-lane-index sch-short">{lane.index}</Mono>}
            </div>
          ))}
        </div>

        <div className="sch-scroll" ref={scrollRef}>
          <div className="sch-track" style={{ minWidth: trackWidth, "--sch-grid": `${Math.round(5 * pxPerMin)}px` }}>
            <div className="sch-ruler">
              {ticks.map((m) => (
                <span className="mono sch-tick" key={m} style={{ left: Math.round(pxFor(m * 60)) }}>
                  {formatClock(m * 60)}
                </span>
              ))}
              <span className="mono sch-tick is-end" style={{ left: Math.round(pxFor(makespanSec)) }}>
                {formatClock(makespanSec)}
              </span>
            </div>

            {lanes.map(({ cook, index, blocks, railRows }) => (
              <div className={`sch-lane is-${playerKey(index)}`} key={cook.id} style={{ "--sch-rail-rows": railRows }}>
                <div className="sch-rail-zone" aria-hidden="true" />
                {blocks.map((b, i) => {
                  const left = Math.round(pxFor(b.startSec));
                  const width = Math.max(10, Math.round(pxFor(b.endSec - b.startSec)) - 3);
                  const durationSec = b.endSec - b.startSec;
                  const delay = `${i * 40}ms`;
                  const style = { left, width, animationDelay: delay };
                  if (b.kind === "wait") {
                    return (
                      <div
                        className={`sch-block is-wait ${width < 96 ? "is-narrow" : ""} ${width < 64 ? "is-tight" : ""}`}
                        key={b.id}
                        style={style}
                        title={b.label}
                        role="img"
                        aria-label={`${b.label} · ${formatClock(durationSec)}`}
                      >
                        {width >= RUNG_WAIT_PX && <span className="sch-block-label">{b.label}</span>}
                        {width < RUNG_WAIT_PX && width >= RUNG_DURATION_PX && <span className="sch-block-label">Waiting</span>}
                      </div>
                    );
                  }
                  const isCritical = criticalStepIds.has(b.id);
                  const isSelected = selectedStepId === b.id;
                  if (b.kind === "unattended") {
                    return (
                      <UnattendedStep
                        key={b.id}
                        block={b}
                        player={playerKey(index)}
                        pxFor={pxFor}
                        delay={delay}
                        isCritical={isCritical}
                        isSelected={isSelected}
                        onSelect={() => onSelect(b.id)}
                      />
                    );
                  }
                  const rung = width >= RUNG_FULL_PX ? "full" : width >= RUNG_NAME_PX ? "name" : width >= RUNG_DURATION_PX ? "dur" : "bare";
                  const equipment = b.step.requiredEquipment[0];
                  return (
                    <button
                      type="button"
                      className={`sch-block is-task is-${playerKey(index)} ${isCritical ? "is-critical" : ""} ${
                        isSelected ? "is-selected" : ""
                      } ${width < 96 ? "is-narrow" : ""} ${width < 64 ? "is-tight" : ""}`}
                      key={b.id}
                      style={style}
                      title={`${b.node?.label} · ${formatClock(durationSec)}`}
                      aria-label={`${b.node?.label} · ${formatClock(durationSec)}`}
                      aria-pressed={isSelected}
                      onClick={() => onSelect(b.id)}
                    >
                      {(rung === "full" || rung === "name") && <span className="sch-block-label">{fitLabel(b.node?.label, width)}</span>}
                      {rung === "full" && (
                        <Mono className="sch-block-meta">
                          {formatClock(durationSec)}
                          {equipment && ` · ${equipmentLabel(equipment)}`}
                        </Mono>
                      )}
                      {rung === "dur" && <Mono className="sch-block-meta">{formatClock(durationSec)}</Mono>}
                    </button>
                  );
                })}
              </div>
            ))}

            {gearLanes.length > 0 && <div className="sch-lane-group-head-track" aria-hidden="true" />}
            {gearLanes.map((lane) => (
              <div className="sch-lane is-equipment" key={`${lane.type}-${lane.index}`}>
                {lane.steps.map((s, i) => {
                  const left = Math.round(pxFor(s.startSec));
                  const width = Math.max(10, Math.round(pxFor(s.endSec - s.startSec)) - 3);
                  const durationSec = s.endSec - s.startSec;
                  const rung = width >= RUNG_NAME_PX ? "name" : width >= RUNG_DURATION_PX ? "dur" : "bare";
                  const owner = playerKey(cookIndexById[s.cookId] ?? 0);
                  const count = s.moments.filter((m) => m.kind === "checkpoint").length;
                  return (
                    // Who has the wok at 9:00: the block is the OWNING
                    // player's tint for the step's whole span. Not
                    // selectable — the same step is already the
                    // selectable thing on its cook's lane. On unattended
                    // steps the ticks are the moments the pot gets touched.
                    <div
                      key={s.id}
                      className={`sch-block is-equipment is-${owner} ${width < 96 ? "is-narrow" : ""} ${width < 64 ? "is-tight" : ""}`}
                      style={{ left, width, animationDelay: `${i * 40}ms` }}
                      title={`${s.node?.label} · ${formatClock(durationSec)}${s.attended ? "" : " · runs on its own"}`}
                      role="img"
                      aria-label={`${s.node?.label} · ${formatClock(durationSec)}${s.attended ? "" : ", cooking on its own"}`}
                    >
                      {rung === "name" && <span className="sch-block-label">{fitLabel(s.node?.label, width)}</span>}
                      {rung === "dur" && <Mono className="sch-block-meta">{formatClock(durationSec)}</Mono>}
                      {s.moments.map((m) => (
                        <span
                          key={`${m.kind}-${m.index}`}
                          className={`sch-equipment-tick is-${m.kind}`}
                          style={{ left: Math.round(pxFor(m.atSec - s.startSec)) }}
                          title={momentName(m, count)}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="sch-card-foot">
        {selected && !isMobile ? (
          <TaskDetail {...selected} onClose={onClose} scrollIntoView />
        ) : (
          <span className="sch-meta">Tap any task — blocks or a rail — for its exact timing.</span>
        )}
        {/* On a phone the panel is a bottom sheet, portaled past .page's
            transform so `position: fixed` is measured from the viewport. */}
        {selected && isMobile && createPortal(<TaskDetail {...selected} sheet onClose={onClose} />, document.body)}
      </div>
    </div>
  );
}

// An unattended step on its owner's lane: the run rail along the
// bottom for the whole span, one block per hands-on moment on top, and
// a short tick joining each moment to the rail. All one selectable
// thing — the rail is the focusable button, the moments are click
// targets that stay out of the tab order so a step is one stop, not
// five.
function UnattendedStep({ block, player, pxFor, delay, isCritical, isSelected, onSelect }) {
  const { node, moments, startSec, endSec } = block;
  const durationSec = endSec - startSec;
  const railLeft = Math.round(pxFor(startSec));
  const railWidth = Math.max(MOMENT_MIN_PX, Math.round(pxFor(durationSec)));
  const checkCount = moments.filter((m) => m.kind === "checkpoint").length;
  const tending = tendingLabel(node);

  // The rail carries the step name; the longer "· runs on its own 8:30"
  // form only when it fits outright.
  const railText = `${node?.label} · runs on its own ${formatClock(durationSec)}`;
  const railLabel = railWidth - 16 >= railText.length * RAIL_LABEL_PX_PER_CHAR ? railText : node?.label;
  const aria = `${node?.label} · ${tending || "unattended"} · ${formatClock(durationSec)}, hands-on at ${
    moments.map((m) => `${momentName(m, checkCount)} ${formatClock(m.atSec)}`).join(", ") || "no set moments"
  }`;
  const stateClass = `is-${player} ${isCritical ? "is-critical" : ""} ${isSelected ? "is-selected" : ""}`;

  return (
    <>
      <button
        type="button"
        className={`sch-rail ${stateClass} ${railWidth < 60 ? "is-tight" : ""}`}
        style={{ left: railLeft, width: railWidth, animationDelay: delay, "--sch-rail-row": block.row || 0 }}
        title={railText}
        aria-label={aria}
        aria-pressed={isSelected}
        onClick={onSelect}
      >
        {railWidth >= RAIL_LABEL_MIN_PX && <span className="sch-rail-label">{railLabel}</span>}
      </button>
      {moments.map((m) => {
        const width = Math.max(MOMENT_MIN_PX, Math.round(pxFor(m.endSec - m.atSec)));
        const left = Math.round(pxFor(m.atSec));
        const pad = width < 64 ? 2 : 8;
        const avail = width - 2 * pad;
        const name = momentName(m, checkCount);
        const short = momentShort(m, checkCount);
        const dur = formatClock(m.endSec - m.atSec);
        const fits = (text) => text.length * MOMENT_LABEL_PX_PER_CHAR + 2 <= avail;
        const fitsDur = dur.length * MOMENT_MONO_PX_PER_CHAR + 1 <= avail;
        const label = fits(name) ? name : fits(short) ? short : null;
        const key = `${m.kind}-${m.index}`;
        return (
          <span key={key} className="sch-moment-group">
            <span className={`sch-moment-tick is-${player}`} style={{ left: left + Math.round(width / 2) - 1, animationDelay: delay, "--sch-rail-row": block.row || 0 }} aria-hidden="true" />
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              className={`sch-block is-task is-moment is-${m.kind} ${label ? "" : "is-bare"} ${stateClass} ${width < 110 ? "is-narrow" : ""} ${width < 64 ? "is-tight" : ""}`}
              style={{ left, width, animationDelay: delay }}
              title={`${name} · ${formatClock(m.atSec)} · ${dur}`}
              onClick={onSelect}
            >
              {label && <span className="sch-moment-label">{label}</span>}
              {fitsDur && <Mono className="sch-block-meta">{dur}</Mono>}
            </button>
          </span>
        );
      })}
    </>
  );
}

function TaskDetail({ step, node, dish, cook, cookIndex, isCritical, waitLabel, sheet = false, scrollIntoView = false, onClose }) {
  const flames = DIFFICULTY_FLAMES[node.difficulty] || 1;
  const durationSec = step.endSec - step.startSec;
  // "Takes" stays the whole span; the free-time line under the moments
  // is where the difference is explained.
  const moments = isAttended(node) ? [] : unattendedEvents(node, step.startSec);
  const checkCount = moments.filter((m) => m.kind === "checkpoint").length;
  const freeSec = Math.max(0, durationSec - moments.reduce((sum, m) => sum + (m.endSec - m.atSec), 0));
  const rootRef = useRef(null);
  const closeRef = useRef(null);

  // Inline panel: it lives below the timeline, under the sticky footer
  // at most viewport heights, so bring it up when the selection changes
  // (scroll-margin-bottom in CSS clears the footer + VoiceBar).
  useEffect(() => {
    if (scrollIntoView) rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [scrollIntoView, step.id]);

  // Sheet: behaves like a dialog — focus lands on Close, Esc dismisses.
  useEffect(() => {
    if (!sheet) return undefined;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, onClose]);

  const panel = (
    <div ref={rootRef} className={`sch-detail ${sheet ? "is-sheet" : ""}`} role={sheet ? "dialog" : undefined} aria-modal={sheet || undefined} aria-label={node.label}>
      {sheet && <span className="sch-sheet-handle" aria-hidden="true" />}
      <button ref={closeRef} type="button" className="btn btn-ghost sch-detail-close" onClick={onClose}>
        Close
      </button>
      <div className="sch-detail-head">
        <span className="sch-eyebrow">{dish || "Step"}</span>
        <span className="sch-detail-title-row">
          <span className="sch-detail-title">{node.label}</span>
          <TendingChip node={node} />
        </span>
        {node.description && <span className="sch-detail-desc">{node.description}</span>}
      </div>
      {moments.length > 0 && (
        <div className="sch-detail-moments">
          <span className="sch-eyebrow">Hands-on moments</span>
          <span className="sch-moments-row">
            {moments.map((m) => (
              <span className="sch-moment-item" key={`${m.kind}-${m.index}`}>
                <span className="sch-moment-item-name">{momentName(m, checkCount)}</span>
                <span className="sch-moment-item-dot">·</span>
                <Mono>{formatClock(m.atSec)}</Mono>
                <span className="sch-moment-item-dot">·</span>
                <Mono className="sch-moment-item-dur">{formatClock(m.endSec - m.atSec)}</Mono>
              </span>
            ))}
          </span>
          {tendingOf(node) === TENDING.SET_AND_FORGET ? (
            <span className="sch-meta">Runs on its own — nothing to come back for.</span>
          ) : (
            <span className="sch-meta">
              Runs on its own for <Mono className="sch-detail-free">{formatClock(freeSec)}</Mono> — you&rsquo;re free in between.
            </span>
          )}
        </div>
      )}
      <div className="sch-detail-grid">
        <div>
          <span className="sch-eyebrow">Starts</span>
          <Mono className="sch-detail-value">{formatClock(step.startSec)}</Mono>
        </div>
        <div>
          <span className="sch-eyebrow">Ends</span>
          <Mono className="sch-detail-value">{formatClock(step.endSec)}</Mono>
        </div>
        <div>
          <span className="sch-eyebrow">Takes</span>
          <Mono className="sch-detail-value">{formatClock(durationSec)}</Mono>
        </div>
        <div>
          <span className="sch-eyebrow">Player</span>
          <span className="sch-detail-player">
            <PlayerAvatar cook={cook} index={cookIndex} size={24} />
            <span>{cook?.name || "—"}</span>
          </span>
        </div>
        <div>
          <span className="sch-eyebrow">Equipment</span>
          <span className="sch-detail-text">
            {step.requiredEquipment.length ? step.requiredEquipment.map(equipmentLabel).join(", ") : "None"}
          </span>
        </div>
        <div>
          <span className="sch-eyebrow">Difficulty</span>
          <span className="sch-difficulty" aria-label={`${node.difficulty} difficulty`}>
            {Array.from({ length: flames }, (_, i) => (
              <KpIcon glyph="flame" size={16} key={i} />
            ))}
          </span>
        </div>
      </div>
      {waitLabel && <span className="sch-detail-note is-warning">&#9888; {waitLabel}</span>}
      {isCritical && <span className="sch-detail-note is-critical">On the critical path — if this runs late, dinner runs late.</span>}
    </div>
  );
  if (!sheet) return panel;
  return (
    <>
      <div className="sch-sheet-scrim" onClick={onClose} aria-hidden="true" />
      {panel}
    </>
  );
}

// ---------------------------------------------------------------
// Versus → opening hand
// ---------------------------------------------------------------

function OpeningHand({ opening, cooks, byId, dishOf }) {
  const { bundles, poolIds, lockedIds, contested, skewSec } = opening;
  const durationOf = (id) => byId[id]?.estimated_duration_sec || 0;
  const grabsTotalSec = [...poolIds, ...lockedIds].reduce((sum, id) => sum + durationOf(id), 0);

  return (
    <div className="sch-card sch-card-versus">
      <div className="sch-card-head">
        <span className="sch-card-title">Opening hand</span>
        {!contested && skewSec > 0 && <Mono className="sch-card-meta">{formatClock(skewSec)} apart at the start</Mono>}
      </div>

      {contested ? (
        <div className="sch-notice is-warning sch-notice-inset" role="status">
          <span>
            Only {plural(poolIds.length, "task")} can start right now — not enough to deal everyone their own. First to claim it by voice
            gets it.
          </span>
        </div>
      ) : (
        <>
          <span className="sch-meta sch-intro">
            Everyone opens with a roughly equal chunk of work, and no two opening tasks fight over the same tool. After that, nothing is
            assigned — claim by voice.
          </span>
          <div className="sch-bundles">
            {bundles.map((bundle) => {
              const index = cooks.findIndex((c) => c.id === bundle.cookId);
              const cook = cooks[index];
              return (
                <div className={`sch-bundle is-${playerKey(index)}`} key={bundle.cookId}>
                  <div className="sch-bundle-head">
                    <PlayerAvatar cook={cook} index={index} size={32} />
                    <span className="sch-bundle-name">{cook?.name}</span>
                    <Mono className="sch-bundle-total">{formatClock(bundle.totalSec)} hands-on to open</Mono>
                  </div>
                  {bundle.stepIds.map((id) => (
                    // "hands-on to open" counts attended time only, so a
                    // long simmer sitting in the same list has to say
                    // what it is or the bundle simply looks wrong. The
                    // chip says it; no rail or moments here — Versus
                    // stays a claim list.
                    <div className="sch-bundle-row" key={id}>
                      <span className="sch-bundle-row-main">
                        <span className="sch-bundle-row-title">
                          <span className="sch-bundle-row-label">{byId[id]?.label}</span>
                          <TendingChip node={byId[id]} />
                        </span>
                        {dishOf(id) && <span className="sch-bundle-row-dish">{dishOf(id)}</span>}
                      </span>
                      <Mono className="sch-bundle-row-dur">{formatClock(durationOf(id))}</Mono>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="sch-grabs">
        <div className="sch-grabs-head">
          <span className="sch-card-title">
            Up for grabs · <Mono className="sch-grabs-total">{formatClock(grabsTotalSec)}</Mono>
          </span>
          <span className="sch-meta">
            {poolIds.length} ready now · {lockedIds.length} not yet · claim by voice
          </span>
        </div>
        <div className="sch-grabs-group">
          <span className="sch-eyebrow is-ready">
            <span className="sch-dot" /> Ready now · {poolIds.length}
          </span>
          <div className="sch-chips">
            {poolIds.map((id) => (
              <span className="sch-chip is-ready" key={id}>
                {byId[id]?.label}
                <TendingChip node={byId[id]} className="is-inset" />
                <Mono className="sch-chip-dur">{formatClock(durationOf(id))}</Mono>
              </span>
            ))}
          </div>
        </div>
        {lockedIds.length > 0 && (
          <div className="sch-grabs-group">
            <span className="sch-eyebrow is-locked">
              <span className="sch-dot" /> Not yet · {lockedIds.length}
            </span>
            <div className="sch-chips">
              {lockedIds.map((id) => (
                <span className="sch-chip is-locked" key={id}>
                  {byId[id]?.label}
                  <TendingChip node={byId[id]} className="is-plain" />
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
