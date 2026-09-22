import test from "node:test";
import assert from "node:assert/strict";
import { collect, openCount, park } from "./pending.js";

test("an answer is collected once and only once", async () => {
  const id = park(Promise.resolve({ reply: "Use a shallot." }));
  const first = collect(id);
  assert.ok(first, "the first collection gets the promise");
  assert.deepEqual(await first, { reply: "Use a shallot." });
  // Spoken twice would be worse than not at all.
  assert.equal(collect(id), null);
});

test("an id nobody parked is simply absent", () => {
  assert.equal(collect("q_nope"), null);
  assert.equal(collect(undefined), null);
});

test("a failed lookup is still collectable, as a failure", async () => {
  const id = park(Promise.reject(new Error("search is down")));
  await assert.rejects(() => collect(id), /search is down/);
});

test("an uncollected failure does not become an unhandled rejection", async () => {
  park(Promise.reject(new Error("nobody asks about this one")));
  // If park() did not attach its own catch, this tick is where the
  // process would die.
  await new Promise((r) => setImmediate(r));
  assert.ok(true);
});

test("the store is bounded: the oldest question goes first", () => {
  const ids = [];
  for (let i = 0; i < 12; i++) ids.push(park(Promise.resolve({ reply: String(i) })));
  assert.ok(openCount() <= 8, `expected at most 8 open, got ${openCount()}`);
  // The earliest ones were evicted to make room.
  assert.equal(collect(ids[0]), null);
  assert.ok(collect(ids[ids.length - 1]), "the newest survives");
});
