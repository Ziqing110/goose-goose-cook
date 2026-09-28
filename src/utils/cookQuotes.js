// A cook's own "keeper" line from the night, picked straight out of the
// run's transcript. Deterministic and free — no model, on purpose. The
// summary card already has cookQuips.js for commentary earned by the
// numbers; a night that actually had a good line in it deserves to keep
// the cook's real words rather than have something paraphrase them, and
// a night that didn't falls back to cookQuips instead (see
// utils/summaryCard.js). Pure: no DOM, no React.

const MIN_WORDS = 4;
// Long enough to be a real sentence, short enough that the card doesn't
// have to wrap it three times.
const MAX_WORDS = 26;

// Words that show up when somebody is genuinely reacting to something,
// rather than just stating what they're doing. Not exhaustive by
// design — this only has to catch enough of them that a fun night
// reliably surfaces a fun line, not every one.
const REACTION = /\b(ha+|lol|omg|no way|worst|best|disaster|amazing|delicious|gross|burnt|burning|smoke|smoking|ugh|yikes|nailed|whoops|oops|help|panic|dying|dead|why is|why did|i can't believe|terrifying|chaos)\b/i;

/**
 * A bare command or a name on its own is not "something fun they said" —
 * three of those filling the slot would read worse than an empty one.
 * Loose on purpose: this only needs to catch the common, boring shapes
 * ("Goose, start the garlic", "done", "Zeina"), not parse the grammar.
 */
function looksLikeACommand(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 2) return true;
  return /^(hey )?goose[,.]?\s*(i'?m |this is )?[\w'\s-]*$/i.test(text.trim());
}

function score(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS || words.length > MAX_WORDS) return 0;
  let s = Math.min(words.length, 12);
  if (text.includes("!")) s += 4;
  if (text.includes("?")) s += 1;
  if (REACTION.test(text)) s += 5;
  return s;
}

/**
 * The best candidate line this cook said during the run, or null when
 * nothing said rises above an ordinary command. Ties keep whichever was
 * said first, so reopening the card never reshuffles the pick.
 *
 * @param {string} cookId
 * @param {Array<{speaker: string, text: string}>} transcript  run.transcript
 * @returns {string|null}
 */
export function pickCookQuote(cookId, transcript) {
  let best = null;
  let bestScore = 0;
  for (const entry of transcript || []) {
    if (entry?.speaker !== cookId || typeof entry.text !== "string") continue;
    const text = entry.text.trim();
    if (!text || looksLikeACommand(text)) continue;
    const s = score(text);
    if (s > bestScore) {
      bestScore = s;
      best = text;
    }
  }
  return best;
}
