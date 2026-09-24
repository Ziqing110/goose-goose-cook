// The route guards and what voice navigation may reach. These used to be
// two separate calculations, and every test here that pairs a guard with
// voice reachability is a case where they disagreed.
import test from "node:test";
import assert from "node:assert/strict";
import { guardRedirect, ROUTES, voiceReachablePaths } from "./routeGuards.js";

const approvedRecipe = { id: "r1", approved: true };
const boundCooks = [
  { id: "cook-a", name: "Mia", bound: true },
  { id: "cook-b", name: "Leo", bound: true },
];

// A session at each stage, built up the way a real one is.
const stages = {
  conversation: { kitchenProfileId: "k1", conversation: { complete: false }, recipes: [], cooks: [] },
  inventory: { kitchenProfileId: "k1", conversation: { complete: true }, recipes: [{ id: "r1", approved: false }], cooks: [] },
  voiceBinding: { kitchenProfileId: "k1", conversation: { complete: true }, recipes: [approvedRecipe], cooks: [] },
  schedule: { kitchenProfileId: "k1", conversation: { complete: true }, recipes: [approvedRecipe], cooks: boundCooks },
  modePicked: {
    kitchenProfileId: "k1",
    conversation: { complete: true },
    recipes: [approvedRecipe],
    cooks: boundCooks,
    mode: "cooperation",
  },
  live: {
    kitchenProfileId: "k1",
    conversation: { complete: true },
    recipes: [approvedRecipe],
    cooks: boundCooks,
    mode: "cooperation",
    run: { startedAt: "2026-09-24T18:00:00Z" },
  },
};
const withSession = (session, kitchenProfiles = [{ id: "k1" }]) => ({ session, kitchenProfiles });

test("guards: home is always allowed, even without a session", () => {
  assert.equal(guardRedirect(ROUTES.home, withSession(null)), null);
});

test("guards: every session page sends you home without a session", () => {
  for (const path of Object.values(ROUTES).filter((p) => p !== ROUTES.home)) {
    assert.equal(guardRedirect(path, withSession(null)), ROUTES.home, path);
  }
});

test("guards: each stage sends you back to the first unfinished one", () => {
  const s = withSession(stages.conversation);
  assert.equal(guardRedirect(ROUTES.conversation, s), null);
  assert.equal(guardRedirect(ROUTES.inventory, s), ROUTES.conversation);
  assert.equal(guardRedirect(ROUTES.liveCook, s), ROUTES.conversation);

  assert.equal(guardRedirect(ROUTES.schedule, withSession(stages.inventory)), ROUTES.inventory);
  assert.equal(guardRedirect(ROUTES.schedule, withSession(stages.voiceBinding)), ROUTES.voiceBinding);
  assert.equal(guardRedirect(ROUTES.liveCook, withSession(stages.schedule)), ROUTES.schedule);
  assert.equal(guardRedirect(ROUTES.liveCook, withSession(stages.modePicked)), null);
});

test("guards: a deleted kitchen sends you to the picker, or home when there is nothing to pick", () => {
  const orphan = { ...stages.schedule, kitchenProfileId: null };
  assert.equal(guardRedirect(ROUTES.schedule, withSession(orphan)), ROUTES.kitchenSetup);
  assert.equal(guardRedirect(ROUTES.schedule, withSession(orphan, [])), ROUTES.home);
  assert.equal(guardRedirect(ROUTES.kitchenSetup, withSession(orphan)), null);
});

test("guards: a session without conversation or recipe fields does not throw", () => {
  const bare = { kitchenProfileId: "k1" };
  assert.equal(guardRedirect(ROUTES.inventory, withSession(bare)), ROUTES.conversation);
});

test("reachable: no session means only home", () => {
  assert.deepEqual(voiceReachablePaths(withSession(null)), [ROUTES.home]);
});

test("reachable: finished stages and the current one, nothing later", () => {
  assert.deepEqual(voiceReachablePaths(withSession(stages.inventory)), [ROUTES.home, ROUTES.conversation, ROUTES.inventory]);
});

test("reachable: revising the board after binding cooks closes every later page", () => {
  // The progress chrome still shows Cooks as done here (a stage counts as
  // done once anything after it is). The guard does not let you in, so
  // voice must not offer it either.
  const revised = { ...stages.schedule, recipes: [{ id: "r1", approved: false }] };
  const reachable = voiceReachablePaths(withSession(revised));
  assert.ok(reachable.includes(ROUTES.inventory));
  assert.ok(!reachable.includes(ROUTES.voiceBinding));
  assert.ok(!reachable.includes(ROUTES.schedule));
});

test("reachable: live cook needs a run, not just a mode", () => {
  assert.ok(!voiceReachablePaths(withSession(stages.modePicked)).includes(ROUTES.liveCook));
  assert.ok(voiceReachablePaths(withSession(stages.live)).includes(ROUTES.liveCook));
});

test("reachable: kitchen setup only while the kitchen is missing", () => {
  assert.ok(!voiceReachablePaths(withSession(stages.live)).includes(ROUTES.kitchenSetup));
  const orphan = { ...stages.schedule, kitchenProfileId: null };
  assert.deepEqual(voiceReachablePaths(withSession(orphan)), [ROUTES.home, ROUTES.kitchenSetup]);
});

test("reachable: every reachable page is one the guard lets you stay on", () => {
  for (const session of [null, ...Object.values(stages)]) {
    const state = withSession(session);
    for (const path of voiceReachablePaths(state)) {
      assert.equal(guardRedirect(path, state), null, `${path} with ${JSON.stringify(session)}`);
    }
  }
});
