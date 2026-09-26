import test from "node:test";
import assert from "node:assert/strict";
import { routeConfirmReply } from "./confirmReply.js";

test("routeConfirmReply: a plain answer resolves the question", () => {
  for (const said of ["yes", "yeah", "yep", "sure", "ok", "do it"]) {
    assert.deepEqual(routeConfirmReply(said), { type: "resolve", answer: "yes" }, said);
  }
  for (const said of ["no", "nope", "nah", "cancel"]) {
    assert.deepEqual(routeConfirmReply(said), { type: "resolve", answer: "no" }, said);
  }
});

test("routeConfirmReply: a question is not an answer", () => {
  // The bug this exists for: asked "Did you mean Mix sauce?", a cook who
  // says "what does that even mean?" was told "I didn't catch that" --
  // the keyword grammar's reply to an utterance that was never a command.
  for (const said of [
    "what does that even mean",
    "how fine should the ginger be",
    "can I use shallots instead",
  ]) {
    assert.deepEqual(routeConfirmReply(said), { type: "moved-on" }, said);
  }
});

test("routeConfirmReply: a different command is not an answer either", () => {
  // They moved on. The command stands on its own and the question goes.
  for (const said of ["start the garlic", "pause", "what's the score"]) {
    assert.deepEqual(routeConfirmReply(said), { type: "moved-on" }, said);
  }
});

test("routeConfirmReply: a long sentence containing 'no' is not a refusal", () => {
  // "no, the other one next to the stock" is someone pointing at a jar.
  const said = "no the other one next to the stock on the shelf";
  assert.deepEqual(routeConfirmReply(said), { type: "moved-on" }, said);
});

test("routeConfirmReply: nothing said is not an answer", () => {
  for (const said of ["", "   ", null, undefined]) {
    assert.deepEqual(routeConfirmReply(said), { type: "moved-on" }, JSON.stringify(said));
  }
});

test("routeConfirmReply: case and punctuation do not change the answer", () => {
  assert.equal(routeConfirmReply("Yes!").answer, "yes");
  assert.equal(routeConfirmReply("  NO.  ").answer, "no");
});
