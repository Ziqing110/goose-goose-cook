import test from "node:test";
import assert from "node:assert/strict";
import { speechActivity } from "./speechActivity.js";

const quiet = (n, level = 60) => Array(n).fill(level);
const loud = (n, level = 3000) => Array(n).fill(level);

test("silence alone is never done", () => {
  const a = speechActivity(quiet(200));
  assert.equal(a.done, false);
  assert.equal(a.voicedMs, 0);
});

test("keeps waiting while the reading is still going", () => {
  // 2s of speech: not enough yet, however long the pause after it.
  const a = speechActivity([...quiet(20), ...loud(40), ...quiet(40)]);
  assert.equal(a.voicedMs, 2000);
  assert.equal(a.done, false);
});

test("done once there is enough speech and then a real pause", () => {
  const a = speechActivity([...quiet(20), ...loud(80), ...quiet(30)]);
  assert.equal(a.done, true);
  assert.equal(a.voicedMs, 4000);
});

test("a pause inside the line does not end it", () => {
  // speech, a 0.5s breath, more speech: the trailing silence is measured
  // from the LAST speech, not the first gap.
  const a = speechActivity([...quiet(20), ...loud(40), ...quiet(10), ...loud(40), ...quiet(10)]);
  assert.equal(a.done, false);
  assert.equal(a.trailingSilenceMs, 500);
});

test("a steady fan is the floor, not speech", () => {
  const fan = 500;
  const a = speechActivity([...quiet(60, fan), ...loud(80, 4000), ...quiet(30, fan)]);
  assert.equal(a.done, true);
  assert.equal(a.voicedMs, 4000); // the fan alone was never counted
});

test("talking without a pause still registers as speech", () => {
  const a = speechActivity(loud(100, 3000));
  assert.equal(a.voicedMs, 5000);
  assert.equal(a.done, false); // no pause yet
});

test("reports where the speech was, for trimming the clip", () => {
  const a = speechActivity([...quiet(10), ...loud(80), ...quiet(30)]);
  assert.equal(a.firstVoiced, 10);
  assert.equal(a.lastVoiced, 89);
});
