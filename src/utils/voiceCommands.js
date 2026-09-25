// Keyword command parsing for the live-cook screen. Deliberately dumb —
// this is the file that gets thrown away when real STT and an intent
// classifier land. What makes a dumb matcher workable is *candidate
// scoping*: "take the garlic" is trivially unambiguous against the 3
// steps you could actually claim, even though it'd be a coin-flip
// against all 20.
import { normalize, normalizeLoose, matchStepName, contentTokens } from "./stepNameMatch.js";
import { resolveCookRef } from "./cookVoice.js";

// Order matters: "we're done" must not fire a step completion, and
// "drop it" must not be read as "done".
const INTENTS = [
  // Pause/resume first: "resume" and "back on" would otherwise read as
  // "start", and "hold on" mustn't fire "on it".
  { intent: "resume", patterns: [/继续|接着/, /\bresume\b/, /\bunpause\b/, /\bback on\b/, /\bkeep going\b/] },
  { intent: "pause", patterns: [/暂停|等一下/, /\bpause\b/, /\bhold on\b/, /\btake (?:a )?(?:break|five)\b/, /\btime ?out\b/] },
  { intent: "finish_run", patterns: [/都好了|都做完了|可以上菜|全部完成/, /\bwe(?:'re| are)? done\b/, /\ball done\b/, /\bfinish(?: the)? cook/, /\bend the cook/, /\bdinner'?s up\b/] },
  { intent: "help", patterns: [/\bhelp\b/, /what can i say/, /\bcommands?\b/, /what can you do/] },
  { intent: "undo", patterns: [/\bundo\b/, /never ?mind/, /\boops\b/, /wait,? no\b/, /i didn'?t\b/] },
  { intent: "score", patterns: [/\bscores?\b/, /\bpoints?\b/, /leader ?board/, /who'?s winning/, /am i winning/] },
  { intent: "status", patterns: [/还要多久|还有多久|到哪了|接下来/, /\bstatus\b/, /what'?s next/, /what now/, /where are we/, /how (?:long|much)/] },
  { intent: "drop", patterns: [/\bdrop\b/, /put (?:it|this) back/, /someone else (?:can )?take/, /give (?:it|this) (?:back|up)/] },
  { intent: "claim", patterns: [/我来|我做|给我/, /\bclaim\b/, /i'?ll take\b/, /i'?ll do\b/, /\btakes?\b/, /i'?ve got\b/, /give me\b/, /\bmine\b/] },
  { intent: "skip", patterns: [/\bskip\b/, /forget (?:that|it)/, /not doing\b/, /cancel that/] },
  { intent: "done", patterns: [/好了|做好|完成|弄好/, /\bdone\b/, /\bfinish(?:ed)?\b/, /\bcomplete(?:d)?\b/, /got it\b/, /that'?s it\b/] },
  { intent: "start", patterns: [/开始|我上/, /\bstart(?:ing)?\b/, /\bbegin\b/, /let'?s go\b/, /\bon it\b/, /\bgo\b/] },
];

function detectIntent(text) {
  // normalizeLoose, not normalize: the ASCII-only one erases Chinese
  // outright, so every Mandarin command reached here as an empty string
  // and came back "unknown". Measured on the kitchen take, the model
  // path resolved all four Chinese utterances and this path resolved
  // none — which matters most exactly when the model is the thing that
  // has become unavailable.
  const norm = normalizeLoose(text);
  for (const { intent, patterns } of INTENTS) {
    const hit = patterns.find((p) => p.test(norm));
    if (hit) return { intent, matched: norm.match(hit)?.[0] ?? "" };
  }
  return { intent: "unknown", matched: "" };
}

// "Resume" said about later rather than now.
const NOT_NOW = /\b(?:don'?t|do not|not|later|yet|after|until|wait)\b|别|先不|等会|等下|待会|一会/;
const MAX_BARE_RESUME_UNITS = 4;

/**
 * Is this turn nothing but "resume"?
 *
 * While a run is paused, resuming is the one thing anybody could mean,
 * and the paused screen says to "say resume" — without the agent's
 * name. Everything else in the live cook has to be addressed, and so
 * did this, so doing what the screen said did nothing and only the
 * button worked. A short turn that is only a resume counts, name or
 * not; "we'll resume after the call" and "don't resume yet" do not.
 * Length is in words for Latin and characters for CJK, as elsewhere.
 */
export function isBareResume(text) {
  const said = normalizeLoose(text);
  if (!said || detectIntent(said).intent !== "resume" || NOT_NOW.test(said)) return false;
  const latin = said.replace(/[一-鿿]/g, " ").split(" ").filter(Boolean).length;
  const cjk = (said.match(/[一-鿿]/g) || []).length;
  return latin + cjk <= MAX_BARE_RESUME_UNITS;
}

/** Match the leftover words against a scoped candidate list. The
 *  similarity metric itself (Dice over content-word sets, three
 *  confidence tiers) lives in stepNameMatch.js, shared with the recipe
 *  graph's "add a task before/between" voice command. */
function resolveStepRef(text, matched, candidates, byId, agentName) {
  // Drop the agent's name before matching. It is addressed speech, not
  // part of the step's name, and leaving it in dilutes every score by a
  // word: "Goose, take the ginger and scallion" scored 2 hits out of 5
  // spoken words instead of 2 out of 4, which dropped it under the floor
  // and turned a clear match into "which one did you mean".
  const spoken = normalize(text).replace(matched, " ");
  const rest = agentName
    ? spoken.split(" ").filter((w) => w !== normalize(agentName)).join(" ")
    : spoken;
  const { stepId, candidates: alternates, confidence } = matchStepName(rest, candidates, (id) => byId[id]?.label);
  // Whether a step was NAMED at all, which is not the same as one being
  // matched. "done" names nothing; "done with the ginger" names something
  // that may simply not be in scope. Those two need opposite answers, so
  // the fallbacks below have to tell them apart.
  return { stepId, candidates: alternates, confidence, named: contentTokens(rest).length > 0 };
}

/**
 * @param {string} text  what the cook "said"
 * @param {object} ctx   { nodes, byId, activeStepId, claimable, ownQueue }
 *   `claimable` / `ownQueue` are the pre-scoped candidate lists — the
 *   caller knows the run state, this module deliberately doesn't.
 *   `agentName` is stripped before step matching; see resolveStepRef.
 *   `cooks` lets a claim name whose it is -- "Zoe will take the
 *   garlic". Only claim and start: saying somebody else is DONE is a
 *   claim about them, not an instruction, and crediting it is how the
 *   wrong cook gets the points.
 */
export function parseCommand(text, ctx) {
  const { byId, activeStepId, claimable = [], ownQueue = [], agentName = "", cooks = [] } = ctx;
  const { intent, matched } = detectIntent(text);
  // Whose task this is, when they said. The same rule as the model
  // path: only for taking work on.
  const forCook = ["claim", "start"].includes(intent) && cooks.length
    ? resolveCookRef(text, cooks)?.id ?? null
    : null;
  const base = { intent, raw: text, stepId: null, candidates: [], confidence: "none", cookId: forCook };
  if (["status", "score", "help", "undo", "finish_run", "unknown"].includes(intent)) return base;

  // Each intent only ever looks at the steps it could plausibly mean.
  const scope =
    intent === "claim"
      ? claimable
      : intent === "start"
      ? [...ownQueue, ...claimable]
      : activeStepId
      ? [activeStepId, ...ownQueue]
      : ownQueue;

  const { named, ...resolved } = resolveStepRef(text, matched, [...new Set(scope)], byId, agentName);
  if (resolved.stepId) return { ...base, ...resolved };

  // No name given: done/skip/drop fall back to whatever they're holding.
  //
  // Only when no name was given. A name that resolved to nothing means the
  // cook asked about a step that is not theirs to act on, and falling back
  // there acted on a DIFFERENT one: "done with the ginger", said while
  // holding the onion, completed the onion and announced it. Leaving
  // stepId null reaches needTarget in LiveCookPage, which asks "Which one
  // did you finish?" instead of acting on a guess.
  const unnamed = !named && !resolved.candidates.length;
  if (unnamed && activeStepId && ["done", "skip", "drop"].includes(intent)) {
    return { ...base, stepId: activeStepId, confidence: "exact" };
  }
  if (unnamed && intent === "start" && ownQueue.length === 1) {
    return { ...base, stepId: ownQueue[0], confidence: "exact" };
  }
  return { ...base, ...resolved };
}

export const HELP_TEXT = 'Say "done", "start", "take" and the step\'s name, "skip", "status", or "score". Every one of those is also a button.';
