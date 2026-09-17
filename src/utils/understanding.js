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

/**
 * One or more dish names. `value` is always an ARRAY, because the
 * session can hold several recipes and shared steps only mean anything
 * across more than one dish.
 *
 * Splitting on "and" is the weak point: "macaroni and cheese" is one
 * dish, not two, and nothing here can tell it from "soup and salad". So
 * a split on "and" is never reported as confident — the sidecar shows it
 * as a guess and the cook can correct it. The LLM reader handles this
 * properly; this is the fallback for when it can't be reached.
 */
function readDishes(raw) {
  const text = raw.trim();
  const vague = /\?|\b(maybe|or|something|not sure|idk|either|whatever|anything)\b/i.test(text);
  const splitOnAnd = /\band\b/i.test(text) && !/[,+&]/.test(text);
  const dishes = text
    .split(/\s*(?:,|\band\b|\bplus\b|&|\+)\s*/i)
    .map((d) => d.trim())
    .filter(Boolean);

  if (!dishes.length) return unsure([], capitalize(text), text);

  // Matches how runTitle joins dish names, so the sidecar and the run log
  // describe the same session the same way.
  const display = dishes.map(capitalize).join(" + ");
  const wordy = dishes.some((d) => d.split(/\s+/).length > 5);
  const guessed = vague || wordy || (splitOnAnd && dishes.length > 1);
  return guessed ? unsure(dishes, display, text) : confirmed(dishes, display);
}

// How much each step should explain. Never a gate on what can be cooked:
// "beginner" means say more, not attempt less.
const SKILL_LABELS = {
  beginner: "Explain everything",
  regular: "Normal detail",
  confident: "Just the essentials",
};

function readSkill(raw) {
  const text = normalize(raw);
  if (/\b(beginner|new|never|first time|learning|explain everything|no idea|novice)\b/.test(text)) {
    return confirmed("beginner", SKILL_LABELS.beginner);
  }
  if (/\b(confident|experienced|expert|pro|chef|essentials|skip|brief|terse)\b/.test(text)) {
    return confirmed("confident", SKILL_LABELS.confident);
  }
  if (/\b(regular|normal|some|average|fine|okay|ok|decent|standard)\b/.test(text)) {
    return confirmed("regular", SKILL_LABELS.regular);
  }
  // The middle setting is the safe miss: it neither buries an expert in
  // detail nor leaves a beginner without any.
  return unsure("regular", SKILL_LABELS.regular, raw.trim());
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
  dishIdea: readDishes,
  servings: readServings,
  diet: readDiet,
  skill: readSkill,
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
