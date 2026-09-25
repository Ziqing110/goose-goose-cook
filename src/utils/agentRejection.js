// What to say when the app refused something the model asked for.
//
// The server vets every tool call against the snapshot and returns the
// ones it threw out, with a reason. The live cook used to discard that
// list entirely, and the cost was a specific, confusing failure:
//
//   Cook, in competition mode, having claimed nothing:
//     "Goose, I'm done with the onion and celery"
//   Goose: "did you also dice the other things?"
//
// The step was `pending`, so it was never in the `done` enum, so the
// call was dropped as step_not_eligible and the model -- which cannot
// see the refusal -- fell back to asking a clarifying question about the
// wrong thing entirely. The app knew the real answer the whole time:
// you have to take a task before you can finish it.
//
// So a refusal with something worth saying is said, and it OUTRANKS the
// model's reply. A reply written around a call that did not happen is,
// by construction, about something that did not happen.
//
// Not every refusal is worth a sentence. A hallucinated step id or
// malformed arguments are the model's problem, not the cook's, and
// saying so out loud would be noise about our own plumbing.
//
// Pure: no DOM, no React.

const named = (byId, stepId) => byId?.[stepId]?.label || null;

/**
 * @param {{name: string, reason: string, stepId?: string}} rejection
 * @param {object} byId step id -> node, for labels
 * @returns {string|null} null when there is nothing useful to say
 */
export function rejectionLine(rejection, byId = {}) {
  const { name, reason, stepId } = rejection || {};
  const label = named(byId, stepId);

  if (reason === "step_not_eligible") {
    // Finishing, skipping or handing back something you never took. The
    // enum only ever holds steps that are actually yours.
    if (name === "done" || name === "skip" || name === "drop") {
      return label
        ? `You haven't taken ${label} yet — claim it first.`
        : "You haven't taken that one yet — claim it first.";
    }
    // Claiming or starting something that is not up for grabs: held by
    // someone else, or still waiting on a step before it.
    if (name === "claim" || name === "start") {
      return label
        ? `${label} isn't up for grabs right now.`
        : "That one isn't up for grabs right now.";
    }
    return null;
  }

  // Two voices in one turn. Nothing that writes may fire, and the cook
  // deserves to know why nothing happened rather than assume it did.
  if (reason === "two_speakers") {
    return "I heard two of you at once — say that again on your own?";
  }

  // unknown_step, bad_json, not_offered: the model naming something that
  // does not exist. Our plumbing, not their problem.
  return null;
}

/**
 * Every refusal worth saying, in order, capped.
 *
 * @param {Array} rejected
 * @param {object} byId
 * @param {number} [max] a refusal is a correction, not a list
 * @returns {string[]}
 */
export function rejectionLines(rejected, byId = {}, max = 2) {
  const seen = new Set();
  const lines = [];
  for (const rejection of rejected || []) {
    const line = rejectionLine(rejection, byId);
    // The same refusal twice in one turn ("done with the onion and the
    // celery", neither taken) is one thing to say, not two.
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length === max) break;
  }
  return lines;
}
