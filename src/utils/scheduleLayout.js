// Resource-constrained scheduler. No DOM/React, same spirit as
// graphLayout.js.
//
// Two stages, deliberately separated:
//
//  1. WHEN each step runs â€” branch-and-bound over activity orderings,
//     minimising the finish time. Cooks are modelled as a pooled
//     resource of capacity N (they're interchangeable), alongside each
//     equipment type at its kitchen capacity. Unattended steps ask for
//     equipment only. With ~20 fixed steps the
//     search proves optimality rather than guessing, falling back to
//     the best found so far if it hits its node budget.
//  2. WHO does each step â€” the schedule above fixes the start times,
//     and any assignment that never double-books a cook is equally
//     fast, so that freedom is spent evening out each cook's workload
//     (the greedy this replaced piled ~3x the work on one cook).
//
// Steps carry `attended`. An attended step needs a cook for its whole
// duration; an unattended one — a simmer left alone, a chill, a rest —
// occupies its EQUIPMENT and nobody. It still has an owner, because
// somebody has to start it, but it never books their time.
import { EQUIPMENT_OPTIONS } from "../data/dishes.js";
import { isAttended } from "./tending.js";

export const EQUIPMENT_LABELS = {
  cutting_board: "cutting board",
  stove_burner: "burner",
  wok: "wok",
  pot: "pot",
  oven: "oven",
};

const COOK_RESOURCE = "__cook__";
// Display order of the equipment lanes on the schedule page. Anything
// in EQUIPMENT_OPTIONS but not named here trails in option order.
const EQUIPMENT_LANE_ORDER = [
  "cutting_board",
  "wok",
  "pot",
  "stove_burner",
  "oven",
  ...EQUIPMENT_OPTIONS.filter((t) => !["cutting_board", "wok", "pot", "stove_burner", "oven"].includes(t)),
];
// The search finds strong schedules quickly and then spends its time
// *proving* nothing better exists. Since the result is reported against
// a lower bound anyway, the budget is set for a responsive page rather
// than for exhaustive proof on large recipes.
const SEARCH_NODE_BUDGET = 150000;
// A node budget bounds the *work*, not the *wait*: the cost of a node
// grows with the recipe, so 150k nodes is a third of a second on 19
// steps and an unbounded freeze on a graph twice that size. The search
// is anytime — it finds a strong schedule early and spends the rest
// proving nothing beats it — so a wall-clock deadline cuts the part
// nobody is waiting for. Whatever it had is still reported honestly
// against the lower bound as "best of >= X".
const SEARCH_TIME_BUDGET_MS = 250;
// Checking the clock every node would cost more than the search; every
// 512 is often enough to hold the deadline to a millisecond or two.
const TIME_CHECK_INTERVAL = 512;

// Equipment with 0 configured capacity (including hasWok/hasOven false)
// is treated as capacity 1 â€” a "make it work" fallback instead of
// declaring the recipe unschedulable.
// The fallback above is a kindness, but a silent one: a kitchen with the
// wok toggled off still gets wok steps planned as though it had one.
// This reports which equipment a plan leans on that the kitchen says it
// hasn't got, so the pages can say so out loud instead of quietly
// planning a cook that can't happen.
export function missingEquipment(nodes, kitchenProfile) {
  if (!kitchenProfile) return [];
  const configured = {
    cutting_board: kitchenProfile.cuttingBoards ?? 1,
    stove_burner: kitchenProfile.burners ?? 1,
    pot: kitchenProfile.pots ?? 1,
    wok: kitchenProfile.hasWok ? 1 : 0,
    oven: kitchenProfile.hasOven ? 1 : 0,
  };
  const needed = new Set((nodes || []).flatMap((n) => n.required_equipment || []));
  return [...needed].filter((type) => (configured[type] ?? 1) === 0);
}

export function equipmentCapacity(kitchenProfile) {
  const kp = kitchenProfile || {};
  return {
    cutting_board: Math.max(1, kp.cuttingBoards ?? 1),
    stove_burner: Math.max(1, kp.burners ?? 1),
    pot: Math.max(1, kp.pots ?? 1),
    wok: 1,
    oven: 1,
  };
}

function resourceCapacities(cooks, kitchenProfile) {
  const caps = { [COOK_RESOURCE]: cooks.length };
  const equipment = equipmentCapacity(kitchenProfile);
  EQUIPMENT_OPTIONS.forEach((type) => {
    caps[type] = equipment[type] ?? 1;
  });
  return caps;
}

// Whether a step occupies a cook now lives in tending.js, alongside the
// distinction between a pot that needs checking and one that does not.
export { isAttended };

/**
 * What a step occupies while it runs.
 *
 * An unattended step demands its EQUIPMENT and no cook. The pot is busy
 * for forty minutes; the person who set it going is not. Charging a cook
 * for it — which this did for every step — made the planner believe two
 * people were flat out for 48 minutes on a congee run that contains 21
 * minutes of actual hands-on work.
 */
const demandOf = (node) => [
  ...(isAttended(node) ? [COOK_RESOURCE] : []),
  ...new Set(node.required_equipment || []),
];

/** Topological order, ignoring references to nodes outside this set.
 *  Anything left over sits in a dependency cycle and can't be ordered. */
function topoSort(nodes, byId) {
  const preds = new Map(nodes.map((n) => [n.id, (n.depends_on || []).filter((d) => byId[d])]));
  const remaining = new Set(nodes.map((n) => n.id));
  const order = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const n of nodes) {
      if (!remaining.has(n.id)) continue;
      if (preds.get(n.id).every((d) => !remaining.has(d))) {
        order.push(n.id);
        remaining.delete(n.id);
        progress = true;
      }
    }
  }
  return { order, unordered: [...remaining] };
}

/** Longest path from each node to a sink, including its own duration â€”
 *  the minimum time still needed once that node can start. */
/**
 * Longest path from each step to the end of the cook, its own duration
 * included. The scheduler uses it as a search bound; the live pool uses
 * it to rank what to claim, because a step with a long tail is a step
 * everything else is waiting behind.
 */
export function computeTails(nodes, byId) {
  const dependents = new Map(nodes.map((n) => [n.id, []]));
  nodes.forEach((n) => {
    (n.depends_on || []).filter((d) => byId[d]).forEach((d) => dependents.get(d).push(n.id));
  });
  const tails = new Map();
  const visit = (id) => {
    if (tails.has(id)) return tails.get(id);
    const own = byId[id].estimated_duration_sec;
    const children = dependents.get(id) || [];
    const tail = own + (children.length ? Math.max(...children.map(visit)) : 0);
    tails.set(id, tail);
    return tail;
  };
  nodes.forEach((n) => visit(n.id));
  return tails;
}

/** Earliest time >= `earliest` where every resource this node needs has
 *  a free unit for its whole duration. Candidate times are `earliest`
 *  plus the finish time of anything already placed â€” a schedule only
 *  ever becomes feasible when something else releases. */
function earliestFeasibleStart(node, earliest, placed, caps) {
  const duration = node.estimated_duration_sec;
  const needs = demandOf(node);
  const candidates = [earliest];
  placed.forEach((p) => {
    if (p.endSec > earliest) candidates.push(p.endSec);
  });
  candidates.sort((a, b) => a - b);

  for (const t of candidates) {
    const feasible = needs.every((r) => {
      const cap = caps[r] ?? 1;
      let inUse = 0;
      for (const p of placed) {
        if (!p.needs.includes(r)) continue;
        if (p.startSec < t + duration && t < p.endSec) inUse++;
        if (inUse + 1 > cap) return false;
      }
      return true;
    });
    if (feasible) return t;
  }
  return candidates[candidates.length - 1];
}

/** Serial schedule generation: place activities in the given order, each
 *  at its earliest feasible time. Produces an "active" schedule, and for
 *  a regular objective like makespan an optimal schedule is always among
 *  these â€” which is what makes searching over orderings exhaustive. */
function buildSchedule(order, byId, caps) {
  const placed = [];
  const finishById = new Map();
  order.forEach((id) => {
    const node = byId[id];
    const depReady = (node.depends_on || [])
      .filter((d) => byId[d])
      .reduce((max, d) => Math.max(max, finishById.get(d) ?? 0), 0);
    const startSec = earliestFeasibleStart(node, depReady, placed, caps);
    const endSec = startSec + node.estimated_duration_sec;
    placed.push({ id, startSec, endSec, needs: demandOf(node), dependsReadySec: depReady });
    finishById.set(id, endSec);
  });
  return placed;
}

const makespanOf = (placed) => placed.reduce((max, p) => Math.max(max, p.endSec), 0);

/**
 * Branch and bound over precedence-feasible orderings. Each node of the
 * search picks which eligible activity goes next; the bound is the best
 * finish still reachable (what's already placed, plus every remaining
 * activity's own earliest start plus its longest path to the end).
 * Returns the best ordering found and whether the search was exhaustive.
 */
function searchBestOrder(nodes, byId, caps, seedOrder, nodeBudget = SEARCH_NODE_BUDGET, timeBudgetMs = SEARCH_TIME_BUDGET_MS) {
  const tails = computeTails(nodes, byId);
  const total = nodes.length;
  const preds = new Map(nodes.map((n) => [n.id, (n.depends_on || []).filter((d) => byId[d])]));
  // Global floors: nothing can finish sooner than the longest dependency
  // chain, than the total work split across the cooks, or than the work
  // queued on any single piece of equipment. Reaching the floor proves
  // optimality outright; otherwise it's how close the answer is known to be.
  const criticalPath = Math.max(0, ...nodes.map((n) => tails.get(n.id)));
  // Only attended steps occupy a cook — an unattended step's duration
  // belongs to its equipment, not the cook pool, so it must not inflate
  // this floor. Counting it here made the bound exceed schedules that
  // are provably achievable, which stops the search from ever declaring
  // victory early on recipes with real unattended time in them.
  const totalCookWork = nodes.filter(isAttended).reduce((sum, n) => sum + n.estimated_duration_sec, 0);
  let floor = Math.max(criticalPath, Math.ceil(totalCookWork / Math.max(1, caps[COOK_RESOURCE])));
  EQUIPMENT_OPTIONS.forEach((type) => {
    const work = nodes
      .filter((n) => (n.required_equipment || []).includes(type))
      .reduce((sum, n) => sum + n.estimated_duration_sec, 0);
    floor = Math.max(floor, Math.ceil(work / Math.max(1, caps[type] ?? 1)));
  });

  const seedPlaced = buildSchedule(seedOrder, byId, caps);
  let bestOrder = seedOrder;
  let bestMakespan = makespanOf(seedPlaced);
  let explored = 0;
  let exhausted = true;
  const deadline = Date.now() + timeBudgetMs;
  let outOfTime = false;
  const spent = () => {
    if (outOfTime) return true;
    if (explored % TIME_CHECK_INTERVAL === 0 && Date.now() > deadline) outOfTime = true;
    return outOfTime;
  };

  const dfs = (order, placed, finishById, scheduled) => {
    if (bestMakespan <= floor) return; // can't do better than the floor
    if (explored++ > nodeBudget || spent()) {
      exhausted = false;
      return;
    }
    if (order.length === total) {
      const ms = makespanOf(placed);
      if (ms < bestMakespan) {
        bestMakespan = ms;
        bestOrder = [...order];
      }
      return;
    }

    const eligible = nodes.filter((n) => !scheduled.has(n.id) && preds.get(n.id).every((d) => scheduled.has(d)));

    // Bound: the finish already committed, and for everything left, the
    // soonest it could start plus everything that must follow it.
    const committed = makespanOf(placed);
    let bound = committed;
    for (const n of nodes) {
      if (scheduled.has(n.id)) continue;
      const est = preds.get(n.id).reduce((max, d) => Math.max(max, finishById.get(d) ?? 0), 0);
      bound = Math.max(bound, est + tails.get(n.id));
    }
    if (bound >= bestMakespan) return;

    // Most critical first â€” finds strong incumbents early, which makes
    // the bound prune far more of the tree.
    const ordered = [...eligible].sort(
      (a, b) => tails.get(b.id) - tails.get(a.id) || b.estimated_duration_sec - a.estimated_duration_sec
    );

    for (const n of ordered) {
      const depReady = preds.get(n.id).reduce((max, d) => Math.max(max, finishById.get(d) ?? 0), 0);
      const startSec = earliestFeasibleStart(n, depReady, placed, caps);
      const endSec = startSec + n.estimated_duration_sec;
      // The finish only ever grows, so if placing this already matches
      // the incumbent, nothing below this branch can beat it.
      if (endSec >= bestMakespan) continue;
      placed.push({ id: n.id, startSec, endSec, needs: demandOf(n), dependsReadySec: depReady });
      finishById.set(n.id, endSec);
      scheduled.add(n.id);
      order.push(n.id);

      dfs(order, placed, finishById, scheduled);

      order.pop();
      scheduled.delete(n.id);
      finishById.delete(n.id);
      placed.pop();
      if (!exhausted) break;
    }
  };

  dfs([], [], new Map(), new Set());
  return { order: bestOrder, optimal: exhausted || bestMakespan <= floor, lowerBoundSec: floor };
}

/**
 * Hand the fixed timeline to specific cooks. Any assignment that never
 * double-books a cook finishes at the same time, so the choice is spent
 * on balance: each step goes to the least-loaded cook who is free,
 * preferring whoever did its prerequisite when loads are level. A local
 * improvement pass then moves steps between cooks while that flattens
 * the busiest cook further.
 */
function assignCooks(placed, cooks, byId) {
  const ordered = [...placed].sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  const assignment = new Map();
  const busy = new Map(cooks.map((c) => [c.id, 0]));
  const intervals = new Map(cooks.map((c) => [c.id, []]));

  const freeFor = (cookId, task, skipTaskId = null) =>
    intervals.get(cookId).every((iv) => iv.id === skipTaskId || iv.endSec <= task.startSec || task.endSec <= iv.startSec);

  ordered.forEach((task) => {
    const depOwners = new Set(
      (byId[task.id].depends_on || []).map((d) => assignment.get(d)).filter(Boolean)
    );
    const candidates = cooks.filter((c) => freeFor(c.id, task));
    const pool = candidates.length ? candidates : cooks;
    pool.sort((a, b) => {
      const byBusy = busy.get(a.id) - busy.get(b.id);
      if (byBusy !== 0) return byBusy;
      const aCont = depOwners.has(a.id) ? 0 : 1;
      const bCont = depOwners.has(b.id) ? 0 : 1;
      return aCont - bCont;
    });
    const chosen = pool[0];
    assignment.set(task.id, chosen.id);
    // An unattended step still gets an owner — somebody has to put the
    // pot on, and cooperation mode needs it in a queue — but it does NOT
    // reserve their time or count toward how busy they are. Booking it
    // would re-create the thing this whole change removes: a cook shown
    // as occupied for forty minutes by a simmer.
    if (isAttended(byId[task.id])) {
      busy.set(chosen.id, busy.get(chosen.id) + (task.endSec - task.startSec));
      intervals.get(chosen.id).push({ id: task.id, startSec: task.startSec, endSec: task.endSec });
    }
  });

  // Local improvement: move a step off the busiest cook whenever some
  // other cook is free for it and ends up no busier than the one we
  // took it from.
  const spread = () => Math.max(...busy.values()) - Math.min(...busy.values());
  for (let pass = 0; pass < 8; pass++) {
    let improved = false;
    for (const task of ordered) {
      // Unattended steps carry no load, so moving them balances nothing.
      if (!isAttended(byId[task.id])) continue;
      const from = assignment.get(task.id);
      const duration = task.endSec - task.startSec;
      for (const c of cooks) {
        if (c.id === from) continue;
        if (!freeFor(c.id, task)) continue;
        const before = spread();
        busy.set(from, busy.get(from) - duration);
        busy.set(c.id, busy.get(c.id) + duration);
        if (spread() < before) {
          intervals.set(from, intervals.get(from).filter((iv) => iv.id !== task.id));
          intervals.get(c.id).push({ id: task.id, startSec: task.startSec, endSec: task.endSec });
          assignment.set(task.id, c.id);
          improved = true;
          break;
        }
        busy.set(from, busy.get(from) + duration);
        busy.set(c.id, busy.get(c.id) - duration);
      }
    }
    if (!improved) break;
  }

  return assignment;
}

/** Why a step couldn't start any earlier: its dependencies, a busy cook,
 *  or a piece of equipment someone else was still holding. Used for the
 *  "waiting for the cutting board" labels and the critical-path trace. */
function deriveStartCause(task, placed, byId, assignment, caps) {
  const node = byId[task.id];
  if (task.startSec === task.dependsReadySec) {
    const preds = (node.depends_on || []).filter((d) => byId[d]);
    let refStepId = null;
    let latest = -1;
    preds.forEach((d) => {
      const p = placed.find((x) => x.id === d);
      if (p && p.endSec > latest) {
        latest = p.endSec;
        refStepId = d;
      }
    });
    return { type: "dependency", time: task.dependsReadySec, refStepId };
  }

  // Something was saturated right up to the moment it started; whichever
  // resource released at exactly that time is the one it waited on.
  const justBefore = task.startSec - 1;
  const releasedAtStart = placed.filter((p) => p.id !== task.id && p.endSec === task.startSec);
  const needs = demandOf(node);
  for (const r of needs) {
    if (r === COOK_RESOURCE) continue;
    const cap = caps[r] ?? 1;
    const holding = placed.filter(
      (p) => p.id !== task.id && p.needs.includes(r) && p.startSec <= justBefore && p.endSec > justBefore
    );
    if (holding.length >= cap) {
      const ref = releasedAtStart.find((p) => p.needs.includes(r)) || holding[0];
      return { type: "equipment", time: task.startSec, refStepId: ref?.id ?? null, equipmentType: r };
    }
  }
  const cookRef = releasedAtStart.find((p) => assignment.get(p.id) === assignment.get(task.id));
  return { type: "cook", time: task.startSec, refStepId: cookRef?.id ?? null };
}

// `nodeBudget` lets a live re-plan trade proof for responsiveness: mid-cook
// the remaining set is small and the answer is needed between taps.
export function scheduleSteps(nodes, cooks, kitchenProfile, { nodeBudget, timeBudgetMs } = {}) {
  if (cooks.length === 0 || nodes.length === 0) {
    return { steps: [], makespanSec: 0, criticalStepIds: new Set(), unscheduledIds: nodes.map((n) => n.id), optimal: true, lowerBoundSec: 0 };
  }

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const caps = resourceCapacities(cooks, kitchenProfile);
  const { order: topo, unordered } = topoSort(nodes, byId);
  const schedulable = topo.map((id) => byId[id]);

  if (schedulable.length === 0) {
    return { steps: [], makespanSec: 0, criticalStepIds: new Set(), unscheduledIds: unordered, optimal: true, lowerBoundSec: 0 };
  }

  const { order, optimal, lowerBoundSec } = searchBestOrder(schedulable, byId, caps, topo, nodeBudget, timeBudgetMs);
  const placed = buildSchedule(order, byId, caps);
  const assignment = assignCooks(placed, cooks, byId);

  const stepById = new Map();
  placed.forEach((p) => {
    stepById.set(p.id, {
      id: p.id,
      cookId: assignment.get(p.id),
      startSec: p.startSec,
      endSec: p.endSec,
      dependsReadySec: p.dependsReadySec,
      requiredEquipment: [...new Set(byId[p.id].required_equipment || [])],
      startCause: deriveStartCause(p, placed, byId, assignment, caps),
    });
  });

  const steps = nodes.map((n) => stepById.get(n.id)).filter(Boolean);
  const makespanSec = steps.length ? Math.max(...steps.map((s) => s.endSec)) : 0;

  // Walk back from whatever finishes last, following each step's reason
  // for not starting sooner â€” so the chain covers equipment and cook
  // contention, not just the dependency graph.
  const endStep = steps.find((s) => s.endSec === makespanSec);
  const criticalStepIds = new Set();
  let cursor = endStep;
  while (cursor && !criticalStepIds.has(cursor.id)) {
    criticalStepIds.add(cursor.id);
    cursor = cursor.startCause.refStepId ? stepById.get(cursor.startCause.refStepId) : null;
  }

  return { steps, makespanSec, criticalStepIds, unscheduledIds: unordered, optimal, lowerBoundSec };
}

/**
 * The hands-on moments inside ONE step, placed in absolute schedule time.
 *
 * `startSec` is that step's own scheduled start (`step.startSec` from
 * `scheduleSteps`). Returns `[]` for a hands_on step — its whole span
 * already IS the hands-on moment, so there is nothing further to place —
 * and for a step that was never decomposed.
 *
 * Checkpoint N is placed `interval_sec` after the previous one, counting
 * from the moment `initial` ends. That is the exact assumption
 * `attachUnattended` (server/routes/recipes.js) used to DERIVE
 * `interval_sec` from the step's own duration in the first place, so the
 * schedule page and the generator can never disagree about where a tick
 * falls.
 */
export function unattendedEvents(node, startSec) {
  const u = node?.unattended;
  if (!u) return [];
  const events = [
    { kind: "initial", index: 0, atSec: startSec, endSec: startSec + u.initial.duration_sec, difficulty: u.initial.difficulty },
  ];

  if (u.checkpoints) {
    const { count, interval_sec, duration_sec, difficulty } = u.checkpoints;
    for (let i = 0; i < count; i++) {
      const atSec = startSec + u.initial.duration_sec + i * interval_sec;
      events.push({ kind: "checkpoint", index: i, atSec, endSec: atSec + duration_sec, difficulty });
    }
  }

  if (u.ending) {
    const endSec = startSec + node.estimated_duration_sec;
    events.push({ kind: "ending", index: 0, atSec: endSec - u.ending.duration_sec, endSec, difficulty: u.ending.difficulty });
  }

  return events;
}

/**
 * When a cook is free even though something is still cooking.
 *
 * "Free" means: not inside one of their hands-on steps or hands-on
 * moments, but inside an unattended step's span. A gap with nothing
 * running is a wait, not free time, and is left out — the same rule the
 * Schedule lanes use for drawing hatched waits versus rails.
 *
 * `cookSteps` are that cook's scheduled steps. Returns
 * [{ startSec, endSec, stepIds }] in time order, windows shorter than
 * `minSec` dropped.
 */
export function cookFreeWindows(cookSteps, byId, minSec = 30) {
  const occupied = [];
  const rails = [];
  cookSteps.forEach((s) => {
    const node = byId[s.id];
    if (!node) return;
    if (isAttended(node)) {
      occupied.push([s.startSec, s.endSec]);
      return;
    }
    rails.push({ id: s.id, startSec: s.startSec, endSec: s.endSec });
    unattendedEvents(node, s.startSec).forEach((m) => occupied.push([m.atSec, m.endSec]));
  });
  occupied.sort((a, b) => a[0] - b[0]);

  const windows = [];
  rails.forEach((rail) => {
    let cursor = rail.startSec;
    const close = (endSec) => {
      if (endSec - cursor >= minSec) windows.push({ startSec: cursor, endSec, stepIds: [rail.id] });
    };
    occupied.forEach(([os, oe]) => {
      if (oe <= cursor || os >= rail.endSec) return;
      if (os > cursor) close(os);
      cursor = Math.max(cursor, oe);
    });
    if (cursor < rail.endSec) close(rail.endSec);
  });
  return windows.sort((a, b) => a.startSec - b.startSec);
}

/**
 * Which physical burner / pot / board each step uses.
 *
 * The scheduler enforces equipment as a COUNT — two burners means at
 * most two things on a burner at once — and never says which. That was
 * enough while every step also occupied a cook, because the cook lanes
 * carried the picture. Once unattended steps stopped occupying anyone,
 * a 40-minute simmer had no lane at all: it belongs to the pot, not the
 * person, and the pot had nowhere to be drawn.
 *
 * Greedy by start time into the first free lane. That is optimal for
 * interval partitioning, and the schedule is already fixed by the time
 * this runs, so it cannot make the plan worse — it only names what the
 * plan already implies.
 *
 * Returns [{ type, index, label, stepIds }], one entry per lane that has
 * anything in it. A kitchen with three burners and two used shows two.
 */
export function equipmentLanes(steps, nodes) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const ordered = [...steps].sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  const lanesByType = new Map();

  ordered.forEach((step) => {
    const needs = [...new Set(byId[step.id]?.required_equipment || [])];
    needs.forEach((type) => {
      if (!lanesByType.has(type)) lanesByType.set(type, []);
      const lanes = lanesByType.get(type);
      const free = lanes.find((lane) => lane.endSec <= step.startSec);
      if (free) {
        free.stepIds.push(step.id);
        free.endSec = step.endSec;
      } else {
        lanes.push({ stepIds: [step.id], endSec: step.endSec });
      }
    });
  });

  // Waits that need no equipment at all — chilling, resting, marinating —
  // have no cook lane (they occupy nobody) and no equipment lane (they
  // use none), so they were drawn nowhere and simply vanished off the
  // schedule. On a congee-and-chicken run that was two steps of six.
  // They get a lane of their own.
  const bare = ordered.filter((step) => {
    const node = byId[step.id];
    return node && !isAttended(node) && !(node.required_equipment || []).length;
  });

  const out = [];
  // Drawn in a fixed order — board, wok, pot, burner, oven — so the
  // lanes sit in the same place on every plan, rather than in whatever
  // order the scheduler's option list happens to be.
  EQUIPMENT_LANE_ORDER.forEach((type) => {
    (lanesByType.get(type) || []).forEach((lane, i) => {
      const label = EQUIPMENT_LABELS[type] || type;
      out.push({
        type,
        index: i + 1,
        // Only number them when there is more than one to tell apart.
        label: (lanesByType.get(type) || []).length > 1 ? `${label} ${i + 1}` : label,
        stepIds: lane.stepIds,
      });
    });
  });

  if (bare.length) {
    // Packed the same way, because two things can rest at once.
    const laneEnds = [];
    const laneSteps = [];
    bare.forEach((step) => {
      const i = laneEnds.findIndex((end) => end <= step.startSec);
      if (i === -1) {
        laneEnds.push(step.endSec);
        laneSteps.push([step.id]);
      } else {
        laneEnds[i] = step.endSec;
        laneSteps[i].push(step.id);
      }
    });
    laneSteps.forEach((stepIds, i) => {
      out.push({
        type: "__unattended__",
        index: i + 1,
        // "Counter", not "waiting": the legend already uses Waiting for a
        // cook who is stuck, and this lane is a step that needs no tool.
        label: laneSteps.length > 1 ? `counter ${i + 1}` : "counter",
        stepIds,
      });
    });
  }
  return out;
}

// Solo comparison reuses scheduleSteps with one synthetic cook, same
// kitchen â€” with a single cook nothing can overlap, so this is the
// "no parallelism" baseline.
export function computeSchedule(nodes, cooks, kitchenProfile) {
  const multi = scheduleSteps(nodes, cooks, kitchenProfile);
  const solo = scheduleSteps(nodes, [{ id: "solo", name: "Solo cook" }], kitchenProfile);
  return {
    steps: multi.steps,
    makespanSec: multi.makespanSec,
    criticalStepIds: multi.criticalStepIds,
    unscheduledIds: multi.unscheduledIds,
    optimal: multi.optimal,
    lowerBoundSec: multi.lowerBoundSec,
    soloMakespanSec: solo.makespanSec,
    savedSec: Math.max(0, solo.makespanSec - multi.makespanSec),
  };
}

// A step can start immediately when it has no dependencies inside this
// node set (a reference to a node that isn't here can't gate anything).
function isReadyAtStart(node, byId) {
  return (node.depends_on || []).every((d) => !byId[d]);
}

/**
 * Competition mode doesn't hand out a full plan â€” cooks claim tasks by
 * voice as they go. All it needs is a fair opening: one bundle of
 * immediately-startable work per cook, balanced so nobody is still on
 * their first task while someone else is three tasks in (e.g. one cook
 * takes a single 9-minute task while the other takes a 5 and a 4).
 *
 * Bundles never split a scarce tool across cooks â€” if the kitchen has
 * one cutting board, only one cook's opening bundle may need it, since
 * two "simultaneous" openers queueing for the same board aren't a fair
 * start. Balance is best-effort: the closest split the ready set allows,
 * with the leftover skew reported rather than papered over.
 *
 * Everything not handed out â€” the rest of the ready work plus every
 * step still gated by dependencies â€” stays in an unclaimed pool.
 */
export function computeOpeningAssignment(nodes, cooks, kitchenProfile) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const capacity = equipmentCapacity(kitchenProfile);
  const allReady = nodes.filter((n) => isReadyAtStart(n, byId));
  const lockedIds = nodes.filter((n) => !isReadyAtStart(n, byId)).map((n) => n.id);
  const emptyBundles = cooks.map((c) => ({ cookId: c.id, stepIds: [], totalSec: 0 }));

  // Openings are balanced on ATTENDED time only.
  //
  // Balancing on total duration made a 40-minute simmer a full opening
  // all by itself: on a congee run both cooks were handed nothing but
  // pots to put on — zero hands-on work each, every real task left in
  // the pool — and it reported a skew of zero. A perfectly balanced
  // nothing. Two people start a simmer apiece and then race for the
  // actual cooking.
  const ready = allReady.filter(isAttended);
  const readyWaits = allReady.filter((n) => !isAttended(n));

  if (ready.length < cooks.length) {
    return {
      bundles: emptyBundles,
      poolIds: allReady.map((n) => n.id),
      lockedIds,
      contested: true,
      skewSec: 0,
    };
  }

  const sorted = [...ready].sort(
    (a, b) => b.estimated_duration_sec - a.estimated_duration_sec || a.id.localeCompare(b.id)
  );
  const bundles = emptyBundles.map((b) => ({ ...b, stepIds: [] }));
  const used = new Set();
  const toolHolders = {}; // equipment type -> Set of bundle indexes already using it

  const canTake = (bundleIdx, node) =>
    (node.required_equipment || []).every((t) => {
      const holders = toolHolders[t];
      if (!holders || holders.has(bundleIdx)) return true;
      return holders.size < (capacity[t] ?? 1);
    });

  const take = (bundleIdx, node, charge = true) => {
    bundles[bundleIdx].stepIds.push(node.id);
    // An unattended step joins the bundle without adding to its load —
    // the cook starts it and is immediately free again.
    if (charge) bundles[bundleIdx].totalSec += node.estimated_duration_sec;
    used.add(node.id);
    (node.required_equipment || []).forEach((t) => {
      if (!toolHolders[t]) toolHolders[t] = new Set();
      toolHolders[t].add(bundleIdx);
    });
  };

  // Deal the ready waits out first, round robin, subject to equipment.
  // Getting them going is the most valuable opening move there is — the
  // claim pool ranks them first for the same reason — but they cost the
  // cook nothing, so `take` is told not to charge for them.
  readyWaits
    .sort((a, b) => b.estimated_duration_sec - a.estimated_duration_sec || a.id.localeCompare(b.id))
    .forEach((node, i) => {
      for (let n = 0; n < bundles.length; n++) {
        const idx = (i + n) % bundles.length;
        if (canTake(idx, node)) {
          take(idx, node, false);
          return;
        }
      }
      // Every cook's equipment is spoken for; it stays in the pool.
    });

  // The longest single ready task sets the bar every other cook tries
  // to match with one or more smaller tasks.
  take(0, sorted[0]);
  const targetSec = bundles[0].totalSec;

  for (let i = 1; i < bundles.length; i++) {
    for (;;) {
      if (bundles[i].totalSec >= targetSec) break;
      const available = sorted.filter((n) => !used.has(n.id) && canTake(i, n));
      if (available.length === 0) break;
      const fits = available.filter((n) => bundles[i].totalSec + n.estimated_duration_sec <= targetSec);
      if (fits.length > 0) {
        take(i, fits[0]); // sorted desc, so this is the largest that still fits
      } else if (bundles[i].stepIds.length === 0) {
        take(i, available[available.length - 1]); // nothing fits, but nobody starts empty
      } else {
        break;
      }
    }
  }

  const totals = bundles.map((b) => b.totalSec);
  return {
    bundles,
    poolIds: allReady.filter((n) => !used.has(n.id)).map((n) => n.id),
    lockedIds,
    contested: false,
    skewSec: Math.max(...totals) - Math.min(...totals),
  };
}
