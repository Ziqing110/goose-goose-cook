// Pure resource-constrained scheduler — no DOM/React, same spirit as
// graphLayout.js. Greedy list scheduler: at each step, picks whichever
// ready step's dependencies finished earliest, assigns it to whichever
// eligible cook is free soonest and whichever slot of each required
// equipment type is free soonest. Not an optimal solver — no cook
// specialization, no lookahead, no backtracking. Every step needs one
// cook's full attention for its whole duration (no unattended/
// background steps, e.g. a hands-off rice cooker — a known gap).
import { EQUIPMENT_OPTIONS } from "../data/dishes.js";

export const EQUIPMENT_LABELS = {
  cutting_board: "cutting board",
  stove_burner: "burner",
  wok: "wok",
  pot: "pot",
  oven: "oven",
};

// Equipment with 0 configured capacity (including hasWok/hasOven false)
// is treated as capacity 1 — a "make it work" fallback instead of
// deadlocking the scheduler.
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

export function scheduleSteps(nodes, cooks, kitchenProfile) {
  if (cooks.length === 0) return { steps: [], makespanSec: 0, criticalStepIds: new Set() };

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const capacity = equipmentCapacity(kitchenProfile);

  const finish = new Map();
  const stepResult = new Map();
  const scheduled = new Set();
  const cookFreeAt = new Map(cooks.map((c) => [c.id, 0]));
  const cookLastStep = new Map(cooks.map((c) => [c.id, null]));

  const slots = {};
  EQUIPMENT_OPTIONS.forEach((type) => {
    slots[type] = Array.from({ length: capacity[type] ?? 1 }, () => ({ freeAt: 0, lastStepId: null }));
  });

  while (scheduled.size < nodes.length) {
    const ready = nodes.filter(
      (n) => !scheduled.has(n.id) && (n.depends_on || []).every((d) => scheduled.has(d) || !byId[d])
    );
    if (ready.length === 0) break; // cycle guard — shouldn't happen for a valid DAG

    const candidates = ready.map((n) => {
      let dependsReadySec = 0;
      let depRef = null;
      (n.depends_on || []).filter((d) => byId[d]).forEach((d) => {
        const f = finish.get(d) ?? 0;
        if (f > dependsReadySec) {
          dependsReadySec = f;
          depRef = d;
        }
      });
      return { node: n, dependsReadySec, depRef };
    });
    candidates.sort(
      (a, b) => a.dependsReadySec - b.dependsReadySec || nodeIndex.get(a.node.id) - nodeIndex.get(b.node.id)
    );
    const { node, dependsReadySec, depRef } = candidates[0];

    let bestCookId = cooks[0].id;
    let bestCookFree = cookFreeAt.get(cooks[0].id);
    cooks.forEach((c) => {
      const t = cookFreeAt.get(c.id);
      if (t < bestCookFree) {
        bestCookFree = t;
        bestCookId = c.id;
      }
    });

    const equipmentTypes = [...new Set(node.required_equipment || [])];
    const chosenSlots = equipmentTypes.map((type) => {
      const arr = slots[type];
      let bestIdx = 0;
      arr.forEach((s, i) => {
        if (s.freeAt < arr[bestIdx].freeAt) bestIdx = i;
      });
      return { type, index: bestIdx, freeAt: arr[bestIdx].freeAt, lastStepId: arr[bestIdx].lastStepId };
    });

    // Precedence on an exact tie: dependency > equipment > cook —
    // dependency is the most truthful cause when it applies; among
    // resource ties, equipment is more narratively useful ("waiting for
    // the cutting board") than a generic cook-busy cause.
    const candidateList = [
      { type: "dependency", time: dependsReadySec, refStepId: depRef },
      ...chosenSlots.map((s) => ({ type: "equipment", time: s.freeAt, refStepId: s.lastStepId, equipmentType: s.type })),
      { type: "cook", time: bestCookFree, refStepId: cookLastStep.get(bestCookId) },
    ];
    const startSec = Math.max(...candidateList.map((c) => c.time));
    const startCause = candidateList.find((c) => c.time === startSec);
    const endSec = startSec + node.estimated_duration_sec;

    finish.set(node.id, endSec);
    cookFreeAt.set(bestCookId, endSec);
    cookLastStep.set(bestCookId, node.id);
    chosenSlots.forEach((s) => {
      slots[s.type][s.index] = { freeAt: endSec, lastStepId: node.id };
    });

    stepResult.set(node.id, {
      id: node.id,
      cookId: bestCookId,
      startSec,
      endSec,
      dependsReadySec,
      requiredEquipment: equipmentTypes,
      startCause,
    });
    scheduled.add(node.id);
  }

  const steps = nodes.map((n) => stepResult.get(n.id)).filter(Boolean);
  const makespanSec = steps.length ? Math.max(...steps.map((s) => s.endSec)) : 0;

  // Backward trace from the (first, by node order) step achieving the
  // makespan, following startCause.refStepId — each link's timestamp is
  // exactly the finish time of the referenced step by construction, so
  // this walks the real chain of constraints (dependency AND resource)
  // that produced the finish time, not a naive dependency-only guess.
  const endStep = steps.find((s) => s.endSec === makespanSec);
  const criticalStepIds = new Set();
  let cursor = endStep;
  while (cursor) {
    criticalStepIds.add(cursor.id);
    cursor = cursor.startCause.refStepId ? stepResult.get(cursor.startCause.refStepId) : null;
  }

  return { steps, makespanSec, criticalStepIds };
}

// Solo comparison reuses scheduleSteps with one synthetic cook, same
// kitchen — with a single cook, equipment can never contend (nobody
// else is running in parallel), so this reduces to the "no parallelism"
// baseline: sum of durations along the ready-order the single cook works.
export function computeSchedule(nodes, cooks, kitchenProfile) {
  const multi = scheduleSteps(nodes, cooks, kitchenProfile);
  const solo = scheduleSteps(nodes, [{ id: "solo", name: "Solo cook" }], kitchenProfile);
  return {
    steps: multi.steps,
    makespanSec: multi.makespanSec,
    criticalStepIds: multi.criticalStepIds,
    soloMakespanSec: solo.makespanSec,
    savedSec: Math.max(0, solo.makespanSec - multi.makespanSec),
  };
}
