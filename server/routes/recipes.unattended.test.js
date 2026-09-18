// Unit tests for the unattended-step data model: pass-2/pass-3 merging,
// validate()'s new checks, and the fallback path's heuristic stand-in.
// Run with: node --test server/routes/recipes.unattended.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  validate,
  toTemplates,
  checkGraphShape,
  validateSkeleton,
  mergeDetail,
  collectNonHandsOn,
  attachUnattended,
  mergeDecomposition,
  heuristicDecompose,
} from "./recipes.js";

const skeletonNode = (id, overrides = {}) => ({
  id,
  label: id,
  phase: "cook",
  depends_on: [],
  is_shareable: false,
  share_key: "",
  ...overrides,
});

const detailStep = (step_id, overrides = {}) => ({
  step_id,
  description: "do it",
  estimated_duration_sec: 60,
  difficulty: "low",
  required_equipment: [],
  required_materials: [],
  material_usage: [],
  tending: "hands_on",
  ...overrides,
});

test("checkGraphShape catches duplicate ids, dangling deps and cycles", () => {
  assert.equal(checkGraphShape([{ id: "a", depends_on: [] }, { id: "a", depends_on: [] }]), "has duplicate step ids");
  assert.match(checkGraphShape([{ id: "a", depends_on: ["ghost"] }]), /does not exist/);
  assert.equal(checkGraphShape([{ id: "a", depends_on: ["b"] }, { id: "b", depends_on: ["a"] }]), "has a circular dependency");
  assert.equal(checkGraphShape([{ id: "a", depends_on: [] }, { id: "b", depends_on: ["a"] }]), null);
});

test("validateSkeleton rejects the wrong dish count and a malformed skeleton", () => {
  const skeleton = { recipes: [{ title: "Congee", dish_idea_raw: "congee", servings: 2, nodes: [skeletonNode("simmer")] }] };
  assert.match(validateSkeleton(skeleton, 2), /expected 2 dish\(es\), got 1/);
  assert.equal(validateSkeleton(skeleton, 1), null);
  assert.match(validateSkeleton({ recipes: [{ title: "", dish_idea_raw: "x", servings: 1, nodes: [] }] }, 1), /no steps|no title/);
});

test("mergeDetail folds detail onto the skeleton by step_id and flags a missing one", () => {
  const skeleton = { recipes: [{ title: "Congee", dish_idea_raw: "congee", servings: 2, nodes: [skeletonNode("simmer"), skeletonNode("plate")] }] };
  const good = mergeDetail(skeleton, { materials: [], steps: [detailStep("simmer"), detailStep("plate")] });
  assert.equal(good.problem, null);
  assert.equal(good.plan.recipes[0].nodes[0].description, "do it");

  const missing = mergeDetail(skeleton, { materials: [], steps: [detailStep("simmer")] });
  assert.match(missing.problem, /"plate" was never detailed/);
});

test("collectNonHandsOn only pulls steps that are not hands_on", () => {
  const plan = {
    recipes: [
      {
        nodes: [
          { id: "chop", tending: "hands_on" },
          { id: "simmer", tending: "tended", label: "Simmer", description: "d", estimated_duration_sec: 2400, difficulty: "low" },
        ],
      },
    ],
  };
  const out = collectNonHandsOn(plan);
  assert.equal(out.length, 1);
  assert.equal(out[0].step_id, "simmer");
});

test("attachUnattended derives an EVEN checkpoint interval from the step's own duration", () => {
  const node = { id: "simmer", tending: "tended", estimated_duration_sec: 2400, difficulty: "low" }; // 40 min
  const dec = {
    step_id: "simmer",
    initial_duration_sec: 60,
    initial_difficulty: "low",
    checkpoint_count: 8,
    checkpoint_duration_sec: 10,
    checkpoint_difficulty: "low",
    ending_duration_sec: 30,
    ending_difficulty: "low",
  };
  const out = attachUnattended(node, dec);
  assert.equal(out.unattended.initial.duration_sec, 60);
  assert.equal(out.unattended.checkpoints.count, 8);
  // (2400 - 60 - 30) / 8 = 288.75 -> 289
  assert.equal(out.unattended.checkpoints.interval_sec, 289);
  assert.equal(out.unattended.ending.duration_sec, 30);
});

test("attachUnattended gives timed steps an ending but never checkpoints", () => {
  const node = { id: "ice_bath", tending: "timed", estimated_duration_sec: 480, difficulty: "low" };
  const dec = {
    step_id: "ice_bath",
    initial_duration_sec: 30,
    initial_difficulty: "low",
    checkpoint_count: 0,
    checkpoint_duration_sec: 0,
    checkpoint_difficulty: "low",
    ending_duration_sec: 20,
    ending_difficulty: "medium",
  };
  const out = attachUnattended(node, dec);
  assert.equal(out.unattended.checkpoints, null);
  assert.deepEqual(out.unattended.ending, { duration_sec: 20, difficulty: "medium" });
});

test("attachUnattended gives set_and_forget steps neither checkpoints nor an ending", () => {
  const node = { id: "soak_rice", tending: "set_and_forget", estimated_duration_sec: 1800, difficulty: "low" };
  const dec = {
    step_id: "soak_rice",
    initial_duration_sec: 45,
    initial_difficulty: "low",
    checkpoint_count: 0,
    checkpoint_duration_sec: 0,
    checkpoint_difficulty: "low",
    ending_duration_sec: 0,
    ending_difficulty: "low",
  };
  const out = attachUnattended(node, dec);
  assert.equal(out.unattended.checkpoints, null);
  assert.equal(out.unattended.ending, null);
});

test("attachUnattended demotes to hands_on when the derived checkpoint gap is under the 2-minute floor", () => {
  const node = { id: "add_chicken", tending: "tended", estimated_duration_sec: 60, difficulty: "medium" };
  const dec = {
    step_id: "add_chicken",
    initial_duration_sec: 20, initial_difficulty: "medium",
    checkpoint_count: 1, checkpoint_duration_sec: 5, checkpoint_difficulty: "low",
    ending_duration_sec: 20, ending_difficulty: "medium",
  };
  const out = attachUnattended(node, dec);
  assert.equal(out.tending, "hands_on");
  assert.equal(out.unattended, undefined);
});

test("heuristicDecompose demotes to hands_on when the derived checkpoint gap is under the 2-minute floor", () => {
  const out = heuristicDecompose({ id: "add_chicken", tending: "tended", estimated_duration_sec: 60, difficulty: "medium" });
  assert.equal(out.tending, "hands_on");
  assert.equal(out.unattended, undefined);
});

test("mergeDecomposition only touches non-hands_on nodes", () => {
  const plan = {
    recipes: [
      {
        nodes: [
          { id: "chop", tending: "hands_on" },
          { id: "simmer", tending: "tended", estimated_duration_sec: 600, difficulty: "low" },
        ],
      },
    ],
  };
  const decomposition = {
    steps: [
      { step_id: "simmer", initial_duration_sec: 30, initial_difficulty: "low", checkpoint_count: 3, checkpoint_duration_sec: 10, checkpoint_difficulty: "low", ending_duration_sec: 20, ending_difficulty: "low" },
    ],
  };
  const out = mergeDecomposition(plan, decomposition);
  assert.equal(out.recipes[0].nodes[0].unattended, undefined);
  assert.ok(out.recipes[0].nodes[1].unattended);
});

test("heuristicDecompose (the fallback stand-in) never leaves a non-hands_on step undecomposed", () => {
  for (const tending of ["tended", "timed", "set_and_forget"]) {
    const node = heuristicDecompose({ id: "x", tending, estimated_duration_sec: 1200, difficulty: "medium" });
    assert.ok(node.unattended.initial.duration_sec > 0);
    if (tending === "tended") {
      assert.ok(node.unattended.checkpoints.count >= 1);
      assert.ok(node.unattended.checkpoints.interval_sec >= 1);
      assert.ok(node.unattended.ending.duration_sec > 0);
    } else if (tending === "timed") {
      assert.equal(node.unattended.checkpoints, null);
      assert.ok(node.unattended.ending.duration_sec > 0);
    } else {
      assert.equal(node.unattended.checkpoints, null);
      assert.equal(node.unattended.ending, null);
    }
  }
  assert.equal(heuristicDecompose({ id: "chop", tending: "hands_on" }).unattended, undefined);
});

test("validate() rejects a tended step that skipped decomposition", () => {
  const plan = {
    materials: [],
    recipes: [{
      title: "Congee",
      nodes: [{
        id: "simmer", label: "Simmer", description: "d", estimated_duration_sec: 2400, difficulty: "low",
        phase: "cook", depends_on: [], required_equipment: [], required_materials: [], tending: "tended",
      }],
    }],
  };
  assert.match(validate(plan), /never decomposed/);
});

test("validate() rejects checkpoints on a step that should not have them", () => {
  const base = {
    id: "chill", label: "Chill", description: "d", estimated_duration_sec: 1200, difficulty: "low",
    phase: "cook", depends_on: [], required_equipment: [], required_materials: [],
  };
  const badTimed = { ...base, tending: "timed", unattended: { initial: { duration_sec: 30, difficulty: "low" }, checkpoints: { count: 2, interval_sec: 60, duration_sec: 5, difficulty: "low" }, ending: { duration_sec: 20, difficulty: "low" } } };
  assert.match(validate({ materials: [], recipes: [{ title: "T", nodes: [badTimed] }] }), /has checkpoints/);

  const badSetAndForget = { ...base, tending: "set_and_forget", unattended: { initial: { duration_sec: 30, difficulty: "low" }, checkpoints: null, ending: { duration_sec: 20, difficulty: "low" } } };
  assert.match(validate({ materials: [], recipes: [{ title: "T", nodes: [badSetAndForget] }] }), /has an ending moment/);
});

test("validate() rejects a hands_on step that was decomposed anyway", () => {
  const node = {
    id: "chop", label: "Chop", description: "d", estimated_duration_sec: 60, difficulty: "low",
    phase: "prep", depends_on: [], required_equipment: [], required_materials: [], tending: "hands_on",
    unattended: { initial: { duration_sec: 10, difficulty: "low" }, checkpoints: null, ending: null },
  };
  assert.match(validate({ materials: [], recipes: [{ title: "T", nodes: [node] }] }), /was decomposed anyway/);
});

test("validate() accepts a fully-decomposed tended/timed/set_and_forget plan", () => {
  const tended = heuristicDecompose({ id: "simmer", label: "Simmer congee", description: "d", estimated_duration_sec: 2400, difficulty: "low", phase: "cook", depends_on: [], required_equipment: [], required_materials: [], tending: "tended" });
  const timed = heuristicDecompose({ id: "ice_bath", label: "Ice bath", description: "d", estimated_duration_sec: 480, difficulty: "low", phase: "cook", depends_on: [], required_equipment: [], required_materials: [], tending: "timed" });
  const forget = heuristicDecompose({ id: "soak", label: "Soak rice", description: "d", estimated_duration_sec: 1800, difficulty: "low", phase: "prep", depends_on: [], required_equipment: [], required_materials: [], tending: "set_and_forget" });
  const plan = { materials: [], recipes: [{ title: "Congee", nodes: [tended, timed, forget] }] };
  assert.equal(validate(plan), null);
});

test("toTemplates carries the unattended breakdown through and drops it when absent", () => {
  const tended = heuristicDecompose({ id: "simmer", label: "Simmer", description: "d", estimated_duration_sec: 2400, difficulty: "low", phase: "cook", depends_on: [], required_equipment: [], required_materials: [], tending: "tended" });
  const chop = { id: "chop", label: "Chop", description: "d", estimated_duration_sec: 60, difficulty: "low", phase: "prep", depends_on: [], required_equipment: [], required_materials: [], material_usage: [], tending: "hands_on" };
  const plan = { materials: [], recipes: [{ title: "Congee", dish_idea_raw: "congee", servings: 2, nodes: [tended, chop] }] };
  const [template] = toTemplates(plan, { diet: "none", dishes: ["congee"] });
  assert.ok(template.nodes[0].unattended);
  // estimated_duration_sec is the untouched wall-clock total from the detail pass —
  // inventory.js and the scheduler read this and only this.
  assert.equal(template.nodes[0].estimated_duration_sec, 2400);
  assert.equal("unattended" in template.nodes[1], false);
});
