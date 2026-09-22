// Regression test for a cook-assignment bug: an unattended step's owner
// only has to be present for its initial/checkpoint/ending moments, not
// its whole span, but assignCooks used to reserve nothing for those
// moments at all. That let another cook's fully-attended step land on
// the SAME cook, overlapping the exact minutes that unattended step
// needed them — two things a real person can't do at once.
// Run with: node --test src/utils/scheduleLayout.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { scheduleSteps, unattendedEvents } from "./scheduleLayout.js";
import { isAttended } from "./tending.js";

const cooks = [
  { id: "c1", name: "A" },
  { id: "c2", name: "B" },
];

// A pot left to simmer: needs someone for the first 50s and the last
// 50s of its 300s span, nobody in between.
const simmer = {
  id: "simmer",
  tending: "timed",
  estimated_duration_sec: 300,
  required_equipment: [],
  depends_on: [],
  unattended: { initial: { duration_sec: 50, difficulty: "low" }, checkpoints: null, ending: { duration_sec: 50, difficulty: "low" } },
};

// A hands-on task, ready at the same moment, that occupies its cook for
// the whole 300s — the same span the simmer runs across.
const chop = {
  id: "chop",
  tending: "hands_on",
  estimated_duration_sec: 300,
  required_equipment: [],
  depends_on: [],
};

// The windows a step's owner actually has to be present for — the same
// notion scheduleLayout.js's assignCooks uses internally, reimplemented
// here (rather than importing an unexported helper) so this test checks
// the externally observable result, not the internals.
function ownerWindows(node, step) {
  if (isAttended(node)) return [[step.startSec, step.endSec]];
  return unattendedEvents(node, step.startSec).map((m) => [m.atSec, m.endSec]);
}

test("assignCooks: a hands-on step never lands on the same cook as an unattended step's initial/ending moments", () => {
  const nodes = [simmer, chop];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const { steps } = scheduleSteps(nodes, cooks, null);
  assert.equal(steps.length, 2);

  const byCook = new Map();
  steps.forEach((s) => {
    const windows = ownerWindows(byId[s.id], s);
    const existing = byCook.get(s.cookId) || [];
    // Every window this step needs its cook for must be disjoint from
    // every window already claimed for that same cook by another step.
    windows.forEach(([s1, e1]) => {
      existing.forEach(([s2, e2]) => {
        assert.ok(
          e1 <= s2 || e2 <= s1,
          `cook ${s.cookId} double-booked: [${s1},${e1}) overlaps [${s2},${e2})`
        );
      });
    });
    byCook.set(s.cookId, [...existing, ...windows]);
  });

  // With two cooks and only two overlapping commitments, both cooks
  // should actually be used — the bug's other symptom was one cook
  // idle the whole time while the other silently double-booked.
  const usedCooks = new Set(steps.map((s) => s.cookId));
  assert.equal(usedCooks.size, 2);
});

// The same rule, one level deeper. Reserving the moments during
// assignment is not enough on its own: the TIMING stage has to know
// about them too, or it hands over a plan whose moments simply cannot
// be shared out, and there is nothing assignment can then do about it.
// Several unattended steps all wanting a cook at once is what exposes
// that, since each one's moments must all fall to a single owner.
test("scheduleSteps: never plans more simultaneous must-be-there moments than there are cooks", () => {
  const nodes = [];
  // Four pots, all startable at once, each wanting somebody at its
  // start and again at its end — with two cooks, they cannot all be
  // started at the same moment, whatever the burners allow.
  for (let i = 0; i < 4; i++) {
    nodes.push({
      id: `pot${i}`,
      label: `Pot ${i}`,
      tending: "timed",
      estimated_duration_sec: 600,
      difficulty: "low",
      required_equipment: [],
      depends_on: [],
      unattended: { initial: { duration_sec: 60, difficulty: "low" }, checkpoints: null, ending: { duration_sec: 60, difficulty: "low" } },
    });
  }
  nodes.push({ id: "prep", label: "Prep", tending: "hands_on", estimated_duration_sec: 600, difficulty: "low", required_equipment: [], depends_on: [] });

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const { steps } = scheduleSteps(nodes, cooks, null);

  // Nobody is in two places at once...
  const claimed = new Map();
  steps.forEach((s) => {
    ownerWindows(byId[s.id], s).forEach(([a, b]) => {
      (claimed.get(s.cookId) || []).forEach(([x, y]) => {
        assert.ok(b <= x || y <= a, `cook ${s.cookId} double-booked: [${a},${b}) overlaps [${x},${y})`);
      });
      claimed.set(s.cookId, [...(claimed.get(s.cookId) || []), [a, b]]);
    });
  });

  // ...and the plan never asks for more hands at one instant than the
  // kitchen has, which is the property assignment alone cannot recover.
  const edges = [];
  steps.forEach((s) => ownerWindows(byId[s.id], s).forEach(([a, b]) => edges.push([a, 1], [b, -1])));
  edges.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  let open = 0;
  edges.forEach(([, delta]) => {
    open += delta;
    assert.ok(open <= cooks.length, `${open} cooks needed at once, kitchen has ${cooks.length}`);
  });
});
