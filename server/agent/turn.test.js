import test from "node:test";
import assert from "node:assert/strict";
import { buildTools, buildUserMessage, cleanReply, isAddressed, parseChoice } from "./turn.js";

const snapshot = {
  speakerName: "Lindy",
  steps: [
    { id: "s1", label: "Chop the garlic", status: "pending", ready: true },
    { id: "s2", label: "Boil the rice", status: "active", ready: true, holder: "Zeina" },
    { id: "s3", label: "Plate up", status: "pending", ready: false },
  ],
};
const call = (name, args) => ({ function: { name, arguments: JSON.stringify(args) } });

test("addressing: name anywhere, case and punctuation aside", () => {
  assert.equal(isAddressed("Goose, I'm done", "Goose"), true);
  assert.equal(isAddressed("ok so goose the garlic is done", "Goose"), true);
});

test("addressing: ordinary kitchen talk is ignored", () => {
  assert.equal(isAddressed("I'm done with this wine", "Goose"), false);
  assert.equal(isAddressed("pass the salt", "Goose"), false);
});

test("addressing: one misheard letter still counts, on longer names only", () => {
  assert.equal(isAddressed("gooze done", "Goose"), true);
  assert.equal(isAddressed("tim done", "Tom"), false);
});

test("addressing: engaged skips the name", () => {
  assert.equal(isAddressed("yes", "Goose", true), true);
});

test("tools: step ids are enums from the snapshot; unusable tools are withheld", () => {
  const tools = Object.fromEntries(buildTools(snapshot).map((t) => [t.function.name, t.function]));
  assert.deepEqual(tools.claim.parameters.properties.step_id.enum, ["s1"]);
  assert.deepEqual(tools.done.parameters.properties.step_id.enum, ["s2"]);
  const none = buildTools({ steps: [] }).map((t) => t.function.name);
  assert.ok(!none.includes("claim") && !none.includes("done"));
  assert.ok(none.includes("pause"));
});

test("parse: keeps valid calls and the reply", () => {
  const out = parseChoice({ message: { content: "On it!", tool_calls: [call("claim", { step_id: "s1" })] } }, snapshot);
  assert.deepEqual(out.calls, [{ name: "claim", stepId: "s1" }]);
  assert.equal(out.reply, "On it!");
});

test("parse: drops invented ids, ineligible steps, unoffered tools and bad JSON", () => {
  const out = parseChoice(
    {
      message: {
        tool_calls: [
          call("claim", { step_id: "nope" }),
          call("claim", { step_id: "s3" }),
          call("explode", {}),
          { function: { name: "done", arguments: "{oops" } },
        ],
      },
    },
    snapshot,
  );
  assert.deepEqual(out.calls, []);
  assert.deepEqual(out.rejected.map((r) => r.reason), ["unknown_step", "step_not_eligible", "not_offered", "bad_json"]);
});

test("parse: strips markdown and caps length", () => {
  const out = parseChoice({ message: { content: "**Ho** ho _ho_ " + "x".repeat(400) } }, snapshot);
  assert.ok(!/[*_]/.test(out.reply));
  assert.ok(out.reply.length <= 200);
});

test("reply: the model's own scratchpad is never spoken", () => {
  assert.equal(cleanReply("Thinking Process: 1. Identify the user's intent."), "");
  assert.equal(cleanReply("toolcode print(default_api.status())"), "");
  assert.equal(cleanReply("This is a cooking question. I should answer it myself."), "");
  assert.equal(cleanReply("The user is asking how fine to chop the garlic."), "");
});

test("reply: ordinary answers pass through, tidied", () => {
  assert.equal(cleanReply("  **Fine-mince** the ginger.  "), "Fine-mince the ginger.");
  assert.equal(cleanReply(""), "");
  assert.equal(cleanReply(null), "");
});

test("reply: long answers are cut at a sentence, never mid-word", () => {
  const long = `${"Rinse the rice until the water runs completely clear. ".repeat(4)}Then simmer.`;
  const out = cleanReply(long);
  assert.ok(out.length <= 200, `too long: ${out.length}`);
  assert.ok(/[.!?]$/.test(out), `does not end a sentence: ${out}`);
  assert.ok(!out.endsWith("..."), "should not need the word-boundary fallback here");
});

test("two cooks in one turn: nothing fires, whatever the model says", () => {
  const choice = {
    message: {
      content: "Got it, done with the garlic.",
      tool_calls: [call("done", { step_id: "s2" }), call("claim", { step_id: "s1" })],
    },
  };
  const normal = parseChoice(choice, snapshot);
  assert.equal(normal.calls.length, 2, "ordinarily both calls stand");

  const shared = parseChoice(choice, snapshot, { shared: true });
  assert.deepEqual(shared.calls, []);
  assert.deepEqual(shared.rejected.map((r) => r.reason), ["two_speakers", "two_speakers"]);
  // The question it asks instead still gets through.
  assert.equal(shared.reply, "Got it, done with the garlic.");
});

test("two cooks in one turn: the model is told, in the words it reads", () => {
  const plain = buildUserMessage(snapshot, "done with— no way, that's mine");
  const both = buildUserMessage(snapshot, "done with— no way, that's mine", { shared: true });
  assert.ok(!/TWO COOKS/.test(plain));
  assert.ok(/TWO COOKS SPOKE AT ONCE/.test(both));
  assert.ok(/Take no action/.test(both));
});
