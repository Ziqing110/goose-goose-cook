import test from "node:test";
import assert from "node:assert/strict";
import {
  cookForLabel,
  withLabelBound,
  withLabelsCleared,
  dominantLabel,
  cookFromTurn,
} from "./speakerLabels.js";

const cooks = [
  { id: "mia", name: "Mia", speakerLabel: "A" },
  { id: "leo", name: "Leo", speakerLabel: "B" },
  { id: "sam", name: "Sam", speakerLabel: null },
];

test("cookForLabel: a bound label names its cook, an unbound one names nobody", () => {
  assert.equal(cookForLabel(cooks, "A"), "mia");
  assert.equal(cookForLabel(cooks, "B"), "leo");
  assert.equal(cookForLabel(cooks, "C"), null);
  assert.equal(cookForLabel(cooks, null), null);
  assert.equal(cookForLabel([], "A"), null);
});

test("withLabelBound: binding a label takes it off whoever held it", () => {
  // Re-recording is how a cook fixes a bad binding. Two cooks holding
  // "A" would make every lookup after that a coin flip.
  const next = withLabelBound(cooks, "sam", "A");
  assert.equal(next.find((c) => c.id === "sam").speakerLabel, "A");
  assert.equal(next.find((c) => c.id === "mia").speakerLabel, null);
  assert.equal(next.find((c) => c.id === "leo").speakerLabel, "B", "untouched");
  assert.equal(cookForLabel(next, "A"), "sam");
});

test("withLabelBound: rebinding a cook's own label is not self-destructive", () => {
  const next = withLabelBound(cooks, "mia", "A");
  assert.equal(next.find((c) => c.id === "mia").speakerLabel, "A");
});

test("withLabelBound: no label is a no-op, not a wipe", () => {
  assert.deepEqual(withLabelBound(cooks, "mia", null), cooks);
});

test("withLabelsCleared: one cook, or everyone", () => {
  assert.equal(withLabelsCleared(cooks, "mia").find((c) => c.id === "mia").speakerLabel, null);
  assert.equal(withLabelsCleared(cooks, "mia").find((c) => c.id === "leo").speakerLabel, "B");
  assert.ok(withLabelsCleared(cooks).every((c) => c.speakerLabel === null));
});

test("dominantLabel: one voice through the recording binds", () => {
  const samples = [
    { label: "A", at: 100 },
    { label: "A", at: 200 },
    { label: "A", at: 300 },
  ];
  const result = dominantLabel(samples, 0, 400);
  assert.equal(result.label, "A");
  assert.equal(result.total, 3);
});

test("dominantLabel: the window is respected, not just the list", () => {
  // Turns from the previous cook's recording are still in the buffer.
  const samples = [
    { label: "B", at: 50 },
    { label: "A", at: 150 },
    { label: "A", at: 250 },
    { label: "B", at: 900 },
  ];
  assert.equal(dominantLabel(samples, 100, 300).label, "A");
});

test("dominantLabel: a stray word from someone else does not break a clear read", () => {
  const samples = [
    { label: "A", at: 100 },
    { label: "A", at: 150 },
    { label: "B", at: 200 },
    { label: "A", at: 250 },
  ];
  assert.equal(dominantLabel(samples, 0, 300).label, "A", "3 of 4 is clear enough");
});

test("dominantLabel: two voices talking over each other bind nobody", () => {
  // Half and half is not a winner. Binding here would be a guess that
  // then decides every later turn.
  const split = dominantLabel(
    [{ label: "A", at: 100 }, { label: "B", at: 200 }],
    0,
    300,
  );
  assert.equal(split.label, null);
  assert.equal(split.reason, "more than one voice");

  // Nor is a plurality that is not a majority.
  const three = dominantLabel(
    [{ label: "A", at: 1 }, { label: "A", at: 2 }, { label: "B", at: 3 }, { label: "C", at: 4 }],
    0,
    10,
  );
  assert.equal(three.label, null);
});

test("dominantLabel: silence binds nobody and says so", () => {
  assert.deepEqual(dominantLabel([], 0, 100), {
    label: null, share: 0, total: 0, reason: "nothing heard",
  });
  assert.equal(dominantLabel([{ label: "A", at: 900 }], 0, 100).label, null);
  assert.equal(dominantLabel(null, 0, 100).label, null);
});

test("cookFromTurn: a bound label on a real sentence names its cook", () => {
  const turn = { speaker_label: "A", words: [{}, {}, {}, {}] };
  assert.deepEqual(cookFromTurn(turn, cooks), { cookId: "mia", label: "A", reason: "ok" });
});

test("cookFromTurn: an unbound label is not a cook", () => {
  // Diarization invents labels for voices nobody enrolled -- a bystander,
  // the radio. The toggle should decide, not this.
  const result = cookFromTurn({ speaker_label: "D", words: [{}, {}] }, cooks);
  assert.equal(result.cookId, null);
  assert.equal(result.reason, "label not bound");
});

test("cookFromTurn: a one-word turn is too short to credit", () => {
  // The docs are explicit: someone who only says "done" may never earn a
  // distinct embedding, and their words land on whoever is closest.
  const result = cookFromTurn({ speaker_label: "A", words: [{}] }, cooks);
  assert.equal(result.cookId, null);
  assert.equal(result.reason, "too short to trust");
  assert.equal(result.label, "A", "the label still comes back, for asking with");
});

test("cookFromTurn: no diarization at all is simply no answer", () => {
  assert.equal(cookFromTurn({ words: [{}, {}] }, cooks).cookId, null);
  assert.equal(cookFromTurn({}, cooks).reason, "no label");
  assert.equal(cookFromTurn(null, cooks).cookId, null);
});

test("cookFromTurn: a turn with no word list is judged on its label alone", () => {
  // Typed input and tests arrive without words. Refusing those would
  // break the path that has nothing to do with diarization.
  assert.equal(cookFromTurn({ speaker_label: "B" }, cooks).cookId, "leo");
});
