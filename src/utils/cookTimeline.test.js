import test from "node:test";
import assert from "node:assert/strict";
import { timelineFor, runTimeline } from "./cookTimeline.js";

const nodes = [
  { id: "onion", label: "Dice onion" },
  { id: "garlic", label: "Mince garlic" },
  { id: "rice", label: "Rinse rice" },
];
const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
const cooks = [{ id: "mia", name: "Mia" }, { id: "leo", name: "Leo" }];

const at = (s) => new Date(Date.UTC(2026, 0, 1, 12, 0, s)).toISOString();

const run = {
  events: [
    { type: "run_start", cookId: null, stepId: null, at: at(0) },
    { type: "start", cookId: "mia", stepId: "onion", at: at(10) },
    { type: "start", cookId: "leo", stepId: "garlic", at: at(12) },
    { type: "done", cookId: "mia", stepId: "onion", at: at(70) },
    { type: "drop", cookId: "leo", stepId: "garlic", at: at(80) },
    { type: "start", cookId: "mia", stepId: "rice", at: at(90) },
    { type: "skip", cookId: "mia", stepId: "rice", at: at(95) },
    { type: "run_end", cookId: null, stepId: null, at: at(100) },
  ],
};

test("timelineFor: one cook's own actions, in order, labelled", () => {
  const mia = timelineFor(run, byId, "mia");
  assert.deepEqual(
    mia.map((a) => [a.type, a.label]),
    [["start", "Dice onion"], ["done", "Dice onion"], ["start", "Rinse rice"], ["skip", "Rinse rice"]],
  );
});

test("timelineFor: run-level events belong to nobody", () => {
  // run_start / run_end / replan carry a null cookId and are the run's,
  // not a person's. They must not show up in anyone's list.
  const all = [...timelineFor(run, byId, "mia"), ...timelineFor(run, byId, "leo")];
  assert.ok(all.every((a) => !String(a.type).startsWith("run_")));
});

test("timelineFor: a finished step carries how long it took", () => {
  const done = timelineFor(run, byId, "mia").find((a) => a.type === "done");
  assert.equal(done.seconds, 60, "started at :10, finished at :70");
});

test("timelineFor: only done is timed", () => {
  const mia = timelineFor(run, byId, "mia");
  assert.ok(mia.filter((a) => a.type !== "done").every((a) => a.seconds === null));
});

test("timelineFor: a step finished without ever being started still appears", () => {
  // Voice-driven runs do this constantly -- somebody says "done" on a
  // step they never announced starting. Dropping it would make the
  // timeline claim they did less than they did.
  const odd = { events: [{ type: "done", cookId: "mia", stepId: "garlic", at: at(30) }] };
  const [entry] = timelineFor(odd, byId, "mia");
  assert.equal(entry.type, "done");
  assert.equal(entry.label, "Mince garlic");
  assert.equal(entry.seconds, null, "no start to measure from");
});

test("timelineFor: an undone action is struck out, not deleted", () => {
  // "Started it, then took it back" is the honest record. Deleting it
  // would silently rewrite what happened.
  const undoRun = {
    events: [
      { type: "start", cookId: "mia", stepId: "onion", at: at(10) },
      { type: "undo", cookId: "mia", stepId: "onion", at: at(20), meta: { undid: "start" } },
    ],
  };
  const mia = timelineFor(undoRun, byId, "mia");
  assert.equal(mia.length, 1, "the undo itself is not an action");
  assert.equal(mia[0].type, "start");
  assert.equal(mia[0].undone, true);
});

test("timelineFor: an undo strikes the matching action, not the newest one", () => {
  const twice = {
    events: [
      { type: "done", cookId: "mia", stepId: "onion", at: at(10) },
      { type: "done", cookId: "mia", stepId: "garlic", at: at(20) },
      { type: "undo", cookId: "mia", stepId: "onion", at: at(30), meta: { undid: "done" } },
    ],
  };
  const mia = timelineFor(twice, byId, "mia");
  assert.equal(mia.find((a) => a.stepId === "onion").undone, true);
  assert.equal(mia.find((a) => a.stepId === "garlic").undone, false);
});

test("timelineFor: a step with no node still lists, without a label", () => {
  // A step deleted from the graph after the fact should not take the
  // record of someone having worked on it down with it.
  const orphan = { events: [{ type: "done", cookId: "mia", stepId: "gone", at: at(10) }] };
  assert.equal(timelineFor(orphan, byId, "mia")[0].label, null);
});

test("timelineFor: an empty or missing run is an empty list", () => {
  assert.deepEqual(timelineFor({ events: [] }, byId, "mia"), []);
  assert.deepEqual(timelineFor(null, byId, "mia"), []);
});

test("runTimeline: counts per cook, with undone actions not counted", () => {
  const undoRun = {
    events: [
      { type: "start", cookId: "mia", stepId: "onion", at: at(10) },
      { type: "done", cookId: "mia", stepId: "onion", at: at(70) },
      { type: "done", cookId: "mia", stepId: "garlic", at: at(80) },
      { type: "undo", cookId: "mia", stepId: "garlic", at: at(85), meta: { undid: "done" } },
    ],
  };
  const [mia] = runTimeline(undoRun, nodes, [cooks[0]]);
  assert.equal(mia.done, 1, "the undone one does not count");
  assert.equal(mia.workingSec, 60);
});

test("runTimeline: tallies each cook separately", () => {
  const [mia, leo] = runTimeline(run, nodes, cooks);
  assert.equal(mia.name, "Mia");
  assert.equal(mia.done, 1);
  assert.equal(mia.skipped, 1);
  assert.equal(mia.dropped, 0);
  assert.equal(leo.done, 0);
  assert.equal(leo.dropped, 1);
});

test("runTimeline: working time is hands-on, not elapsed", () => {
  // The run spans 100s, but Mia held a step for 60 of them. Counting the
  // gaps would credit whoever stood around longest.
  const [mia] = runTimeline(run, nodes, [cooks[0]]);
  assert.equal(mia.workingSec, 60);
});

test("runTimeline: the longest step is named, or null when nothing was timed", () => {
  const [mia] = runTimeline(run, nodes, [cooks[0]]);
  assert.equal(mia.longest.label, "Dice onion");
  const [leo] = runTimeline(run, nodes, [cooks[1]]);
  assert.equal(leo.longest, null, "Leo finished nothing");
});

test("runTimeline: no cooks, no rows", () => {
  assert.deepEqual(runTimeline(run, nodes, []), []);
  assert.deepEqual(runTimeline(run, nodes, null), []);
});
