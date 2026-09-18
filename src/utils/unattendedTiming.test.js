// Tests for the two pieces that turn a step's `unattended` breakdown into
// actual moments in time: scheduleLayout's unattendedEvents (planned
// schedule time) and liveCook's unattendedPhaseNow/activeStepFor (real
// elapsed time during a run).
// Run with: node --test src/utils/unattendedTiming.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { unattendedEvents } from "./scheduleLayout.js";
import { unattendedPhaseNow, activeStepFor, makeStepRecords } from "./liveCook.js";

const tendedNode = {
  id: "simmer",
  tending: "tended",
  estimated_duration_sec: 2400, // 40 min
  unattended: {
    initial: { duration_sec: 60, difficulty: "low" },
    checkpoints: { count: 8, interval_sec: 280, duration_sec: 20, difficulty: "low" },
    ending: { duration_sec: 30, difficulty: "low" },
  },
};

const timedNode = {
  id: "ice_bath",
  tending: "timed",
  estimated_duration_sec: 480,
  unattended: {
    initial: { duration_sec: 30, difficulty: "low" },
    checkpoints: null,
    ending: { duration_sec: 20, difficulty: "low" },
  },
};

const forgetNode = {
  id: "soak",
  tending: "set_and_forget",
  estimated_duration_sec: 1800,
  unattended: { initial: { duration_sec: 45, difficulty: "low" }, checkpoints: null, ending: null },
};

const handsOnNode = { id: "chop", tending: "hands_on", estimated_duration_sec: 120 };

test("unattendedEvents: hands_on and undecomposed steps have nothing to place", () => {
  assert.deepEqual(unattendedEvents(handsOnNode, 0), []);
  assert.deepEqual(unattendedEvents({ id: "x" }, 0), []);
});

test("unattendedEvents: tended step gets initial + every checkpoint + ending, in absolute time", () => {
  const events = unattendedEvents(tendedNode, 1000); // starts at t=1000
  assert.equal(events.length, 1 + 8 + 1);
  assert.deepEqual(events[0], { kind: "initial", index: 0, atSec: 1000, endSec: 1060, difficulty: "low" });
  // checkpoint 0 starts right after initial ends (1060), checkpoint 1 is one interval later, etc.
  assert.equal(events[1].kind, "checkpoint");
  assert.equal(events[1].atSec, 1060);
  assert.equal(events[1].endSec, 1080);
  assert.equal(events[2].atSec, 1060 + 280);
  const ending = events[events.length - 1];
  assert.equal(ending.kind, "ending");
  assert.equal(ending.endSec, 1000 + tendedNode.estimated_duration_sec);
  assert.equal(ending.atSec, ending.endSec - 30);
});

test("unattendedEvents: timed step has an initial and an ending, never a checkpoint", () => {
  const events = unattendedEvents(timedNode, 0);
  assert.deepEqual(events.map((e) => e.kind), ["initial", "ending"]);
});

test("unattendedEvents: set_and_forget has only an initial", () => {
  const events = unattendedEvents(forgetNode, 0);
  assert.deepEqual(events.map((e) => e.kind), ["initial"]);
});

function activeRecordAt(startedAtMs) {
  return { status: "active", cookId: "a", startedAt: new Date(startedAtMs).toISOString(), endedAt: null, pausedSec: 0 };
}

test("unattendedPhaseNow: idle before start, initial right after, waiting once initial ends", () => {
  const record = { status: "pending", startedAt: null };
  assert.equal(unattendedPhaseNow(tendedNode, record).phase, "idle");

  const start = 1_000_000;
  assert.equal(unattendedPhaseNow(tendedNode, activeRecordAt(start), start).phase, "initial");
  assert.equal(unattendedPhaseNow(tendedNode, activeRecordAt(start), start + 59_000).phase, "initial");
  // checkpoint 0's own window is [60,80)s after initial ends; 90s is past it.
  assert.equal(unattendedPhaseNow(tendedNode, activeRecordAt(start), start + 90_000).phase, "waiting");
});

test("unattendedPhaseNow: lands inside each checkpoint window and waits between them", () => {
  const start = 0;
  const record = activeRecordAt(start);
  // checkpoint 0 window: [60, 80)s
  assert.equal(unattendedPhaseNow(tendedNode, record, 65_000).phase, "checkpoint");
  assert.equal(unattendedPhaseNow(tendedNode, record, 65_000).index, 0);
  // between checkpoint 0 and 1: waiting
  assert.equal(unattendedPhaseNow(tendedNode, record, 200_000).phase, "waiting");
  // checkpoint 1 window: [60+280, 60+280+20)s = [340, 360)
  assert.equal(unattendedPhaseNow(tendedNode, record, 345_000).phase, "checkpoint");
  assert.equal(unattendedPhaseNow(tendedNode, record, 345_000).index, 1);
});

test("unattendedPhaseNow: ending phase opens at duration-minus-ending and stays open if late", () => {
  const start = 0;
  const record = activeRecordAt(start);
  const endingOpensAt = (tendedNode.estimated_duration_sec - tendedNode.unattended.ending.duration_sec) * 1000;
  assert.equal(unattendedPhaseNow(tendedNode, record, endingOpensAt - 1000).phase, "waiting");
  assert.equal(unattendedPhaseNow(tendedNode, record, endingOpensAt).phase, "ending");
  // running well past the whole step's estimated duration — still "ending", not silently idle
  assert.equal(unattendedPhaseNow(tendedNode, record, endingOpensAt + 10 * 60_000).phase, "ending");
});

test("unattendedPhaseNow: set_and_forget never reports checkpoint or ending", () => {
  const record = activeRecordAt(0);
  for (const atMs of [0, 44_000, 1_800_000, 3_600_000]) {
    const { phase } = unattendedPhaseNow(forgetNode, record, atMs);
    assert.ok(["initial", "waiting"].includes(phase), `unexpected phase "${phase}" at ${atMs}ms`);
  }
});

test("activeStepFor: a cook is occupied during initial/checkpoint/ending but free while waiting", () => {
  const nodes = [tendedNode, handsOnNode];
  const run = { steps: makeStepRecords(nodes) };
  run.steps.simmer = activeRecordAt(0);

  assert.equal(activeStepFor("a", run, nodes, 30_000), "simmer"); // inside initial
  assert.equal(activeStepFor("a", run, nodes, 200_000), null); // waiting between checkpoints
  assert.equal(activeStepFor("a", run, nodes, 345_000), "simmer"); // inside checkpoint 1
});

test("activeStepFor: still honors a real hands_on step regardless of any unattended work also running", () => {
  const nodes = [tendedNode, handsOnNode];
  const run = { steps: makeStepRecords(nodes) };
  run.steps.simmer = activeRecordAt(0); // cook "a" started the simmer, currently waiting on it
  run.steps.chop = { status: "active", cookId: "a", startedAt: new Date(200_000).toISOString(), endedAt: null, pausedSec: 0 };

  assert.equal(activeStepFor("a", run, nodes, 200_000), "chop");
});
