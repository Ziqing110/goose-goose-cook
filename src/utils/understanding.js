// The agent's reading of each conversation answer, shown in the
// understanding sidecar. There's no real extraction service yet, so this
// is a small per-question interpreter: an answer that parses cleanly is
// "confirmed", one that only partly parses (hedges, extra words, no
// number where one is expected) is "low-confidence" and keeps the raw
// text as `heard` so the cook can check it. The `value` it returns is
// what goes into conversation.answers, so downstream readers
// (useSessionRecipes, runStats) get a number instead of a sentence.
import { ELICITATION_QUESTIONS } from "../data/dishes.js";

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const NUMBER_PATTERN = `\\d+(?:\\.\\d+)?|${Object.keys(NUMBER_WORDS).join("|")}`;

const toNumber = (token) => NUMBER_WORDS[token.toLowerCase()] ?? Number(token);

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// Lower-cased, trailing punctuation dropped, so "Vegan." parses as clean.
const normalize = (text) => text.trim().replace(/[.!]+$/, "").trim().toLowerCase();

function firstNumber(text) {
  const match = new RegExp(`\\b(${NUMBER_PATTERN})\\b`, "i").exec(text);
  return match ? toNumber(match[1]) : null;
}

/**
 * "four" or "4" -> 4, anything else -> null.
 *
 * Exported so spoken form-filling reads numbers the same way spoken
 * answers do. A second copy of the word list would drift, and then
 * "four burners" and "four servings" would disagree about what four is.
 */
export function spokenNumber(token) {
  if (token == null) return null;
  const n = toNumber(String(token).trim());
  return Number.isFinite(n) ? n : null;
}

/** The number-word alternation, for building command patterns. */
export const NUMBER_TOKEN = NUMBER_PATTERN;

const confirmed = (value, display) => ({ value, display, status: "confirmed" });
const unsure = (value, display, heard) => ({ value, display, status: "low-confidence", heard });

function readDish(raw) {
  const text = raw.trim();
  const vague = /\?|\b(maybe|or|something|not sure|idk|either|whatever)\b/i.test(text);
  const wordy = text.split(/\s+/).length > 5;
  return vague || wordy ? unsure(text, capitalize(text), text) : confirmed(text, capitalize(text));
}

function readServings(raw) {
  const text = normalize(raw);
  const clean = new RegExp(`^(${NUMBER_PATTERN})\\s*(servings?|people|persons?|portions?|guests?|of us)?$`, "i").exec(text);
  if (clean) {
    const n = toNumber(clean[1]);
    return confirmed(String(n), `${n} servings`);
  }
  const n = firstNumber(text);
  return n ? unsure(String(n), `${n} servings`, raw.trim()) : unsure(raw.trim(), capitalize(raw.trim()), raw.trim());
}

function readDiet(raw) {
  const text = normalize(raw);
  if (/^(none|no|nope|nothing|anything|n\/a|no restrictions?|no constraints?)$/.test(text)) {
    return confirmed("none", "No restrictions");
  }
  if (text === "vegan") return confirmed("vegan", "Vegan");
  if (/^(vegetarian|veggie|no meat|meat-free)$/.test(text)) return confirmed("vegetarian", "Vegetarian");
  if (/\bvegan\b/.test(text)) return unsure("vegan", "Vegan", raw.trim());
  if (/\b(vegetarian|veggie|no meat|meat-free)\b/.test(text)) return unsure("vegetarian", "Vegetarian", raw.trim());
  // Anything else is a constraint in the cook's own words (an allergy,
  // say) — there's nothing to misread, so it's taken as given.
  return confirmed(raw.trim(), capitalize(raw.trim()));
}

function readTargetTime(raw) {
  const text = normalize(raw);
  const minutes = new RegExp(`^(${NUMBER_PATTERN})\\s*(m|mins?|minutes?)?$`, "i").exec(text);
  if (minutes) {
    const n = toNumber(minutes[1]);
    return confirmed(String(n), `${n} minutes`);
  }
  const hours = new RegExp(`^(${NUMBER_PATTERN}|an?)\\s*(h|hrs?|hours?)$`, "i").exec(text);
  if (hours) {
    const n = Math.round((/^an?$/i.test(hours[1]) ? 1 : toNumber(hours[1])) * 60);
    return confirmed(String(n), `${n} minutes`);
  }
  if (text === "half an hour") return confirmed("30", "30 minutes");
  const n = firstNumber(text);
  if (n) {
    const total = Math.round(/\b(h|hrs?|hours?)\b/.test(text) ? n * 60 : n);
    return unsure(String(total), `${total} minutes`, raw.trim());
  }
  return unsure(raw.trim(), capitalize(raw.trim()), raw.trim());
}

const READERS = {
  dishIdea: readDish,
  servings: readServings,
  diet: readDiet,
  targetTime: readTargetTime,
};

/** { value, display, status, heard? } for a typed or spoken answer. A
 * quick-answer label used as-is is always a confident read. */
export function interpretAnswer(question, text) {
  const option = question.options.find((o) => o.label === text.trim());
  if (option) return confirmed(option.value, option.label);
  const read = READERS[question.id] ?? ((raw) => confirmed(raw.trim(), raw.trim()));
  return read(text);
}

/** The agent's echo for a read it isn't sure of, prepended to its next turn. */
export function echoFor(reading) {
  return `I took that as ${reading.display} — it's on the right if you want to check it.`;
}

/**
 * One slot per question, in question order:
 * [{ id, label, status, display, heard }] where status is
 * "confirmed" | "low-confidence" | "asking" | "pending".
 */
export function conversationSlots(conversation) {
  const { understanding = {}, answers = {}, questionIndex = 0, complete = false } = conversation;
  return ELICITATION_QUESTIONS.map((question, i) => {
    const base = { id: question.id, label: question.slotLabel };
    const reading = understanding[question.id];
    if (reading) return { ...base, status: reading.status, display: reading.display, heard: reading.heard };
    // Sessions from before the sidecar existed have answers but no
    // readings; show what they answered as-is.
    if (i < questionIndex && answers[question.id] != null) {
      return { ...base, status: "confirmed", display: String(answers[question.id]) };
    }
    return { ...base, status: !complete && i === questionIndex ? "asking" : "pending" };
  });
}
