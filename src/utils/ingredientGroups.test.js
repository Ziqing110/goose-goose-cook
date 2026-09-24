import test from "node:test";
import assert from "node:assert/strict";
import { groupStepsByDish, dishPaper, SHARED_PAPER, DISH_PAPERS } from "./ingredientGroups.js";

const dishes = ["Mapo Tofu", "Chicken Noodle Soup"];
const steps = [
  { id: "1", dish: "Chicken Noodle Soup", shared: false },
  { id: "2", dish: "Mapo Tofu", shared: false },
  { id: "3", dish: null, shared: true },
  { id: "4", dish: "Mapo Tofu", shared: false },
];

test("groups follow dish order, with shared last", () => {
  const groups = groupStepsByDish(steps, dishes);
  assert.deepEqual(groups.map((g) => g.name), ["Mapo Tofu", "Chicken Noodle Soup", "Shared"]);
  assert.deepEqual(groups.map((g) => g.count), [2, 1, 1]);
});

test("each group carries its own paper", () => {
  const groups = groupStepsByDish(steps, dishes);
  assert.deepEqual(groups[0].paper, DISH_PAPERS[0]);
  assert.deepEqual(groups[1].paper, DISH_PAPERS[1]);
  assert.deepEqual(groups[2].paper, SHARED_PAPER);
});

test("one dish makes one group", () => {
  const groups = groupStepsByDish([steps[1], steps[3]], dishes);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "Mapo Tofu");
});

test("a dish the run no longer lists keeps its own group rather than joining Shared", () => {
  const groups = groupStepsByDish([...steps, { id: "5", dish: "Congee", shared: false }], dishes);
  assert.deepEqual(groups.map((g) => g.name), ["Mapo Tofu", "Chicken Noodle Soup", "Congee", "Shared"]);
});

test("shared steps sort under Shared whatever dish they name", () => {
  const groups = groupStepsByDish([{ id: "6", dish: "Mapo Tofu", shared: true }], dishes);
  assert.deepEqual(groups.map((g) => g.name), ["Shared"]);
});

test("the shared swatch is the dashed white sheet", () => {
  assert.deepEqual(dishPaper("Shared", dishes), SHARED_PAPER);
  assert.deepEqual(dishPaper(null, dishes), SHARED_PAPER);
});

test("an unknown dish still gets a stock rather than nothing", () => {
  assert.deepEqual(dishPaper("Congee", dishes), DISH_PAPERS[0]);
});

test("a run of many dishes gives each its own paper", () => {
  const many = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
  const papers = many.map((d) => dishPaper(d, many).bg);
  assert.equal(new Set(papers).size, many.length, "ten dishes, ten papers");
  // An eleventh starts the sequence again rather than running out.
  assert.equal(dishPaper("K", [...many, "K"]).bg, DISH_PAPERS[0].bg);
});

test("the papers come out in the palette's own order", () => {
  // Light, dark, light… so neighbouring dishes never look alike.
  assert.deepEqual(DISH_PAPERS.slice(0, 3).map((p) => p.bg), ["#fbf8f1", "#efdcc6", "#e9e4dc"]);
});

test("no dish is ever handed the shared sheet", () => {
  const many = ["A", "B", "C", "D", "E", "F", "G", "H"];
  many.forEach((d) => assert.notDeepEqual(dishPaper(d, many), SHARED_PAPER));
});
