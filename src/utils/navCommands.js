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

// Phrases where a movement word is doing ordinary work. Checked first,
// because "next week" contains "next" and always will.
const NOT_NAVIGATION = [
  /\bnext (?:week|time|day|month|year|morning|one)\b/,
  /\bback (?:in|up|off)\b/,
  /\bgo back to that\b/,
  /\bcontinue (?:to|with|cooking|stirring|until)\b/,
  /下(?:个|一)(?:星期|礼拜|周|月|次)/,
];

// Two kinds of pattern per action:
//   explicit — unmistakably an instruction. Allowed at any length,
//              because the phrasing itself is the evidence.
//   bare     — a word that merely means movement. Short utterances only.
// Ordered so "go back" is never read as "go to ...".
const ACTIONS = [
  {
    action: "back",
    explicit: [
      /\bgo back\b/,
      /\b(?:last|previous) (?:page|step|screen)\b/,
      /返回/,
      /上一步/,
      /上一页/,
    ],
    bare: [/\bback\b/, /\bprevious\b/, /后退/],
  },
  {
    action: "next",
    explicit: [
      /\b(?:go|move|take me|skip|jump) (?:on |to )?(?:the )?next\b/,
      /\bnext (?:page|step|screen)\b/,
      /下一步/,
      /下一页/,
    ],
    bare: [/\bnext\b/, /\bcontinue\b/, /\bcarry on\b/, /\bkeep going\b/, /\bmove on\b/, /继续/],
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
 * @returns {{ action: string, path?: string }} "none" when nothing
 *          matched — the common case, since most of what gets said near
 *          a kitchen is not a command.
 */
export function matchNavCommand(text, { route = "/", reachable } = {}) {
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

  // CJK has no spaces, so counting words there is meaningless; collapse
  // each run to one token before measuring.
  const wordCount = said.replace(/[一-鿿]+/g, " x ").split(" ").filter(Boolean).length;

  for (const { action, explicit, bare } of ACTIONS) {
    if (explicit.some((p) => p.test(said))) return { action };
    if (bare.some((p) => p.test(said)) && wordCount <= MAX_BARE_COMMAND_WORDS) {
      return { action };
    }
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
