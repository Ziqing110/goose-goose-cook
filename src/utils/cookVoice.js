// Spoken references to cooks on the voice-binding page — pure, so the
// grammar is testable without a DOM.
//
// A cook is "the first cook", "cook two", or by name once they have one.
// Slots are the only stable handle before names exist, which is exactly
// when someone is saying "call the first cook Mia".

import { MAX_COOK_NAME_LENGTH } from "./cooks.js";

// Bare "to" is deliberately not a synonym for two: "add a cook to the
// kitchen" would resolve it. "too" is what recognizers actually hear.
export const ORDINAL = "first|1st|one|1|second|2nd|two|too|2";

const ORDINAL_INDEX = {
  first: 0, "1st": 0, one: 0, 1: 0,
  second: 1, "2nd": 1, two: 1, too: 1, 2: 1,
};

export const ordinalIndex = (word) => {
  const key = (word || "").toLowerCase();
  return Object.hasOwn(ORDINAL_INDEX, key) ? ORDINAL_INDEX[key] : null;
};

/**
 * Which cook does this spoken reference mean? Returns the cook, or null
 * when it names nobody (or a slot that doesn't exist).
 *
 * @param {string} said   normalized text, e.g. "the first cook", "mia"
 * @param {Array<{name: string}>} cooks
 */
export function resolveCookRef(said, cooks) {
  const text = (said || "").toLowerCase().trim();
  if (!text) return null;

  const ord = new RegExp(`\\b(${ORDINAL})\\b`).exec(text);
  if (ord) return cooks[ordinalIndex(ord[1])] ?? null;

  // By name. Whole-word, so "mia" doesn't claim "miami"; an ambiguous
  // hit (two cooks match) resolves to nobody rather than guessing.
  const hits = cooks.filter((c) => {
    const name = c.name.trim().toLowerCase();
    return name && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
  });
  return hits.length === 1 ? hits[0] : null;
}

// Words that follow "I'm" without being a name. Without this, "I'm
// ready" renames a cook to Ready.
const NOT_NAMES = new Set([
  "ready", "done", "finished", "back", "here", "good", "fine", "okay", "ok", "sorry",
  "confused", "lost", "stuck", "sure", "not", "going", "gonna", "trying", "cooking",
]);

/**
 * A spoken name, cleaned for the input box: filler and trailing pleasantries
 * removed, capitalized, capped at the input's own limit. Null if what's left
 * can't plausibly be a name.
 */
export function cleanSpokenName(said) {
  const words = (said || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\b(?:please|thanks|thank you|and|okay|ok)\s*$/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > 2) return null;
  if (NOT_NAMES.has(words[0])) return null;
  const name = words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  return name.slice(0, MAX_COOK_NAME_LENGTH).trim();
}

// A cook's name as the recogniser spelled it.
//
// "Zeina" comes back as "Zina", "Lindy" as "Lindi". resolveCookRef wants
// the name exactly, which is right where a name is being SET (the
// binding page stores what it hears), and wrong where one is only being
// RECOGNISED: "I'm Zina" said by Zeina found nobody, so her turn stayed
// credited to whoever the voiceprint or the toggle had guessed.
//
// So: the one cook whose name is within a letter (two, for a name of
// six letters or more) of what was said, and closer than anyone else's.
// A tie, or nobody close enough, is nobody -- a guess between two cooks
// is exactly the wrong credit this exists to prevent.
function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/**
 * @param {string} said  one or two words that should be a cook's name
 * @param {Array} cooks  [{ id, name }]
 * @returns {object|null} the cook, or null when nobody is clearly meant
 */
export function nearestCook(said, cooks) {
  const heard = String(said || "").toLowerCase().replace(/[^a-z' -]/g, "").trim();
  if (heard.length < 3 || NOT_NAMES.has(heard)) return null;
  const exact = resolveCookRef(heard, cooks);
  if (exact) return exact;
  const scored = (cooks || [])
    .filter((c) => c.name.trim())
    .map((c) => {
      const name = c.name.trim().toLowerCase();
      return { cook: c, d: editDistance(heard, name), allowed: name.length >= 6 ? 2 : 1 };
    })
    .sort((a, b) => a.d - b.d);
  const [best, next] = scored;
  if (!best || best.d > best.allowed) return null;
  if (next && next.d === best.d) return null;
  return best.cook;
}

// A name spelled out letter by letter, as the recogniser writes it:
// "Z-E-I-N-A", "Z E I N A", "z. e. i. n. a." -- joined back into the
// word, so an uncommon name can be spelled when saying it did not work.
// Three letters or more, so "a" and "I" in ordinary speech are left
// alone.
const SPELLED = /(?<![\w'])[a-z](?![\w'])(?:[\s.-]+[a-z](?![\w'])){2,}\.?/gi;

export function joinSpelledLetters(text) {
  return String(text || "").replace(SPELLED, (run) => {
    const letters = run.replace(/[^a-z]/gi, "");
    return letters[0].toUpperCase() + letters.slice(1).toLowerCase();
  });
}
