import test from "node:test";
import assert from "node:assert/strict";
import { shouldCommentate, QUIET_MS, COOLDOWN_MS } from "./commentary.js";

// Two cooks, both heads-down, a long quiet stretch, nothing said for
// ages: the one shape an unprompted remark is welcome in.
const lull = {
  busyCooks: 2,
  cookCount: 2,
  paused: false,
  ended: false,
  msSinceVoice: QUIET_MS + 1000,
  msSinceComment: COOLDOWN_MS + 1000,
};

test("shouldCommentate: a real lull passes", () => {
  assert.deepEqual(shouldCommentate(lull), { ok: true, reason: "ok" });
});

test("shouldCommentate: never over a paused or finished run", () => {
  assert.equal(shouldCommentate({ ...lull, paused: true }).ok, false);
  assert.equal(shouldCommentate({ ...lull, ended: true }).ok, false);
  // Over beats paused: a finished run is not waiting for anything.
  assert.equal(shouldCommentate({ ...lull, ended: true, paused: true }).reason, "run over");
});

test("shouldCommentate: a cook standing free is not an audience", () => {
  // Someone with nothing to do could be given a task, or is about to
  // speak. Both beat being talked at.
  assert.equal(shouldCommentate({ ...lull, busyCooks: 1 }).ok, false);
  assert.equal(shouldCommentate({ ...lull, busyCooks: 1 }).reason, "someone is free");
  assert.equal(shouldCommentate({ ...lull, busyCooks: 0 }).ok, false);
});

test("shouldCommentate: one cook alone gets no commentary", () => {
  assert.equal(shouldCommentate({ ...lull, cookCount: 1, busyCooks: 1 }).ok, false);
  assert.equal(shouldCommentate({ ...lull, cookCount: 0, busyCooks: 0 }).ok, false);
});

test("shouldCommentate: a pause for breath is not a lull", () => {
  // A turn ends after well under a second of silence. Speaking into
  // that is interrupting, not filling a gap.
  assert.equal(shouldCommentate({ ...lull, msSinceVoice: 0 }).ok, false);
  assert.equal(shouldCommentate({ ...lull, msSinceVoice: QUIET_MS - 1 }).ok, false);
  assert.equal(shouldCommentate({ ...lull, msSinceVoice: QUIET_MS }).ok, true, "the boundary counts");
});

test("shouldCommentate: it has to have kept quiet recently too", () => {
  // Otherwise a genuinely silent stretch becomes a monologue.
  assert.equal(shouldCommentate({ ...lull, msSinceComment: 0 }).ok, false);
  assert.equal(shouldCommentate({ ...lull, msSinceComment: COOLDOWN_MS - 1 }).ok, false);
  assert.equal(shouldCommentate({ ...lull, msSinceComment: COOLDOWN_MS }).ok, true);
});

test("shouldCommentate: never having spoken is not 'too soon'", () => {
  const noHistory = { ...lull };
  delete noHistory.msSinceComment;
  assert.equal(shouldCommentate(noHistory).ok, true, "defaults to Infinity");
  assert.equal(shouldCommentate({ ...lull, msSinceComment: Infinity }).ok, true);
});

test("shouldCommentate: called with nothing says no, rather than throwing", () => {
  // The timer that drives this runs before a run exists.
  assert.equal(shouldCommentate().ok, false);
  assert.equal(shouldCommentate({}).ok, false);
});

test("shouldCommentate: the reason is specific enough to debug from", () => {
  // These end up in a console line during a cook; "no" on its own would
  // make a quiet goose impossible to diagnose.
  const reasons = [
    [{ ...lull, ended: true }, "run over"],
    [{ ...lull, paused: true }, "paused"],
    [{ ...lull, cookCount: 1 }, "not enough cooks"],
    [{ ...lull, busyCooks: 0 }, "someone is free"],
    [{ ...lull, msSinceVoice: 0 }, "not quiet yet"],
    [{ ...lull, msSinceComment: 0 }, "too soon after the last one"],
  ];
  for (const [state, reason] of reasons) {
    assert.equal(shouldCommentate(state).reason, reason);
  }
});
