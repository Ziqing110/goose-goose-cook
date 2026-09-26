import test from "node:test";
import assert from "node:assert/strict";
import { buildInterpretMessage, buildInterpretPrompt, parseInterpretation, requestInterpretation } from "./interpret.js";

const call = (args) => ({
  message: { content: null, tool_calls: [{ id: "1", type: "function", function: { name: "say_command", arguments: JSON.stringify(args) } }] },
});

test("parse: a rewrite comes back as one trimmed line, and no reply alongside it", () => {
  assert.deepEqual(parseInterpretation(call({ utterance: "  call the first   cook Zeina " })), {
    utterance: "call the first cook Zeina",
    reply: "",
  });
});

test("parse: no call is a reply, cleaned for speech", () => {
  assert.deepEqual(parseInterpretation({ message: { content: "**Which** cook did you mean?" } }), {
    utterance: null,
    reply: "Which cook did you mean?",
  });
});

test("parse: a malformed or empty call is no rewrite at all", () => {
  const bad = { message: { tool_calls: [{ function: { name: "say_command", arguments: "{not json" } }] } };
  assert.equal(parseInterpretation(bad).utterance, null);
  assert.equal(parseInterpretation(call({ utterance: "   " })).utterance, null);
  assert.equal(parseInterpretation(undefined).utterance, null);
});

test("parse: a tool the model made up is ignored", () => {
  const other = { message: { tool_calls: [{ function: { name: "delete_everything", arguments: "{}" } }] } };
  assert.deepEqual(parseInterpretation(other), { utterance: null, reply: "" });
});

test("parse: a runaway rewrite is capped", () => {
  assert.equal(parseInterpretation(call({ utterance: "x".repeat(500) })).utterance.length, 200);
});

test("message: page state, commands with examples and patterns, destinations, and the words", () => {
  const msg = buildInterpretMessage({
    text: "no, it's Zeina, Z E I N A",
    route: "/session/voice-binding",
    context: ['Cook 1 (the first cook): named "Zina"'],
    commands: [{ description: "Name a cook", examples: ["call the first cook Mia"], patterns: ["\\bcall (first|second) (.+)$"] }],
    destinations: ["the schedule"],
  });
  assert.match(msg, /named "Zina"/);
  assert.match(msg, /1\. Name a cook/);
  assert.match(msg, /say: "call the first cook Mia"/);
  assert.match(msg, /must match: \/\\bcall \(first\|second\) \(\.\+\)\$\//);
  assert.match(msg, /2\. Go to another page\n {3}say: "go to the schedule"/);
  assert.match(msg, /They said: "no, it's Zeina, Z E I N A"$/);
});

test("prompt: names the agent and tells it spelled letters are the spelling", () => {
  const prompt = buildInterpretPrompt("Goose");
  assert.match(prompt, /^You are Goose/);
  assert.match(prompt, /letter by letter/);
});

test("request: without a key it refuses rather than calling out", async () => {
  await assert.rejects(
    requestInterpretation({ apiKey: "", model: "m", agentName: "Goose", text: "hi", route: "/", commands: [] }),
    (err) => err.status === 503,
  );
});

test("parse: a reply that is really JSON is not read aloud", () => {
  const leaked = { message: { content: '{"criteria":"go to the next page, e.g. continue to scheduling' } };
  assert.deepEqual(parseInterpretation(leaked), { utterance: null, reply: "" });
});
