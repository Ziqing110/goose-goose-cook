import test from "node:test";
import assert from "node:assert/strict";
import { decideSpeaker, hasHandover, shouldLearn } from "./speakerMatch.js";

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

test("learn: a cook who said who they are teaches their print, whatever the voiceprint thought", () => {
  assert.equal(shouldLearn({ via: "said so", seconds: 2.4 }), true);
});

test("learn: only a match well clear of the thresholds teaches", () => {
  assert.equal(shouldLearn({ via: "voiceprint", result: { score: 0.72, margin: 0.31 }, seconds: 2 }), true);
  // Accepted for crediting, but not sure enough to learn from.
  assert.equal(shouldLearn({ via: "voiceprint", result: { score: 0.58, margin: 0.31 }, seconds: 2 }), false);
  assert.equal(shouldLearn({ via: "voiceprint", result: { score: 0.72, margin: 0.12 }, seconds: 2 }), false);
  // One cook enrolled: no runner-up to be sure it is not.
  assert.equal(shouldLearn({ via: "voiceprint", result: { score: 0.9, margin: null }, seconds: 2 }), false);
});

test("learn: never from two voices, a short scrap, a label or a toggle", () => {
  assert.equal(shouldLearn({ via: "said so", seconds: 3, shared: true }), false);
  assert.equal(shouldLearn({ via: "said so", seconds: 1.2 }), false);
  assert.equal(shouldLearn({ via: "label", result: { score: 0.9, margin: 0.5 }, seconds: 3 }), false);
  assert.equal(shouldLearn({ via: "toggle", seconds: 3 }), false);
  assert.equal(shouldLearn({ via: "said so" }), false);
});
