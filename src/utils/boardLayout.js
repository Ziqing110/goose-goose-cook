// Geometry for the recipe board: where cards sit so they never overlap,
// and how an edge gets from one to another without disappearing under a
// third. Pure functions on plain boxes — no DOM — so the board can lay
// itself out without measuring first.
import { layoutLevels } from "./graphLayout.js";

// Cards are a fixed size. Variable height was what made the board
// unreadable: the auto-layout couldn't know how tall a row was, so long
// labels overlapped their neighbours before anyone dragged anything.
export const CARD_W = 168;  /* the narrowest card, and the default */
export const CARD_H = 72;   /* a two-line card; taller ones are computed */
export const COL_GAP = 60;
export const ROW_GAP = 14;
/* The most the auto-layout will open a column up by to fill a tall
   board. Bounded by a card's own height, not a flat number — past a
   full card's height of empty paper between two notes, the column
   stops reading as one run of steps and starts reading as several. */
export const ROW_GAP_MAX = CARD_H;
export const PAD = 16;
const CLEAR = 10; // breathing room kept between cards when one is nudged
const LANE = 16; // how far an edge detours clear of a card it would cross

/* Card geometry, in the same units the positions use. */
export const CARD_WIDTHS = [168, 204, 240];
export const CARD_PAD_X = 12 + 12; /* the slip's padding, both sides */
/* The number and the duration share the line above the label, so the
   label has the card's full width rather than dodging a corner. */
export const CARD_NUM_W = 0;
export const LABEL_LINE_H = 19;
export const CARD_CHROME_H = 14 + 15 + 4 + 9; /* top padding, number line, gap, bottom padding */
export const MAX_LABEL_LINES = 4;
/* Two legends float over the board's top corners — the phase key on the
   right, the paper key on the left. The end columns keep clear of them
   rather than the board reserving a margin all the way across. */
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
 *
 * `availableH` is the board's visible height, when the caller knows it.
 * Cards then breathe out into whatever room is going spare instead of
 * packing into the top of a tall board and leaving the bottom third
 * bare — a big screen made the plan look smaller, not roomier. The gap
 * is capped, so a board with two cards on it stays a board with two
 * cards on it rather than one card at each end.
 */
export function autoPositions(nodes, sizeOf = () => ({ w: CARD_W, h: CARD_H }), keepOut, availableH) {
  const clearance = Math.max(LEGEND_KEEPOUT, Number(keepOut) || 0);
  const out = {};
  const levels = orderLevels(nodes);
  const cardsHeight = (level) => level.reduce((sum, n) => sum + sizeOf(n).h, 0);
  // One gap for every column, sized off the fullest one: per-column
  // spacing would stretch a two-card column to the same height as an
  // eight-card one and read as two unrelated boards.
  const fullest = levels.reduce((best, l) => (cardsHeight(l) > cardsHeight(best) ? l : best), levels[0] || []);
  const room = Number(availableH) - 2 * PAD - clearance - cardsHeight(fullest);
  const rowGap =
    fullest.length > 1 && Number.isFinite(room) && room > 0
      ? Math.min(ROW_GAP_MAX, Math.max(ROW_GAP, room / (fullest.length - 1)))
      : ROW_GAP;
  const colHeight = (level) => cardsHeight(level) + Math.max(0, level.length - 1) * rowGap;
  const tallest = Math.max(0, ...levels.map(colHeight));
  let x = PAD;
  levels.forEach((level, col) => {
    const width = Math.max(CARD_W, ...level.map((n) => sizeOf(n).w));
    let y = PAD + (tallest - colHeight(level)) / 2;
    const underALegend = col === 0 || (col === levels.length - 1 && levels.length > 1);
    if (underALegend) y = Math.max(y, PAD + clearance);
    level.forEach((node) => {
      // Cards in a column are centred on it, so a narrow card between
      // wide ones doesn't leave the edges kinked.
      const size = sizeOf(node);
      out[node.id] = { x: x + (width - size.w) / 2, y };
      y += size.h + rowGap;
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
 * Right angles with rounded corners, through a list of points. Curves
 * were read as decoration; a board wired like a diagram reads as one.
 */
export function roundPath(points, r = 6) {
  const p = points.filter((q, i) => i === 0 || q.x !== points[i - 1].x || q.y !== points[i - 1].y);
  if (p.length < 2) return "";
  let d = `M ${p[0].x} ${p[0].y}`;
  for (let i = 1; i < p.length - 1; i += 1) {
    const a = p[i - 1];
    const b = p[i];
    const c = p[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y);
    const l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const p1 = { x: b.x - ((b.x - a.x) / (l1 || 1)) * rr, y: b.y - ((b.y - a.y) / (l1 || 1)) * rr };
    const p2 = { x: b.x + ((c.x - b.x) / (l2 || 1)) * rr, y: b.y + ((c.y - b.y) / (l2 || 1)) * rr };
    d += ` L ${p1.x} ${p1.y} Q ${b.x} ${b.y} ${p2.x} ${p2.y}`;
  }
  const z = p[p.length - 1];
  return `${d} L ${z.x} ${z.y}`;
}

/**
 * A lane of its own for every arrow.
 *
 * Routed naively, eighteen arrows leave and land on midlines, overlap
 * each other for whole columns and arrive as one thick line — you can
 * see that something feeds a step, not what. So each edge gets three
 * things of its own:
 *
 *  - an exit point spread down the source's right edge, ordered by
 *    where it is going, so the fan leaves in the order it arrives
 *  - a landing point spread down the target's left edge, ordered by
 *    where it came from, so two arrows into one card keep two heads
 *  - a vertical lane in the gap in front of its column, a few pixels
 *    apart from its neighbours, shortest run nearest the card
 *
 * Returns a Map of "from>to" -> { sy, ey, tx, ex } for edgePath.
 */
export function laneRouting(nodes, boxes, columnSnap = 10) {
  const pairs = [];
  nodes.forEach((n) => {
    (n.depends_on || []).forEach((d) => {
      if (boxes[d] && boxes[n.id]) pairs.push({ from: d, to: n.id });
    });
  });
  const centreY = (id) => boxes[id].y + boxes[id].h / 2;
  // Points spread down an edge of the card, clear of its corners.
  const spread = (box, i, count) => box.y + 14 + ((box.h - 22) * (i + 1)) / (count + 1);

  const outgoing = new Map();
  const incoming = new Map();
  pairs.forEach((p) => {
    if (!outgoing.has(p.from)) outgoing.set(p.from, []);
    if (!incoming.has(p.to)) incoming.set(p.to, []);
    outgoing.get(p.from).push(p);
    incoming.get(p.to).push(p);
  });

  outgoing.forEach((list, id) => {
    list.sort((a, b) => centreY(a.to) - centreY(b.to));
    list.forEach((p, i) => {
      p.sy = spread(boxes[id], i, list.length);
      // Staggered so two arrows leaving the same card don't run as one.
      p.ex = boxes[id].x + boxes[id].w + 8 + i * 6;
    });
  });
  incoming.forEach((list, id) => {
    list.sort((a, b) => centreY(a.from) - centreY(b.from));
    list.forEach((p, i) => {
      p.ey = spread(boxes[id], i, list.length);
    });
  });

  // One lane each, within the gap in front of the column they arrive in.
  const gaps = new Map();
  pairs.forEach((p) => {
    const key = Math.round(boxes[p.to].x / columnSnap);
    if (!gaps.has(key)) gaps.set(key, []);
    gaps.get(key).push(p);
  });
  gaps.forEach((list) => {
    // Shortest first: the arrow with the least climbing gets the lane
    // closest to the cards, so lanes cross as little as possible.
    list.sort((a, b) => a.ey - a.sy - (b.ey - b.sy));
    const room = Math.max(12, COL_GAP - 26);
    const step = list.length > 1 ? Math.min(7, room / (list.length - 1)) : 0;
    const middle = (list.length - 1) / 2;
    list.forEach((p, i) => {
      p.tx = boxes[p.to].x - COL_GAP / 2 + (i - middle) * step;
    });
  });

  return new Map(pairs.map((p) => [`${p.from}>${p.to}`, { sy: p.sy, ey: p.ey, tx: p.tx, ex: p.ex }]));
}

/**
 * An SVG path from the right edge of `from` to the left edge of `to`,
 * down the column's shared trunk. If the run along to the trunk would
 * cross a card, it steps above or below the cards in the way — whichever
 * is the shorter deviation — so the line stays visible.
 */
export function edgePath(from, to, obstacles, port = {}) {
  const start = { x: from.x + from.w, y: port.sy ?? from.y + from.h / 2 };
  const end = { x: to.x, y: port.ey ?? to.y + to.h / 2 };
  // Never inside the card it is arriving at: a lane past the left edge
  // would double back on itself.
  const lane = Math.min(port.tx ?? to.x - 14, to.x - 10);
  if (lane <= start.x + 4) return roundPath([start, end]);

  const corner = { x: lane, y: start.y };
  const blockers = obstacles.filter((o) => segmentHitsRect(start, corner, o));
  if (!blockers.length) return roundPath([start, corner, { x: lane, y: end.y }, end]);

  const exitX = port.ex ?? start.x + 12;
  const above = Math.min(...blockers.map((o) => o.y)) - LANE / 2;
  const below = Math.max(...blockers.map((o) => o.y + o.h)) + LANE / 2;
  const viaY = Math.abs(above - end.y) <= Math.abs(below - end.y) ? above : below;
  return roundPath([start, { x: exitX, y: start.y }, { x: exitX, y: viaY }, { x: lane, y: viaY }, { x: lane, y: end.y }, end]);
}
