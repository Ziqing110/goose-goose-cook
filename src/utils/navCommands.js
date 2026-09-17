// Voice navigation: spoken words -> a route, or nothing.
//
// Deliberately a matcher and not an LLM. The vocabulary is small and
// closed, and paying a model round-trip to move between pages would add
// latency to the one interaction with no tolerance for it — you said
// "next" and you are staring at the screen waiting for it to happen.
//
// BILINGUAL BY NECESSITY, not ambition. universal-3-5-pro code-switches
// natively and we don't tell it to stop, so a transcript can come back
// in Mandarin mid-sentence. A matcher that only knew English would fail
// silently on half of what gets said in this kitchen.
//
// Every command here is reversible — the worst case is you're on a page
// you didn't want and you say "back". Irreversible actions (approving a
// recipe, starting a cook) are deliberately NOT here; each gets its own
// confirmation built around what it actually risks.

/** Routes reachable by name, with what people actually call them. */
const DESTINATIONS = [
  { path: "/", names: ["home", "the start", "首页", "主页", "回家"] },
  {
    path: "/session/kitchen-setup",
    names: ["kitchen setup", "the kitchen", "equipment", "厨房", "设备"],
  },
  {
    path: "/session/conversation",
    names: ["conversation", "the questions", "对话", "问题"],
  },
  {
    path: "/session/inventory",
    names: ["inventory", "the recipe", "the board", "ingredients", "食材", "配料", "菜谱"],
  },
  {
    path: "/session/voice-binding",
    names: ["voice binding", "voices", "the cooks", "声音", "厨师"],
  },
  {
    path: "/session/schedule",
    names: ["schedule", "the timeline", "the plan", "时间表", "计划"],
  },
  {
    path: "/session/live-cook",
    names: ["live cook", "cooking", "the cook", "开始做饭", "做饭"],
  },
];

// A bare movement word only counts as a command in a SHORT utterance.
// "next" is a command; "we should do this again next week" is
// conversation that happens to contain it. Cruder than parsing intent,
// but the right shape — nobody navigates a wizard in a long sentence.
const MAX_BARE_COMMAND_WORDS = 4;

// Phrases where a movement word is doing ordinary work. A blocklist is
// whack-a-mole by nature — it only knows the idioms someone thought of —
// so it is the LAST line of defence here, not the first. The structural
// rules below do the real work.
const NOT_NAVIGATION = [
  /\bnext (?:week|time|day|month|year|morning|one)\b/,
  /\bback (?:in|up|off)\b/,
  /\bcontinue (?:to|with|cooking|stirring|until)\b/,
  /下(?:个|一)(?:星期|礼拜|周|月|次)/,
];

// A command has no subject. You say "next", not "we should go next" —
// the moment a sentence names who is doing something, it is describing
// or discussing, not instructing the app.
//
// This is the structural version of the blocklist, and it generalises:
// "we should continue", "I'll be back", "you carry on", 我们继续做饭吧
// are all caught by the same rule, without anyone having to predict
// them. Applied only to bare words — "take me to the schedule" contains
// "me" and is unambiguously a command, but it matches as a destination
// before this is ever consulted.
const HAS_SUBJECT =
  /\b(?:i|i'll|i'm|i've|we|we'll|we're|you|you'll|you're|he|she|they|let|lets|let's)\b|我|你|他|她|咱们/;

// Below this, the transcript is a guess. From the R-core recording,
// genuinely garbled turns bottomed out around 0.2-0.4 word confidence
// ("And that's you." at 0.39) while clean short commands sat above 0.9.
// Acting on a guess is how you navigate somewhere nobody asked for.
const MIN_BARE_CONFIDENCE = 0.6;

// Between these two floors the transcript is plausible but not solid,
// and the same applies just past the length cap. Rather than silently
// dropping those — which loses real commands and looks like the app
// ignoring you — they come back as `confirm`, and the bar asks.
//
// A subject is NOT ambiguous. "we should continue" is someone talking,
// and asking "did you mean next?" every time two people discuss the
// cooking would be worse than saying nothing.
const CONFIRM_CONFIDENCE = 0.4;
const CONFIRM_COMMAND_WORDS = 8;

const YES = /^(?:yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|confirm|please)\b|^(?:是|是的|对|好|好的|确认|可以|行)/;
const NO = /^(?:no|nope|nah|don't|do not|cancel|never ?mind|stop|wait)\b|^(?:不|不是|不要|取消|算了|等)/;

/**
 * Answer to a pending confirmation.
 * @returns {"yes"|"no"|null} null when it isn't an answer at all, which
 *          the caller should treat as abandoning the question rather
 *          than as a "no" — the person moved on to something else.
 */
export function matchConfirmation(text) {
  const said = normalize(text);
  if (!said) return null;
  // Answers are short. "no, the other one next to the stock" is someone
  // pointing at a jar, not declining a prompt.
  const units =
    said.replace(/[一-鿿]/g, " ").split(" ").filter(Boolean).length +
    (said.match(/[一-鿿]/g) || []).length;
  if (units > 4) return null;
  if (YES.test(said)) return "yes";
  if (NO.test(said)) return "no";
  return null;
}

// Two kinds of pattern per action:
//   explicit — unmistakably an instruction. Allowed at any length,
//              because the phrasing itself is the evidence.
//   bare     — a word that merely means movement. Short utterances only.
// Ordered so "go back" is never read as "go to ...".
const ACTIONS = [
  {
    action: "back",
    // The Chinese command words live in `bare`, not here. "go back" is
    // explicit because it takes three English words to say — the
    // phrasing is the evidence. 返回 is one word, so 返回厨房拿个碗
    // ("go back to the kitchen for a bowl") contains it exactly the way
    // "back" hides inside "back in a minute". It needs the same gate.
    explicit: [/\bgo back\b/, /\b(?:last|previous) (?:page|step|screen)\b/],
    bare: [/\bback\b/, /\bprevious\b/, /返回/, /后退/, /上一步/, /上一页/],
  },
  {
    action: "next",
    explicit: [
      /\b(?:go|move|take me|skip|jump) (?:on |to )?(?:the )?next\b/,
      /\bnext (?:page|step|screen)\b/,
    ],
    bare: [
      /\bnext\b/, /\bcontinue\b/, /\bcarry on\b/, /\bkeep going\b/, /\bmove on\b/,
      /下一步/, /下一页/, /继续/,
    ],
  },
  {
    action: "help",
    // Asking a question moves nobody, so length never disqualifies it.
    explicit: [/\bwhat can i say\b/, /\bhelp\b/, /\bcommands?\b/, /帮助/, /能说什么/],
    bare: [],
  },
];

const normalize = (s) =>
  (s || "")
    .toLowerCase()
    // Keep CJK — that block is where the dish names and the Chinese
    // command words live. Stripping it would delete the Chinese
    // entirely, and the failure would look like "it didn't hear me".
    .replace(/[^a-z0-9\s'一-鿿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * @param {string} text              what was said
 * @param {object} ctx
 * @param {string} ctx.route         current pathname
 * @param {string[]} [ctx.reachable] paths the session guards allow;
 *                                   omit to allow any
 * @param {number} [ctx.confidence]  lowest word confidence in the turn,
 *                                   0-1; omit to skip the check
 * @returns {{ action: string, path?: string }} "none" when nothing
 *          matched — the common case, since most of what gets said near
 *          a kitchen is not a command.
 */
export function matchNavCommand(text, { route = "/", reachable, confidence } = {}) {
  const said = normalize(text);
  if (!said) return { action: "none" };

  // Named destinations first: "go to the schedule" contains "go", which
  // a bare movement pattern would otherwise swallow.
  for (const dest of DESTINATIONS) {
    for (const name of dest.names) {
      if (!said.includes(normalize(name))) continue;
      // A name alone isn't a command — "the schedule looks tight" is
      // talking about it, not asking to go there. Require a verb.
      if (!/\b(go|open|show|take me|jump|switch|navigate)\b|去|打开|回到|切换/.test(said)) continue;
      if (dest.path === route) return { action: "already", path: dest.path };
      if (reachable && !reachable.includes(dest.path)) {
        return { action: "blocked", path: dest.path };
      }
      return { action: "goto", path: dest.path };
    }
  }

  if (NOT_NAVIGATION.some((p) => p.test(said))) return { action: "none" };

  // Length, in units comparable across both scripts.
  //
  // CJK has no spaces, so Latin word-splitting sees a whole Chinese
  // sentence as one token. Collapsing each run to a single unit — which
  // is what this did first — gave Chinese NO length protection at all:
  // 继续搅拌直到变稠 ("continue stirring until it thickens") counted as
  // one word and passed a gate meant to stop exactly that.
  //
  // Counting characters instead is crude but correctly shaped. Chinese
  // command words here are two characters (继续, 返回), so the same cap
  // admits a bare command and rejects a sentence containing one.
  const latinWords = said.replace(/[一-鿿]/g, " ").split(" ").filter(Boolean).length;
  const cjkChars = (said.match(/[一-鿿]/g) || []).length;
  const wordCount = latinWords + cjkChars;

  // Three independent reasons a bare word doesn't count. Computed once,
  // because "help" is exempt from all of them — asking a question moves
  // nobody, so none of these risks apply to it.
  const tooLong = wordCount > MAX_BARE_COMMAND_WORDS;
  const hasSubject = HAS_SUBJECT.test(said);
  const unsure = typeof confidence === "number" && confidence < MIN_BARE_CONFIDENCE;

  // Plausible but not solid: slightly over the length cap, or heard with
  // middling confidence. Worth asking about rather than dropping.
  const maybeLong = wordCount > MAX_BARE_COMMAND_WORDS && wordCount <= CONFIRM_COMMAND_WORDS;
  const maybeUnsure =
    typeof confidence === "number" &&
    confidence < MIN_BARE_CONFIDENCE &&
    confidence >= CONFIRM_CONFIDENCE;

  for (const { action, explicit, bare } of ACTIONS) {
    const isExplicit = explicit.some((p) => p.test(said));
    if (!isExplicit && !bare.some((p) => p.test(said))) continue;
    if (action === "help") return { action };

    // A subject means conversation, full stop. Not ambiguous, not worth
    // a prompt — asking "did you mean next?" every time two people
    // discuss the cooking would be worse than staying quiet.
    //
    // Explicit phrasing buys a pass on LENGTH, which is what makes it
    // explicit, but not on having a subject.
    if (hasSubject) return { action: "none" };
    if (unsure && !maybeUnsure) return { action: "none" };
    if (!isExplicit && tooLong && !maybeLong) return { action: "none" };

    if (maybeUnsure || (!isExplicit && maybeLong)) {
      return { action, confirm: true };
    }
    return { action };
  }

  return { action: "none" };
}

/** What to say on this page, for the VoiceBar hint. */
export function navHintFor(route) {
  const elsewhere = DESTINATIONS.find((d) => d.path !== route);
  return {
    line: `Say “next”, “back”, or “go to ${elsewhere?.names[0] ?? "home"}”.`,
    sub: "Voice navigation — say “help” for the full list.",
  };
}

/** Destination names, for the "help" action. */
export function navCommandList() {
  return DESTINATIONS.map((d) => d.names[0]);
}

/** Friendly name for a route, for confirmation prompts. */
export function pathLabel(path) {
  return DESTINATIONS.find((d) => d.path === path)?.names[0] ?? "that page";
}
