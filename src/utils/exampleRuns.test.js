// The example runs pinned to Home (src/data/exampleRuns.json) are
// generated, not hand-written. These check they still say what the app
// would say about them, so a hand edit or a stale regenerate shows up.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runOutcome } from "./liveCook.js";
import { allWorkingNodes } from "./runStats.js";

const read = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8"));
const sessions = read("exampleRuns.json");
const rows = read("exampleRunRows.json");
const byId = Object.fromEntries(sessions.map((s) => [s.id, s]));

test("one co-op chicken noodle soup and one versus mapo tofu with rice, both for two", () => {
  const soup = byId["example-coop-chicken-noodle-soup"];
  const mapo = byId["example-versus-mapo-tofu-rice"];
  assert.equal(soup.mode, "cooperation");
  assert.equal(soup.summary.dish, "Chicken Noodle Soup");
  assert.equal(mapo.mode, "competition");
  assert.equal(mapo.summary.dish, "Mapo Tofu + Steamed Rice");
  for (const s of sessions) {
    assert.equal(s.status, "completed");
    assert.equal(s.conversation.answers.servings, "2");
    assert.ok(s.recipes.every((r) => r.working.servings === 2), s.id);
    assert.equal(s.cooks.length, 2);
  }
});

test("the kitchen is two burners, two boards, two pots, and the cook never used more", () => {
  const caps = { stove_burner: "burners", cutting_board: "cuttingBoards", pot: "pots" };
  for (const s of sessions) {
    assert.deepEqual([s.kitchenProfile.burners, s.kitchenProfile.cuttingBoards, s.kitchenProfile.pots], [2, 2, 2]);
    const nodes = Object.fromEntries(allWorkingNodes(s).map((n) => [n.id, n]));
    const inUse = new Set();
    for (const event of s.run.events) {
      if (event.type === "start") inUse.add(event.stepId);
      if (event.type === "done") inUse.delete(event.stepId);
      for (const [equipment, field] of Object.entries(caps)) {
        const count = [...inUse].filter((id) => nodes[id].required_equipment.includes(equipment)).length;
        assert.ok(count <= s.kitchenProfile[field], `${s.id}: ${count} ${equipment} at ${event.at}`);
      }
    }
  }
});

test("every step was cooked, and the card agrees with the run", () => {
  for (const s of sessions) {
    const nodes = allWorkingNodes(s);
    assert.ok(nodes.every((n) => s.run.steps[n.id].status === "done"), s.id);
    const outcome = runOutcome(s.run, nodes, s.cooks);
    assert.equal(s.summary.totalSec, outcome.totalSec);
    assert.deepEqual(
      s.summary.cooks.map((c) => [c.name, c.points, c.doneCount]),
      outcome.scoreboard.map((b) => [b.name, b.points, b.doneCount]),
    );
    // A card on Home has something of theirs on it, not only numbers.
    assert.ok(s.summary.cooks.every((c) => c.quote), s.id);
  }
  // Co-op is not a contest, even when one cook did more of it.
  assert.doesNotMatch(byId["example-coop-chicken-noodle-soup"].summary.headline, /points|ran away|took it by|Dead heat/);
});

test("Home's rows are the same runs", () => {
  assert.deepEqual(
    rows.map((r) => [r.id, r.dish, r.servings, r.run.startedAt, r.run.endedAt]),
    sessions.map((s) => [s.id, s.summary.dish, 2, s.run.startedAt, s.run.endedAt]),
  );
});
