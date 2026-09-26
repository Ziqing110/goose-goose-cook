import test from "node:test";
import assert from "node:assert/strict";
import { isAddressed, isNameOnlyTurn, isUrgent } from "./addressing.js";

test("addressed: the name anywhere, punctuation and case aside", () => {
  assert.equal(isAddressed("Goose, I'm done with the tofu.", "Goose"), true);
  assert.equal(isAddressed("ok so goose the garlic is done", "Goose"), true);
  assert.equal(isAddressed("Hey Goose! Done with the tofu!", "Goose"), true);
});

test("addressed: one mishearing of a long name still counts", () => {
  assert.equal(isAddressed("goos, done with the tofu", "Goose"), true);
  assert.equal(isAddressed("goose done with the tofu", "Goose"), true);
  // Two edits away is a different word, not a mangled name.
  assert.equal(isAddressed("juice, done with the tofu", "Goose"), false);
});

test("addressed: kitchen talk is not", () => {
  assert.equal(isAddressed("Can you pass me the cutting board?", "Goose"), false);
  assert.equal(isAddressed("Yeah, hold on, I'm done with this.", "Goose"), false);
});

test("addressed: engaged lets an unnamed answer through", () => {
  assert.equal(isAddressed("the garlic one", "Goose"), false);
  assert.equal(isAddressed("the garlic one", "Goose", true), true);
});

// The split seen on scenes 2 and 4 of the kitchen recordings: the name
// finalizes as its own turn and the instruction arrives in the next one.
test("name only: the name by itself, with or without a greeting", () => {
  assert.equal(isNameOnlyTurn("Goose.", "Goose"), true);
  assert.equal(isNameOnlyTurn("Goose!", "Goose"), true);
  assert.equal(isNameOnlyTurn("Hey Goose", "Goose"), true);
  assert.equal(isNameOnlyTurn("ok goose", "Goose"), true);
  assert.equal(isNameOnlyTurn("goos", "Goose"), true);
});

test("name only: anything that asks for something is not", () => {
  assert.equal(isNameOnlyTurn("Goose, status.", "Goose"), false);
  assert.equal(isNameOnlyTurn("Goose, done with the tofu.", "Goose"), false);
  // No name at all is not a name-only turn, it is somebody else talking.
  assert.equal(isNameOnlyTurn("Done with the tofu.", "Goose"), false);
  assert.equal(isNameOnlyTurn("", "Goose"), false);
});

// Somebody with a pot boiling over does not stop to say the name.
test("urgent: trouble at the stove needs no name", () => {
  assert.equal(isUrgent("The water's boiling over!"), true);
  assert.equal(isUrgent("oh no the water is coming out"), true);
  assert.equal(isUrgent("It's overflowing, what do I do?"), true);
  assert.equal(isUrgent("Something's burning"), true);
  assert.equal(isUrgent("the pan is smoking"), true);
  assert.equal(isUrgent("Help, the rice is foaming over"), true);
  assert.equal(isUrgent("what should we do now"), true);
});

test("urgent: ordinary kitchen talk is not", () => {
  assert.equal(isUrgent("Can you pass me the cutting board?"), false);
  assert.equal(isUrgent("Quick question, where's the salt?"), false);
  assert.equal(isUrgent("Someone took my knife"), false);
  assert.equal(isUrgent("I'm done with the tofu."), false);
  assert.equal(isUrgent(""), false);
});
