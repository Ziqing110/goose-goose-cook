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

// How much of what the cook SAID this label accounts for.
//
// Two formulas were tried before this one and both had a bias.
// One-directional overlap tied "cut onion" at a perfect 1.0 against both
// "cut the yellow onion" and "cut the red onion", and then treated the
// tie as certainty. Dice, which counts both directions, broke the tie —
// but by punishing labels for having words the cook didn't say, which
// means it quietly prefers the SHORTEST label containing the word.
// Measured on the kitchen recordings, "Goose, I'll take the tofu"
// claimed "Blanch tofu" (0.67) over "Cut tofu into cubes" (0.40), which
// is the wrong step and was never in doubt as far as the app was
// concerned.
//
// So: score by coverage of the spoken words, and let a tie be a tie.
// Two labels that both account for everything said ARE ambiguous, and
// the honest answer to "the tofu" when two steps are about tofu is to
// ask which — not to pick the one with the shorter name.
function coverage(spoken, label) {
  if (spoken.size === 0) return 0;
  let hits = 0;
  spoken.forEach((t) => {
    if (label.has(t)) hits++;
  });
  return hits / spoken.size;
}

const sameSet = (a, b) => a.size === b.size && [...a].every((t) => b.has(t));

// Certainty is set EQUALITY, not a high score: nothing added, nothing
// dropped, nothing swapped. Anything less is a guess, and making a guess
// silently is how "done with the onion" finishes the wrong onion, or
// "before the onion" wires a new step to the wrong one.
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
    .map((id) => {
      const labelSet = new Set(contentTokens(labelOf(id) || ""));
      return { id, score: coverage(spokenSet, labelSet), exact: sameSet(spokenSet, labelSet) };
    })
    .sort((a, b) => b.score - a.score || Number(b.exact) - Number(a.exact));

  const [best, runnerUp] = scored;
  const clearWinner = best && best.score >= CONFIRM_FLOOR && best.score - (runnerUp?.score ?? 0) >= CONFIRM_MARGIN;
  if (!clearWinner) {
    // An exact match still wins outright even against an equal-scoring
    // rival: "mince garlic" said in full is not ambiguous just because
    // "mince ginger & scallion" also covers the word "mince".
    if (best?.exact && !runnerUp?.exact) {
      return { stepId: best.id, label: labelOf(best.id), candidates: [], confidence: "exact" };
    }
    return {
      stepId: null,
      label: null,
      candidates: scored.filter((s) => s.score > 0).slice(0, 3).map((s) => s.id),
      confidence: "none",
    };
  }
  if (best.exact) return { stepId: best.id, label: labelOf(best.id), candidates: [], confidence: "exact" };
  // Runner-ups travel with the guess so a "no" has somewhere to go
  // straight to "which one" instead of starting the search over.
  return { stepId: best.id, label: labelOf(best.id), candidates: scored.slice(1, 4).map((s) => s.id), confidence: "confirm" };
}
