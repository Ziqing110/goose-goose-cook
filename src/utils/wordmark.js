// The GOOSE! GOOSE! COOK! wordmark, ported from the brand pass's
// ggc-wordmark.js. Two of its directions ship:
//
// - "hand" (direction A, "Hand-lettered, cleaned up"): the L lockup's
//   lettering on one baseline and one x-height, in the icon's pen. The
//   brand's default: top bar and share card.
// - "mono" (direction B, "Monoline caps"): caps drawn with the goose's
//   own line. Used where the design draws B, the chef-working ticket.
//
// Glyphs sit on a 100-unit cap grid (y=0 cap line, y=100 baseline) and
// are strokes, not fills, so the same data draws the inline SVG
// (Wordmark.jsx) and the share card's canvas (summaryCard.js, via
// Path2D) with no font to load. Both are ink only here: none of the
// three "!" takes the accent.

export const WORDMARK_LABEL = "Goose! Goose! Cook!";

const SETS = {
  hand: {
    // Stroke width in grid units: 10u is 1.44px at the top bar's 14.4px cap.
    stroke: 10, track: 21, bang: 13, space: 46,
    text: "Goose! Goose! Cook!",
    glyphs: {
      G: { w: 56, d: "M52,16C47,6 39,1 30,1C13,1 3,22 3,51C3,81 13,99 29,99C43,99 52,89 53,72L53,60L36,60" },
      C: { w: 53, d: "M50,18C45,7 38,1 29,1C12,1 3,23 3,51C3,80 13,99 29,99C39,99 46,93 50,82" },
      o: { w: 38, d: "M19,41C29,41 36,53 36,70C36,87 29,99 19,99C9,99 2,87 2,70C2,53 9,41 19,41Z" },
      s: { w: 30, d: "M27,47C24,43 20,41 15,41C8,41 4,45 4,52C4,59 10,62 16,66C23,70 28,74 28,84C28,93 22,99 14,99C8,99 4,96 2,92" },
      e: { w: 37, d: "M4,71L34,71C34,52 28,41 19,41C9,41 3,54 3,70C3,88 10,99 20,99C27,99 31,95 34,90" },
      k: { w: 34, d: "M4,0L4,100M30,43L5,76M14,63L32,100" },
      // The dot is a zero-length stroke; round caps turn it into a dot.
      "!": { w: 8, d: "M4,2L4,68M4,95L4,95.01" },
    },
  },
  mono: {
    stroke: 13, track: 15, bang: 8, space: 36,
    text: "GOOSE! GOOSE! COOK!",
    glyphs: {
      G: { w: 92, d: "M84,24C76,10 63,2 48,2C22,2 4,23 4,50.5C4,78 22,99 48,99C71,99 88,84 88,62L88,56L60,56" },
      C: { w: 88, d: "M84,24C76,10 63,2 48,2C22,2 4,23 4,50.5C4,78 22,99 48,99C63,99 76,91 84,77" },
      O: { w: 96, d: "M48,4A46.5,46.5 0 0 1 48,97A46.5,46.5 0 0 1 48,4Z" },
      S: { w: 62, d: "M56,20C52,9 43,3 32,3C18,3 8,11 8,25C8,39 19,44 32,48C47,53 58,59 58,74C58,89 46,98 31,98C18,98 8,92 4,80" },
      E: { w: 60, d: "M55,4L8,4L8,97L55,97M8,50.5L47,50.5" },
      K: { w: 68, d: "M8,3L8,98M63,3L9,60M29,39L65,98" },
      "!": { w: 16, d: "M8,4L8,64M8,93L8,93.01" },
    },
  },
};

export const WORDMARK_VARIANTS = Object.keys(SETS);

// Lays one set out left to right. Each glyph is { x, d } in grid units;
// advance is the width of the whole line before stroke padding, and the
// viewBox adds room for the round caps to overhang the grid.
function layout(set) {
  const glyphs = [];
  let x = 0;
  set.text.split(" ").forEach((word, wi) => {
    if (wi > 0) x += set.space;
    [...word].forEach((ch, i) => {
      const glyph = set.glyphs[ch];
      if (i > 0) x += ch === "!" ? set.bang : set.track;
      glyphs.push({ x, d: glyph.d });
      x += glyph.w;
    });
  });
  const pad = set.stroke / 2 + 1;
  return {
    glyphs,
    advance: x,
    stroke: set.stroke,
    pad,
    viewBox: [-pad, -pad, x + 2 * pad, 100 + 2 * pad],
  };
}

const GEOMETRY = Object.fromEntries(Object.entries(SETS).map(([name, set]) => [name, layout(set)]));

export function wordmarkGeometry(variant = "hand") {
  return GEOMETRY[variant];
}

// Rendered box for a given cap height in px, stroke overhang included.
export function wordmarkSize(cap, variant = "hand") {
  const { viewBox } = GEOMETRY[variant];
  const scale = cap / 100;
  return { width: viewBox[2] * scale, height: viewBox[3] * scale };
}
