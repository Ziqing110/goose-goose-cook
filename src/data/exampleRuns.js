// Two finished cooks pinned to Home, so a first visit has a cook card to
// open before anyone has cooked. Built by scripts/build-showcase-runs.mjs
// through the app's own pipeline (template, schedule, a replayed live
// cook, buildSummary); rerun it rather than editing the JSON. The photos
// are drawings in the page's own hand, not photographs.
//
// They are not in the database, on purpose: the demo's database resets
// on every boot, and they must look the same to every visitor. So they
// are read-only too -- nobody can delete them, and one visitor's "Change
// photo" must not become the next one's.
import rows from "./exampleRunRows.json";
import soupDrawing from "../assets/example-chicken-noodle-soup.svg";
import mapoDrawing from "../assets/example-mapo-tofu-rice.svg";

const PHOTOS = {
  "example-coop-chicken-noodle-soup": soupDrawing,
  "example-versus-mapo-tofu-rice": mapoDrawing,
};

/** The compact rows Home lists them by, same shape as ?view=list. */
export const EXAMPLE_RUN_ROWS = rows;

export const isExampleRun = (id) => rows.some((row) => row.id === id);

/** One whole session, as getSession would return it. Loaded on demand:
 *  Home never needs the recipes or the run, only the rows above. */
export async function loadExampleRun(id) {
  const { default: sessions } = await import("./exampleRuns.json");
  const session = sessions.find((s) => s.id === id);
  if (!session) throw new Error("Not found");
  return structuredClone({ ...session, summary: { ...session.summary, photo: PHOTOS[id] } });
}
