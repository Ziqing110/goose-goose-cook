import test from "node:test";
import assert from "node:assert/strict";
import { resultLine } from "./serviceResults.js";

const outcome = (overrides = {}) => ({
  totalSec: 42 * 60,
  estimatedSec: 45 * 60,
  winnerCookIds: [],
  scoreboard: [
    { cookId: "a", name: "Mia", points: 85 },
    { cookId: "b", name: "Leo", points: 60 },
  ],
  doneCount: 12,
  skippedCount: 0,
  perStep: [],
  ...overrides,
});

test("versus: names the winner and the score", () => {
  assert.equal(resultLine(outcome({ winnerCookIds: ["a"] }), { versus: true }), "Mia wins. Mia 85, Leo 60. Dinner took about 42 minutes.");
});

test("versus: a shared top score is a tie, and no points is nobody", () => {
  assert.match(resultLine(outcome({ winnerCookIds: ["a", "b"] }), { versus: true }), /^It's a tie\./);
  assert.match(resultLine(outcome({ winnerCookIds: [] }), { versus: true }), /^Nobody scored\./);
});

test("co-op: how it went against the plan, and the step count", () => {
  assert.equal(resultLine(outcome(), { versus: false }), "Dinner took about 42 minutes. That's about 3 minutes under plan. 12 steps done.");
  // A run with skips has no fair plan comparison.
  assert.equal(resultLine(outcome({ skippedCount: 2 }), { versus: false }), "Dinner took about 42 minutes. 12 steps done, 2 skipped.");
});
