import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNarrationMessage,
  buildNarrationPrompt,
  cleanNarration,
  requestNarration,
} from "./narrate.js";

const record = {
  dish: "Mapo Tofu",
  mode: "cooperation",
  totalSec: 1500,
  estimatedSec: 1800,
  cooks: [
    {
      name: "Mia",
      done: 2,
      skipped: 1,
      dropped: 0,
      workingSec: 300,
      longest: { label: "Cut tofu", seconds: 200 },
      actions: [
        { type: "start", label: "Cut tofu", undone: false },
        { type: "done", label: "Cut tofu", undone: false },
        { type: "skip", label: "Mix sauce", undone: false },
      ],
    },
    { name: "Leo", done: 1, skipped: 0, dropped: 1, workingSec: 170, longest: null, actions: [] },
  ],
};

test("buildNarrationMessage: the dish, the clock and the plan", () => {
  const message = buildNarrationMessage(record);
  assert.ok(message.includes("Mapo Tofu"));
  assert.ok(message.includes("co-op"));
  assert.ok(message.includes("25m"), "took 1500s");
  assert.ok(message.includes("30m"), "planned 1800s");
});

test("buildNarrationMessage: each cook's tally, with the notable bits", () => {
  const message = buildNarrationMessage(record);
  assert.ok(message.includes("Mia: 2 steps finished"));
  assert.ok(message.includes("1 skipped"));
  assert.ok(message.includes("longest was Cut tofu"));
  assert.ok(message.includes("Leo: 1 steps finished"));
  assert.ok(message.includes("1 handed back"), "the hand-back is where the story is");
});

test("buildNarrationMessage: the order of what each did", () => {
  // The tallies say what happened; the order says how the evening went.
  const message = buildNarrationMessage(record);
  assert.ok(message.includes("Mia in order: start Cut tofu; done Cut tofu; skip Mix sauce."));
});

test("buildNarrationMessage: undone actions are not part of the story", () => {
  const message = buildNarrationMessage({
    cooks: [{ name: "Mia", actions: [{ type: "done", label: "Cut tofu", undone: true }] }],
  });
  assert.ok(!message.includes("in order"), "nothing left to list");
});

test("buildNarrationMessage: versus is named as versus", () => {
  assert.ok(buildNarrationMessage({ mode: "competition" }).includes("versus"));
  assert.ok(buildNarrationMessage({ mode: "versus" }).includes("versus"));
  assert.ok(buildNarrationMessage({}).includes("co-op"), "and coop is the default");
});

test("buildNarrationMessage: an empty record still produces a message", () => {
  const message = buildNarrationMessage();
  assert.ok(message.includes("an untitled cook"));
});

test("buildNarrationPrompt: forbids inventing and forbids a scoreboard", () => {
  const prompt = buildNarrationPrompt("Goose");
  assert.ok(prompt.includes("Goose"));
  assert.ok(/never invent/i.test(prompt));
  assert.ok(/no scores or rankings/i.test(prompt), "the card already shows those");
});

test("cleanNarration: prose comes through as one paragraph", () => {
  assert.equal(
    cleanNarration("Mia flew through the tofu.\nLeo handed back the pork."),
    "Mia flew through the tofu. Leo handed back the pork.",
  );
});

test("cleanNarration: a model that returned a list loses the bullets", () => {
  // Keeping them would put a bulleted list on a diary card.
  const out = cleanNarration("How it went:\n- Mia did the tofu\n- Leo did not\nA good night.");
  assert.ok(!out.includes("Mia did the tofu"), out);
  assert.ok(out.includes("A good night."));
});

test("cleanNarration: markdown is stripped", () => {
  assert.equal(cleanNarration("**Mia** flew through it."), "Mia flew through it.");
});

test("cleanNarration: an essay is dropped rather than truncated mid-word", () => {
  assert.equal(cleanNarration("word ".repeat(200)), "");
});

test("cleanNarration: nothing in, nothing out", () => {
  for (const value of ["", "   ", null, undefined, "\n\n"]) {
    assert.equal(cleanNarration(value), "", JSON.stringify(value));
  }
});

test("requestNarration: no key means the card keeps its own headline", () => {
  return requestNarration({ apiKey: "", model: "x", agentName: "Goose", record })
    .then((r) => assert.deepEqual(r, { story: "", model: null }));
});

test("requestNarration: an unreachable gateway is not an error the card shows", async () => {
  const r = await requestNarration({
    apiKey: "test", model: "x", agentName: "Goose", record, timeoutMs: 1,
  });
  assert.equal(r.story, "");
});
