// The goose's footprint as plain data, so the DOM marks (GooseMarks.jsx)
// and the canvas share card (shareCard.js) draw the same print.

// One webbed print: three splayed toes with deep rounded notches over a
// tapering heel, on a 26×28 grid. Size, rotation and colour are the only
// variables, so other surfaces can vary the count and the direction
// instead of repeating an arrangement.
export const PRINT_PATH =
  "M13 3.2c1.6 0 2.2 1.6 2.4 3.4l.5 4.6c.1 1.2 1 1.6 2 1.1l3.6-1.8c1.6-.8 2.8.6 1.7 2L14.9 25c-1 1.3-2.6 1.3-3.5 0L2.9 12.6c-1-1.4.2-2.8 1.8-2l3.5 1.8c1 .5 1.9.1 2-1.1l.5-4.6C10.9 4.8 11.4 3.2 13 3.2Z";

// Size tracks depth: the palest print is the smallest, the deepest the
// largest. Muted warm brown, not black — these are empty states, and at
// full ink the prints pull focus off the copy.
export const PRINT_DEPTHS = {
  deep: { w: 21, h: 23, fill: "#f6cfa6", stroke: "#b08a63" },
  mid: { w: 17, h: 18, fill: "#faddbe", stroke: "#c2a081" },
  pale: { w: 13, h: 14, fill: "#fdeada", stroke: "#d2b79c" },
};
