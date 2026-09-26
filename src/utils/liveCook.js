// Live-cook run mechanics. Pure — no DOM, no React — same spirit as
// graphLayout.js and scheduleLayout.js, so the whole state machine is
// testable without mounting anything.
//
// A "run" is the record of an actual cook: what each step's status is,
// who owns it, when it started and ended, plus an append-only event log.
// Everything that can be recomputed (scores, ready pools, elapsed time,
// progress) is derived on read and never stored.
import { scheduleSteps, computeTails, equipmentCapacity } from "./scheduleLayout.js";
import { isAttended, hasDeadline, isOneShot, rewardsTimeliness, effectiveDifficulty } from "./tending.js";

const TRANSCRIPT_LIMIT = 40;
const UNDO_WINDOW_MS = 60_000;
// Mid-run the remaining set is small and the answer is needed between
// taps, so a re-plan trades proof for responsiveness.
const LIVE_REPLAN_NODE_BUDGET = 20_000;
// Mid-cook this runs on every completion with someone standing there
// waiting to see their next step, so it gets a tighter deadline than
// the planning page's.
const LIVE_REPLAN_TIME_BUDGET_MS = 80;

export const DIFFICULTY_POINTS = { low: 10, medium: 20, high: 35 };

/**
 * Starting an unattended step pays for two different things.
 *
 * THE ACT. Putting rice on is a one-minute job whatever the rice goes on
 * to do for the next forty, so the physical part is scored as what it
 * is: a small hands-on task, sized by difficulty. A braise that has to
 * be browned and deglazed before it is left alone is worth more to start
 * than a rice cooker, because it is a harder minute.
 *
 * WHAT IT UNBLOCKS. The rest is the real reason to reward starting: the
 * congee gates the entire evening, and getting it on is the single most
 * valuable move in the run. That is not a property of how hard it is —
 * rice is easy and still decides when everyone eats — so it cannot come
 * from difficulty. It comes from the step's tail, the same measure the
 * claim pool already ranks on, scaled against the longest tail in the
 * run. The step everything waits behind earns the full bonus; a wait
 * that blocks nothing earns none of it.
 *
 * The bonus is ADDED rather than carved out of the step's points, so
 * finishing is always worth the same and there is always a reason to
 * come back to the pot.
 */
export const UNATTENDED_START_SHARE = 0.25;

/**
 * The timeliness bonus, as a share of the step's points.
 *
 * Small on purpose. It rewards being there at the right moment, which is
 * a real skill in a kitchen with three things going, but it must not
 * become the main way to score — that would turn the run into a game of
 * watching clocks rather than cooking.
 */
export const TIMELINESS_SHARE = 0.15;

/**
 * How close counts as on time.
 *
 * Proportional, because eight minutes and forty minutes do not deserve
 * the same tolerance, with a one-minute floor so a short step is not
 * impossible to hit. An ice bath wanting eight minutes accepts roughly
 * seven to nine.
 */
export const timelinessWindowSec = (estSec) => Math.max(60, Math.round(estSec * 0.15));

/**
 * Most the unblocking bonus can add. Set so that the best possible start
 * — an easy wait that gates the whole run, i.e. the congee — is worth
 * exactly one chop of scallions, and no more. Starting the most
 * important thing in the evening should feel worth doing; it should
 * never beat doing actual work.
 */
export const UNATTENDED_UNBLOCK_BONUS = DIFFICULTY_POINTS.low - Math.round(DIFFICULTY_POINTS.low * 0.25);

/**
 * What starting this unattended step pays.
 *
 * `ctx.tailShare` is this step's tail as a fraction of the longest tail
 * in the run, 0 to 1. Omit it and only the act is paid — which is what
 * happens anywhere the graph is not to hand, and is the safe direction
 * to be wrong in.
 */
export function unattendedStartPoints(node, ctx = {}) {
  const full = DIFFICULTY_POINTS[effectiveDifficulty(node)] ?? DIFFICULTY_POINTS.low;
  // Nothing is held back on a step that is finished the moment it is
  // started, so the starter takes all of it.
  const act = isOneShot(node) ? full : Math.max(1, Math.round(full * UNATTENDED_START_SHARE));
  const share = Number.isFinite(ctx.tailShare) ? Math.max(0, Math.min(1, ctx.tailShare)) : 0;
  return act + Math.round(UNATTENDED_UNBLOCK_BONUS * share);
}

/** Every step's tail as a fraction of the longest tail in the run. */
export function tailShares(nodes) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const tails = computeTails(nodes, byId);
  const longest = Math.max(1, ...tails.values());
  return new Map([...tails].map(([id, tail]) => [id, tail / longest]));
}

/**
 * SCORING SEAM — the single place points are decided.
 *
 * Today: flat points per difficulty tier, nothing else. The brief's
 * "difficulty x quality x composure" is deliberately not implemented —
 * quality and composure are undefined there and unobservable with the
 * data this app has, so scoring them would be theatre.
 *
 * To add a factor later (speed against estimate, a quality rating, a
 * composure measure), push another entry into `breakdown` HERE and
 * nowhere else: every caller reads `.points` and renders `.breakdown`
 * generically, so no UI or aggregation code has to change.
 *
 * `ctx` deliberately carries more than today's rule needs so the
 * signature doesn't have to change when a factor is added.
 */
export function scoreStep(node, ctx = {}) {
  if (!node || ctx.record?.status !== "done") return { points: 0, breakdown: [] };
  const difficulty = effectiveDifficulty(node);
  const full = DIFFICULTY_POINTS[difficulty] ?? DIFFICULTY_POINTS.low;
  // An unattended step already paid its starter; this is the rest of it,
  // and like every step's points it goes to the holder.
  const unattended = !isAttended(node);
  // Rice was paid for in full when it went on. Coming back to lift the
  // lid is not work, and paying for it invents an achievement — the step
  // is one task done once, which is what set-and-forget means.
  if (isOneShot(node)) return { points: 0, breakdown: [] };

  const breakdown = [
    {
      key: "difficulty",
      label: unattended ? `${difficulty} step, finished` : `${difficulty} step`,
      points: unattended ? Math.max(0, full - unattendedStartPoints(node)) : full,
    },
  ];

  // Being there when the pot wants you. Only for steps where the moment
  // actually matters — a bare simmer that breaks, an ice bath that wants
  // eight minutes and not fifteen. Scaled by difficulty, because hitting
  // the end of a hard step is a harder thing to have done.
  if (rewardsTimeliness(node) && ctx.record?.startedAt && ctx.record?.endedAt) {
    const actual = Math.max(
      0,
      Math.round((Date.parse(ctx.record.endedAt) - Date.parse(ctx.record.startedAt)) / 1000) - (ctx.record.pausedSec || 0),
    );
    const est = node.estimated_duration_sec || 0;
    if (est > 0 && Math.abs(actual - est) <= timelinessWindowSec(est)) {
      breakdown.push({
        key: "timeliness",
        label: "on time",
        points: Math.max(1, Math.round(full * TIMELINESS_SHARE)),
      });
    }
  }

  return { points: breakdown.reduce((sum, b) => sum + b.points, 0), breakdown };
}

const emptyRecord = () => ({
  status: "pending",
  cookId: null,
  startedAt: null,
  endedAt: null,
  source: null,
  skipReason: null,
  // Seconds this step spent inside a pause. Subtracted from its actual
  // time so a break doesn't read as the cook being slow.
  pausedSec: 0,
});

export function makeStepRecords(nodes) {
  return Object.fromEntries(nodes.map((n) => [n.id, emptyRecord()]));
}

function pushEvent(run, event) {
  return {
    ...run,
    events: [...run.events, { id: crypto.randomUUID(), ...event }],
  };
}

function patchStep(run, stepId, patch) {
  return { ...run, steps: { ...run.steps, [stepId]: { ...run.steps[stepId], ...patch } } };
}

export function appendTranscript(run, entry) {
  const next = [...run.transcript, { id: crypto.randomUUID(), ...entry }];
  return { ...run, transcript: next.slice(-TRANSCRIPT_LIMIT) };
}

function planFromSchedule(schedule) {
  if (!schedule?.steps?.length) return null;
  const order = {};
  [...schedule.steps]
    .sort((a, b) => a.startSec - b.startSec)
    .forEach((s) => {
      if (!order[s.cookId]) order[s.cookId] = [];
      order[s.cookId].push(s.id);
    });
  return {
    computedAt: new Date().toISOString(),
    makespanSec: schedule.makespanSec,
    order,
    startSecById: Object.fromEntries(schedule.steps.map((s) => [s.id, s.startSec])),
  };
}

export function createRun({ nodes, mode, schedule, opening, now = new Date() }) {
  const isCompetition = mode === "competition";
  return {
    startedAt: now.toISOString(),
    endedAt: null,
    // Snapshot: the run never re-reads session.mode, so changing it
    // mid-cook can't desync what's already happened.
    mode,
    steps: makeStepRecords(nodes),
    // Closed pause time, and the open pause if one is running. Time
    // spent paused is nobody's cooking time.
    pausedSec: 0,
    pausedAt: null,
    events: [{ id: crypto.randomUUID(), at: now.toISOString(), type: "run_start", cookId: null, stepId: null }],
    plan: isCompetition ? null : planFromSchedule(schedule),
    openingSuggestions:
      isCompetition && opening && !opening.contested
        ? Object.fromEntries(opening.bundles.map((b) => [b.cookId, b.stepIds]))
        : null,
    transcript: [
      {
        id: crypto.randomUUID(),
        at: now.toISOString(),
        speaker: "agent",
        text: isCompetition
          ? "Pool's open. Claim what you want — say \"take\" and the task name, or tap it."
          : "Let's cook. Say \"done\" when you finish a step, or tap the button.",
      },
    ],
  };
}

/** Defensive: the graph could have changed under a stored run. Returns
 *  the same object when nothing differs so useMemo identity holds. */
export function reconcileRun(run, nodes) {
  if (!run) return run;
  const ids = new Set(nodes.map((n) => n.id));
  const missing = nodes.filter((n) => !run.steps[n.id]);
  const stale = Object.keys(run.steps).filter((id) => !ids.has(id));
  if (missing.length === 0 && stale.length === 0) return run;
  const steps = {};
  nodes.forEach((n) => {
    steps[n.id] = run.steps[n.id] || emptyRecord();
  });
  return { ...run, steps };
}

// ---------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------

/** A skipped dependency counts as satisfied — otherwise one skip
 *  deadlocks its whole downstream chain in the middle of a cook. */
export function isReady(stepId, nodes, run) {
  const node = nodes.find((n) => n.id === stepId);
  if (!node) return false;
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  return (node.depends_on || [])
    .filter((d) => byId[d])
    .every((d) => ["done", "skipped"].includes(run.steps[d]?.status));
}

export function readyStepIds(nodes, run) {
  return nodes.filter((n) => run.steps[n.id]?.status === "pending" && isReady(n.id, nodes, run)).map((n) => n.id);
}

export function blockedStepIds(nodes, run) {
  return nodes.filter((n) => run.steps[n.id]?.status === "pending" && !isReady(n.id, nodes, run)).map((n) => n.id);
}

/**
 * Callers have nodes in two shapes — the array here in the utils, a byId
 * map inside the components — and neither is worth converting at every
 * call site just to answer "is this step attended".
 */
function nodeLookup(nodes) {
  if (!nodes) return null;
  if (Array.isArray(nodes)) return (id) => nodes.find((n) => n.id === id);
  return (id) => nodes[id];
}

/**
 * Which hands-on moment of an unattended step is happening RIGHT NOW,
 * derived purely from elapsed time — nothing about this is stored,
 * same as every other derivation in this file (see the header comment).
 * A missed checkpoint simply passes; there is no separate "acknowledged"
 * state to track, the same way a set-and-forget step has none.
 *
 * Returns one of "initial" | "checkpoint" | "waiting" | "ending" | "idle".
 * "idle" covers both a hands_on step (nothing to derive — the whole
 * active span already IS its hands-on moment) and a step that hasn't
 * started or was never decomposed.
 */
export function unattendedPhaseNow(node, record, now = Date.now()) {
  const u = node?.unattended;
  if (!u || record?.status !== "active" || !record.startedAt) return { phase: "idle", index: null };

  const elapsed = Math.round((now - Date.parse(record.startedAt)) / 1000) - (record.pausedSec || 0);

  if (elapsed < u.initial.duration_sec) return { phase: "initial", index: 0 };

  if (u.checkpoints) {
    const { count, interval_sec, duration_sec } = u.checkpoints;
    const sinceInitial = elapsed - u.initial.duration_sec;
    const index = Math.floor(sinceInitial / interval_sec);
    if (index < count && sinceInitial - index * interval_sec < duration_sec) {
      return { phase: "checkpoint", index };
    }
  }

  // The ending window stays open once reached — same "still due" logic as
  // the whole-step deadline elsewhere in this file — rather than closing
  // after ending.duration_sec and leaving a late finish with no phase at
  // all to report.
  if (u.ending && elapsed >= node.estimated_duration_sec - u.ending.duration_sec) {
    return { phase: "ending", index: 0 };
  }

  return { phase: "waiting", index: null };
}

/** Does this phase put a cook's hands on the step right now? */
const OCCUPYING_PHASES = new Set(["initial", "checkpoint", "ending"]);

/**
 * The step this cook is actually DOING — occupying them right now.
 *
 * A 40-minute congee simmer is "active" in the run log and occupies
 * nobody for most of that span: the pot does the work. Counting the
 * whole thing here would lock whoever started it out of the kitchen for
 * 40 minutes, and in competition mode that makes taking the congee a
 * self-inflicted penalty — exactly the step you most want someone to
 * start early. But the moments IN that span where a cook actually has
 * hands on it — putting it on, a checkpoint stir, taking it off — do
 * occupy them, same as any hands_on step, for exactly as long as that
 * moment lasts.
 *
 * The nodes argument is optional so old callers still work; without it
 * every active step counts, which is the pre-existing behaviour. `now`
 * defaults to the real clock; pass the caller's own ticked `now` when
 * rendering, so a phase check agrees with everything else drawn that tick.
 */
export function activeStepFor(cookId, run, nodes, now = Date.now()) {
  const lookup = nodeLookup(nodes);
  const occupies = (stepId, record) => {
    if (!lookup) return true;
    const node = lookup(stepId);
    // Unmarked means attended. A step nobody classified is assumed to
    // need a cook, which is the safe way to be wrong.
    if (!node) return true;
    if (isAttended(node)) return true;
    return OCCUPYING_PHASES.has(unattendedPhaseNow(node, record, now).phase);
  };
  const hit = Object.entries(run.steps).find(
    ([id, r]) => r.status === "active" && r.cookId === cookId && occupies(id, r),
  );
  return hit ? hit[0] : null;
}

/**
 * Set-and-forget steps whose time is up.
 *
 * Rice does not need finishing. Nobody stands up, walks over and
 * completes it — the rice is simply there when you come to plate, and
 * the end of it is really part of whatever uses it next. Leaving a Done
 * button on the screen asks someone to perform a task that does not
 * exist, and worse, holds everything downstream hostage until they
 * notice it.
 *
 * So these close themselves once their time has run. Paused time does
 * not count, because a pot is not cooking while the run is stopped.
 */
export function selfFinishingIds(run, nodes, now = Date.now()) {
  return nodes
    .filter((n) => {
      if (!isOneShot(n)) return false;
      const record = run.steps[n.id];
      if (record?.status !== "active" || !record.startedAt) return false;
      const elapsed = Math.round((now - Date.parse(record.startedAt)) / 1000) - (record.pausedSec || 0);
      return elapsed >= (n.estimated_duration_sec || 0);
    })
    .map((n) => n.id);
}

/** Everything this cook has running that does not occupy them. */
export function passiveStepsFor(cookId, run, nodes) {
  const lookup = nodeLookup(nodes);
  if (!lookup) return [];
  return Object.entries(run.steps)
    .filter(([id, r]) => {
      if (r.status !== "active" || r.cookId !== cookId) return false;
      const node = lookup(id);
      return node ? !isAttended(node) : false;
    })
    .map(([id]) => id);
}

export function stepVariance(node, record, now = Date.now()) {
  const estSec = node?.estimated_duration_sec ?? 0;
  // Running long is only a failure when the step had a deadline. A
  // congee left twenty minutes too long IS burnt and the cook should see
  // that in red; an ice bath sat in five minutes longer is not late, it
  // is just when somebody got round to it.
  const blameable = hasDeadline(node);
  if (!record?.startedAt) return { estSec, actualSec: 0, deltaSec: 0, over: false, running: false };
  const end = record.endedAt ? Date.parse(record.endedAt) : now;
  const actualSec = Math.max(0, Math.round((end - Date.parse(record.startedAt)) / 1000) - (record.pausedSec || 0));
  const deltaSec = actualSec - estSec;
  return { estSec, actualSec, deltaSec, over: blameable && deltaSec > 0, running: !record.endedAt };
}

export function isRunComplete(run, nodes) {
  return nodes.every((n) => ["done", "skipped"].includes(run.steps[n.id]?.status));
}

export function runProgress(run, nodes, now = Date.now()) {
  const records = nodes.map((n) => run.steps[n.id] || emptyRecord());
  const count = (status) => records.filter((r) => r.status === status).length;
  const done = count("done");
  const skipped = count("skipped");
  const total = nodes.length;
  const elapsedSec = Math.max(
    0,
    Math.round(((run.endedAt ? Date.parse(run.endedAt) : now) - Date.parse(run.startedAt)) / 1000) - (run.pausedSec || 0)
  );
  // Hands-on work adds up, because one cook does one thing at a time.
  // Waits do NOT: a 40-minute simmer and a 25-minute poach running
  // together are 40 minutes, not 65. Summing them told people a run was
  // half an hour longer than it was, and the longer the waits the worse
  // the lie got. The remaining waits contribute their longest, which is
  // what they actually cost.
  const unfinished = nodes.filter((n) => !["done", "skipped"].includes(run.steps[n.id]?.status));
  const remainingHandsSec = unfinished
    .filter(isAttended)
    .reduce((sum, n) => sum + n.estimated_duration_sec, 0);
  const remainingWaitSec = Math.max(
    0,
    ...unfinished.filter((n) => !isAttended(n)).map((n) => n.estimated_duration_sec),
  );
  const remainingEstSec = Math.max(remainingHandsSec, remainingWaitSec);

  // Drift against the plan: how late the most recently finished step
  // landed compared with when the plan expected it to finish.
  let driftSec = 0;
  if (run.plan) {
    const finished = nodes
      .filter((n) => run.steps[n.id]?.status === "done" && run.steps[n.id]?.endedAt)
      .sort((a, b) => Date.parse(run.steps[a.id].endedAt) - Date.parse(run.steps[b.id].endedAt));
    const last = finished[finished.length - 1];
    if (last && run.plan.startSecById[last.id] != null) {
      const plannedEnd = run.plan.startSecById[last.id] + last.estimated_duration_sec;
      const actualEnd =
        Math.round((Date.parse(run.steps[last.id].endedAt) - Date.parse(run.startedAt)) / 1000) - (run.pausedSec || 0);
      driftSec = actualEnd - plannedEnd;
    }
  }

  return {
    total,
    done,
    skipped,
    active: count("active"),
    pending: count("pending"),
    pct: total ? Math.round(((done + skipped) / total) * 100) : 0,
    elapsedSec,
    estimatedTotalSec: run.plan?.makespanSec ?? null,
    remainingEstSec,
    remainingHandsSec,
    remainingWaitSec,
    driftSec,
  };
}

/**
 * The starting award for every unattended step that is on or finished,
 * paid to its holder — who is the cook whose start stuck, since only a
 * start sets the holder and only a drop clears it (see the credit rule
 * at applyDone).
 *
 * Only steps that are still active or finished count, and a drop wipes
 * the holder, so start, drop, start, drop pays once at most — the
 * farming this split exists to stop.
 */
export function startAwards(run, nodes) {
  const shares = tailShares(nodes);
  const byCook = {};
  nodes.forEach((n) => {
    if (isAttended(n)) return;
    const record = run.steps[n.id];
    if (!record?.cookId || (record.status !== "active" && record.status !== "done")) return;
    byCook[record.cookId] =
      (byCook[record.cookId] || 0) + unattendedStartPoints(n, { tailShare: shares.get(n.id) });
  });
  return byCook;
}

export function scoreboard(run, nodes, cooks) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const started = startAwards(run, nodes);
  return cooks
    .map((cook) => {
      const mine = Object.entries(run.steps).filter(([, r]) => r.cookId === cook.id);
      const doneEntries = mine.filter(([, r]) => r.status === "done");
      const points =
        doneEntries.reduce(
          (sum, [id, record]) => sum + scoreStep(byId[id], { record, run, nodes, cooks }).points,
          0
        ) + (started[cook.id] || 0);
      const lastDoneAt = doneEntries
        .map(([, r]) => (r.endedAt ? Date.parse(r.endedAt) : 0))
        .reduce((max, t) => Math.max(max, t), 0);
      return {
        cookId: cook.id,
        name: cook.name,
        points,
        doneCount: doneEntries.length,
        skippedCount: mine.filter(([, r]) => r.status === "skipped").length,
        activeStepId: activeStepFor(cook.id, run, nodes),
        lastDoneAt,
      };
    })
    .sort((a, b) => b.points - a.points || b.doneCount - a.doneCount || a.lastDoneAt - b.lastDoneAt);
}

export function runOutcome(run, nodes, cooks) {
  const board = scoreboard(run, nodes, cooks);
  const top = board[0]?.points ?? 0;
  const progress = runProgress(run, nodes, run.endedAt ? Date.parse(run.endedAt) : Date.now());
  return {
    totalSec: progress.elapsedSec,
    estimatedSec: run.plan?.makespanSec ?? null,
    scoreboard: board,
    // A shared win is the honest result — don't invent an end-of-run
    // tiebreak. (A *claim* must resolve to one owner; a final score needn't.)
    winnerCookIds: board.filter((b) => b.points === top && top > 0).map((b) => b.cookId),
    doneCount: progress.done,
    skippedCount: progress.skipped,
    // In the order the night actually went: started steps by start
    // time, then whatever never started, in main-line order.
    perStep: (() => {
      const shares = tailShares(nodes);
      return nodes
        .map((n, order) => {
          const record = run.steps[n.id] || emptyRecord();
          const variance = stepVariance(n, record, run.endedAt ? Date.parse(run.endedAt) : Date.now());
          const unattended = !isAttended(n);
          return {
            id: n.id,
            label: n.label,
            cookId: record.cookId,
            status: record.status,
            attended: !unattended,
            ...variance,
            points: scoreStep(n, { record, run, nodes, cooks }).points,
            // An unattended step paid twice, and the summary has to account
            // for both halves or the start awards appear in the totals from
            // nowhere. Both halves go to the holder, so this is the same
            // cook as cookId; it stays a field of its own for the summary.
            ...(unattended
              ? {
                  startPoints: unattendedStartPoints(n, { tailShare: shares.get(n.id) }),
                  startedByCookId: record.cookId,
                }
              : {}),
            _startedAt: record.startedAt ? Date.parse(record.startedAt) : Infinity,
            _order: order,
          };
        })
        .sort((a, b) => a._startedAt - b._startedAt || a._order - b._order)
        .map((s) => {
          const { _startedAt: _s, _order: _o, ...rest } = s; // eslint-disable-line no-unused-vars
          return rest;
        });
    })(),
  };
}

// ---------------------------------------------------------------------
// Cooperation: what should each cook do next
// ---------------------------------------------------------------------

export function resolveAssignments({ nodes, run, cooks, now = Date.now() }) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const ready = new Set(readyStepIds(nodes, run));
  const claimedFills = new Set();
  const byCook = {};

  // TWO PASSES, and the order matters. Everyone's own queued work is
  // reserved before anyone is offered somebody else's.
  //
  // One pass let a cook who was only minding a simmer fall through to
  // the idle-fill branch and be handed a step that was about to be
  // assigned to its actual owner — both cooks pointed at "make sauce".
  // That was unreachable while holding anything made you busy; letting a
  // cook hold a wait and stay free is what opened it. It is the exact
  // failure the comment on the fill branch below warns about.
  const queues = new Map();
  cooks.forEach((cook) => {
    const active = activeStepFor(cook.id, run, nodes, now);
    if (active) {
      byCook[cook.id] = { stepId: active, reason: "active", waitingOnStepId: null, waitingOnCookId: null, etaSec: null };
      return;
    }
    const queue = (run.plan?.order?.[cook.id] || []).filter((id) => run.steps[id]?.status === "pending");
    queues.set(cook.id, queue);
    const head = queue.find((id) => ready.has(id) && !claimedFills.has(id));
    if (head) {
      byCook[cook.id] = { stepId: head, reason: "assigned", waitingOnStepId: null, waitingOnCookId: null, etaSec: null };
      claimedFills.add(head);
    }
  });

  cooks.forEach((cook) => {
    if (byCook[cook.id]) return;
    const queue = queues.get(cook.id) || [];

    if (queue.length === 0) {
      const anythingLeft = nodes.some((n) => ["pending", "active"].includes(run.steps[n.id]?.status));
      if (!anythingLeft) {
        byCook[cook.id] = { stepId: null, reason: "finished", waitingOnStepId: null, waitingOnCookId: null, etaSec: null };
        return;
      }
    }

    // Their own next step is blocked. Offer someone else's ready work
    // rather than idling — but as an explicit offer, never silently:
    // silent reassignment on a shared screen is how two people end up
    // doing the same task.
    const fill = [...ready]
      .filter((id) => !claimedFills.has(id))
      .sort((a, b) => (run.plan?.startSecById?.[a] ?? 0) - (run.plan?.startSecById?.[b] ?? 0))[0];
    if (fill) {
      claimedFills.add(fill);
      byCook[cook.id] = { stepId: fill, reason: "idle_fill", waitingOnStepId: null, waitingOnCookId: null, etaSec: null };
      return;
    }

    // Genuinely nothing to do — name the blocker honestly.
    const target = queue[0];
    let waitingOnStepId = null;
    if (target) {
      const unmet = (byId[target]?.depends_on || [])
        .filter((d) => byId[d] && !["done", "skipped"].includes(run.steps[d]?.status));
      waitingOnStepId = unmet[0] ?? null;
    }
    const holder = waitingOnStepId ? run.steps[waitingOnStepId]?.cookId : null;
    let etaSec = null;
    if (waitingOnStepId && run.steps[waitingOnStepId]?.status === "active") {
      const v = stepVariance(byId[waitingOnStepId], run.steps[waitingOnStepId], now);
      etaSec = Math.max(0, v.estSec - v.actualSec);
    }
    byCook[cook.id] = { stepId: null, reason: "waiting", waitingOnStepId, waitingOnCookId: holder, etaSec };
  });

  return { byCook, unassignedReady: [...ready].filter((id) => !claimedFills.has(id)) };
}

/**
 * Versus has no plan, so a cook with nothing to grab is waiting on
 * whatever will open the board up next: the running step, of those that
 * block something still pending, closest to its estimate. Same shape as
 * a co-op "waiting" assignment, so the card renders both the same way.
 *
 * Null once nothing is pending or active -- that, and only that, is a
 * cook being done for the night. Having nothing to grab right now is
 * not: it read as the goose sending somebody home mid-run.
 */
export function versusWaiting(run, nodes, now = Date.now()) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const open = nodes.filter((n) => ["pending", "active"].includes(run.steps[n.id]?.status));
  if (!open.length) return null;
  const blockers = new Set(
    open
      .filter((n) => run.steps[n.id].status === "pending")
      .flatMap((n) => n.depends_on || [])
      .filter((d) => run.steps[d]?.status === "active"),
  );
  const [soonest] = [...blockers]
    .map((id) => {
      const v = stepVariance(byId[id], run.steps[id], now);
      return { id, etaSec: Math.max(0, v.estSec - v.actualSec) };
    })
    .sort((a, b) => a.etaSec - b.etaSec);
  return {
    stepId: null,
    reason: "waiting",
    waitingOnStepId: soonest?.id ?? null,
    waitingOnCookId: soonest ? run.steps[soonest.id].cookId : null,
    etaSec: soonest?.etaSec ?? null,
  };
}

/**
 * Recompute the plan for everything still pending. Runs after every
 * completion (and every skip/drop) — real times diverge from estimates,
 * so the remaining plan genuinely changes shape as the cook progresses.
 * Active steps are pinned: you don't re-plan something already underway.
 */
export function replan({ nodes, run, cooks, kitchenProfile }) {
  const remaining = nodes.filter((n) => run.steps[n.id]?.status === "pending");
  if (remaining.length === 0) {
    return pushEvent({ ...run, plan: run.plan ? { ...run.plan, order: {}, startSecById: {} } : null }, {
      at: new Date().toISOString(),
      type: "replan",
      cookId: null,
      stepId: null,
      meta: { remaining: 0 },
    });
  }
  // scheduleSteps, not computeSchedule — the solo baseline is dead
  // weight mid-run and doubles the work.
  const schedule = scheduleSteps(remaining, cooks, kitchenProfile, { nodeBudget: LIVE_REPLAN_NODE_BUDGET, timeBudgetMs: LIVE_REPLAN_TIME_BUDGET_MS });
  const plan = planFromSchedule(schedule);
  return pushEvent({ ...run, plan }, {
    at: new Date().toISOString(),
    type: "replan",
    cookId: null,
    stepId: null,
    meta: { remaining: remaining.length, makespanSec: schedule.makespanSec },
  });
}

// ---------------------------------------------------------------------
// Competition: claiming
// ---------------------------------------------------------------------

/**
 * A cook holding an unfinished step cannot claim another one. That check
 * lives here rather than in the UI so the voice path, the claim buttons
 * and any future caller all hit the same wall — there is deliberately no
 * "drop this and take that" shortcut anywhere.
 */
/**
 * Is a piece of equipment this step needs already fully in use?
 *
 * Returns the equipment type that is short, or null. Counts only steps
 * running RIGHT NOW — this is a live check against the actual kitchen,
 * not the planner's model of it.
 */
export function equipmentShortage({ run, nodes, stepId, kitchenProfile }) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const needs = [...new Set(byId[stepId]?.required_equipment || [])];
  if (!needs.length) return null;
  const caps = equipmentCapacity(kitchenProfile);
  const activeIds = Object.entries(run.steps)
    .filter(([id, r]) => r.status === "active" && id !== stepId)
    .map(([id]) => id);
  for (const type of needs) {
    const cap = caps[type] ?? 1;
    const inUse = activeIds.filter((id) => (byId[id]?.required_equipment || []).includes(type)).length;
    if (inUse >= cap) return type;
  }
  return null;
}

export function arbitrateClaim({ run, nodes, cooks, stepId, cookId, at, kitchenProfile }) {
  const record = run.steps[stepId];
  if (!record) return { ok: false, code: "unknown_step" };
  if (["done", "skipped"].includes(record.status)) return { ok: false, code: "already_done" };

  // Only actually-occupied time makes you busy. Someone minding a simmer
  // between its checkpoints can pick up the next thing, and can hold
  // several waits at once — which is the whole point of marking a step
  // unattended. Mid-checkpoint, mid-initial or mid-ending, though, they
  // are exactly as busy as anyone doing hands_on work — see
  // unattendedPhaseNow.
  const holding = activeStepFor(cookId, run, nodes, Date.parse(at));
  if (holding && holding !== stepId) return { ok: false, code: "busy", holdingStepId: holding };

  // The kitchen has a finite number of burners, and until unattended
  // steps existed nothing had to say so here: one cook could hold one
  // step, so two cooks could never run more than two things. Letting a
  // cook hold several waits removed that accidental ceiling, and without
  // this a single person can put three pots on two burners.
  const shortage = equipmentShortage({ run, nodes, stepId, kitchenProfile });
  if (shortage) return { ok: false, code: "no_equipment", equipmentType: shortage };

  if (record.status === "active") {
    if (record.cookId === cookId) return { ok: false, code: "noop" };
    const mine = Date.parse(at);
    const theirs = Date.parse(record.startedAt);
    if (mine > theirs) return { ok: false, code: "already_claimed", holderCookId: record.cookId };
    if (mine === theirs) {
      // Dead heat: the cook who's behind takes it. Deterministic (the run
      // replays from a persisted log), self-balancing, and explainable in
      // one sentence to the people at the counter.
      const board = scoreboard(run, nodes, cooks);
      const rank = (id) => {
        const i = board.findIndex((b) => b.cookId === id);
        return [board[i]?.points ?? 0, cooks.findIndex((c) => c.id === id)];
      };
      const [myPoints, myIndex] = rank(cookId);
      const [theirPoints, theirIndex] = rank(record.cookId);
      const iWin = myPoints < theirPoints || (myPoints === theirPoints && myIndex < theirIndex);
      if (!iWin) return { ok: false, code: "already_claimed", holderCookId: record.cookId, tie: true };
    }
    // Won it — the previous holder loses the step.
    return { ok: true, stealFrom: record.cookId };
  }

  if (!isReady(stepId, nodes, run)) {
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const blockedBy = (byId[stepId]?.depends_on || []).filter(
      (d) => byId[d] && !["done", "skipped"].includes(run.steps[d]?.status)
    );
    return { ok: false, code: "not_ready", blockedBy };
  }
  return { ok: true };
}

/**
 * What this cook should claim next, best first.
 *
 * Ranked by TAIL — how much of the cook is still waiting behind this
 * step — not by points. Points-first was actively harmful here: a
 * 40-minute congee simmer is one "medium" step worth the same as a
 * two-minute chop, and sorting ties by shortest duration pushed it to
 * the bottom of the pool. The app was steering people toward quick wins
 * and burying the one step that gates dinner, so in competition mode
 * everybody ended up waiting on a pot nobody had started.
 *
 * Tail ordering fixes that without any scoring change: the simmer has
 * the longest chain behind it, so it surfaces first. Points still break
 * ties, which is where they belong — between two steps that unblock the
 * same amount of work, take the one worth more.
 */
export function claimSuggestions({ nodes, run, cookId, limit = 3 }) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const opening = new Set(run.openingSuggestions?.[cookId] || []);
  const tails = computeTails(nodes, byId);
  return readyStepIds(nodes, run)
    .sort((a, b) => {
      const aOpen = opening.has(a) ? 0 : 1;
      const bOpen = opening.has(b) ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      const tail = (id) => tails.get(id) ?? 0;
      if (tail(a) !== tail(b)) return tail(b) - tail(a);
      const pts = (id) => DIFFICULTY_POINTS[byId[id]?.difficulty] ?? 0;
      return pts(b) - pts(a);
    })
    .slice(0, limit);
}


// ---------------------------------------------------------------------
// Transitions — all pure, all return a new run
// ---------------------------------------------------------------------

export function applyStart({ run, stepId, cookId, at, source = "tap" }) {
  const next = patchStep(run, stepId, { status: "active", cookId, startedAt: at, endedAt: null, source });
  return pushEvent(next, { at, type: "start", cookId, stepId, source });
}

/**
 * CREDIT RULE — a step's points belong to whoever holds it.
 *
 * Holding is decided by starting or claiming, both arbitrated, and
 * changes hands only by a drop, which is also explicit. Closing a step
 * says nothing about who did it: "Nora's finished the tofu" is a report,
 * and anybody may make it, but it is Nora's tofu. So done and skip never
 * move record.cookId. The one who reported it is kept apart as
 * `reportedBy`, for the log and for undo, and is never read for points.
 *
 * This used to be the other way round. applyDone overwrote cookId with
 * the caller, and the caller on the voice path is a guess: without the
 * speaker sidecar it is whoever the toggle was last left on. One cook
 * saying another's step was done moved the other's points to themselves.
 *
 * `cookId` here is therefore the reporter. It only becomes the holder
 * when nobody holds the step, which for done cannot happen (only an
 * active step can be finished) and for skip means a pending step.
 */
export function applyDone({ run, stepId, cookId, at, source = "tap" }) {
  const holder = run.steps[stepId]?.cookId ?? cookId;
  const next = patchStep(run, stepId, { status: "done", cookId: holder, endedAt: at });
  return pushEvent(next, { at, type: "done", cookId: holder, reportedBy: cookId, stepId, source });
}

export function applySkip({ run, stepId, cookId, at, source = "tap", reason = "manual" }) {
  const holder = run.steps[stepId]?.cookId ?? cookId;
  const next = patchStep(run, stepId, { status: "skipped", cookId: holder, endedAt: at, skipReason: reason });
  return pushEvent(next, { at, type: "skip", cookId: holder, reportedBy: cookId, stepId, source, meta: { reason } });
}

/** Put an active step back in the pool — no points, no penalty. */
export function applyDrop({ run, stepId, cookId, at, source = "tap" }) {
  const next = patchStep(run, stepId, { status: "pending", cookId: null, startedAt: null, endedAt: null, source: null });
  return pushEvent(next, { at, type: "drop", cookId, stepId, source });
}

/** Inverts this cook's last action, within a minute, and only while
 *  nothing downstream has started on the back of it. */
export function applyUndo({ run, nodes, cookId, at }) {
  const undoable = ["start", "done", "skip"];
  // Yours to undo if it was your step or you were the one who said it:
  // somebody who wrongly reported another cook's step done has to be
  // able to take it back.
  const last = [...run.events]
    .reverse()
    .find((e) => (e.cookId === cookId || e.reportedBy === cookId) && undoable.includes(e.type));
  if (!last) return { run, rejected: "nothing" };
  if (Date.parse(at) - Date.parse(last.at) > UNDO_WINDOW_MS) return { run, rejected: "too_late" };

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const downstreamStarted = nodes.some(
    (n) => (n.depends_on || []).includes(last.stepId) && run.steps[n.id]?.status !== "pending"
  );
  if (downstreamStarted) return { run, rejected: "downstream_started", blockedBy: last.stepId };

  let next;
  if (last.type === "done") {
    next = patchStep(run, last.stepId, { status: "active", endedAt: null });
  } else if (last.type === "skip") {
    next = patchStep(run, last.stepId, { status: "pending", cookId: null, endedAt: null, skipReason: null });
  } else {
    next = patchStep(run, last.stepId, { status: "pending", cookId: null, startedAt: null, source: null });
  }
  return {
    run: pushEvent(next, { at, type: "undo", cookId, stepId: last.stepId, meta: { undid: last.type } }),
    undid: last,
    label: byId[last.stepId]?.label,
  };
}

/** Whether Undo would take right now — the card uses this to enable the
 *  button only inside the window, so a dead tap never has to be explained. */
export function canUndo({ run, nodes, cookId, at }) {
  return !applyUndo({ run, nodes, cookId, at }).rejected;
}

/** Freeze the run. Anything still pending is swept to skipped so the
 *  summary accounts for every step. */
export function isPaused(run) {
  return Boolean(run?.pausedAt);
}

export function applyPause({ run, at }) {
  if (isPaused(run) || run.endedAt) return run;
  return pushEvent({ ...run, pausedAt: at }, { at, type: "run_pause", cookId: null, stepId: null });
}

/**
 * Credits the pause to the run and to every step that was mid-flight
 * when it started — those are the only ones whose clock was affected.
 * Steps finished before the pause, or started after it, are untouched.
 */
export function applyResume({ run, at }) {
  if (!isPaused(run)) return run;
  const pausedSec = Math.max(0, Math.round((Date.parse(at) - Date.parse(run.pausedAt)) / 1000));
  const steps = { ...run.steps };
  Object.entries(steps).forEach(([id, record]) => {
    if (record.status === "active") steps[id] = { ...record, pausedSec: (record.pausedSec || 0) + pausedSec };
  });
  const next = { ...run, steps, pausedAt: null, pausedSec: (run.pausedSec || 0) + pausedSec };
  return pushEvent(next, { at, type: "run_resume", cookId: null, stepId: null });
}

export function endRun({ run, nodes, at }) {
  // Finishing while paused would otherwise bank the whole break as
  // cooking time, so close the open pause first.
  const settled = isPaused(run) ? applyResume({ run, at }) : run;
  let next = { ...settled, steps: { ...settled.steps } };
  // Anything not finished — untouched or mid-step — is skipped, so no
  // step can outlive the run and the counts add up to the total.
  nodes.forEach((n) => {
    const status = next.steps[n.id]?.status;
    if (status === "pending" || status === "active") {
      next.steps[n.id] = { ...next.steps[n.id], status: "skipped", endedAt: at, skipReason: "run_ended" };
    }
  });
  next.endedAt = at;
  return pushEvent(next, { at, type: "run_end", cookId: null, stepId: null });
}
