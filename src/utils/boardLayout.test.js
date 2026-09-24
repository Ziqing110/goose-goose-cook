import test from "node:test";
import assert from "node:assert/strict";
import { laneRouting, autoPositions, ROW_GAP, ROW_GAP_MAX, PAD, LEGEND_KEEPOUT } from "./boardLayout.js";

// Two sources in one column feeding one card in the next.
const boxes = {
  a: { id: "a", x: 0, y: 0, w: 100, h: 70 },
  b: { id: "b", x: 0, y: 100, w: 100, h: 70 },
  c: { id: "c", x: 200, y: 40, w: 100, h: 70 },
};
const nodes = [
  { id: "a", depends_on: [] },
  { id: "b", depends_on: [] },
  { id: "c", depends_on: ["a", "b"] },
];

test("every edge gets its own exit, landing and lane", () => {
  const lanes = laneRouting(nodes, boxes);
  const ac = lanes.get("a>c");
  const bc = lanes.get("b>c");
  assert.ok(ac && bc);
  // Two arrows into one card land at two different heights.
  assert.notEqual(ac.ey, bc.ey);
  // And run down two different verticals.
  assert.notEqual(ac.tx, bc.tx);
});

test("landings are inside the card's left edge, not on its corners", () => {
  const { ey } = laneRouting(nodes, boxes).get("a>c");
  assert.ok(ey > boxes.c.y, "not above the card");
  assert.ok(ey < boxes.c.y + boxes.c.h, "not below the card");
});

test("lanes sit in the gap in front of the column, never inside the card", () => {
  const lanes = laneRouting(nodes, boxes);
  [...lanes.values()].forEach((port) => {
    assert.ok(port.tx < boxes.c.x, "a lane inside the card would double back");
    assert.ok(port.tx > boxes.a.x + boxes.a.w - 30, "and it should stay in the gap");
  });
});

test("a card with one arrow out leaves from one point", () => {
  const single = laneRouting([{ id: "c", depends_on: ["a"] }], boxes);
  const port = single.get("a>c");
  assert.equal(port.ex, boxes.a.x + boxes.a.w + 8);
});

test("nothing is routed for an edge whose ends are not on the board", () => {
  const lanes = laneRouting([{ id: "c", depends_on: ["ghost"] }], boxes);
  assert.equal(lanes.size, 0);
});

// One column of four, so the spread has something to open up.
const column = [
  { id: "p", depends_on: [] },
  { id: "q", depends_on: [] },
  { id: "r", depends_on: [] },
  { id: "s", depends_on: [] },
];
const size = () => ({ w: 168, h: 72 });
const gapBetween = (pos, a, b) => pos[b].y - pos[a].y - 72;

test("with no height given, the layout packs at the default gap", () => {
  const pos = autoPositions(column, size, 0);
  assert.equal(gapBetween(pos, "p", "q"), ROW_GAP);
});

test("a board taller than the cards need opens the gaps to fill it", () => {
  const pos = autoPositions(column, size, 0, 600);
  const gap = gapBetween(pos, "p", "q");
  assert.ok(gap > ROW_GAP, `expected more than ${ROW_GAP}, got ${gap}`);
  // Every gap in the column is the same one.
  assert.equal(gapBetween(pos, "q", "r"), gap);
  assert.equal(gapBetween(pos, "r", "s"), gap);
  // And the run still starts under the legend, not floating mid-board.
  assert.equal(pos.p.y, PAD + LEGEND_KEEPOUT);
});

test("a board with room to spare still stops at the cap", () => {
  const pos = autoPositions(column, size, 0, 4000);
  assert.equal(gapBetween(pos, "p", "q"), ROW_GAP_MAX);
});

test("a board smaller than the cards need keeps the default gap", () => {
  const pos = autoPositions(column, size, 0, 120);
  assert.equal(gapBetween(pos, "p", "q"), ROW_GAP);
});
