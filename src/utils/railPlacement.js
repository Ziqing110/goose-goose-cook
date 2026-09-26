// Where Goose's Notes' handle sits on the right edge.
//
// Design 4e ("Handle → pull-out sheet"): tucked, the notes are a slim
// handle on the right edge that can be dragged up or down, out of the way
// of whatever that page has there. Only the height moves -- the handle
// always hugs the edge, and the sheet always opens from it.
//
// Pure: the viewport height comes in as an argument.

export const HANDLE_HEIGHT = 132;
const MARGIN = 12;

/** Below the page header on every page, and clear of the goose's corner. */
export const DEFAULT_HANDLE_TOP = 150;

/** Keep the whole handle on screen, whatever it was dragged to. */
export function clampHandleTop(top, viewportHeight) {
  const max = Math.max(MARGIN, viewportHeight - HANDLE_HEIGHT - MARGIN);
  return Math.max(MARGIN, Math.min(max, top));
}

/** A stored height, or null if it is missing or malformed. */
export function parseHandleTop(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
