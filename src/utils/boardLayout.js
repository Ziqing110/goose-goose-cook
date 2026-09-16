// Geometry for the recipe board: where cards sit so they never overlap,
// and how an edge gets from one to another without disappearing under a
// third. Pure functions on plain boxes — no DOM — so the board can lay
// itself out without measuring first.
import { layoutLevels } from "./graphLayout.js";

// Cards are a fixed size. Variable height was what made the board
// unreadable: the auto-layout couldn't know how tall a row was, so long
// labels overlapped their neighbours before anyone dragged anything.
export const CARD_W = 200;
export const CARD_H = 84;
export const COL_GAP = 104;
export const ROW_GAP = 26;
export const PAD = 20;
const CLEAR = 10; // breathing room kept between cards when one is nudged
const LANE = 16; // how far an edge detours clear of a card it would cross

export const boxOf = (pos) => ({ x: pos.x, y: pos.y, w: CARD_W, h: CARD_H });

export function overlaps(a, b, pad = 0) {
  return (
    a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y
  );
}

/** Dependency-depth layout: one column per depth, no two cards touching. */
export function autoPositions(nodes) {
  const out = {};
  layoutLevels(nodes).forEach((level, col) => {
    level.forEach((node, row) => {
      out[node.id] = { x: PAD + col * (CARD_W + COL_GAP), y: PAD + row * (CARD_H + ROW_GAP) };
    });
  });
  return out;
}

/**
 * Where a card actually lands when dropped at `wanted`. If that spot is
 * free it stays put; otherwise it takes the shortest push that clears
 * every other card — so a drop is predictable (it goes roughly where you
 * aimed) rather than springing somewhere else entirely.
 */
export function settle(wanted, others) {
  let box = boxOf(wanted);
  for (let guard = 0; guard < 60; guard += 1) {
    const hit = others.find((o) => overlaps(box, o, CLEAR));
    if (!hit) return { x: Math.max(0, box.x), y: Math.max(0, box.y) };
    // Four ways out; take the cheapest that isn't off the top or left.
    const moves = [
      { x: hit.x + hit.w + CLEAR, y: box.y },
      { x: hit.x - CARD_W - CLEAR, y: box.y },
      { x: box.x, y: hit.y + hit.h + CLEAR },
      { x: box.x, y: hit.y - CARD_H - CLEAR },
    ]
      .filter((m) => m.x >= 0 && m.y >= 0)
      .sort(
        (a, b) =>
          Math.hypot(a.x - wanted.x, a.y - wanted.y) - Math.hypot(b.x - wanted.x, b.y - wanted.y)
      );
    if (moves.length === 0) return { x: Math.max(0, box.x), y: Math.max(0, box.y + hit.h + CLEAR) };
    box = boxOf(moves[0]);
  }
  return { x: Math.max(0, box.x), y: Math.max(0, box.y) };
}

/**
 * The positions the board actually renders. Stored positions are not
 * trusted: they can predate the no-overlap rule, or come from another
 * device, and a card hidden under another is the exact failure the
 * board exists to prevent. Each card is placed in turn and settled
 * against the ones already down. Render-time only — nothing is written
 * back, so a cook's own placement is never quietly rewritten on disk.
 */
export function resolvePositions(nodes, stored, auto) {
  const placed = [];
  const out = {};
  nodes.forEach((n) => {
    const wanted = stored[n.id] || auto[n.id] || { x: PAD, y: PAD };
    const at = settle(wanted, placed);
    out[n.id] = at;
    placed.push({ id: n.id, ...boxOf(at) });
  });
  return out;
}

/** Does the segment a->b pass through rect r? (Liang–Barsky clip.) */
export function segmentHitsRect(a, b, r) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges = [
    { p: -dx, q: a.x - r.x },
    { p: dx, q: r.x + r.w - a.x },
    { p: -dy, q: a.y - r.y },
    { p: dy, q: r.y + r.h - a.y },
  ];
  for (const { p, q } of edges) {
    if (p === 0) {
      if (q < 0) return false; // parallel and outside
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

/**
 * An SVG path from the right edge of `from` to the left edge of `to`.
 * If the direct run would cross any other card, it detours above or
 * below the cards in the way — whichever is the shorter deviation — so
 * the line stays visible instead of vanishing under a card.
 */
export function edgePath(from, to, obstacles) {
  const start = { x: from.x + CARD_W, y: from.y + CARD_H / 2 };
  const end = { x: to.x, y: to.y + CARD_H / 2 };
  const blockers = obstacles.filter((o) => segmentHitsRect(start, end, o));

  if (blockers.length === 0) {
    const mid = (start.x + end.x) / 2;
    return `M ${start.x} ${start.y} C ${mid} ${start.y}, ${mid} ${end.y}, ${end.x} ${end.y}`;
  }

  const above = Math.min(...blockers.map((o) => o.y)) - LANE;
  const below = Math.max(...blockers.map((o) => o.y + o.h)) + LANE;
  const viaY =
    Math.abs(above - (start.y + end.y) / 2) <= Math.abs(below - (start.y + end.y) / 2) ? above : below;
  const x1 = start.x + Math.max(24, (end.x - start.x) * 0.25);
  const x2 = end.x - Math.max(24, (end.x - start.x) * 0.25);
  return [
    `M ${start.x} ${start.y}`,
    `C ${x1} ${start.y}, ${x1} ${viaY}, ${(x1 + x2) / 2} ${viaY}`,
    `C ${x2} ${viaY}, ${x2} ${end.y}, ${end.x} ${end.y}`,
  ].join(" ");
}
