import test from "node:test";
import assert from "node:assert/strict";
import { opensFollowUp } from "./followUp.js";

test("a question the agent asked leaves the door open", () => {
  // Unchanged behaviour: the answer is the next thing said and it will
  // not have a name on it.
  assert.equal(opensFollowUp({ reply: "Did you mean Mix sauce?" }), true);
  assert.equal(opensFollowUp({ reply: "Which one did you finish?  " }), true);
});

test("an answer the agent gave leaves the door open too", () => {
  // The bug this exists for: "Goose, what does mix sauce mean?" was
  // answered, and then "how long does that take?" fell on the floor for
  // want of a name.
  for (const name of ["explain", "status", "score", "help"]) {
    assert.equal(opensFollowUp({ reply: "", calls: [{ name }] }), true, name);
  }
});

test("acting does not", () => {
  // "Onion done." is the end of a thing, not half of an exchange.
  // Leaving the mic open after every completed step would feed the model
  // every word said near it.
  for (const name of ["claim", "start", "done", "skip", "drop", "undo", "pause", "resume", "finish_run"]) {
    assert.equal(opensFollowUp({ reply: "Cut tofu done.", calls: [{ name }] }), false, name);
  }
});

test("a statement with no calls closes the door", () => {
  assert.equal(opensFollowUp({ reply: "I can't help with the weather." }), false);
  assert.equal(opensFollowUp({ reply: "Back on. Clock's running again." }), false);
});

test("answering wins when a turn both answered and acted", () => {
  // "Goose, what's mix sauce, and start the garlic" -- they are mid
  // conversation whatever else happened.
  assert.equal(
    opensFollowUp({ reply: "", calls: [{ name: "start" }, { name: "explain" }] }),
    true,
  );
});

test("nothing at all closes the door, rather than throwing", () => {
  assert.equal(opensFollowUp(), false);
  assert.equal(opensFollowUp({}), false);
  assert.equal(opensFollowUp({ reply: null, calls: null }), false);
  assert.equal(opensFollowUp({ calls: [null, undefined] }), false);
});

test("a question mark mid-sentence is not the agent asking", () => {
  // Only a trailing one. "How thin? Very thin." is an answer.
  assert.equal(opensFollowUp({ reply: "How thin? Very thin." }), false);
});
