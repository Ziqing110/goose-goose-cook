// One ordered record of everything that happened in a live cook: what
// people said, what the goose said back, and what the run actually did
// about it.
//
// The page kept two of these and showed one. `run.transcript` has the
// talking; `run.events` has the doing. A cook watching only the talking
// sees "Mia has Dice onion. Go." and has to work out that a claim
// happened, to whom, and why — which is exactly the confusion that made
// a mis-assigned claim so hard to unpick.
//
// So the two are merged on their timestamps. Nothing new is recorded:
// every row here was already being written during the cook, including
// actions taken by tapping, which never produced a spoken line at all.
//
// Reading it back rather than instrumenting the handlers is deliberate.
// There are a dozen places that change the run and every one of them
// already logs an event; a parallel "and also tell the feed" call in
// each is a second source of truth that drifts the first time someone
// adds a verb.
//
// Pure: no DOM, no React.

// Past tense, and naming the step, because this is read after the fact.
const VERB = {
  start: "started",
  done: "finished",
  skip: "skipped",
  drop: "put back",
  undo: "undid",
};

// Run-level events belong to the run, not a person.
const RUN_VERB = {
  run_start: "Run started",
  run_pause: "Paused",
  run_resume: "Resumed",
  run_end: "Run ended",
  replan: "Schedule recalculated",
};

/**
 * How the app decided who was speaking, in words a cook can act on.
 * Only worth showing when it might be wrong — the toggle is a guess
 * nobody made deliberately, so it is the one that needs saying.
 */
export const ATTRIBUTION = {
  voiceprint: "by voice",
  label: "by voice",
  toggle: "from the speaker toggle",
};

/**
 * @param {object} args
 *   transcript  run.transcript — [{ at, speaker, text, via? }]
 *   events      run.events — [{ at, type, cookId, stepId, source }]
 *   byId        step id -> node, for labels
 *   cooks       [{ id, name }]
 *   extraRows   rows already in this shape, from pages that keep no
 *               run of their own (see voice/voiceLog.js)
 *   thinkingSince  ms timestamp of a turn still in flight, or null
 *   now         ms, for the thinking row's own clock
 * @returns {Array} rows, oldest first
 */
export function buildConversationFeed({
  transcript = [],
  events = [],
  byId = {},
  cooks = [],
  extraRows = [],
  thinkingSince = null,
  now = Date.now(),
} = {}) {
  const nameOf = (id) => cooks.find((c) => c.id === id)?.name ?? null;
  const rows = [];

  for (const entry of transcript || []) {
    if (!entry?.text) continue;
    if (entry.speaker === "agent") {
      rows.push({ kind: "agent", at: entry.at, text: entry.text });
    } else {
      rows.push({
        kind: "said",
        at: entry.at,
        cookId: entry.speaker,
        // A page with no cooks (anything outside a run) names the
        // speaker itself; inside a run the cook list is the authority.
        name: nameOf(entry.speaker) ?? entry.name ?? "Someone",
        text: entry.text,
        // Absent on older runs and on typed input; the row simply does
        // not claim to know how it was attributed.
        via: entry.via ? ATTRIBUTION[entry.via] ?? null : null,
      });
    }
  }

  for (const event of events || []) {
    if (!event?.type) continue;
    if (RUN_VERB[event.type]) {
      rows.push({ kind: "run", at: event.at, text: RUN_VERB[event.type] });
      continue;
    }
    const verb = VERB[event.type];
    if (!verb) continue;
    rows.push({
      kind: "action",
      at: event.at,
      cookId: event.cookId,
      name: nameOf(event.cookId) ?? "Someone",
      verb,
      stepId: event.stepId,
      label: byId[event.stepId]?.label ?? null,
      // How it was done, so "said it" and "tapped it" are tellable
      // apart when a claim went to the wrong person.
      source: event.source ?? null,
    });
  }

  rows.push(...(extraRows || []));

  rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  // The goose is mid-turn. Always last, because it is happening now.
  if (thinkingSince) {
    rows.push({
      kind: "thinking",
      at: new Date(thinkingSince).toISOString(),
      seconds: Math.max(0, Math.round((now - thinkingSince) / 1000)),
    });
  }
  return rows;
}

/** A stable key for a row, since rows carry no ids of their own. */
export function feedKey(row, index) {
  return `${row.kind}-${row.at}-${row.stepId ?? row.cookId ?? index}`;
}
