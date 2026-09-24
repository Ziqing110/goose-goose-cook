import test from "node:test";
import assert from "node:assert/strict";
import { coverageNarration } from "./coverageNarration.js";

test("a full basket gets the seal and the clean stamp", () => {
  const n = coverageNarration({ total: 18, blockedCount: 0, atRiskCount: 0, outLabels: [] });
  assert.equal(n.summary, "Full inventory, every step is craftable");
  assert.equal(n.stampLabel, "LOOKING GOOD");
  assert.equal(n.showSeal, true);
  assert.match(n.gooseLine, /Full basket/);
});

test("something missing but nothing broken is a pantry check, not a seal", () => {
  const n = coverageNarration({ total: 18, blockedCount: 0, atRiskCount: 0, outLabels: ["Parsley"] });
  assert.equal(n.stampLabel, "PANTRY CHECK");
  assert.equal(n.stampTone, "neutral");
  assert.equal(n.showSeal, false);
  assert.equal(n.gooseLine, "No Parsley. Nothing breaks — I've noted where it would have gone.");
});

test("steps at risk raise the stamp but keep the sentence factual", () => {
  const n = coverageNarration({ total: 18, blockedCount: 0, atRiskCount: 7, outLabels: ["Stock"] });
  assert.equal(n.summary, "7 of 18 steps at risk");
  assert.equal(n.stampTone, "warning");
  assert.equal(n.showSeal, false);
});

test("blocked steps name the count and send someone to the shop", () => {
  const n = coverageNarration({ total: 18, blockedCount: 5, atRiskCount: 7, outLabels: ["Tofu", "Garlic"] });
  assert.equal(n.summary, "Run blocked, 5 of 18 steps can't be done");
  assert.equal(n.stampLabel, "WE HAVE A PROBLEM");
  assert.equal(n.gooseLine, "Tofu and Garlic gone means 5 steps fall over. I'd send someone to the shop.");
});

test("one blocked step is singular", () => {
  const n = coverageNarration({ total: 4, blockedCount: 1, atRiskCount: 0, outLabels: ["Rice"] });
  assert.match(n.gooseLine, /1 step falls over/);
});

test("three missing things are listed, not run together", () => {
  const n = coverageNarration({ total: 9, blockedCount: 0, atRiskCount: 0, outLabels: ["Rice", "Stock", "Thyme"] });
  assert.match(n.gooseLine, /Rice, Stock and Thyme/);
});
