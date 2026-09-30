// Headlines for the cook card: which ones a run can earn.
import test from "node:test";
import assert from "node:assert/strict";
import { buildRunContext, headlineFor } from "./cookQuips.js";

// Two cooks, one far ahead on points, finished well inside the plan.
const outcome = {
  scoreboard: [
    { cookId: "a", name: "Leo", points: 191, doneCount: 13 },
    { cookId: "b", name: "Mia", points: 100, doneCount: 7 },
  ],
  perStep: [],
  winnerCookIds: ["a"],
  totalSec: 2069,
  estimatedSec: 2340,
  skippedCount: 0,
};

test("co-op never reads as a contest, however lopsided the points", () => {
  for (const seed of ["a-b", "b-a", "x", "y", "z"]) {
    const line = headlineFor(buildRunContext(outcome, seed, "cooperation"));
    assert.doesNotMatch(line, /points|took it by|ran away|Dead heat/, `${seed}: ${line}`);
  }
  assert.equal(headlineFor(buildRunContext(outcome, "a-b", "cooperation")), "Finished 5 min inside the plan.");
});

test("versus still gets its winner", () => {
  const lines = ["a-b", "b-a", "x", "y", "z"].map((seed) => headlineFor(buildRunContext(outcome, seed, "competition")));
  assert.ok(lines.some((line) => /Leo ran away with it by 91 points/.test(line)), lines.join(" | "));
});

test("a tie is only a dead heat in versus", () => {
  const tied = { ...outcome, winnerCookIds: ["a", "b"], estimatedSec: null, scoreboard: outcome.scoreboard.map((b) => ({ ...b, points: 120 })) };
  assert.match(headlineFor(buildRunContext(tied, "t", "competition")), /Dead heat at 120 points/);
  assert.equal(headlineFor(buildRunContext(tied, "t", "cooperation")), "Dinner happened. That's the main thing.");
});
