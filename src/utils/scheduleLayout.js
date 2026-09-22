// Resource-constrained scheduler. No DOM/React, same spirit as
// graphLayout.js.
//
// Two stages, deliberately separated:
//
//  1. WHEN each step runs — branch-and-bound over activity orderings,
//     minimising the finish time, against each equipment type at its
//     kitchen capacity and against the cooks themselves. With ~20 fixed
//     steps the search proves optimality rather than guessing, falling
//     back to the best found so far if it hits its node budget.
//  2. WHO does each step — the schedule above fixes the start times,
//     and any assignment that never double-books a cook is equally
//     fast, so that freedom is spent evening out each cook's workload
//     (the greedy this replaced piled ~3x the work on one cook).
//
// An attended step needs a cook for its whole duration. An unattended
// one — a simmer, a chill, a rest — holds its EQUIPMENT throughout but
// needs a cook only at its own moments: starting it, any checkpoints,
// and taking it off. Those moments are real work and are scheduled as
// such; the long gap between them is not, and is what lets the other
// cook get on with something else.
//
// Stage 1 picks a cook as it places each step, rather than checking a
// pooled count and leaving identity to stage 2. It has to: an
// unattended step's moments all belong to whoever started it, and that
// grouping means "somebody was spare at each moment" does not imply
// anyone can actually cover them all. Asking the pooled question
// produced timelines no division of the work could staff.
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
 * What a step occupies, and WHEN within its own span.
 *
 * A claim is one resource held over one interval. Equipment is always
 * held for the step's whole span — the pot is busy for the entire
 * simmer. A cook is not: an attended step holds one for its whole span,
 * while an unattended step holds one only for the moments somebody has
 * to be there, the initial/checkpoint/ending windows, and nobody in
 * between.
 *
 * Those brief windows are the whole reason this returns intervals
 * rather than a flat list of resource names. Charging a cook for an
 * unattended step's FULL span made the planner believe two people were
 * flat out for 48 minutes on a congee run containing 21 minutes of
 * hands-on work. But charging nothing at all — which is what replaced
 * it — let the planner put three simultaneous must-be-there moments in
 * a two-cook kitchen, because taking a pot off the heat looked free.
 * Both are wrong in the same place; only the interval says so.
 */
function claimsOf(node, startSec) {
  const endSec = startSec + node.estimated_duration_sec;
  const claims = [...new Set(node.required_equipment || [])].map((resource) => ({ resource, startSec, endSec }));
  if (isAttended(node)) {
    claims.push({ resource: COOK_RESOURCE, startSec, endSec });
  } else {
    unattendedEvents(node, startSec).forEach((m) => {
      claims.push({ resource: COOK_RESOURCE, startSec: m.atSec, endSec: m.endSec });
    });
  }
  return claims;
}

/** Every interval already claimed on one resource by what's been placed. */
function claimedOn(placed, resource, skipId = null) {
  const out = [];
  placed.forEach((p) => {
    if (p.id === skipId) return;
    p.claims.forEach((c) => {
      if (c.resource === resource) out.push([c.startSec, c.endSec]);
    });
  });
  return out;
}

/**
 * The most that overlap at any one instant inside [from, to).
 *
 * A plain pairwise count — what this used to do — asks "how many things
 * touch my span", which is a different and stricter question: two short
 * claims at either end of a long simmer both touch it without ever
 * coinciding. With a cook's time now arriving in fragments, that
 * distinction decides whether a plan is called impossible or merely busy.
 */
function maxConcurrent(intervals, from, to) {
  const edges = [];
  intervals.forEach(([s, e]) => {
    const start = Math.max(s, from);
    const end = Math.min(e, to);
    if (start < end) edges.push([start, 1], [end, -1]);
  });
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let open = 0;
  let peak = 0;
  edges.forEach(([, delta]) => {
    open += delta;
    if (open > peak) peak = open;
  });
  return peak;
}

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
function earliestFeasibleStart(node, earliest, placed, caps, cookCount) {
  const candidates = new Set([earliest]);
  placed.forEach((p) =>
    p.claims.forEach((c) => {
      if (c.endSec > earliest) candidates.add(c.endSec);
    })
  );
  const times = [...candidates].sort((a, b) => a - b);

  // What each cook is already holding, by the index they were placed
  // under. Read off `placed` rather than carried alongside it, so the
  // search's push/pop of a placement undoes its cook too, for free.
  const heldBy = (k) => {
    const out = [];
    placed.forEach((p) => {
      if (p.cookIndex !== k) return;
      p.claims.forEach((c) => {
        if (c.resource === COOK_RESOURCE) out.push([c.startSec, c.endSec]);
      });
    });
    return out;
  };
  const loadOf = (k) =>
    placed.reduce(
      (sum, p) =>
        p.cookIndex === k
          ? sum + p.claims.reduce((s, c) => (c.resource === COOK_RESOURCE ? s + (c.endSec - c.startSec) : s), 0)
          : sum,
      0
    );

  for (const t of times) {
    const claims = claimsOf(node, t);
    const equipmentOk = claims.every((c) => {
      if (c.resource === COOK_RESOURCE) return true;
      const cap = caps[c.resource] ?? 1;
      return maxConcurrent(claimedOn(placed, c.resource), c.startSec, c.endSec) + 1 <= cap;
    });
    if (!equipmentOk) continue;

    // A named cook has to be able to take EVERY moment this step needs
    // one for, not just "some cook was spare at each moment" — all of an
    // unattended step's moments belong to whoever started it. Asking the
    // pooled question instead let this hand back timelines that no
    // division of the work could actually staff.
    const wants = claims.filter((c) => c.resource === COOK_RESOURCE);
    if (wants.length === 0) return { startSec: t, cookIndex: null };
    const fits = [];
    for (let k = 0; k < cookCount; k++) {
      const held = heldBy(k);
      if (held.every(([hs, he]) => wants.every((c) => he <= c.startSec || c.endSec <= hs))) fits.push(k);
    }
    if (fits.length === 0) continue;
    // Least-loaded of those that fit, so the timeline it hands on is
    // already roughly even and assignCooks has less to undo.
    fits.sort((a, b) => loadOf(a) - loadOf(b) || a - b);
    return { startSec: t, cookIndex: fits[0] };
  }
  return { startSec: times[times.length - 1], cookIndex: 0 };
}

/** Serial schedule generation: place activities in the given order, each
 *  at its earliest feasible time. Produces an "active" schedule, and for
 *  a regular objective like makespan an optimal schedule is always among
 *  these â€” which is what makes searching over orderings exhaustive. */
function buildSchedule(order, byId, caps, cookCount) {
  const placed = [];
  const finishById = new Map();
  order.forEach((id) => {
    const node = byId[id];
    const depReady = (node.depends_on || [])
      .filter((d) => byId[d])
      .reduce((max, d) => Math.max(max, finishById.get(d) ?? 0), 0);
    const { startSec, cookIndex } = earliestFeasibleStart(node, depReady, placed, caps, cookCount);
    const endSec = startSec + node.estimated_duration_sec;
    placed.push({ id, startSec, endSec, cookIndex, claims: claimsOf(node, startSec), dependsReadySec: depReady });
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
function searchBestOrder(nodes, byId, caps, cookCount, seedOrder, nodeBudget = SEARCH_NODE_BUDGET, timeBudgetMs = SEARCH_TIME_BUDGET_MS) {
  const tails = computeTails(nodes, byId);
  const total = nodes.length;
  const preds = new Map(nodes.map((n) => [n.id, (n.depends_on || []).filter((d) => byId[d])]));
  // Global floors: nothing can finish sooner than the longest dependency
  // chain, than the total work split across the cooks, or than the work
  // queued on any single piece of equipment. Reaching the floor proves
  // optimality outright; otherwise it's how close the answer is known to be.
  const criticalPath = Math.max(0, ...nodes.map((n) => tails.get(n.id)));
  // An attended step charges the cook pool its whole duration; an
  // unattended one charges only the moments somebody has to be there.
  // Charging its full duration made the bound exceed schedules that are
  // provably achievable, so the search never declared victory on
  // recipes with real unattended time in them — but charging nothing
  // understates work the kitchen genuinely has to staff. The hands-on
  // seconds inside it are the honest figure, and they keep the floor a
  // floor: it is time somebody must spend, however it is arranged.
  const totalCookWork = nodes.reduce(
    (sum, n) =>
      sum +
      (isAttended(n)
        ? n.estimated_duration_sec
        : unattendedEvents(n, 0).reduce((inner, m) => inner + (m.endSec - m.atSec), 0)),
    0
  );
  let floor = Math.max(criticalPath, Math.ceil(totalCookWork / Math.max(1, caps[COOK_RESOURCE])));
  EQUIPMENT_OPTIONS.forEach((type) => {
    const work = nodes
      .filter((n) => (n.required_equipment || []).includes(type))
      .reduce((sum, n) => sum + n.estimated_duration_sec, 0);
    floor = Math.max(floor, Math.ceil(work / Math.max(1, caps[type] ?? 1)));
  });

  const seedPlaced = buildSchedule(seedOrder, byId, caps, cookCount);
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
      const { startSec, cookIndex } = earliestFeasibleStart(n, depReady, placed, caps, cookCount);
      const endSec = startSec + n.estimated_duration_sec;
      // The finish only ever grows, so if placing this already matches
      // the incumbent, nothing below this branch can beat it.
      if (endSec >= bestMakespan) continue;
      placed.push({ id: n.id, startSec, endSec, cookIndex, claims: claimsOf(n, startSec), dependsReadySec: depReady });
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
 * The windows during which a step's owner actually has to be there.
 *
 * An attended step is one window, its whole span. An unattended step is
 * several brief ones — the initial/checkpoint/ending moments from
 * `unattendedEvents` — with nothing reserved in between, because that
 * gap is exactly the point of calling it unattended.
 */
function ownerWindows(node, task) {
  if (isAttended(node)) return [[task.startSec, task.endSec]];
  return unattendedEvents(node, task.startSec).map((m) => [m.atSec, m.endSec]);
}

// How many assignments the backtracking search below will try before it
// concedes. Reached only when the greedy passes have already failed, so
// this bounds a rare case, not the common path.
const ASSIGN_SEARCH_BUDGET = 40000;

/**
 * Find ANY assignment of steps to cooks that double-books nobody.
 *
 * Backtracking over cooks per step, in start order. This exists because
 * an unattended step's moments all belong to one cook, which turns the
 * assignment from interval colouring — where first-fit always works —
 * into something that can need two steps to swap cooks together. Returns
 * null if it proves there is none, or runs out of budget: some timelines
 * genuinely cannot be staffed however the work is shared out, and saying
 * so is better than pretending.
 */
function searchAssignment(ordered, cooks, byId) {
  const windows = new Map(ordered.map((t) => [t.id, ownerWindows(byId[t.id], t)]));
  const held = new Map(cooks.map((c) => [c.id, []]));
  const chosen = new Map();
  let tried = 0;

  const fits = (cookId, wins) =>
    held.get(cookId).every(([hs, he]) => wins.every(([s, e]) => he <= s || e <= hs));

  const place = (i) => {
    if (i === ordered.length) return true;
    if (tried++ > ASSIGN_SEARCH_BUDGET) return false;
    const task = ordered[i];
    const wins = windows.get(task.id);
    for (const c of cooks) {
      if (!fits(c.id, wins)) continue;
      const before = held.get(c.id);
      held.set(c.id, [...before, ...wins]);
      chosen.set(task.id, c.id);
      if (place(i + 1)) return true;
      held.set(c.id, before);
      chosen.delete(task.id);
    }
    return false;
  };

  return place(0) ? chosen : null;
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

  // Free for EVERY window the task needs its owner present for — not
  // just its outer span. An unattended step's owner only has to be free
  // at its initial/checkpoint/ending moments, and everyone else's
  // hands-on work is checked against those same moments, not the whole
  // simmer, so a burner minute in the middle of it is never mistaken for
  // a cook minute.
  const freeFor = (cookId, task, skipTaskId = null) => {
    const windows = ownerWindows(byId[task.id], task);
    return intervals
      .get(cookId)
      .every((iv) => iv.id === skipTaskId || windows.every(([s, e]) => iv.endSec <= s || e <= iv.startSec));
  };

  const reserve = (cookId, task) => {
    ownerWindows(byId[task.id], task).forEach(([s, e]) => {
      intervals.get(cookId).push({ id: task.id, startSec: s, endSec: e });
    });
  };

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
    // An unattended step's owner still has its initial/checkpoint/ending
    // moments reserved (above), so nothing else lands on them, but the
    // step does NOT count toward how busy that cook is — the load
    // balancer is about the free stretch in between, which is exactly
    // what makes it unattended. Charging the full span for it would
    // re-create the thing this whole change removes: a cook shown as
    // occupied for forty minutes by a simmer.
    reserve(chosen.id, task);
    if (isAttended(byId[task.id])) {
      busy.set(chosen.id, busy.get(chosen.id) + (task.endSec - task.startSec));
    }
  });

  const move = (task, toCookId) => {
    const from = assignment.get(task.id);
    intervals.set(from, intervals.get(from).filter((iv) => iv.id !== task.id));
    reserve(toCookId, task);
    assignment.set(task.id, toCookId);
    if (isAttended(byId[task.id])) {
      const duration = task.endSec - task.startSec;
      busy.set(from, busy.get(from) - duration);
      busy.set(toCookId, busy.get(toCookId) + duration);
    }
  };

  // Repair. First-fit by start time is optimal for plain intervals, but
  // an unattended step's moments must all go to ONE cook, and that
  // grouping is enough to let the pass above paint itself into a corner:
  // it can hand a cook's middle to somebody and only then meet the step
  // that needed that cook at both ends. So where somebody is
  // double-booked, first try simply moving one of the overlapping steps
  // to a cook it fits on, repeatedly, since freeing one cook is often
  // what makes the next move possible.
  for (let pass = 0; pass < 8; pass++) {
    const stuck = ordered.filter((t) => !freeFor(assignment.get(t.id), t, t.id));
    if (stuck.length === 0) break;
    let moved = false;
    for (const task of stuck) {
      const to = cooks.find((c) => c.id !== assignment.get(task.id) && freeFor(c.id, task));
      if (!to) continue;
      move(task, to.id);
      moved = true;
    }
    if (!moved) break;
  }

  // Still stuck means no sequence of single moves gets there, which does
  // not prove no assignment does: with the grouping above this is not
  // interval colouring any more, and a conflict can need two steps to
  // trade cooks at once. Search for a whole consistent assignment before
  // giving up. Only reached when the cheap passes failed, and bounded,
  // because with the grouping the problem is NP-hard in general.
  if (ordered.some((t) => !freeFor(assignment.get(t.id), t, t.id))) {
    const found = searchAssignment(ordered, cooks, byId);
    if (found) {
      cooks.forEach((c) => {
        intervals.set(c.id, []);
        busy.set(c.id, 0);
      });
      ordered.forEach((task) => {
        const cookId = found.get(task.id);
        assignment.set(task.id, cookId);
        reserve(cookId, task);
        if (isAttended(byId[task.id])) {
          busy.set(cookId, busy.get(cookId) + (task.endSec - task.startSec));
        }
      });
    }
  }

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
        const better = spread() < before;
        busy.set(from, busy.get(from) + duration);
        busy.set(c.id, busy.get(c.id) - duration);
        if (better) {
          move(task, c.id);
          improved = true;
          break;
        }
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
  const holds = (p, r, at) => p.claims.some((c) => c.resource === r && c.startSec <= at && c.endSec > at);
  const releasedAtStart = placed.filter((p) => p.id !== task.id && p.claims.some((c) => c.endSec === task.startSec));
  const equipment = [...new Set(task.claims.map((c) => c.resource))].filter((r) => r !== COOK_RESOURCE);
  for (const r of equipment) {
    const cap = caps[r] ?? 1;
    const holding = placed.filter((p) => p.id !== task.id && holds(p, r, justBefore));
    if (holding.length >= cap) {
      const ref = releasedAtStart.find((p) => p.claims.some((c) => c.resource === r)) || holding[0];
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

  const { order, optimal, lowerBoundSec } = searchBestOrder(schedulable, byId, caps, cooks.length, topo, nodeBudget, timeBudgetMs);
  const placed = buildSchedule(order, byId, caps, cooks.length);
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
