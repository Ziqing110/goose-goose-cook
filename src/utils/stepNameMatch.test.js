import test from "node:test";
import assert from "node:assert/strict";
import { matchStepName } from "./stepNameMatch.js";
import { parseCommand } from "./voiceCommands.js";

// The seeded Mapo Tofu board. Two steps mention tofu and two start with
// "Mince", which is exactly the shape that makes this hard.
const BOARD = {
  tofu_cut: "Cut tofu into cubes",
  mince_garlic: "Mince garlic",
  aromatics_mince_other: "Mince ginger & scallion",
  sauce_mix: "Mix sauce & slurry",
  tofu_blanch: "Blanch tofu",
  simmer_combine: "Combine & simmer",
};
const IDS = Object.keys(BOARD);
const match = (said) => matchStepName(said, IDS, (id) => BOARD[id]);

test("a word two steps share is ambiguous, and says so", () => {
  // Dice used to hand this to "Blanch tofu" outright, because that label
  // is shorter — the wrong step, with no question asked.
  const r = match("the tofu");
  assert.equal(r.stepId, null);
  assert.equal(r.confidence, "none");
  assert.deepEqual(new Set(r.candidates), new Set(["tofu_cut", "tofu_blanch"]));
});

test("a word only one step has resolves to it", () => {
  assert.equal(match("the ginger").stepId, "aromatics_mince_other");
  assert.equal(match("garlic").stepId, "mince_garlic");
  assert.equal(match("the sauce").stepId, "sauce_mix");
});

test("naming a step in full is certain, not a guess", () => {
  const r = match("mince garlic");
  assert.equal(r.stepId, "mince_garlic");
  assert.equal(r.confidence, "exact");
});

test("a shared first word is not enough to pick one", () => {
  const r = match("the mince");
  assert.equal(r.stepId, null);
  assert.deepEqual(new Set(r.candidates), new Set(["mince_garlic", "aromatics_mince_other"]));
});

test("nothing said, nothing matched", () => {
  assert.equal(match("").stepId, null);
  assert.equal(match("the").confidence, "none");
});

// Straight from the recordings: every one of these is a real transcript.
test("the agent's name is not part of the step's name", () => {
  const ctx = { byId: Object.fromEntries(IDS.map((id) => [id, { label: BOARD[id] }])), activeStepId: null, claimable: IDS, ownQueue: IDS, agentName: "Goose" };

  // Counting "goose" as a spoken word put this under the floor and
  // turned a clear match into "which one did you mean?".
  const claim = parseCommand("Goose, add or take the ginger and scallion.", ctx);
  assert.equal(claim.intent, "claim");
  assert.equal(claim.stepId, "aromatics_mince_other");

  const done = parseCommand("Goose, done with the ginger.", ctx);
  assert.equal(done.intent, "done");
  assert.equal(done.stepId, "aromatics_mince_other");

  // Still ambiguous, and still asks: two steps are about tofu.
  const tofu = parseCommand("Goose, I'm done with the tofu.", ctx);
  assert.equal(tofu.stepId, null);
  assert.equal(tofu.candidates.length, 2);
});
