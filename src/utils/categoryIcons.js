// The line icon that heads each ingredient category.
//
// Every path here is the design system's own ("Recipe Graph C v2",
// `categories`): 24x24, drawn as strokes so each icon takes the
// heading's colour.

const ICONS = {
  protein: [
    "M12 2.8c3.7 0 6.6 5.3 6.6 10a6.6 6.6 0 0 1-13.2 0c0-4.7 2.9-10 6.6-10Z",
    "M8.9 10.6c.3-1.6 1-3 1.9-3.9",
  ],
  seafood: [
    "M3 12c2.6-3.8 6-5.6 9.6-5.6 3 0 5.6 1.6 7.2 3.4L21.8 7v10l-2-2.8c-1.6 1.8-4.2 3.4-7.2 3.4-3.6 0-7-1.8-9.6-5.6Z",
    "M7.6 11.2v.1",
    "M13.4 8.6c.8 1 1.2 2.1 1.2 3.4s-.4 2.4-1.2 3.4",
  ],
  vegetable: [
    "M10.6 9.2 4.4 19.6 14.8 13.4c1.7-1 2-3.4.6-4.8-1.3-1.3-3.6-1-4.8.6Z",
    "M15.2 8.8c.2-2.2-.4-4.2-1.8-5.6M15.2 8.8c1.5-1.7 3.3-2.6 5.4-2.6M15.2 8.8c2.2-.2 4 .4 5.6 1.8",
    "M8.2 13.6l1.6 1.6M10.9 11.4l1.2 1.2",
  ],
  grain: [
    "M12 21V3.4",
    "M8.8 5.8 12 8.8l3.2-3M8.8 9.8l3.2 3 3.2-3M8.8 13.8l3.2 3 3.2-3",
  ],
  pantry: [
    "M10.4 3.4h3.2v3l2 2.5c.5.6.8 1.3.8 2v7.5a2.6 2.6 0 0 1-2.6 2.6h-3.6a2.6 2.6 0 0 1-2.6-2.6v-7.5c0-.7.3-1.4.8-2l2-2.5v-3Z",
    "M8.2 13.2h7.6",
  ],
  other: [
    "M4 8.2 12 4l8 4.2v7.6L12 20l-8-4.2V8.2Z",
    "M4 8.2 12 12.4l8-4.2",
    "M12 12.4V20",
  ],
};

/** The 24x24 stroke paths for a category, or [] when it has none. */
export function categoryIconPaths(category) {
  return ICONS[category] || [];
}
