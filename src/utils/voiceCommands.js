// Keyword command parsing for the live-cook screen. Deliberately dumb —
// this is the file that gets thrown away when real STT and an intent
// classifier land. What makes a dumb matcher workable is *candidate
// scoping*: "take the garlic" is trivially unambiguous against the 3
// steps you could actually claim, even though it'd be a coin-flip
// against all 20.
import { normalize, normalizeLoose, matchStepName } from "./stepNameMatch.js";

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
  { intent: "claim", patterns: [/我来|我做|给我/, /\bclaim\b/, /i'?ll take\b/, /i'?ll do\b/, /\btake\b/, /i'?ve got\b/, /give me\b/, /\bmine\b/] },
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
  return { stepId, candidates: alternates, confidence };
}

/**
 * @param {string} text  what the cook "said"
 * @param {object} ctx   { nodes, byId, activeStepId, claimable, ownQueue }
 *   `claimable` / `ownQueue` are the pre-scoped candidate lists — the
 *   caller knows the run state, this module deliberately doesn't.
 *   `agentName` is stripped before step matching; see resolveStepRef.
 */
export function parseCommand(text, ctx) {
  const { byId, activeStepId, claimable = [], ownQueue = [], agentName = "" } = ctx;
  const { intent, matched } = detectIntent(text);
  const base = { intent, raw: text, stepId: null, candidates: [], confidence: "none" };
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

  const resolved = resolveStepRef(text, matched, [...new Set(scope)], byId, agentName);
  if (resolved.stepId) return { ...base, ...resolved };

  // No name given: done/skip/drop fall back to whatever they're holding.
  if (!resolved.candidates.length && activeStepId && ["done", "skip", "drop"].includes(intent)) {
    return { ...base, stepId: activeStepId, confidence: "exact" };
  }
  if (!resolved.candidates.length && intent === "start" && ownQueue.length === 1) {
    return { ...base, stepId: ownQueue[0], confidence: "exact" };
  }
  return { ...base, ...resolved };
}

export const HELP_TEXT = 'Say "done", "start", "take" and the step\'s name, "skip", "status", or "score". Every one of those is also a button.';
