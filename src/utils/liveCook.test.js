// Tests for the run engine as the Live cook page drives it: every card
// button and every voice path funnels into these functions, so this is
// where "Done marks it done", "Undo only inside 60s", "a pause freezes
// every clock" and "a claim says who tapped" are pinned down.
// Run with: node --test src/utils/liveCook.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  createRun, isReady, readyStepIds, blockedStepIds, activeStepFor, stepVariance, runProgress,
  isRunComplete, scoreboard, runOutcome, resolveAssignments, arbitrateClaim, claimSuggestions,
  applyStart, applyDone, applySkip, applyDrop, applyUndo, canUndo, applyPause, applyResume,
  isPaused, endRun, DIFFICULTY_POINTS, versusWaiting,
} from "./liveCook.js";
import { parseCommand } from "./voiceCommands.js";

// A small main line: two independent preps feed one cook step, which
// feeds plating. Every step is hands-on, so the attended rules apply.
const nodes = [
  { id: "dice", label: "Dice the onion", difficulty: "low", estimated_duration_sec: 120, depends_on: [], required_equipment: ["cutting_board"] },
  { id: "tofu", label: "Cut the tofu", difficulty: "medium", estimated_duration_sec: 180, depends_on: [], required_equipment: ["cutting_board"] },
  { id: "fry", label: "Fry the pork", difficulty: "high", estimated_duration_sec: 300, depends_on: ["dice", "tofu"], required_equipment: ["wok"] },
  { id: "plate", label: "Plate the bowls", difficulty: "low", estimated_duration_sec: 60, depends_on: ["fry"], required_equipment: [] },
];
const cooks = [
  { id: "c1", name: "Mia" },
  { id: "c2", name: "Leo" },
];
const T0 = Date.parse("2026-09-19T18:00:00Z");
const at = (sec) => new Date(T0 + sec * 1000).toISOString();

const coopSchedule = {
  makespanSec: 660,
  steps: [
    { id: "dice", cookId: "c1", startSec: 0, endSec: 120 },
    { id: "tofu", cookId: "c2", startSec: 0, endSec: 180 },
    { id: "fry", cookId: "c1", startSec: 180, endSec: 480 },
    { id: "plate", cookId: "c2", startSec: 480, endSec: 540 },
  ],
};
const coopRun = () => createRun({ nodes, mode: "cooperation", schedule: coopSchedule, opening: null, now: new Date(T0) });
const versusRun = () => createRun({ nodes, mode: "competition", schedule: null, opening: null, now: new Date(T0) });

test("ready / blocked follow dependencies, and a skip unblocks like a done", () => {
  let run = coopRun();
  assert.deepEqual(readyStepIds(nodes, run).sort(), ["dice", "tofu"]);
  assert.deepEqual(blockedStepIds(nodes, run).sort(), ["fry", "plate"]);

  run = applyDone({ run: applyStart({ run, stepId: "dice", cookId: "c1", at: at(0) }), stepId: "dice", cookId: "c1", at: at(100) });
  run = applySkip({ run, stepId: "tofu", cookId: "c2", at: at(100) });
  assert.ok(isReady("fry", nodes, run), "fry is ready once both inputs are done or skipped");
});

test("start → done records who, when, and the variance against the estimate", () => {
  let run = coopRun();
  run = applyStart({ run, stepId: "dice", cookId: "c1", at: at(0) });
  assert.equal(activeStepFor("c1", run, nodes, T0 + 1000), "dice");
  assert.equal(activeStepFor("c2", run, nodes, T0 + 1000), null);

  const v = stepVariance(nodes[0], run.steps.dice, T0 + 150_000);
  assert.equal(v.actualSec, 150);
  assert.equal(v.over, true);
  assert.equal(v.deltaSec, 30);

  run = applyDone({ run, stepId: "dice", cookId: "c1", at: at(150) });
  assert.equal(run.steps.dice.status, "done");
  assert.equal(runProgress(run, nodes, T0 + 150_000).done, 1);
});

test("undo works inside the 60s window and is refused after it or once downstream started", () => {
  let run = coopRun();
  run = applyStart({ run, stepId: "dice", cookId: "c1", at: at(0) });
  run = applyDone({ run, stepId: "dice", cookId: "c1", at: at(100) });

  assert.equal(canUndo({ run, nodes, cookId: "c1", at: at(130) }), true);
  assert.equal(canUndo({ run, nodes, cookId: "c2", at: at(130) }), false, "only the player who acted can undo it");
  assert.equal(applyUndo({ run, nodes, cookId: "c1", at: at(161) }).rejected, "too_late");

  const undone = applyUndo({ run, nodes, cookId: "c1", at: at(130) });
  assert.equal(undone.rejected, undefined);
  assert.equal(undone.run.steps.dice.status, "active", "undoing a Done re-opens the step");

  // Downstream started: fry needs dice + tofu, so finish tofu and start fry.
  let later = applyStart({ run, stepId: "tofu", cookId: "c2", at: at(100) });
  later = applyDone({ run: later, stepId: "tofu", cookId: "c2", at: at(110) });
  later = applyStart({ run: later, stepId: "fry", cookId: "c1", at: at(111) });
  // c1's last undoable event is now the *start* of fry, so undo c2's tofu instead.
  assert.equal(applyUndo({ run: later, nodes, cookId: "c2", at: at(120) }).rejected, "downstream_started");
});

test("a pause freezes the run clock and every active step's clock, and the break is never billed", () => {
  let run = coopRun();
  run = applyStart({ run, stepId: "dice", cookId: "c1", at: at(0) });
  run = applyPause({ run, at: at(60) });
  assert.equal(isPaused(run), true);
  assert.equal(applyPause({ run, at: at(70) }), run, "pausing twice is a no-op");

  run = applyResume({ run, at: at(90) });
  assert.equal(isPaused(run), false);
  assert.equal(run.pausedSec, 30);
  assert.equal(run.steps.dice.pausedSec, 30, "the step that was mid-flight is credited the break");

  assert.equal(runProgress(run, nodes, T0 + 120_000).elapsedSec, 90, "120s of wall clock minus the 30s break");
  assert.equal(stepVariance(nodes[0], run.steps.dice, T0 + 120_000).actualSec, 90);
});

test("co-op assignments: the plan's next ready step, then an offer, then waiting on the other player", () => {
  let run = coopRun();
  const a0 = resolveAssignments({ nodes, run, cooks, now: T0 }).byCook;
  assert.equal(a0.c1.reason, "assigned");
  assert.equal(a0.c1.stepId, "dice");
  assert.equal(a0.c2.reason, "assigned");
  assert.equal(a0.c2.stepId, "tofu");

  // Mia finishes dice; her next planned step (fry) is blocked on tofu.
  // Tofu is ready but it is Leo's assigned head — it is never offered
  // to Mia as a fill too (that's how two people end up on one task) —
  // so with nothing else ready she waits on it.
  run = applyDone({ run: applyStart({ run, stepId: "dice", cookId: "c1", at: at(0) }), stepId: "dice", cookId: "c1", at: at(100) });
  const a1 = resolveAssignments({ nodes, run, cooks, now: T0 + 100_000 }).byCook;
  assert.equal(a1.c2.reason, "assigned", "Leo is still offered tofu");
  assert.equal(a1.c1.reason, "waiting");
  assert.equal(a1.c1.waitingOnStepId, "tofu");

  // Leo takes tofu: Mia still waits, now on Leo by name.
  run = applyStart({ run, stepId: "tofu", cookId: "c2", at: at(100) });
  const a2 = resolveAssignments({ nodes, run, cooks, now: T0 + 100_000 }).byCook;
  assert.equal(a2.c1.reason, "waiting");
  assert.equal(a2.c1.waitingOnStepId, "tofu");
  assert.equal(a2.c1.waitingOnCookId, "c2");

  // A free-hands offer is a *different* ready step nobody is assigned:
  // give the plan a third prep that belongs to nobody's queue.
  const extra = { id: "wash", label: "Wash the greens", difficulty: "low", estimated_duration_sec: 60, depends_on: [], required_equipment: [] };
  const wider = [...nodes, extra];
  let run3 = createRun({ nodes: wider, mode: "cooperation", schedule: coopSchedule, opening: null, now: new Date(T0) });
  run3 = applyDone({ run: applyStart({ run: run3, stepId: "dice", cookId: "c1", at: at(0) }), stepId: "dice", cookId: "c1", at: at(100) });
  run3 = applyStart({ run: run3, stepId: "tofu", cookId: "c2", at: at(100) });
  const a3 = resolveAssignments({ nodes: wider, run: run3, cooks, now: T0 + 100_000 }).byCook;
  assert.equal(a3.c1.reason, "idle_fill");
  assert.equal(a3.c1.stepId, "wash");
});

test("versus claims: busy players are refused, first claim wins, blocked steps say why", () => {
  let run = versusRun();
  const c1Takes = arbitrateClaim({ run, nodes, cooks, stepId: "dice", cookId: "c1", at: at(0) });
  assert.equal(c1Takes.ok, true);
  run = applyStart({ run, stepId: "dice", cookId: "c1", at: at(0) });

  assert.equal(arbitrateClaim({ run, nodes, cooks, stepId: "tofu", cookId: "c1", at: at(1) }).code, "busy");
  assert.equal(arbitrateClaim({ run, nodes, cooks, stepId: "dice", cookId: "c2", at: at(1) }).code, "already_claimed");
  const blocked = arbitrateClaim({ run, nodes, cooks, stepId: "fry", cookId: "c2", at: at(1) });
  assert.equal(blocked.code, "not_ready");
  assert.deepEqual(blocked.blockedBy.sort(), ["dice", "tofu"]);

  // Put it back: the step returns to the pool with no owner.
  run = applyDrop({ run, stepId: "dice", cookId: "c1", at: at(5) });
  assert.equal(run.steps.dice.status, "pending");
  assert.equal(run.steps.dice.cookId, null);
  assert.equal(arbitrateClaim({ run, nodes, cooks, stepId: "dice", cookId: "c2", at: at(6) }).ok, true);
});

test("versus scoring is flat per tier, a skip scores 0, and a tie has no winner", () => {
  let run = versusRun();
  run = applyDone({ run: applyStart({ run, stepId: "dice", cookId: "c1", at: at(0) }), stepId: "dice", cookId: "c1", at: at(100) });
  run = applyDone({ run: applyStart({ run, stepId: "tofu", cookId: "c2", at: at(0) }), stepId: "tofu", cookId: "c2", at: at(100) });
  let board = scoreboard(run, nodes, cooks);
  assert.equal(board[0].name, "Leo", "sorted points desc");
  assert.equal(board[0].points, DIFFICULTY_POINTS.medium);
  assert.equal(board[1].points, DIFFICULTY_POINTS.low);

  run = applySkip({ run, stepId: "fry", cookId: "c1", at: at(200) });
  board = scoreboard(run, nodes, cooks);
  assert.equal(board.find((b) => b.cookId === "c1").points, DIFFICULTY_POINTS.low, "a skipped step scores nothing");
  assert.equal(board.find((b) => b.cookId === "c1").skippedCount, 1);

  const tied = { ...run, steps: { ...run.steps, tofu: { ...run.steps.tofu, status: "skipped" } } };
  const tiedOut = runOutcome(endRun({ run: tied, nodes, at: at(300) }), nodes, cooks);
  assert.equal(tiedOut.winnerCookIds.length, 1, "Mia alone has points");
  const bothZero = runOutcome(endRun({ run: versusRun(), nodes, at: at(1) }), nodes, cooks);
  assert.deepEqual(bothZero.winnerCookIds, [], "nobody wins at 0–0");
});

test("claim suggestions never include a blocked or taken step", () => {
  let run = versusRun();
  run = applyStart({ run, stepId: "dice", cookId: "c1", at: at(0) });
  const forLeo = claimSuggestions({ nodes, run, cookId: "c2" });
  assert.deepEqual(forLeo, ["tofu"]);
});

test("ending the run sweeps pending and active steps to skipped and closes an open pause", () => {
  let run = coopRun();
  run = applyStart({ run, stepId: "dice", cookId: "c1", at: at(0) });
  run = applyPause({ run, at: at(50) });
  const ended = endRun({ run, nodes, at: at(80) });
  assert.equal(ended.endedAt, at(80));
  assert.equal(isPaused(ended), false);
  assert.equal(ended.steps.dice.status, "skipped");
  assert.equal(ended.steps.dice.skipReason, "run_ended");
  assert.equal(isRunComplete(ended, nodes), true);
  const out = runOutcome(ended, nodes, cooks);
  assert.equal(out.skippedCount, 4);
  assert.equal(out.totalSec, 50, "the 30s pause is not on the clock");
  assert.equal(out.estimatedSec, 660, "co-op reports the plan's makespan");
});

test("voice: a bare 'done' resolves to the held step; with nothing held it asks which one", () => {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const held = parseCommand("done", { byId, activeStepId: "dice", claimable: ["tofu"], ownQueue: [] });
  assert.equal(held.intent, "done");
  assert.equal(held.stepId, "dice");

  const free = parseCommand("done", { byId, activeStepId: null, claimable: ["dice", "tofu"], ownQueue: ["dice", "tofu"] });
  assert.equal(free.intent, "done");
  assert.equal(free.stepId, null, "no guess — the page shows the disambiguation buttons");

  const named = parseCommand("take the tofu", { byId, activeStepId: null, claimable: ["dice", "tofu"], ownQueue: [] });
  assert.equal(named.intent, "claim");
  assert.equal(named.stepId, "tofu");
});

test("voice: pause / resume / finish are their own intents and win over 'start' and 'done'", () => {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const ctx = { byId, activeStepId: "dice", claimable: [], ownQueue: [] };
  assert.equal(parseCommand("pause", ctx).intent, "pause");
  assert.equal(parseCommand("hold on", ctx).intent, "pause");
  assert.equal(parseCommand("resume", ctx).intent, "resume");
  assert.equal(parseCommand("ok back on", ctx).intent, "resume");
  assert.equal(parseCommand("we're done", ctx).intent, "finish_run");
  assert.equal(parseCommand("dinner's up", ctx).intent, "finish_run");
});

test("points go to the holder, not to whoever reports the step finished", () => {
  // Mia is on the onion, Leo on the tofu. The voice path credits the
  // speaker toggle, which was left on Mia -- and she (or the mic, thinking
  // it heard her) reports Leo's tofu done. It is still Leo's tofu.
  let run = versusRun();
  run = applyStart({ run, stepId: "dice", cookId: "c1", at: at(0) });
  run = applyStart({ run, stepId: "tofu", cookId: "c2", at: at(0) });
  run = applyDone({ run, stepId: "tofu", cookId: "c1", at: at(100), source: "voice" });

  assert.equal(run.steps.tofu.cookId, "c2", "finishing never moves the step");
  const done = run.events.at(-1);
  assert.equal(done.cookId, "c2");
  assert.equal(done.reportedBy, "c1", "who said it is kept, apart from the credit");

  const board = scoreboard(run, nodes, cooks);
  assert.equal(board.find((b) => b.cookId === "c2").points, DIFFICULTY_POINTS.medium);
  assert.equal(board.find((b) => b.cookId === "c1").points, 0);
  assert.equal(activeStepFor("c1", run, nodes), "dice", "Mia is still on her own step");

  // The one who misreported it can take it back.
  const undone = applyUndo({ run, nodes, cookId: "c1", at: at(110) });
  assert.equal(undone.rejected, undefined);
  assert.equal(undone.run.steps.tofu.status, "active");
  assert.equal(undone.run.steps.tofu.cookId, "c2");
});

test("an unattended step pays both halves to its holder, whoever lifts the lid", () => {
  const simmer = [
    { id: "stock", label: "Simmer the stock", difficulty: "medium", estimated_duration_sec: 1200, depends_on: [], required_equipment: [], attended: false },
  ];
  let run = createRun({ nodes: simmer, mode: "competition", schedule: null, opening: null, now: new Date(T0) });
  run = applyStart({ run, stepId: "stock", cookId: "c2", at: at(0) });
  run = applyDone({ run, stepId: "stock", cookId: "c1", at: at(1200) });
  const board = scoreboard(run, simmer, cooks);
  assert.equal(board.find((b) => b.cookId === "c1").points, 0);
  assert.ok(board.find((b) => b.cookId === "c2").points >= DIFFICULTY_POINTS.medium, "start award plus the finish");
  const step = runOutcome(run, simmer, cooks).perStep[0];
  assert.equal(step.cookId, "c2");
  assert.equal(step.startedByCookId, "c2");
});

test("skipping somebody's step leaves it theirs; a pending skip belongs to the skipper", () => {
  let run = versusRun();
  run = applyStart({ run, stepId: "tofu", cookId: "c2", at: at(0) });
  run = applySkip({ run, stepId: "tofu", cookId: "c1", at: at(50) });
  assert.equal(run.steps.tofu.cookId, "c2");
  run = applySkip({ run, stepId: "dice", cookId: "c1", at: at(60) });
  assert.equal(run.steps.dice.cookId, "c1");
});

test("versus: nothing to grab mid-run is waiting on the next unlock, not done for the night", () => {
  // Mia finished the onion; Leo is on the tofu, and fry needs both. Mia
  // has nothing to grab, but the night is not over for her.
  let run = versusRun();
  run = applyDone({ run: applyStart({ run, stepId: "dice", cookId: "c1", at: at(0) }), stepId: "dice", cookId: "c1", at: at(100) });
  run = applyStart({ run, stepId: "tofu", cookId: "c2", at: at(100) });
  assert.deepEqual(claimSuggestions({ nodes, run, cookId: "c1" }), []);
  const wait = versusWaiting(run, nodes, T0 + 160_000);
  assert.equal(wait.reason, "waiting");
  assert.equal(wait.waitingOnStepId, "tofu");
  assert.equal(wait.waitingOnCookId, "c2");
  assert.equal(wait.etaSec, 120, "tofu is 180s, 60s in");

  // Everything closed: now, and only now, is anyone done for the night.
  const ended = endRun({ run, nodes, at: at(200) });
  assert.equal(versusWaiting(ended, nodes, T0 + 200_000), null);
});
