import test from "node:test";
import assert from "node:assert/strict";
import { decideSpeaker } from "./speakerMatch.js";

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
