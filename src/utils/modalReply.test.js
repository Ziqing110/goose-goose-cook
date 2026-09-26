import test from "node:test";
import assert from "node:assert/strict";
import { routeModalReply } from "./modalReply.js";

const reply = (text, kind) => routeModalReply(text, kind, "Goose").type;

test("modal: skipping a step others need takes a plain yes, with or without the name", () => {
  assert.equal(reply("yes", "skip"), "confirm");
  assert.equal(reply("Goose, yes", "skip"), "confirm");
  assert.equal(reply("skip it", "skip"), "confirm");
  assert.equal(reply("skip anyway", "skip"), "confirm");
});

test("modal: no, keep it and never mind all keep the step", () => {
  assert.equal(reply("no", "skip"), "cancel");
  assert.equal(reply("keep it", "skip"), "cancel");
  assert.equal(reply("never mind", "skip"), "cancel");
});

test("modal: ending the cook early needs the phrase, not a yes", () => {
  assert.equal(reply("call it early", "finish"), "confirm");
  assert.equal(reply("Goose, call it early", "finish"), "confirm");
  assert.equal(reply("call it", "finish"), "confirm");
  // A stray "yeah" across the kitchen must not end the cook -- but it is
  // an answer, so the goose asks again rather than going quiet.
  assert.equal(reply("yes", "finish"), "reprompt");
  assert.equal(reply("yeah", "finish"), "reprompt");
});

test("modal: a refusal wins even when it contains the confirming words", () => {
  assert.equal(reply("don't call it early", "finish"), "cancel");
  assert.equal(reply("no, keep cooking", "finish"), "cancel");
  assert.equal(reply("not yet", "finish"), "cancel");
});

test("modal: anything else is not an answer, and is handled on its own", () => {
  assert.equal(reply("Goose, how long is the rice", "finish"), "moved-on");
  assert.equal(reply("Goose, start the garlic", "skip"), "moved-on");
  assert.equal(reply("", "skip"), "moved-on");
});
