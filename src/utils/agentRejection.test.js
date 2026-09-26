import test from "node:test";
import assert from "node:assert/strict";
import { rejectionLine, rejectionLines } from "./agentRejection.js";

const byId = {
  dice: { label: "Dice onion, carrots and celery" },
  garlic: { label: "Mince garlic" },
};

test("finishing something you never took says to claim it first", () => {
  // The reported bug: in competition mode, having claimed nothing, "I'm
  // done with the onion and celery" got "did you also dice the other
  // things?" -- a question about the wrong thing, because the call was
  // dropped and the model could not see the refusal.
  const line = rejectionLine({ name: "done", reason: "step_not_eligible", stepId: "dice" }, byId);
  assert.equal(line, "You haven't taken Dice onion, carrots and celery yet — claim it first.");
});

test("skipping and dropping something you never took say the same", () => {
  for (const name of ["skip", "drop"]) {
    const line = rejectionLine({ name, reason: "step_not_eligible", stepId: "garlic" }, byId);
    assert.ok(line.includes("claim it first"), name);
    assert.ok(line.includes("Mince garlic"), name);
  }
});

test("claiming something unavailable says so without guessing why", () => {
  // Held by someone else, or still gated by a step before it. The
  // rejection does not say which, so neither does the line.
  for (const name of ["claim", "start"]) {
    assert.equal(
      rejectionLine({ name, reason: "step_not_eligible", stepId: "garlic" }, byId),
      "Mince garlic isn't up for grabs right now.",
      name,
    );
  }
});

test("a step with no findable label still gets a usable sentence", () => {
  const line = rejectionLine({ name: "done", reason: "step_not_eligible", stepId: "gone" }, byId);
  assert.equal(line, "You haven't taken that one yet — claim it first.");
});

test("two voices in one turn is explained, not silently dropped", () => {
  assert.equal(
    rejectionLine({ name: "done", reason: "two_speakers", stepId: "dice" }, byId),
    "I heard two of you at once — say that again on your own?",
  );
});

test("our own plumbing is not read out to the cook", () => {
  // A hallucinated id or malformed arguments is the model's problem.
  for (const reason of ["unknown_step", "bad_json", "not_offered"]) {
    assert.equal(rejectionLine({ name: "done", reason, stepId: "dice" }, byId), null, reason);
  }
});

test("an unknown verb with an eligible-step refusal says nothing", () => {
  assert.equal(rejectionLine({ name: "status", reason: "step_not_eligible" }, byId), null);
});

test("rejectionLine survives nonsense input", () => {
  assert.equal(rejectionLine(null, byId), null);
  assert.equal(rejectionLine({}, byId), null);
  assert.equal(rejectionLine({ name: "done", reason: "step_not_eligible" }), "You haven't taken that one yet — claim it first.");
});

test("rejectionLines: the same refusal twice is said once", () => {
  // "done with the onion and the celery", neither taken, is one thing to
  // say, not two.
  const lines = rejectionLines(
    [
      { name: "done", reason: "step_not_eligible", stepId: "gone" },
      { name: "done", reason: "step_not_eligible", stepId: "alsogone" },
    ],
    byId,
  );
  assert.deepEqual(lines, ["You haven't taken that one yet — claim it first."]);
});

test("rejectionLines: distinct refusals are both said, up to the cap", () => {
  const lines = rejectionLines(
    [
      { name: "done", reason: "step_not_eligible", stepId: "dice" },
      { name: "claim", reason: "step_not_eligible", stepId: "garlic" },
      { name: "drop", reason: "step_not_eligible", stepId: "gone" },
    ],
    byId,
  );
  assert.equal(lines.length, 2, "a refusal is a correction, not a list");
  assert.ok(lines[0].includes("Dice onion"));
  assert.ok(lines[1].includes("Mince garlic"));
});

test("rejectionLines: silent reasons produce no lines at all", () => {
  assert.deepEqual(rejectionLines([{ name: "done", reason: "unknown_step" }], byId), []);
  assert.deepEqual(rejectionLines([], byId), []);
  assert.deepEqual(rejectionLines(null, byId), []);
});
