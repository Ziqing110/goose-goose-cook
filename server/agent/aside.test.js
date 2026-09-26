import test from "node:test";
import assert from "node:assert/strict";
import { buildAsideMessage, buildAsidePrompt, cleanAside, requestAside } from "./aside.js";

test("cleanAside: a plain sentence comes through", () => {
  assert.equal(cleanAside("Mia is closing in on the tofu."), "Mia is closing in on the tofu.");
});

test("cleanAside: markdown is stripped, since this is read aloud", () => {
  assert.equal(cleanAside("**Mia** is _ahead_."), "Mia is ahead.");
  assert.equal(cleanAside("# Leo takes the lead"), "Leo takes the lead");
});

test("cleanAside: whitespace and newlines collapse to one line", () => {
  assert.equal(cleanAside("  Mia is ahead.\n\nLeo is not.  "), "Mia is ahead. Leo is not.");
});

test("cleanAside: a question is dropped entirely", () => {
  // An unprompted question leaves the kitchen owing an answer to
  // something nobody was asked.
  assert.equal(cleanAside("Who's winning?"), "");
  assert.equal(cleanAside("Mia is ahead. Want the score?"), "");
});

test("cleanAside: a model that ignored 'short' says nothing", () => {
  // Better silence than ninety seconds of goose over a hot wok.
  assert.equal(cleanAside("x".repeat(200)), "");
});

test("cleanAside: nothing in, nothing out", () => {
  for (const value of ["", "   ", null, undefined]) {
    assert.equal(cleanAside(value), "", String(value));
  }
});

test("buildAsidePrompt: names the agent and forbids instructions", () => {
  const prompt = buildAsidePrompt("Goose");
  assert.ok(prompt.includes("Goose"));
  assert.ok(/never give an instruction/i.test(prompt), "they are already working");
  assert.ok(/empty string/i.test(prompt), "silence has to be an allowed answer");
});

test("buildAsideMessage: carries the run, without the ids", () => {
  // Step ids exist so the model can ACT on a step. An aside cannot, so
  // sending them is tokens spent inviting a tool call that is not offered.
  const message = buildAsideMessage({
    mode: "versus",
    cooks: [{ name: "Mia" }, { name: "Leo" }],
    steps: [{ id: "tofu", label: "Cut tofu", status: "active", holder: "Mia" }],
  });
  assert.ok(message.includes("versus"));
  assert.ok(message.includes("Mia, Leo"));
  assert.ok(message.includes("Cut tofu"));
  assert.ok(!message.includes("\"id\""), "the id key is not sent");
  assert.ok(!message.includes("\"tofu\""), "nor the id as a value");
});

test("buildAsideMessage: an empty kitchen does not throw", () => {
  assert.ok(buildAsideMessage({}).includes("coop"));
});

test("requestAside: no API key means silence, not an error", () => {
  // The deployed app without a key should behave as if the feature is
  // simply off.
  return requestAside({ apiKey: "", model: "x", agentName: "Goose", snapshot: {} })
    .then((result) => assert.deepEqual(result, { line: "", model: null }));
});

test("requestAside: an unreachable gateway is silence too", async () => {
  // Nobody asked for this line, so nobody should hear about it failing.
  const result = await requestAside({
    apiKey: "test",
    model: "x",
    agentName: "Goose",
    snapshot: { steps: [] },
    timeoutMs: 1,
  });
  assert.equal(result.line, "");
});
