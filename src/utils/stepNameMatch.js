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
import { spokenNumber, NUMBER_TOKEN } from "./understanding.js";

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

/**
 * Upgrades a "none" match into a "confirm" guess using its own
 * best-scoring runner-up, for a caller where a wrong pick costs nothing
 * more than picking again — a form field being filled in, not the live
 * cook crediting a task somebody actually did. matchStepName's own floor
 * exists to protect the latter, so this never changes matchStepName
 * itself; it only gives a form a friendlier fallback than flatly giving
 * up on anything short of the full name read back.
 */
export function guessIfNone(match, labelOf) {
  if (match.confidence !== "none" || match.candidates.length === 0) return match;
  const [best, ...rest] = match.candidates;
  return { stepId: best, label: labelOf(best), candidates: rest, confidence: "confirm" };
}

const STEP_NUMBER_REF = /^(?:step\s+(?:number\s+)?|number\s+)(.+)$/i;

// "The second step", not "step two" -- the ordinal comes before "step"
// instead of a cardinal coming after it, and it needed its own word
// list: cookVoice.js's ORDINAL only goes to two, for two cooks, and a
// recipe can run past twenty steps.
const ORDINAL_WORDS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20,
};
const ORDINAL_PATTERN = `${Object.keys(ORDINAL_WORDS).join("|")}|\\d+(?:st|nd|rd|th)`;
const STEP_ORDINAL_REF = new RegExp(`^(?:the\\s+)?(${ORDINAL_PATTERN})\\s+step$`, "i");

function ordinalToNumber(word) {
  const key = (word || "").toLowerCase();
  if (Object.hasOwn(ORDINAL_WORDS, key)) return ORDINAL_WORDS[key];
  const m = /^(\d+)(?:st|nd|rd|th)$/.exec(key);
  return m ? Number(m[1]) : null;
}

function stepFromNumber(n, candidateIds, labelOf, numberOf) {
  if (n === null) return null;
  const id = candidateIds.find((cid) => Number(numberOf(cid)) === n);
  return id
    ? { stepId: id, label: labelOf(id), candidates: [], confidence: "exact" }
    : { stepId: null, label: null, candidates: [], confidence: "none" };
}

/**
 * A candidate named by its on-screen number: "step 3" / "step number 3"
 * / "number 3" (cardinal, after "step"), or "the third step" / "3rd
 * step" (ordinal, before "step") -- the same number its own picker
 * already shows next to the label ("03  Mince garlic"). Null if `said`
 * isn't a number reference at all, so the caller falls back to
 * matchStepName; a number that doesn't exist among the candidates is
 * "none", not passed through to the name matcher as if "3" were a word
 * in somebody's step name.
 *
 * @param {(id: string) => string} numberOf  the field's own numbering
 */
export function stepByNumber(said, candidateIds, labelOf, numberOf) {
  if (!numberOf) return null;
  const trimmed = (said || "").trim();
  const cardinal = STEP_NUMBER_REF.exec(trimmed);
  const ordinal = cardinal ? null : STEP_ORDINAL_REF.exec(trimmed);
  if (!cardinal && !ordinal) return null;
  const n = cardinal ? spokenNumber(cardinal[1].trim()) : ordinalToNumber(ordinal[1]);
  return stepFromNumber(n, candidateIds, labelOf, numberOf);
}

// A bare number/ordinal, no "step"/"number" framing at all -- "2",
// "second", "the second". Never registered on its own: a bare "second"
// heard out of nowhere means nothing. It exists for exactly one thing,
// paired with BARE_STEP_REF_PATTERNS below -- answering a step-reference
// question that already failed once, the way a person would just repeat
// the number rather than the whole sentence again.
const BARE_CARDINAL_REF = new RegExp(`^(${NUMBER_TOKEN})$`, "i");
const BARE_ORDINAL_REF = new RegExp(`^(?:the\\s+)?(${ORDINAL_PATTERN})$`, "i");

/** Patterns for a bare step reference, to register only while a prior
 * "which step?" is still open -- see AddStepPanel.jsx / NodeEditorPanel.jsx. */
export const BARE_STEP_REF_PATTERNS = [BARE_CARDINAL_REF, BARE_ORDINAL_REF];

/** Same as stepByNumber, but for a bare "2" / "second" with no framing. */
export function bareStepRef(said, candidateIds, labelOf, numberOf) {
  if (!numberOf) return null;
  const trimmed = (said || "").trim();
  const cardinal = BARE_CARDINAL_REF.exec(trimmed);
  const ordinal = cardinal ? null : BARE_ORDINAL_REF.exec(trimmed);
  if (!cardinal && !ordinal) return null;
  const n = cardinal ? spokenNumber(cardinal[1]) : ordinalToNumber(ordinal[1]);
  return stepFromNumber(n, candidateIds, labelOf, numberOf);
}

// Everything stepByNumber and bareStepRef each recognise on their own,
// combined: a step-reference answer on its own, with or without "step"/
// "number" framing -- "step 2" and "2" are both fine as a follow-up to
// a failed "which step?", the way a person might repeat either.
export const STEP_RETRY_PATTERNS = [STEP_NUMBER_REF, STEP_ORDINAL_REF, BARE_CARDINAL_REF, BARE_ORDINAL_REF];

/** stepByNumber, falling back to bareStepRef -- see STEP_RETRY_PATTERNS. */
export function stepRetryRef(said, candidateIds, labelOf, numberOf) {
  return stepByNumber(said, candidateIds, labelOf, numberOf) ?? bareStepRef(said, candidateIds, labelOf, numberOf);
}

// Like `normalize`, but it keeps every letter rather than only a-z.
//
// The ASCII-only version above is right for matching a spoken name
// against a step LABEL, because the labels are English: letting Chinese
// characters through there would add tokens no label can ever match and
// dilute the score, the same way the agent's name did.
//
// Intent detection is the opposite case. "豆腐切好了" is a completed
// step and "还要多久" is a request for status, and stripping them leaves
// an empty string and no intent at all.
export const normalizeLoose = (s) =>
  (s || "").toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();
