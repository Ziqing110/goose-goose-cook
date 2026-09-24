import test from "node:test";
import assert from "node:assert/strict";
import { stepMaterialAmount, materialTotal, stepsUsing } from "./materialAmounts.js";

const info = { garlic: { amount: 5, unit: "cloves" }, stock: { amount: 200, unit: "ml" } };

test("a recorded amount is used as it stands", () => {
  const node = { id: "a", required_materials: ["stock"], material_usage: { stock: { amount: 150, unit: "ml" } } };
  assert.deepEqual(stepMaterialAmount([node], node, "stock", info), { amount: 150, unit: "ml" });
});

test("with nothing recorded, the total splits evenly across the steps that use it", () => {
  const nodes = [
    { id: "a", required_materials: ["stock"] },
    { id: "b", required_materials: ["stock"] },
  ];
  assert.deepEqual(stepMaterialAmount(nodes, nodes[0], "stock", info), { amount: 100, unit: "ml" });
});

test("a shared step buys the sum of what each dish needs", () => {
  const node = {
    id: "mince_garlic",
    required_materials: ["garlic"],
    usage_breakdown: [
      { title: "Mapo Tofu", material_usage: { garlic: { amount: 3, unit: "cloves" } } },
      { title: "Chicken Noodle Soup", material_usage: { garlic: { amount: 2, unit: "cloves" } } },
    ],
  };
  assert.deepEqual(stepMaterialAmount([node], node, "garlic", info), { amount: 5, unit: "cloves" });
});

test("the total is the sum of the steps", () => {
  const nodes = [
    { id: "a", required_materials: ["stock"], material_usage: { stock: { amount: 120, unit: "ml" } } },
    { id: "b", required_materials: ["stock"], material_usage: { stock: { amount: 80, unit: "ml" } } },
  ];
  assert.deepEqual(materialTotal(nodes, "stock", info), { amount: 200, unit: "ml" });
});

test("a plan nobody has touched still totals what the material says", () => {
  const nodes = [
    { id: "a", required_materials: ["stock"] },
    { id: "b", required_materials: ["stock"] },
    { id: "c", required_materials: ["stock"] },
  ];
  assert.equal(materialTotal(nodes, "stock", info).amount, 200);
});

test("editing one step moves the total", () => {
  const nodes = [
    { id: "a", required_materials: ["stock"], material_usage: { stock: { amount: 500, unit: "ml" } } },
    { id: "b", required_materials: ["stock"] },
  ];
  // The untouched step still contributes its even share of the original.
  assert.equal(materialTotal(nodes, "stock", info).amount, 600);
});

test("a material no step uses keeps its own amount", () => {
  assert.deepEqual(materialTotal([], "garlic", info), { amount: 5, unit: "cloves" });
  assert.deepEqual(stepsUsing([], "garlic"), []);
});

test("an unknown material is not invented", () => {
  const node = { id: "a", required_materials: ["mystery"] };
  assert.deepEqual(stepMaterialAmount([node], node, "mystery", info), { amount: null, unit: "" });
  assert.equal(materialTotal([node], "mystery", info).amount, null);
});
