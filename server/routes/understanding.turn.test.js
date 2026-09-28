// /turn's guard rails: what the model says is checked before the page sees it.
import test from "node:test";
import assert from "node:assert/strict";
import { coerceTurn } from "./understanding.js";

const slots = (answers = {}) =>
  ["dishIdea", "servings", "diet", "skill", "targetTime"].map((id) => ({
    id,
    question: `Q ${id}?`,
    answer: answers[id] || "",
  }));

test("a dish changed after servings is an update, and the chat stays where it was", () => {
  const t = coerceTurn(
    {
      updates: [{ slot: "dishIdea", value: "", dishes: ["Kung pao chicken"], display: "Kung pao chicken", status: "confirmed" }],
      focus: "diet",
      done: false,
      reply: "Kung pao it is. Any dietary needs?",
    },
    { slots: slots({ dishIdea: "Chicken stir fry", servings: "4 servings" }), focus: "diet", said: "actually make it kung pao" },
  );
  assert.deepEqual(t.updates, [{ slot: "dishIdea", value: ["Kung pao chicken"], display: "Kung pao chicken", status: "confirmed" }]);
  assert.equal(t.focus, "diet");
  assert.equal(t.done, false);
});

test("an update that isn't a value is dropped, not stored", () => {
  const t = coerceTurn(
    { updates: [{ slot: "servings", value: "a few", dishes: [], display: "A few", status: "confirmed" }, { slot: "nope", value: "1", dishes: [], display: "", status: "confirmed" }], focus: "servings", done: false, reply: "How many exactly?" },
    { slots: slots({ dishIdea: "Ramen" }), focus: "servings", said: "a few" },
  );
  assert.deepEqual(t.updates, []);
  assert.equal(t.focus, "servings");
});

test("done with a slot still empty goes to that slot, with its own question", () => {
  const t = coerceTurn(
    { updates: [], focus: "targetTime", done: true, reply: "Drafting now!" },
    { slots: slots({ dishIdea: "Ramen", servings: "2", diet: "None", skill: "Normal detail" }), focus: "skill", said: "that's all" },
  );
  assert.equal(t.done, false);
  assert.equal(t.focus, "targetTime");
  assert.equal(t.reply, "Q targetTime?");
});

test("done once the last slot is filled", () => {
  const t = coerceTurn(
    { updates: [{ slot: "targetTime", value: "45", dishes: [], display: "45 minutes", status: "confirmed" }], focus: "", done: true, reply: "" },
    { slots: slots({ dishIdea: "Ramen", servings: "2", diet: "None", skill: "Normal detail" }), focus: "targetTime", said: "45 minutes" },
  );
  assert.equal(t.done, true);
  assert.equal(t.focus, null);
  assert.match(t.reply, /drafting/);
});

test("an unknown focus keeps the one it had", () => {
  const t = coerceTurn({ updates: [], focus: "dessert", done: false, reply: "Hmm?" }, { slots: slots(), focus: "dishIdea", said: "hmm" });
  assert.equal(t.focus, "dishIdea");
});
