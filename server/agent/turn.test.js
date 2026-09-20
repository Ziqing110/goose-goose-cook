import test from "node:test";
import assert from "node:assert/strict";
import { buildTools, isAddressed, parseChoice } from "./turn.js";

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
