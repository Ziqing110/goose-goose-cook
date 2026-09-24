import test from "node:test";
import assert from "node:assert/strict";
import { createSpanLog } from "./speechSpans.js";

test("a turn that started while the agent spoke is the agent", () => {
  const log = createSpanLog();
  log.begin(1000);
  log.end(3000);
  assert.equal(log.covers(2000), true);
});

test("the room tail after playback still counts, then stops counting", () => {
  const log = createSpanLog({ tailMs: 700 });
  log.begin(1000);
  log.end(3000);
  assert.equal(log.covers(3600), true);
  assert.equal(log.covers(3800), false);
});

test("output latency at the front counts, earlier does not", () => {
  const log = createSpanLog({ leadMs: 150 });
  log.begin(1000);
  log.end(3000);
  assert.equal(log.covers(900), true);
  assert.equal(log.covers(800), false);
});

test("a span still playing covers the words being spoken over it", () => {
  const log = createSpanLog();
  const now = Date.now();
  log.begin(now - 1_000);
  assert.equal(log.covers(now - 500), true);
  assert.equal(log.covers(now), true);
});

// A voice that reports onstart and never onend — which is what a browser
// with no installed voices does — used to leave the span open forever, and
// an open span matched every later turn. The agent then heard its own
// voice in everything anyone said and went deaf for the rest of the
// session. An unclosed span is only believed for as long as speaking is
// plausible.
test("a span nobody closed stops covering once it outlasts any sentence", () => {
  const log = createSpanLog({ maxOpenMs: 30_000 });
  const now = Date.now();
  log.begin(now - 60_000);
  assert.equal(log.covers(now - 10_000), false);
  assert.equal(log.covers(now), false);
});

test("someone speaking well before or after is not the agent", () => {
  const log = createSpanLog();
  log.begin(10_000);
  log.end(12_000);
  assert.equal(log.covers(5_000), false);
  assert.equal(log.covers(20_000), false);
});

test("end() with nothing playing is harmless", () => {
  const log = createSpanLog();
  log.end(5);
  assert.equal(log.covers(5), false);
});
