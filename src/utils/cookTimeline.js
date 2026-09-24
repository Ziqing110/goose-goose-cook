// What each cook actually did, in order, from the run's own event log.
//
// The summary card already says how many steps someone finished and how
// many points that scored. It does not say what they DID, which is the
// part people actually want to read afterwards: the order, how long each
// thing took, what got handed back, what got skipped.
//
// Everything here comes out of `run.events`, which the live cook has been
// writing all along — every start, done, skip, drop and undo, each with a
// cookId, a stepId and a timestamp. So this is a read, not new
// bookkeeping, and it costs nothing: no model, no network, and it works
// on a run that never reached the agent at all.
//
// Pure: no DOM, no React.

// Events that belong to a person doing something. run_start, run_pause,
// run_resume, run_end and replan are the run's, not a cook's.
const COOK_EVENTS = new Set(["start", "done", "skip", "drop", "undo"]);

const seconds = (fromIso, toIso) => {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.round((to - from) / 1000));
};

/**
 * One cook's actions, oldest first.
 *
 * A `done` is paired with the `start` that preceded it on the same step
 * by the same cook, so the entry can carry how long the step actually
 * took. Unpaired events still appear — a step someone finished without
 * ever formally starting is a real thing that happens when a run is
 * driven by voice, and dropping it would make the timeline lie.
 *
 * @param {object} run    { events: [...] }
 * @param {object} byId   step id -> node, for labels
 * @param {string} cookId
 * @returns {Array<{type, stepId, label, at, seconds, undone}>}
 */
export function timelineFor(run, byId, cookId) {
  const events = (run?.events || []).filter(
    (e) => e.cookId === cookId && COOK_EVENTS.has(e.type),
  );

  // An undone action should not read as something the cook did. Undo
  // carries the step it reversed, so the most recent matching action
  // before it is struck out rather than deleted: "started, then took it
  // back" is the honest record.
  const undone = new Set();
  events.forEach((event, i) => {
    if (event.type !== "undo") return;
    for (let j = i - 1; j >= 0; j -= 1) {
      const prior = events[j];
      if (prior.stepId === event.stepId && prior.type === (event.meta?.undid ?? prior.type) && !undone.has(j)) {
        undone.add(j);
        return;
      }
    }
  });

  const startedAt = new Map();
  const out = [];
  events.forEach((event, i) => {
    if (event.type === "undo") return;
    if (event.type === "start") startedAt.set(event.stepId, event.at);
    out.push({
      type: event.type,
      stepId: event.stepId,
      label: byId?.[event.stepId]?.label ?? null,
      at: event.at,
      seconds: event.type === "done" ? seconds(startedAt.get(event.stepId), event.at) : null,
      undone: undone.has(i),
    });
  });
  return out;
}

/**
 * The same thing for everyone, plus a count of what each cook did.
 *
 * @param {object} run
 * @param {Array}  nodes  the approved graph
 * @param {Array}  cooks  [{ id, name }]
 */
export function runTimeline(run, nodes, cooks) {
  const byId = Object.fromEntries((nodes || []).map((n) => [n.id, n]));
  return (cooks || []).map((cook) => {
    const actions = timelineFor(run, byId, cook.id);
    const counted = actions.filter((a) => !a.undone);
    const timed = counted.filter((a) => a.type === "done" && a.seconds != null);
    return {
      cookId: cook.id,
      name: cook.name,
      actions,
      done: counted.filter((a) => a.type === "done").length,
      skipped: counted.filter((a) => a.type === "skip").length,
      dropped: counted.filter((a) => a.type === "drop").length,
      // Hands-on time, not elapsed: the gaps between steps belong to
      // nobody, and counting them would credit whoever waited longest.
      workingSec: timed.reduce((total, a) => total + a.seconds, 0),
      longest: timed.reduce((best, a) => (!best || a.seconds > best.seconds ? a : best), null),
    };
  });
}
