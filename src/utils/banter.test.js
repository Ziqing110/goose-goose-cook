import test from "node:test";
import assert from "node:assert/strict";
import { BANTER_COOLDOWN_MS, ROOM_WINDOW_MS, recentRoomTalk, shouldBanter } from "./banter.js";

const two = [{ speaker: "Zeina", text: "a", at: 0 }, { speaker: "Nora", text: "b", at: 0 }];

test("banter: a live exchange with the goose quiet is allowed", () => {
  assert.equal(shouldBanter({ roomLines: two }).ok, true);
});

test("banter: one remark into the air is not a conversation", () => {
  assert.equal(shouldBanter({ roomLines: two.slice(0, 1) }).ok, false);
});

test("banter: rare, and never on top of the goose", () => {
  assert.equal(shouldBanter({ roomLines: two, msSinceBanter: BANTER_COOLDOWN_MS - 1 }).ok, false);
  assert.equal(shouldBanter({ roomLines: two, msSinceAgent: 1000 }).ok, false);
  assert.equal(shouldBanter({ roomLines: two, busy: true }).ok, false);
});

test("banter: not while paused or after the run", () => {
  assert.equal(shouldBanter({ roomLines: two, paused: true }).ok, false);
  assert.equal(shouldBanter({ roomLines: two, ended: true }).ok, false);
});

test("room talk: old lines drop out, newest kept", () => {
  const now = ROOM_WINDOW_MS + 10;
  const lines = [{ text: "old", at: 0 }, ...Array.from({ length: 8 }, (_, i) => ({ text: `n${i}`, at: now - i }))];
  const kept = recentRoomTalk(lines, now);
  assert.equal(kept.length, 6);
  assert.ok(!kept.some((l) => l.text === "old"));
});
