import test from "node:test";
import assert from "node:assert/strict";
import { explainStep, spokenDuration } from "./stepExplain.js";

const tofu = {
  label: "Cut tofu into cubes",
  description: "Drain the block, cut into ~2cm cubes.",
  estimated_duration_sec: 180,
  required_equipment: ["cutting_board", "bowl"],
};
const labels = { cutting_board: "the cutting board", bowl: "a bowl" };
const equipmentLabel = (t) => labels[t] || t;

test("spokenDuration: minutes and seconds, rounded for speech", () => {
  assert.equal(spokenDuration(180), "about 3 minutes");
  assert.equal(spokenDuration(60), "about a minute");
  assert.equal(spokenDuration(59), "about 60 seconds", "just under still reads in seconds");
  assert.equal(spokenDuration(45), "about 50 seconds");
  assert.equal(spokenDuration(100), "about 2 minutes");
});

test("spokenDuration: nothing sensible to say about a missing estimate", () => {
  for (const value of [0, -30, null, undefined, NaN, "soon"]) {
    assert.equal(spokenDuration(value), null, String(value));
  }
});

test("explainStep: the recipe's own sentence comes first", () => {
  const line = explainStep(tofu, { skill: "regular", equipmentLabel });
  assert.ok(line.startsWith("Drain the block, cut into ~2cm cubes."), line);
});

test("explainStep: regular detail adds the timing, not the kit", () => {
  const line = explainStep(tofu, { skill: "regular", equipmentLabel });
  assert.ok(line.includes("about 3 minutes"));
  assert.ok(!line.includes("cutting board"), "the board is visible on screen");
});

test("explainStep: a beginner is told what to reach for", () => {
  const line = explainStep(tofu, { skill: "beginner", equipmentLabel });
  assert.ok(line.includes("about 3 minutes"));
  assert.ok(line.includes("the cutting board and a bowl"), line);
});

test("explainStep: 'just the essentials' is the description alone", () => {
  // Every extra clause is another second of the goose talking while a
  // pan is on, and this cook asked for none of them.
  const line = explainStep(tofu, { skill: "confident", equipmentLabel });
  assert.equal(line, "Drain the block, cut into ~2cm cubes.");
});

test("explainStep: skill defaults to regular when the Brief never answered", () => {
  const line = explainStep(tofu, { equipmentLabel });
  assert.ok(line.includes("about 3 minutes"));
  assert.ok(!line.includes("cutting board"));
});

test("explainStep: a step with no description says so instead of padding", () => {
  // Reading the label back is not an answer. Saying there is nothing
  // more is, and it stops the cook asking twice.
  const line = explainStep({ label: "Mix sauce", estimated_duration_sec: 60 }, { equipmentLabel });
  assert.ok(line.startsWith("There's no more detail on Mix sauce than the name."), line);
  assert.ok(line.includes("about a minute"), "the timing is still worth having");
});

test("explainStep: a description missing its full stop still reads as a sentence", () => {
  const line = explainStep({ label: "X", description: "Slice it thin" }, {});
  assert.ok(line.startsWith("Slice it thin."), line);
});

test("explainStep: punctuation already there is not doubled", () => {
  for (const [text, expected] of [
    ["Slice it thin.", "Slice it thin."],
    ["How thin? Very.", "How thin? Very."],
    ["Go!", "Go!"],
  ]) {
    assert.equal(explainStep({ label: "X", description: text }, { skill: "confident" }), expected);
  }
});

test("explainStep: no such step is null, not a sentence about nothing", () => {
  assert.equal(explainStep(null), null);
  assert.equal(explainStep(undefined), null);
  assert.equal(explainStep({}), null, "no label and no description");
});

test("explainStep: equipment with no label falls back to its own name", () => {
  const line = explainStep(
    { label: "X", description: "Do it.", required_equipment: ["sous_vide"] },
    { skill: "beginner" },
  );
  assert.ok(line.includes("sous_vide"), line);
});

test("explainStep: a beginner with no equipment listed is not told to want nothing", () => {
  const line = explainStep(
    { label: "X", description: "Do it.", estimated_duration_sec: 30, required_equipment: [] },
    { skill: "beginner" },
  );
  assert.ok(!line.includes("You'll want"), line);
});
