// Grouping an ingredient's steps by the dish they belong to.
//
// An ingredient that turns up in both dishes used to list its steps in
// one run, so "2 cloves for the tofu, 3 for the soup" had to be worked
// out from the step names. Grouped, the split is the shape of the list.

// The dish papers, from the design system's own palette ("Dish Paper
// Palette"): ten warm tones, low enough in saturation not to fight the
// phase tape (prep blue, cook amber, plate green) or the red and amber
// status borders a step in trouble wears.
const TONES = [
  { name: "Cream", bg: "#fbf8f1", border: "1px solid #e4dccb" },
  { name: "Oat", bg: "#f5efe2", border: "1px solid #ddd2bb" },
  { name: "Almond", bg: "#f3e8da", border: "1px solid #dbc9b1" },
  { name: "Sand", bg: "#ece3d3", border: "1px solid #d2c4aa" },
  { name: "Biscuit", bg: "#f0e2cc", border: "1px solid #d8c09e" },
  { name: "Caramel", bg: "#efdcc6", border: "1px solid #d9bf9f" },
  { name: "Toffee", bg: "#e8d3ba", border: "1px solid #cdb08e" },
  { name: "Mushroom", bg: "#e9e4dc", border: "1px solid #cdc5b8" },
  { name: "Taupe", bg: "#e2dbd0", border: "1px solid #c4b9a8" },
  { name: "Cocoa", bg: "#e2cfbd", border: "1px solid #c6ab91" },
];

/* The order the palette hands them out in. It alternates light and dark
   so two dishes that land next to each other on the board stay easy to
   tell apart — which is why this is a fixed sequence rather than the
   tones in their own order. */
const ASSIGNMENT = [0, 5, 7, 2, 9, 1, 6, 3, 8, 4];

/** The papers in the order dishes receive them. */
export const DISH_PAPERS = ASSIGNMENT.map((i) => TONES[i]);

export const SHARED_PAPER = { bg: "#ffffff", border: "1px dashed #b9b6ae" };
export const SHARED_GROUP = "Shared";

/** The swatch for a dish, by its place in the run. */
export function dishPaper(dishTitle, dishTitles = []) {
  if (!dishTitle || dishTitle === SHARED_GROUP) return SHARED_PAPER;
  const i = dishTitles.indexOf(dishTitle);
  return DISH_PAPERS[(i === -1 ? 0 : i) % DISH_PAPERS.length];
}

/**
 * [{ name, steps, paper, count }] in dish order, with the shared steps
 * last — they are the ones both dishes lean on, so they read as the
 * common ground under the split rather than as a third dish.
 *
 * `steps` are the entries from an ingredient's `usedIn`, each carrying
 * its own `dish` title and `shared` flag.
 */
export function groupStepsByDish(steps, dishTitles = []) {
  const buckets = new Map();
  steps.forEach((step) => {
    const key = step.shared ? SHARED_GROUP : step.dish || SHARED_GROUP;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(step);
  });

  const ordered = [
    ...dishTitles.filter((title) => buckets.has(title)),
    // A dish the run doesn't list (an older session, a renamed dish)
    // still gets its own group rather than being folded into Shared.
    ...[...buckets.keys()].filter((key) => key !== SHARED_GROUP && !dishTitles.includes(key)),
    ...(buckets.has(SHARED_GROUP) ? [SHARED_GROUP] : []),
  ];

  return ordered.map((name) => ({
    name,
    steps: buckets.get(name),
    count: buckets.get(name).length,
    paper: dishPaper(name, dishTitles),
  }));
}
