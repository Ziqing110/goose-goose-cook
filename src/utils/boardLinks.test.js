import test from "node:test";
import assert from "node:assert/strict";
import { linkRejection, childrenOf, eligibleParents, eligibleChildren } from "./boardLinks.js";

// a -> b -> c, plus a loose step d.
const nodes = [
  { id: "a", depends_on: [] },
  { id: "b", depends_on: ["a"] },
  { id: "c", depends_on: ["b"] },
  { id: "d", depends_on: [] },
];

test("a link nothing forbids is allowed", () => {
  assert.equal(linkRejection(nodes, "d", "b"), null);
  assert.equal(linkRejection(nodes, "a", "c"), null);
});

test("a step can't wait on itself", () => {
  assert.match(linkRejection(nodes, "b", "b"), /itself/);
});

test("an existing link is not drawn twice", () => {
  assert.equal(linkRejection(nodes, "a", "b"), "Already linked");
});

test("a link back up the chain would make a loop", () => {
  assert.match(linkRejection(nodes, "c", "a"), /loop/);
  // Straight back the way it came counts too.
  assert.match(linkRejection(nodes, "b", "a"), /loop/);
});

test("children are the steps waiting on this one", () => {
  assert.deepEqual(childrenOf(nodes, "a"), ["b"]);
  assert.deepEqual(childrenOf(nodes, "c"), []);
});

test("eligible parents exclude self, current links and anything downstream", () => {
  const ids = eligibleParents(nodes, "b", { deps: ["a"], children: ["c"] }).map((n) => n.id);
  assert.deepEqual(ids, ["d"]);
});

test("eligible children exclude anything upstream", () => {
  const ids = eligibleChildren(nodes, "b", { deps: ["a"], children: ["c"] }).map((n) => n.id);
  assert.deepEqual(ids, ["d"]);
});

test("a step with no links can go either side of anything else", () => {
  assert.deepEqual(eligibleParents(nodes, "d").map((n) => n.id), ["a", "b", "c"]);
  assert.deepEqual(eligibleChildren(nodes, "d").map((n) => n.id), ["a", "b", "c"]);
});
