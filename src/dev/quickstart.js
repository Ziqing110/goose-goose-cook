// Dev-only shortcut into a live cook, skipping the flow that gets you there.
//
// Reaching the live cook honestly means a kitchen, five conversation
// questions, a recipe board to approve, two cooks to bind and a mode to
// pick. That is the product; it is also four minutes of clicking before you
// can look at the thing you changed. Adding ?go=versus (or ?go=coop) to the
// Schedule page picks the mode and starts the cook on arrival.
//
//   npm run seed                       seeds a session and prints these
//   /session/schedule?go=coop
//   /session/schedule?go=versus
//
// It needs a session that already has an approved board and bound cooks —
// `npm run seed` makes one with no API key and no model call. It does NOT
// invent one, because a shortcut that fabricates state is a shortcut that
// tests something nobody ships.
//
// Read from the URL and compiled out of a production build, same as
// dev/preview.js. It starts a real run through the page's own startCook,
// so what you land in is what a cook would have got.
const MODES = {
  coop: "cooperation",
  "co-op": "cooperation",
  cooperation: "cooperation",
  versus: "competition",
  vs: "competition",
  competition: "competition",
};

// Read ONCE, when this module is first imported, which is before the
// router has rendered anything. It cannot be read later: the session
// guards bounce through <Navigate to="/session/schedule" replace />, and
// that drops the query string, so by the time the page mounts the URL no
// longer says what it was asked for.
const WANTED = (() => {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("go");
  return MODES[String(value || "").toLowerCase()] ?? null;
})();

/**
 * @returns {"cooperation"|"competition"|null} the mode to start in, if the
 *   page was opened with ?go= and this is a dev build.
 */
export function devQuickstart() {
  return WANTED;
}
