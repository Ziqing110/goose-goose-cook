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
export function devPreview() {
  if (!import.meta.env.DEV) return null;
  const value = new URLSearchParams(window.location.search).get("preview");
  return value === "loading" || value === "done" ? value : null;
}
