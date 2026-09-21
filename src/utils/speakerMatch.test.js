import test from "node:test";
import assert from "node:assert/strict";
import { decideSpeaker, hasHandover } from "./speakerMatch.js";

const good = { cook: "a", score: 0.85, margin: 0.4, seconds: 2.5 };

test("a clear, long match is accepted", () => {
  assert.deepEqual(decideSpeaker(good), { cookId: "a", reason: "ok" });
});

test("each check can veto on its own", () => {
  assert.equal(decideSpeaker({ ...good, seconds: 0.6 }).cookId, null);
  assert.equal(decideSpeaker({ ...good, score: 0.4 }).cookId, null);
  assert.equal(decideSpeaker({ ...good, margin: 0.03 }).cookId, null);
  assert.equal(decideSpeaker({ cook: null, score: null, margin: null, seconds: 2 }).cookId, null);
});

test("a single enrolled cook has no margin, and the score decides", () => {
  assert.equal(decideSpeaker({ ...good, margin: null }).cookId, "a");
  assert.equal(decideSpeaker({ ...good, margin: null, score: 0.3 }).cookId, null);
});

test("a missing result is 'nobody', not an error", () => {
  assert.equal(decideSpeaker(null).cookId, null);
});

// Straight from runs/scene-08.diarized.jsonl and its clean neighbours.
test("handover: a turn that changed speaker part-way through", () => {
  const merged = [1.0, 1.0, 1.0, 0.63, 0.63, 0.63, 0.63].map((c) => ({ speaker_confidence: c }));
  assert.equal(hasHandover(merged), true);
});

test("handover: clean turns hold flat, however unsure the label is", () => {
  const confident = [1.0, 1.0, 1.0, 1.0].map((c) => ({ speaker_confidence: c }));
  const unsure = [0.5, 0.5, 0.5, 0.5].map((c) => ({ speaker_confidence: c }));
  assert.equal(hasHandover(confident), false);
  // 0.50 throughout is an ordinary single-speaker turn in these
  // recordings; a floor on the level rather than the drop would have
  // flagged every one of them.
  assert.equal(hasHandover(unsure), false);
});

test("handover: no diarization, no opinion", () => {
  assert.equal(hasHandover([{ text: "hi" }, { text: "there" }]), false);
  assert.equal(hasHandover([{ speaker_confidence: 1 }]), false);
  assert.equal(hasHandover([]), false);
  assert.equal(hasHandover(undefined), false);
});
