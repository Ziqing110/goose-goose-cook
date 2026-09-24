// Dev-only way to hold a screen on display for design review.
//
// Some screens (the chef "at work" loading screens) only exist for a few
// moments, or for as long as a real generation takes, which makes them hard
// to look at and impossible to tweak. Adding ?preview=loading to the page's
// URL pins the loading screen; ?preview=done pins its thumbs-up frame.
//
//   /session/inventory?preview=loading
//   /session/inventory?preview=done
//   /session/schedule?preview=loading
//
// Read once per render from the URL and ignored outside `npm run dev`, so it
// cannot reach a production build. Nothing is written or generated.
/**
 * ?goose=<state> pins the voice agent in one of its five poses, so the
 * states that need a live socket (listening, thinking, speaking) or a
 * broken one (warning) can be looked at without either.
 *
 *   /session/conversation?goose=speaking
 *
 * Dev-only, same as devPreview above.
 */
const GOOSE_STATES = ["idle", "listening", "thinking", "speaking", "warning"];
export function devGooseState() {
  if (!import.meta.env.DEV) return null;
  const value = new URLSearchParams(window.location.search).get("goose");
  return GOOSE_STATES.includes(value) ? value : null;
}

export function devPreview() {
  if (!import.meta.env.DEV) return null;
  const value = new URLSearchParams(window.location.search).get("preview");
  return value === "loading" || value === "done" ? value : null;
}

/**
 * ?preview=mobile shows the phone-blocked screen inside a phone-sized
 * frame on a desktop, so it can be looked at and tweaked without a
 * device or a resized window.
 *
 *   /?preview=mobile
 *
 * Dev-only, same as the two above.
 */
export function devMobilePreview() {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(window.location.search).get("preview") === "mobile";
}
