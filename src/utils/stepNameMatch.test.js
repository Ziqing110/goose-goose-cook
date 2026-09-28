import test from "node:test";
import assert from "node:assert/strict";
import { matchStepName, guessIfNone, stepByNumber, bareStepRef, BARE_STEP_REF_PATTERNS, stepRetryRef, STEP_RETRY_PATTERNS } from "./stepNameMatch.js";
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

// --- guessIfNone: a friendlier fallback for a form field --------------

test("guessIfNone leaves an exact match alone", () => {
  assert.deepEqual(guessIfNone(match("mince garlic"), (id) => BOARD[id]), match("mince garlic"));
});

test("guessIfNone leaves an already-confirming match alone", () => {
  // Coverage of everything said, but not the whole label -- matchStepName
  // already asks about this one; guessIfNone has nothing to add.
  const confirm = match("mince garlic please open it");
  assert.equal(confirm.confidence, "confirm");
  assert.deepEqual(guessIfNone(confirm, (id) => BOARD[id]), confirm);
});

test("guessIfNone turns a weak or ambiguous none into its own best guess", () => {
  const labelOf = (id) => BOARD[id];
  // Two steps tie on "the tofu" -- a wrong guess here costs a "no", not
  // a mis-credited task, so it takes the first rather than giving up.
  const tofu = guessIfNone(match("the tofu"), labelOf);
  assert.equal(tofu.confidence, "confirm");
  assert.ok(["tofu_cut", "tofu_blanch"].includes(tofu.stepId));
  assert.equal(tofu.label, labelOf(tofu.stepId));
});

test("guessIfNone still gives up on a word nothing shares", () => {
  const r = guessIfNone(match("xyzzy"), (id) => BOARD[id]);
  assert.equal(r.confidence, "none");
  assert.equal(r.stepId, null);
});

// --- stepByNumber: naming a candidate by its on-screen number ---------

test("stepByNumber resolves 'step N' / 'step number N' / 'number N', digits or words", () => {
  const numberOf = (id) => String(IDS.indexOf(id) + 1).padStart(2, "0"); // 01, 02, ...
  const labelOf = (id) => BOARD[id];
  for (const said of ["step 2", "step 02", "step number 2", "number 2", "step two"]) {
    const r = stepByNumber(said, IDS, labelOf, numberOf);
    assert.equal(r?.confidence, "exact", said);
    assert.equal(r?.stepId, IDS[1], said);
  }
});

test("stepByNumber resolves an ordinal before 'step' -- 'the second step', not 'step two'", () => {
  const numberOf = (id) => String(IDS.indexOf(id) + 1).padStart(2, "0");
  const labelOf = (id) => BOARD[id];
  for (const said of ["the second step", "second step", "the 2nd step", "2nd step"]) {
    const r = stepByNumber(said, IDS, labelOf, numberOf);
    assert.equal(r?.confidence, "exact", said);
    assert.equal(r?.stepId, IDS[1], said);
  }
  // Past twelve, where NUMBER_WORDS (cardinals) stops but a recipe
  // doesn't -- the board fixture has six steps, so "sixth" is its last.
  const r = stepByNumber("the sixth step", IDS, labelOf, numberOf);
  assert.equal(r.confidence, "exact");
  assert.equal(r.stepId, IDS[5]);
});

test("stepByNumber is null (not none) for anything that isn't a number reference", () => {
  const numberOf = (id) => String(IDS.indexOf(id) + 1).padStart(2, "0");
  assert.equal(stepByNumber("mince garlic", IDS, (id) => BOARD[id], numberOf), null);
  assert.equal(stepByNumber("", IDS, (id) => BOARD[id], numberOf), null);
});

test("stepByNumber reports none for a number off the board, not a guess", () => {
  const numberOf = (id) => String(IDS.indexOf(id) + 1).padStart(2, "0");
  const r = stepByNumber("step 99", IDS, (id) => BOARD[id], numberOf);
  assert.equal(r.confidence, "none");
  assert.equal(r.stepId, null);
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

// The kitchen take has both cooks code-switching. These are the exact
// transcripts the recogniser returned for it, so a regression shows up
// as the sentence somebody actually said.
test("Mandarin commands reach an intent instead of vanishing", () => {
  const board = { tofu_cut: "Cut tofu into cubes", mince_garlic: "Mince garlic", sauce_mix: "Mix sauce & slurry" };
  const ids = Object.keys(board);
  const ctx = {
    byId: Object.fromEntries(ids.map((id) => [id, { label: board[id] }])),
    activeStepId: "tofu_cut",
    claimable: ids,
    ownQueue: ids,
    agentName: "Goose",
  };

  // "the tofu is cut" — no step named, so it falls back to the one they
  // are holding, exactly as the English "done" does.
  assert.equal(parseCommand("Goose 豆腐切好了。", ctx).intent, "done");
  assert.equal(parseCommand("Goose 豆腐切好了。", ctx).stepId, "tofu_cut");

  // Code-switched mid-sentence: the verb is Chinese, the step is English.
  const claim = parseCommand("Goose, 我来做 the sauce.", ctx);
  assert.equal(claim.intent, "claim");
  assert.equal(claim.stepId, "sauce_mix");

  assert.equal(parseCommand("Goose, 还要多久?", ctx).intent, "status");
  assert.equal(parseCommand("Goose 都好了,可以上菜", ctx).intent, "finish_run");
  assert.equal(parseCommand("Goose 暂停", ctx).intent, "pause");
});

test("Chinese does not dilute an English step match", () => {
  const board = { mince_garlic: "Mince garlic", tofu_cut: "Cut tofu into cubes" };
  const ids = Object.keys(board);
  const ctx = {
    byId: Object.fromEntries(ids.map((id) => [id, { label: board[id] }])),
    activeStepId: null,
    claimable: ids,
    ownQueue: ids,
    agentName: "Goose",
  };
  // Step matching still normalises to ASCII on purpose: a Chinese token
  // can match no English label, and counting it would only push the real
  // match under the floor — the same way the agent's name used to.
  const r = parseCommand("Goose, 蒜蓉 done with the garlic", ctx);
  assert.equal(r.stepId, "mince_garlic");
});

// --- bareStepRef: answering a failed "which step?" with just the number ---

test("bareStepRef resolves a number or ordinal with no framing at all", () => {
  const numberOf = (id) => String(IDS.indexOf(id) + 1).padStart(2, "0");
  const labelOf = (id) => BOARD[id];
  for (const said of ["2", "two", "second", "the second", "2nd", "the 2nd"]) {
    const r = bareStepRef(said, IDS, labelOf, numberOf);
    assert.equal(r?.confidence, "exact", said);
    assert.equal(r?.stepId, IDS[1], said);
  }
});

test("bareStepRef is null for ordinary words, so it never swallows an unrelated command", () => {
  const numberOf = (id) => String(IDS.indexOf(id) + 1).padStart(2, "0");
  const labelOf = (id) => BOARD[id];
  for (const said of ["cancel", "mince garlic", "the tofu one", ""]) {
    assert.equal(bareStepRef(said, IDS, labelOf, numberOf), null, said);
  }
});

test("BARE_STEP_REF_PATTERNS match exactly what bareStepRef resolves, whole-utterance only", () => {
  const hear = (text) => BARE_STEP_REF_PATTERNS.some((p) => p.test(text));
  assert.ok(hear("second"));
  assert.ok(hear("2"));
  assert.ok(!hear("cancel"));
  // Whole-utterance, not a fragment: "second" inside a real sentence
  // isn't this pattern's job -- stepByNumber/matchStepName own that.
  assert.ok(!hear("runs after the second step"));
});

test("stepRetryRef and STEP_RETRY_PATTERNS answer a follow-up either framed or bare", () => {
  const numberOf = (id) => String(IDS.indexOf(id) + 1).padStart(2, "0");
  const labelOf = (id) => BOARD[id];
  const hear = (text) => STEP_RETRY_PATTERNS.some((p) => p.test(text));
  for (const said of ["step 2", "the second step", "2", "second"]) {
    assert.ok(hear(said), said);
    const r = stepRetryRef(said, IDS, labelOf, numberOf);
    assert.equal(r?.confidence, "exact", said);
    assert.equal(r?.stepId, IDS[1], said);
  }
  assert.ok(!hear("cancel"));
  assert.equal(stepRetryRef("cancel", IDS, labelOf, numberOf), null);
});
