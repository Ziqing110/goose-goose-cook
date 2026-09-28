// Was the agent spoken to, and did the speaker actually say anything?
//
// Shared by the client (which decides what to send) and the server's turn
// handler (which decides what to act on), so the two can never drift into
// disagreeing about whether a turn was addressed.
//
// Deterministic on purpose. It runs before the model, so speech that
// isn't for the agent never leaves the machine and never costs a call,
// and the rule is one we can calibrate rather than a model's mood.

const norm = (s) =>
  String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * Speech recognition won't always spell the name right, so a word within
 * one edit of it counts, but only for names of four letters or more:
 * one edit on a three-letter name matches half the dictionary.
 */
function isName(word, target) {
  if (word === target) return true;
  const slack = target.length >= 4 ? 1 : 0;
  return Boolean(slack) && Math.abs(word.length - target.length) <= slack
    && editDistance(word, target) <= slack;
}

/**
 * `engaged` is true for a short window after the agent last spoke, so
 * "yes" or "the garlic one" answering its question doesn't need the name
 * repeated.
 */
export function isAddressed(text, name, engaged = false) {
  if (engaged) return true;
  const target = norm(name);
  if (!target) return false;
  return norm(text).split(" ").some((word) => isName(word, target));
}

// Words that carry no instruction on their own. Stripped before deciding
// whether a turn said anything beyond the name.
const EMPTY_WORDS = new Set(["hey", "hi", "hello", "yo", "ok", "okay", "um", "uh", "er", "so", "well", "please"]);

/**
 * Did this turn consist of the agent's name and nothing else?
 *
 * People pause after saying a name — it is how you get someone's
 * attention before telling them the thing. The recogniser's end-of-turn
 * check reads that pause as a finished thought, so "Goose, I'm done with
 * the mincing" arrives as two turns: "Goose." and then, unaddressed and
 * therefore ignored, the part that mattered. Measured on the kitchen
 * recordings, this split hit two scenes in nine even at
 * min_turn_silence 400ms, and every scene at the 128ms default.
 *
 * Raising the silence threshold further trades the whole app's
 * responsiveness against one pause, so the caller handles it instead: a
 * name-only turn opens the same engaged window an agent question does,
 * and the next turn is heard as the rest of the sentence.
 */
export function isNameOnlyTurn(text, name) {
  const target = norm(name);
  if (!target) return false;
  const words = norm(text).split(" ").filter(Boolean);
  if (!words.length) return false;
  let sawName = false;
  for (const word of words) {
    if (isName(word, target)) {
      sawName = true;
      continue;
    }
    if (!EMPTY_WORDS.has(word)) return false;
  }
  return sawName;
}

// Trouble at the stove, or a cook asking the room what to do. Checked on
// whole words after norm(), so punctuation and case don't matter.
//
// Every other unnamed turn is ignored, and that is right for chatter. It
// is wrong for "the water's boiling over, what do I do?": the cook who
// says it has their hands full and their mind on the pot, which is
// exactly when they will not remember to say the name first. Missing
// that turn costs a mess; hearing one that wasn't meant for the goose
// costs one model call that is told to stay quiet if it isn't trouble.
//
// Kept to phrases that mean trouble on their own. "burn" is in because
// "it's burning" is the whole message; "quick" and "someone" are not,
// because "quick question" and "someone took my knife" are not.
const URGENT = [
  /\b(?:boil|boils|boiling|boiled|bubbling|spilling|pouring|foaming) over\b/,
  /\b(?:overflow|overflowing|overflowed|boiling out|coming out|spilling out|pouring out|leaking)\b/,
  /\b(?:burning|burnt|burned|scorching|scorched)\b/,
  /\b(?:smoke|smoking|smoky|on fire|caught fire|catching fire|fire|flames?)\b/,
  /\bhelp\b/,
  /\bwhat (?:do|should|can) (?:i|we) do\b/,
  /\bwhat (?:do|should) (?:i|we) do now\b/,
  /\bwhat now\b/,
  /\boh no\b/,
];

/**
 * Worth the goose's attention with no name on it: something is going
 * wrong, or someone is asking the room for help.
 */
export function isUrgent(text) {
  const said = norm(text);
  return Boolean(said) && URGENT.some((re) => re.test(said));
}
