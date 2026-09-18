// Shared step-name similarity — which existing step, if any, a spoken
// name refers to. Used wherever a spoken name has to be resolved
// against a list of candidates that can read a lot alike: claiming a
// step in the live cook (voiceCommands.js), and picking where a new
// step goes on the recipe graph (InventoryPage.jsx's "add a task
// before/between").
//
// A lot of steps in one recipe read alike — "Cut the yellow onion" /
// "Cut the red onion", "Whisk the eggs" / "Whisk the egg whites" — so
// the metric has to notice when a word was dropped or swapped, not just
// count overlap.

const STOP_WORDS = new Set([
  "the", "a", "an", "my", "on", "to", "that", "one", "it", "i", "im", "ill", "ive",
  "now", "please", "up", "of", "and", "is", "am", "next", "step", "task", "with",
]);

export const normalize = (s) => (s || "").toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();

export const contentTokens = (s) =>
  normalize(s)
    .split(" ")
    .map((t) => t.replace(/s$/, ""))
    .filter((t) => t && !STOP_WORDS.has(t));

// Dice coefficient over the content-word SETS, counted both directions.
// The old "fraction of what I said is in the label" formula was
// one-directional, so "cut onion" scored a perfect 1.0 against BOTH
// "cut the yellow onion" and "cut the red onion" — every spoken word
// was present in either label, and the extra word each one carried
// never counted against it. Dice counts both directions, so a label
// with a word the cook didn't say scores below 1.0 too, and the two
// candidates split apart instead of tying at "certain".
function diceScore(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let hits = 0;
  a.forEach((t) => {
    if (b.has(t)) hits++;
  });
  return (2 * hits) / (a.size + b.size);
}

// A perfect Dice score means the two token sets are IDENTICAL — nothing
// was added, dropped or swapped, so there's nothing to double-check.
// Below that, the guess is doing real work, and doing it silently is
// how "done with the onion" finishes the wrong onion, or "before the
// onion" wires a new step to the wrong one.
const EXACT_SCORE = 1;
const CONFIRM_FLOOR = 0.5;
const CONFIRM_MARGIN = 0.15;

/**
 * @param {string} said           the spoken name, already stripped of
 *                                 any trigger words ("take", "before", …)
 * @param {string[]} candidateIds
 * @param {(id: string) => string} labelOf
 * @returns {{
 *   stepId: string|null, label: string|null,
 *   candidates: string[],           // runner-ups, for a "which one" fallback
 *   confidence: "exact"|"confirm"|"none"
 * }}
 */
export function matchStepName(said, candidateIds, labelOf) {
  const tokens = contentTokens(said);
  if (tokens.length === 0 || candidateIds.length === 0) {
    return { stepId: null, label: null, candidates: [], confidence: "none" };
  }

  const phrase = tokens.join(" ");
  const exactSubstring = candidateIds.filter((id) => normalize(labelOf(id) || "").includes(phrase));
  if (exactSubstring.length === 1) {
    return { stepId: exactSubstring[0], label: labelOf(exactSubstring[0]), candidates: [], confidence: "exact" };
  }

  const spokenSet = new Set(tokens);
  const scored = candidateIds
    .map((id) => ({ id, score: diceScore(spokenSet, new Set(contentTokens(labelOf(id) || ""))) }))
    .sort((a, b) => b.score - a.score);

  const [best, runnerUp] = scored;
  const clearWinner = best && best.score >= CONFIRM_FLOOR && best.score - (runnerUp?.score ?? 0) >= CONFIRM_MARGIN;
  if (!clearWinner) {
    return {
      stepId: null,
      label: null,
      candidates: scored.filter((s) => s.score > 0).slice(0, 3).map((s) => s.id),
      confidence: "none",
    };
  }
  if (best.score >= EXACT_SCORE) return { stepId: best.id, label: labelOf(best.id), candidates: [], confidence: "exact" };
  // Runner-ups travel with the guess so a "no" has somewhere to go
  // straight to "which one" instead of starting the search over.
  return { stepId: best.id, label: labelOf(best.id), candidates: scored.slice(1, 4).map((s) => s.id), confidence: "confirm" };
}
