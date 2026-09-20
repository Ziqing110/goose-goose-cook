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

test("a span still playing covers everything after its start", () => {
  const log = createSpanLog();
  log.begin(1000);
  assert.equal(log.covers(999999), true);
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
