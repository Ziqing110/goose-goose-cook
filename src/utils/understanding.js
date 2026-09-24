// The agent's reading of each conversation answer, shown in the
// understanding sidecar. There's no real extraction service yet, so this
// is a small per-question interpreter: an answer that parses cleanly is
// "confirmed", one that only partly parses (hedges, extra words, no
// number where one is expected) is "low-confidence" and keeps the raw
// text as `heard` so the cook can check it. The `value` it returns is
// what goes into conversation.answers, so downstream readers
// (useSessionRecipes, runStats) get a number instead of a sentence.
import { ELICITATION_QUESTIONS } from "../data/dishes.js";
import { matchConfirmation } from "./navCommands.js";

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

// Not an answer to the question at all, so the goose asks again rather
// than taking it. `display` is what was heard, which the notes show
// while the goose asks. `suggestion` is a reading the goose offers ("Did
// you mean vegan?") for a plain yes to accept.
//
// It keeps asking for as long as the answer isn't one. Taking a best
// guess the second time round turned "啊，可以，可以" ("ah, sure, sure")
// into a one-hour target, which is the same fault as taking it the first
// time. Nobody is stuck: the quick answers under the question always
// work, and the second ask says so. (`alreadyAsked` only changes that
// wording — and, for dietary needs, lets an unfamiliar constraint in the
// cook's own words through, since no list can hold them all.)
const askAgain = (raw, followUp, suggestion = null) => ({
  value: null,
  display: capitalize(raw.trim()),
  status: "needs-followup",
  followUp,
  heard: raw.trim(),
  ...(suggestion ? { suggestion } : {}),
});

// Words that carry no answer, English and Chinese: acknowledgements,
// fillers, a question back. Speech in this kitchen comes in both — the
// recogniser is set to English and Mandarin — so a reader that knew only
// English read every Chinese reply as "no number here" and, worse, every
// Chinese "sure" as an answer.
const NON_ANSWER_PHRASES = /\b(?:i don'?t know|i'?m not sure|not sure|what do you mean|say (?:that|it) again|come again|sorry)\b/g;
const NON_ANSWER_WORDS = new Set([
  "yes", "yeah", "yep", "yup", "ok", "okay", "sure", "fine", "alright", "right", "cool",
  "um", "umm", "uh", "uhh", "er", "erm", "hmm", "mm", "oh", "ah", "what", "huh", "why", "so", "well",
  "maybe", "idk", "dunno", "hi", "hey", "hello", "please", "thanks",
]);
const NON_ANSWER_CJK = /不知道|随便|怎么了|咋了|什么|好的|对的|是的|嗯嗯|可以|啊|嗯|哦|噢|呃|额|好|行|对|是|咋|怎么|啥|吗|呢|吧|哈|嘿|喂|了|的/g;
const PUNCTUATION = /[，。？！、；：,.!?;:~…"“”()（）]+/g;

/** True when nothing in the answer is an answer: "okay", "啊，可以，可以", "what?". */
export function isNonAnswer(raw) {
  const words = String(raw ?? "")
    .toLowerCase()
    .replace(NON_ANSWER_PHRASES, " ")
    .replace(PUNCTUATION, " ")
    .replace(NON_ANSWER_CJK, " ")
    .split(/\s+/)
    .filter((w) => w && !NON_ANSWER_WORDS.has(w));
  return words.length === 0;
}

// Chinese numerals, for the numeric slots only — "一般" is a skill word,
// not a one. "三四" is a range, not thirty-four, and is left alone.
const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnToNumber(run) {
  if (/[一二两三四五六七八九]{2}/.test(run)) return null;
  let total = 0;
  let digit = 0;
  for (const ch of run) {
    if (ch in CN_DIGIT) digit = CN_DIGIT[ch];
    else if (ch === "百") [total, digit] = [total + (digit || 1) * 100, 0];
    else if (ch === "十") [total, digit] = [total + (digit || 1) * 10, 0];
  }
  return total + digit;
}
const withDigits = (text) =>
  text.replace(/[零〇一二两三四五六七八九十百]+/g, (run) => {
    const n = cnToNumber(run);
    return n == null ? run : String(n);
  });

const pad2 = (n) => String(n).padStart(2, "0");
function durationLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h ? `${h} ${h === 1 ? "hour" : "hours"}` : "";
  const mins = m ? `${m} minutes` : "";
  return [hours, mins].filter(Boolean).join(" ") || "0 minutes";
}

/**
 * A time of day in the answer — "7:30 pm", "by 8", "三点四十" — as
 * { hour, minute, meridiem }, or null. A time of day is a
 * reasonable reading of "target finish time", but the plan needs a
 * length, so it is only ever offered back as a guess.
 */
function clockTime(text) {
  const t = withDigits(text.replace(/\b([ap])\.?m\.?/g, "$1m"));
  const cn = /(上午|早上|早晨|中午|下午|傍晚|晚上)?\s*(\d{1,2})\s*点\s*(?:(半)|(\d{1,2})\s*分?)?/.exec(t);
  if (cn) {
    const meridiem = cn[1] ? (/上午|早/.test(cn[1]) ? "am" : "pm") : null;
    return { hour: Number(cn[2]), minute: cn[3] ? 30 : Number(cn[4] || 0), meridiem };
  }
  const en =
    /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/.exec(t) ||
    /\b(\d{1,2})()\s*(am|pm)\b/.exec(t) ||
    /\b(\d{1,2})()\s*o'?clock()\b/.exec(t) ||
    /\b(?:at|by)\s+(\d{1,2})(?::(\d{2}))?()\b/.exec(t);
  if (en) return { hour: Number(en[1]), minute: Number(en[2] || 0), meridiem: en[3] || null };
  return null;
}

/** Minutes from `now` until the next time the clock reads that time. */
function minutesUntil({ hour, minute, meridiem }, now) {
  if (hour > 23 || minute > 59) return null;
  const at = (h) => {
    const d = new Date(now);
    d.setHours(h, minute, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  };
  const hours =
    hour > 12 ? [hour] : meridiem === "pm" ? [(hour % 12) + 12] : meridiem === "am" ? [hour % 12] : [hour % 12, (hour % 12) + 12];
  const soonest = Math.min(...hours.map((h) => at(h).getTime()));
  return Math.round((soonest - now.getTime()) / 60000);
}

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
function readDishes(raw, { alreadyAsked } = {}) {
  const text = raw.trim();
  // Nothing in it, or a sentence about the speaker ("I'm a duck", "我是
  // Megan") rather than a dish.
  if (isNonAnswer(text) || /^(?:i'?m|i am|my name|this is|it'?s me)\b|^(?:我是|我叫)/i.test(text)) {
    return askAgain(raw, alreadyAsked ? "I still need a dish — name one or a few, like mapo tofu." : "Which dish? Name one or a few — like mapo tofu.");
  }
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

function readSkill(raw, { alreadyAsked } = {}) {
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
  // No \b around these: it never matches next to Chinese characters.
  if (/新手|第一次|不太会|不会做|没做过|详细|仔细|多讲|讲清楚|全部讲/.test(text)) return confirmed("beginner", SKILL_LABELS.beginner);
  if (/熟练|老手|简单点|简略|要点|简短|别太啰嗦|不用讲/.test(text)) return confirmed("confident", SKILL_LABELS.confident);
  if (/正常|一般|普通|适中|中等/.test(text)) return confirmed("regular", SKILL_LABELS.regular);
  return askAgain(
    raw,
    alreadyAsked
      ? "Pick one — explain everything, normal detail, or just the essentials. The buttons below work too."
      : "Explain everything, normal detail, or just the essentials?",
  );
}

const servingsLabel = (n) => `${n} ${n === 1 ? "serving" : "servings"}`;

// The word (or Chinese characters) right after the first number, which is
// what that number counts: "6 light year" counts light years. null when
// nothing follows it.
function unitAfterFirstNumber(text) {
  const m = new RegExp(`(?:^|[^\\w.])(${NUMBER_PATTERN})(?![\\w.])\\s*([a-z%']+|[\\u4e00-\\u9fff]+)?`, "i").exec(text);
  return m ? (m[2] || "").toLowerCase() || null : null;
}
// Words that can sit after a number without being its unit: "40 or so",
// "6 or 7", "45 I think", "30 tops".
const NUMBER_CONNECTOR = /^(?:or|to|and|ish|maybe|max|tops|at|i|we|is|if|please|roughly|about|give|would|should|sounds|works|then)$/;
const bareNumber = (text) => new RegExp(`^(?:${NUMBER_PATTERN})$`, "i").test(text);

// People-sized: the plan scales every amount by this.
const MAX_SERVINGS = 30;
const PEOPLE_UNIT = /^(?:servings?|people|persons?|portions?|guests?|of|adults?|kids?|children|friends|mates|folks|us|pax|eaters?)$|^(?:个|位|人|口|份)/;

function plausibleServings(reading, raw) {
  const n = Number(reading.value);
  if (reading.status === "needs-followup" || !Number.isFinite(n)) return reading;
  if (n < 1 || !Number.isInteger(n)) return askAgain(raw, "How many people is that? A whole number — like 2 or 4.");
  if (n > MAX_SERVINGS) {
    return askAgain(raw, `Cooking for ${n}? That's a lot of plates. Say yes, or tell me how many.`, {
      value: String(n),
      display: servingsLabel(n),
    });
  }
  return reading;
}

function readServings(raw, context = {}) {
  return plausibleServings(parseServings(raw, context), raw);
}

function parseServings(raw, { alreadyAsked } = {}) {
  const text = normalize(raw);
  const clean = new RegExp(`^(${NUMBER_PATTERN})\\s*(servings?|people|persons?|portions?|guests?|of us)?$`, "i").exec(text);
  if (clean) {
    const n = toNumber(clean[1]);
    return confirmed(String(n), servingsLabel(n));
  }
  if (/^(?:just|only) (?:me|myself)$|^(?:me|myself)(?: alone)?$/.test(text)) return confirmed("1", servingsLabel(1));
  const t = withDigits(text);
  const cn = /(\d+)\s*(?:个人|个|位|口人|口|人|份)/.exec(t);
  if (cn) return confirmed(cn[1], servingsLabel(Number(cn[1])));
  if (/我们?俩|俩人|咱俩|两口子/.test(text)) return confirmed("2", servingsLabel(2));
  if (/就我|我自己|只有我/.test(text)) return confirmed("1", servingsLabel(1));
  // "Me and three mates" is four.
  const meAnd = new RegExp(`\\b(?:me|myself) (?:and|plus) (${NUMBER_PATTERN})\\b`, "i").exec(t);
  if (meAnd) return unsure(String(toNumber(meAnd[1]) + 1), servingsLabel(toNumber(meAnd[1]) + 1), raw.trim());
  const n = firstNumber(t);
  if (n) {
    const unit = unitAfterFirstNumber(t);
    if (unit && !PEOPLE_UNIT.test(unit) && !NUMBER_CONNECTOR.test(unit)) {
      return askAgain(raw, `“${raw.trim()}” isn't a number of people — how many are eating?`);
    }
    return unsure(String(n), servingsLabel(n), raw.trim());
  }
  // No number in it at all. It used to be stored as-is — a name where
  // the plan multiplies every amount by this — and the questions moved on.
  return askAgain(
    raw,
    alreadyAsked
      ? "I still need a number of people — say it, like “four”, or tap one below."
      : "How many people is that? Just the number — like 2 or 4.",
  );
}

// What a dietary answer is made of. Before, anything at all was "a
// constraint in the cook's own words" and taken as confirmed; then any
// "no" or "not" was, so "I'm not a duck" went down as a dietary need.
// Now it has to be about food:
//   a diet by name or an allergy            "halal", "Jain", "lactose intolerant"
//   a restriction on a food                 "no pork", "my kid hates onions"
//   nothing but foods                       "peanuts", "shellfish and nuts"
// "I'm a duck" names a food and still isn't one of these.
const DIET_NAMES = /\b(?:vegan|vegetarian|veggie|pescatarian|pescetarian|flexitarian|halal|kosher|jain|keto|ketogenic|paleo|whole ?30|fodmap|mediterranean|diabetic|celiac|coeliac|plant[ -]based|(?:gluten|dairy|nut|lactose|egg|soy|sugar|meat|pork)[ -]free|low[ -](?:carb|fat|sodium|salt|sugar|fodmap|spice))\b|\ballerg\w*|\bintoleran\w*|\bsensitiv\w* to\b/;
const FOOD_WORDS = new Set(`
  meat meats pork bacon ham sausage beef steak lamb mutton veal goat chicken duck turkey poultry offal
  fish seafood shellfish shrimp shrimps prawn prawns crab lobster clam clams oyster oysters mussels squid
  egg eggs dairy milk cheese butter cream yogurt yoghurt gluten wheat flour bread pasta noodles rice grains
  nut nuts peanut peanuts almond almonds walnut walnuts cashew cashews pecans hazelnuts pistachios
  soy soya tofu sesame corn beans lentils legumes chickpeas peas nightshades
  garlic onion onions shallots scallion scallions leek mushroom mushrooms tomato tomatoes pepper peppers
  eggplant aubergine celery cilantro coriander ginger chili chilli chilies chillies spice spices spicy heat
  sugar sweets salt sodium msg carbs carb fat oil fried alcohol wine beer caffeine coffee fruit fruits
  strawberries citrus avocado coconut
`.trim().split(/\s+/));
const RESTRICTION = /\b(?:no|not|none of|without|avoid\w*|can'?t|cannot|don'?t|doesn'?t|won'?t|never|except|but|less|low|little|hates?|dislikes?|skip|keep off|cut out|go easy on)\b|-free\b/;
const FOOD_FILLER = new Set(["and", "or", "a", "an", "the", "some", "any", "also", "plus", "please", "thanks"]);

// "I'm (not) a duck" says what someone is, not what they eat: its "not"
// restricts nothing and its "duck" is not on a plate. Such clauses are
// taken out before the food words are looked at, so "my kid is a picky
// eater, no onions" still counts. "Not a fan of" is a restriction.
const IDENTITY = /\b(?:i'?m|i am|we'?re|we are|you'?re|you are|he'?s|she'?s|it'?s|that'?s|this is|is|are|am)\s+(?:not\s+)?(?:a|an)\s+\S+/g;
const NOT_A_FAN = /\bnot (?:a |the )?(?:big |huge )?fan of\b/;

function isDietaryNeed(text) {
  if (DIET_NAMES.test(text)) return true;
  const restricted = NOT_A_FAN.test(text);
  const rest = restricted ? text : text.replace(IDENTITY, " ");
  const words = rest.replace(PUNCTUATION, " ").split(/\s+/).filter(Boolean);
  if (!words.some((w) => FOOD_WORDS.has(w))) return false;
  if (restricted || RESTRICTION.test(rest)) return true;
  return words.every((w) => FOOD_WORDS.has(w) || FOOD_FILLER.has(w));
}

// What a misheard dietary word most likely was. Words only, compared
// whole: "Megan" is one edit from vegan.
const DIET_GUESSES = [
  { word: "vegan", value: "vegan", display: "Vegan" },
  { word: "vegetarian", value: "vegetarian", display: "Vegetarian" },
  { word: "veggie", value: "vegetarian", display: "Vegetarian" },
  { word: "pescatarian", value: "pescatarian", display: "Pescatarian" },
  { word: "halal", value: "halal", display: "Halal" },
  { word: "kosher", value: "kosher", display: "Kosher" },
  { word: "keto", value: "keto", display: "Keto" },
  { word: "paleo", value: "paleo", display: "Paleo" },
  { word: "gluten", value: "gluten-free", display: "Gluten-free" },
  { word: "dairy", value: "dairy-free", display: "Dairy-free" },
];

function guessDiet(text) {
  const words = text.split(/\s+/).filter((w) => w.length >= 4);
  let best = null;
  for (const word of words) {
    for (const guess of DIET_GUESSES) {
      const d = editDistance(word, guess.word);
      const slack = guess.word.length >= 8 ? 2 : 1;
      if (d <= slack && (!best || d < best.d)) best = { d, guess };
    }
  }
  return best ? { value: best.guess.value, display: best.guess.display } : null;
}

// Chinese answers, matched without \b for the same reason as the skill
// words. "都可以" means "anything is fine" here, which is "none".
// Several can come together ("没有，都可以"); "没有过敏" is none, not an allergy.
const CN_DIET_NONE = /没什么(?:忌口|要求|限制)?|没(?:有)?(?:忌口|过敏)|不过敏|不忌口|不挑食?|什么都(?:能|可以)?吃|都能吃|都行|都可以|随便|没有|没|无/g;
const CN_SOFT = /[啊嗯呃哦的吧呢\s]/g;
function isChineseNone(text) {
  const core = text.replace(PUNCTUATION, "").replace(CN_SOFT, "");
  return core !== "" && core.replace(CN_DIET_NONE, "") === "";
}
// The same three shapes, in Chinese. "我不要回答" has a 不要 in it and
// no food, so it is not one.
const CN_DIET_NAMES = /素食|吃素|纯素|清真|过敏|不耐受|乳糖不耐|麸质|低糖|低盐|低脂|低碳|糖尿病/;
const CN_FOODS = /猪|牛|羊|鸡|鸭|鹅|鱼|虾|蟹|贝|海鲜|蛋|奶|乳|芝士|花生|坚果|核桃|杏仁|豆|麸|面|米|辣|糖|盐|油|酒|咖啡|葱|姜|蒜|香菜|芹菜|韭菜|洋葱|菇|蘑菇|肉|内脏|味精|甜|咸/;
const CN_RESTRICTION = /不吃|不要|不能吃|不能有|别放|少放|不放|不加|少加|不含|忌口|避免|不喜欢|讨厌|吃不了/;
function isChineseDietaryNeed(text) {
  if (CN_DIET_NAMES.test(text)) return true;
  if (!CN_FOODS.test(text)) return false;
  if (CN_RESTRICTION.test(text)) return true;
  // Nothing but a food or two: "花生", "海鲜和花生".
  return text.replace(PUNCTUATION, "").replace(/和|跟|还有|以及|、|\s/g, "").replace(new RegExp(CN_FOODS.source, "g"), "") === "";
}

function readDiet(raw, { alreadyAsked } = {}) {
  const text = normalize(raw);
  const plain = text.replace(PUNCTUATION, " ").trim();
  if (isChineseNone(text)) return confirmed("none", "No restrictions");
  if (/纯素/.test(text)) return confirmed("vegan", "Vegan");
  if (/^(?:吃素|素食|素的|吃素的)$/.test(plain)) return confirmed("vegetarian", "Vegetarian");
  if (isChineseDietaryNeed(text)) return confirmed(raw.trim(), raw.trim());
  // Checked before the constraint words below: "no allergies" names an
  // allergy and means there isn't one.
  if (/^(?:none|no|nope|nothing|anything|n\/a|no (?:thanks?|thank you)|not really|nothing (?:really|special)|none at all|(?:we|i) eat (?:everything|anything)|anything goes|no (?:restrictions?|constraints?|allergies|dietary (?:needs|restrictions?)))$/.test(text)) {
    return confirmed("none", "No restrictions");
  }
  if (text === "vegan") return confirmed("vegan", "Vegan");
  if (/^(vegetarian|veggie|no meat|meat-free)$/.test(text)) return confirmed("vegetarian", "Vegetarian");
  if (/\bvegan\b/.test(text)) return unsure("vegan", "Vegan", raw.trim());
  if (/\b(vegetarian|veggie|no meat|meat-free)\b/.test(text)) return unsure("vegetarian", "Vegetarian", raw.trim());
  // A constraint in the cook's own words (an allergy, say) — there's
  // nothing to misread, so it's taken as given.
  if (isDietaryNeed(text)) return confirmed(raw.trim(), capitalize(raw.trim()));

  const guess = guessDiet(text);
  if (guess) return askAgain(raw, `Did you mean “${guess.display}”? Say yes, or tell me again.`, guess);
  // Still not one, however often it is said. The second ask gives the
  // shapes an answer can take, since saying the same thing again won't.
  return askAgain(
    raw,
    alreadyAsked
      ? "I still need a dietary need — say “none”, a diet like vegetarian, or a food to avoid, like “no pork”."
      : `I didn't catch a dietary need in “${raw.trim()}”. Say “none”, or name it — vegetarian, vegan, an allergy.`,
  );
}

// Start to plated. Outside this it is still possible, but far more often
// a slip — "6" meant hours, "5 minutes" was a mishearing — so it is
// checked with the cook rather than planned around.
const MIN_TARGET_MINUTES = 10;
const MAX_TARGET_MINUTES = 6 * 60;
const TIME_UNIT = /^(?:m|mins?|minutes?|h|hrs?|hours?|half)$|^(?:分|个?半?小时|个?钟|钟头|半)/;

function plausibleLength(reading, raw) {
  const n = Number(reading.value);
  if (reading.status === "needs-followup" || !Number.isFinite(n)) return reading;
  if (n >= MIN_TARGET_MINUTES && n <= MAX_TARGET_MINUTES) return reading;
  const said = withDigits(normalize(raw));
  // A bare small number is more likely hours than minutes.
  if (bareNumber(said) && n >= 1 && n * 60 <= MAX_TARGET_MINUTES) {
    return askAgain(raw, `Did you mean ${durationLabel(n * 60)}? Say yes, or tell me how long.`, {
      value: String(n * 60),
      display: `${n * 60} minutes`,
    });
  }
  if (n <= 0) return askAgain(raw, "How long, roughly? Something like 45 minutes or an hour.");
  const check = n < MIN_TARGET_MINUTES
    ? `${durationLabel(n)} start to plated is very quick — is that right?`
    : `That's ${durationLabel(n)} — longer than I'd plan a dinner for. Is that right?`;
  return askAgain(raw, `${check} Say yes, or tell me how long.`, { value: String(n), display: `${n} minutes` });
}

function readTargetTime(raw, context = {}) {
  return plausibleLength(parseTargetTime(raw, context), raw);
}

function parseTargetTime(raw, { alreadyAsked, now = new Date() } = {}) {
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

  // Halves and quarters, which people say constantly and no amount of
  // number-word matching catches: "an hour and a half", "two and a half
  // hours". Without this they fell through to the raw-text branch below
  // and put a sentence where the scheduler expects minutes.
  // Both word orders, because people use both and they are not
  // interchangeable to a regex: "two and a half hours" puts the half
  // before the unit, "an hour and a half" puts it after.
  const halfBefore = new RegExp(`^(${NUMBER_PATTERN}|an?)\\s*(?:and\\s*)?(?:a\\s*)?half\\s*(?:h|hrs?|hours?)$`, "i");
  const halfAfter = new RegExp(`^(${NUMBER_PATTERN}|an?)\\s*(?:h|hrs?|hours?)\\s*(?:and\\s*)?(?:a\\s*)?half$`, "i");
  const half = halfBefore.exec(text) || halfAfter.exec(text);
  if (half) {
    const base = /^an?$/i.test(half[1]) ? 1 : toNumber(half[1]);
    const n = Math.round((base + 0.5) * 60);
    return confirmed(String(n), `${n} minutes`);
  }

  // Chinese lengths: "四十分钟", "一个半小时", "半小时". A 点 makes it a
  // time of day instead, below.
  const t = withDigits(text);
  if (!/点/.test(t)) {
    const cnHours = /(\d+(?:\.\d+)?)\s*个?\s*(半)?\s*(?:小时|钟头|个钟)/.exec(t);
    if (cnHours) {
      const n = Math.round((Number(cnHours[1]) + (cnHours[2] ? 0.5 : 0)) * 60);
      return confirmed(String(n), `${n} minutes`);
    }
    if (/半\s*个?\s*(?:小时|钟头|钟)/.test(t)) return confirmed("30", "30 minutes");
    const cnMinutes = /(\d+)\s*(?:分钟|分)/.exec(t);
    if (cnMinutes) return confirmed(cnMinutes[1], `${cnMinutes[1]} minutes`);
  }

  // A time of day — "三点四十", "by 7:30". A fair reading of "finish
  // time", but the plan runs on a length, so the length from now is
  // offered back for a yes rather than assumed.
  const clock = clockTime(text);
  if (clock) {
    const said = `${clock.hour}:${pad2(clock.minute)}${clock.meridiem ? ` ${clock.meridiem}` : ""}`;
    const n = minutesUntil(clock, now);
    if (n != null && n >= 15 && n <= 6 * 60) {
      return askAgain(
        raw,
        `Done by ${said} — that's about ${durationLabel(n)} from now. Say yes, or tell me how long it should take.`,
        { value: String(n), display: `${n} minutes` },
      );
    }
    return askAgain(raw, `I need how long it should take, not a time of day — say the minutes, or tap one below.`);
  }

  const n = firstNumber(t);
  if (n) {
    // "6 light year", "3 days", "20 km": a number, but not of minutes.
    const unit = unitAfterFirstNumber(t);
    if (unit && !TIME_UNIT.test(unit) && !NUMBER_CONNECTOR.test(unit)) {
      return askAgain(raw, `“${raw.trim()}” isn't a cooking time — say it in minutes or hours, like 45 minutes.`);
    }
    const isHours = /\b(h|hrs?|hours?)\b/.test(text);
    const total = Math.round((isHours ? n * 60 : n) + (/\bhalf\b/.test(text) ? (isHours ? 30 : 0) : 0));
    return unsure(String(total), `${total} minutes`, raw.trim());
  }

  // Nothing numeric at all. This slot MUST end up a number — the
  // scheduler does arithmetic on it — and a non-answer is not a guess
  // worth making for someone, so it asks until it has one.
  return askAgain(
    raw,
    alreadyAsked
      ? "I still need a length of time — say the minutes, or tap 30 minutes, 1 hour or 1½ hours below."
      : "How long, roughly? Something like 45 minutes or an hour.",
  );
}

const READERS = {
  dishIdea: readDishes,
  servings: readServings,
  diet: readDiet,
  skill: readSkill,
  targetTime: readTargetTime,
};

/**
 * { value, display, status, heard?, followUp?, suggestion? } for a typed
 * or spoken answer. A quick-answer label used as-is is always a
 * confident read.
 *
 * @param {object} [context]
 * @param {boolean} [context.alreadyAsked]  a follow-up was already put to
 *   them (or this is a correction typed into the notes): take the best
 *   reading instead of asking again.
 * @param {object} [context.suggestion]  { value, display } the last
 *   follow-up offered. A yes takes it; a no asks once more, openly.
 */
// What to ask after a "no" to "Did you mean…?".
const REASK_AFTER_NO = {
  servings: "Okay — how many people are eating?",
  diet: "Okay — what should I plan around? Say “none” if there's nothing.",
  targetTime: "Okay — how long should it take, start to plated? Say the minutes, or tap one below.",
};

export function interpretAnswer(question, text, { alreadyAsked = false, suggestion = null, now } = {}) {
  const option = question.options.find((o) => o.label === text.trim());
  if (option) return confirmed(option.value, option.label);
  if (suggestion) {
    const answer = matchConfirmation(text) ?? matchChineseConfirmation(text);
    if (answer === "yes") return confirmed(suggestion.value, suggestion.display);
    // "No" means "not that", not "no restrictions" — reading it as an
    // answer to the original question would get exactly that wrong.
    if (answer === "no") return askAgain(text, REASK_AFTER_NO[question.id] || question.agentText);
  }
  const read = READERS[question.id] ?? ((raw) => confirmed(raw.trim(), raw.trim()));
  return read(text, { alreadyAsked, now });
}

// "对", "是的", "可以" to "Did you mean…?". Only ever read as an answer to
// a question the goose just asked; on their own they answer nothing.
export function matchChineseConfirmation(text) {
  const t = String(text ?? "").replace(PUNCTUATION, "").replace(/^(?:啊|嗯|呃|哦)+/, "").trim();
  if (/^(?:对|是|是的|对的|好|好的|行|可以|嗯|没错|对啊|是啊|就是)+(?:啊|吧|呀|的)?$/.test(t)) return "yes";
  if (/^(?:不|不是|不对|没有|不行|不要)(?:的|啊|吧|呀)?/.test(t)) return "no";
  return null;
}

const ECHO_PREFIX = "I took that as";

/** The agent's echo for a read it isn't sure of, prepended to its next turn. */
export function echoFor(reading) {
  return `${ECHO_PREFIX} ${reading.display} — it's on the right if you want to check it.`;
}

/** True for an agent line that opens with an echo of an unsure reading.
 * The transcript stores the finished sentence rather than its parts, so
 * this is how the page spots the turn that asks you to check a reading
 * (see the HONK pill in ConversationPage). */
export function isEchoLine(text = "") {
  return text.startsWith(ECHO_PREFIX);
}

/**
 * One slot per question, in question order:
 * [{ id, label, status, display, heard }] where status is
 * "confirmed" | "low-confidence" | "asking" | "asking-again" | "pending".
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
