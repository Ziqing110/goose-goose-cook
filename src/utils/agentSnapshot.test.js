import test from "node:test";
import assert from "node:assert/strict";
import { createRun, applyStart, applyDone } from "./liveCook.js";
import { buildAgentSnapshot } from "./agentSnapshot.js";

const nodes = [
  { id: "a", label: "Chop garlic", depends_on: [], estimated_duration_sec: 60 },
  { id: "b", label: "Fry garlic", depends_on: ["a"], estimated_duration_sec: 60 },
  { id: "c", label: "Boil rice", depends_on: [], estimated_duration_sec: 600 },
];
const cooks = [{ id: "k1", name: "Lindy" }, { id: "k2", name: "Zeina" }];
const at = "2026-09-19T10:00:00.000Z";

test("snapshot lists open steps with readiness and holders, and drops finished ones", () => {
  let run = createRun({ nodes, mode: "cooperation", schedule: null });
  run = applyStart({ run, stepId: "c", cookId: "k2", at });
  run = applyStart({ run, stepId: "a", cookId: "k1", at });
  run = applyDone({ run, stepId: "a", cookId: "k1", at });

  const snap = buildAgentSnapshot({ run, nodes, cooks, speakerId: "k1" });
  assert.equal(snap.speakerName, "Lindy");
  assert.deepEqual(snap.steps.map((s) => s.id), ["b", "c"]);
  assert.deepEqual(snap.steps.find((s) => s.id === "b"), { id: "b", label: "Fry garlic", status: "pending", ready: true, holder: null });
  assert.equal(snap.steps.find((s) => s.id === "c").holder, "Zeina");
  assert.equal(snap.mode, "coop");
});
