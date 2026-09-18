// Geometry for the recipe board: where cards sit so they never overlap,
// and how an edge gets from one to another without disappearing under a
// third. Pure functions on plain boxes — no DOM — so the board can lay
// itself out without measuring first.
import { layoutLevels } from "./graphLayout.js";

// Cards are a fixed size. Variable height was what made the board
// unreadable: the auto-layout couldn't know how tall a row was, so long
// labels overlapped their neighbours before anyone dragged anything.
export const CARD_W = 168;  /* the narrowest card, and the default */
export const CARD_H = 68;   /* a two-line card; taller ones are computed */
export const COL_GAP = 60;
export const ROW_GAP = 14;
export const PAD = 16;
const CLEAR = 10; // breathing room kept between cards when one is nudged
const LANE = 16; // how far an edge detours clear of a card it would cross

/* Card geometry, in the same units the positions use. */
export const CARD_WIDTHS = [168, 204, 240];
export const CARD_PAD_X = 12 + 10; /* left spine padding + right padding */
export const CARD_NUM_W = 16; /* the step number's corner */
export const LABEL_LINE_H = 17;
export const CARD_CHROME_H = 8 + 2 + 15 + 8; /* padding, gap, meta line, padding */
export const MAX_LABEL_LINES = 4;
/* The phase legend floats over the board's top-right corner; the last
   column keeps clear of it rather than the board reserving a margin. */
export const LEGEND_KEEPOUT = 34;

/** Greedy word wrap against a text measurer; returns the line count. */
export function wrapLines(text, maxWidth, measure) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  let lines = 1;
  let line = "";
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > maxWidth) {
      lines += 1;
      line = word;
    } else {
      line = next;
    }
  });
  return lines;
}

/**
 * The smallest card that shows a label in full: the narrowest width
 * that keeps it to two lines, then extra lines (up to four) if even the
 * widest card can't. `measure` returns the pixel width of a string in
 * the card's label font.
 */
export function cardSize(label, measure) {
  let best = null;
  for (const w of CARD_WIDTHS) {
    const lines = wrapLines(label, w - CARD_PAD_X - CARD_NUM_W, measure);
    if (!best || lines < best.lines) best = { w, lines };
    if (lines <= 2) break;
  }
  const lines = Math.min(best.lines, MAX_LABEL_LINES);
  return { w: best.w, h: Math.max(CARD_H, CARD_CHROME_H + lines * LABEL_LINE_H) };
}

/** A card's box. `size` defaults to the fixed minimum. */
export const boxOf = (pos, size) => ({
  x: pos.x,
  y: pos.y,
  w: size?.w ?? CARD_W,
  h: size?.h ?? CARD_H,
});

export function overlaps(a, b, pad = 0) {
  return (
    a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y
  );
}

/**
 * Orders each column so its edges cross as little as possible: the
 * classic barycentre sweep — a card sits opposite the average position
 * of what it connects to, repeated down and back up until it settles.
 * Ordering only; which column a card is in is its dependency depth and
 * never changes.
 */
function orderLevels(nodes) {
  const levels = layoutLevels(nodes);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const deps = (n) => (n.depends_on || []).filter((d) => byId[d]);
  const dependents = new Map(nodes.map((n) => [n.id, []]));
  nodes.forEach((n) => deps(n).forEach((d) => dependents.get(d).push(n.id)));

  const rowOf = new Map();
  const reindex = () => levels.forEach((col) => col.forEach((n, i) => rowOf.set(n.id, i)));
  reindex();

  // A card with nothing to line up against keeps where it was, so the
  // sweep can't shuffle independent chains around for no reason.
  const sortBy = (col, neighboursOf) => {
    const keyed = col.map((n, i) => {
      const ns = neighboursOf(n).map((id) => rowOf.get(id)).filter((v) => v !== undefined);
      return { n, key: ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : rowOf.get(n.id) ?? i };
    });
    keyed.sort((a, b) => a.key - b.key);
    return keyed.map((k) => k.n);
  };

  for (let pass = 0; pass < 4; pass += 1) {
    for (let c = 1; c < levels.length; c += 1) levels[c] = sortBy(levels[c], (n) => deps(n).map((d) => d));
    reindex();
    for (let c = levels.length - 2; c >= 0; c -= 1) levels[c] = sortBy(levels[c], (n) => dependents.get(n.id) || []);
    reindex();
  }
  return levels;
}

/**
 * Dependency-depth layout: one column per depth, no two cards touching.
 * Columns are ordered to minimise crossings and centred against the
 * tallest one, so edges run flat across the board instead of fanning
 * out from a top-aligned stack.
 */
export function autoPositions(nodes, sizeOf = () => ({ w: CARD_W, h: CARD_H }), keepOutRight = LEGEND_KEEPOUT) {
  const out = {};
  const levels = orderLevels(nodes);
  const colHeight = (level) =>
    level.reduce((sum, n) => sum + sizeOf(n).h, 0) + Math.max(0, level.length - 1) * ROW_GAP;
  const tallest = Math.max(0, ...levels.map(colHeight));
  let x = PAD;
  levels.forEach((level, col) => {
    const width = Math.max(CARD_W, ...level.map((n) => sizeOf(n).w));
    let y = PAD + (tallest - colHeight(level)) / 2;
    if (col === levels.length - 1 && levels.length > 1) y = Math.max(y, PAD + keepOutRight);
    level.forEach((node) => {
      // Cards in a column are centred on it, so a narrow card between
      // wide ones doesn't leave the edges kinked.
      const size = sizeOf(node);
      out[node.id] = { x: x + (width - size.w) / 2, y };
      y += size.h + ROW_GAP;
    });
    x += width + COL_GAP;
  });
  return out;
}

/**
 * Where a card actually lands when dropped at `wanted`. If that spot is
 * free it stays put; otherwise it takes the shortest push that clears
 * every other card — so a drop is predictable (it goes roughly where you
 * aimed) rather than springing somewhere else entirely.
 */
export function settle(wanted, others, size) {
  let box = boxOf(wanted, size);
  for (let guard = 0; guard < 60; guard += 1) {
    const hit = others.find((o) => overlaps(box, o, CLEAR));
    if (!hit) return { x: Math.max(0, box.x), y: Math.max(0, box.y) };
    // Four ways out; take the cheapest that isn't off the top or left.
    const moves = [
      { x: hit.x + hit.w + CLEAR, y: box.y },
      { x: hit.x - box.w - CLEAR, y: box.y },
      { x: box.x, y: hit.y + hit.h + CLEAR },
      { x: box.x, y: hit.y - box.h - CLEAR },
    ]
      .filter((m) => m.x >= 0 && m.y >= 0)
      .sort(
        (a, b) =>
          Math.hypot(a.x - wanted.x, a.y - wanted.y) - Math.hypot(b.x - wanted.x, b.y - wanted.y)
      );
    if (moves.length === 0) return { x: Math.max(0, box.x), y: Math.max(0, box.y + hit.h + CLEAR) };
    box = boxOf(moves[0], box);
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
export function resolvePositions(nodes, stored, auto, sizeOf = () => undefined) {
  const placed = [];
  const out = {};
  nodes.forEach((n) => {
    const wanted = stored[n.id] || auto[n.id] || { x: PAD, y: PAD };
    const size = sizeOf(n);
    const at = settle(wanted, placed, size);
    out[n.id] = at;
    placed.push({ id: n.id, ...boxOf(at, size) });
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
// `endDy` moves the landing point off the target's midline, so two
// edges converging on one card keep separate arrowheads.
export function edgePath(from, to, obstacles, endDy = 0) {
  const start = { x: from.x + from.w, y: from.y + from.h / 2 };
  const end = { x: to.x, y: to.y + to.h / 2 + endDy };
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
