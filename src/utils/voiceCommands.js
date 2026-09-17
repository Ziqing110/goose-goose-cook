// Keyword command parsing for the live-cook screen. Deliberately dumb —
// this is the file that gets thrown away when real STT and an intent
// classifier land. What makes a dumb matcher workable is *candidate
// scoping*: "take the garlic" is trivially unambiguous against the 3
// steps you could actually claim, even though it'd be a coin-flip
// against all 20.

const STOP_WORDS = new Set([
  "the", "a", "an", "my", "on", "to", "that", "one", "it", "i", "im", "ill", "ive",
  "now", "please", "up", "of", "and", "is", "am", "next", "step", "task", "with",
]);

// Order matters: "we're done" must not fire a step completion, and
// "drop it" must not be read as "done".
const INTENTS = [
  // Pause/resume first: "resume" and "back on" would otherwise read as
  // "start", and "hold on" mustn't fire "on it".
  { intent: "resume", patterns: [/\bresume\b/, /\bunpause\b/, /\bback on\b/, /\bkeep going\b/] },
  { intent: "pause", patterns: [/\bpause\b/, /\bhold on\b/, /\btake (?:a )?(?:break|five)\b/, /\btime ?out\b/] },
  { intent: "finish_run", patterns: [/\bwe(?:'re| are)? done\b/, /\ball done\b/, /\bfinish(?: the)? cook/, /\bend the cook/, /\bdinner'?s up\b/] },
  { intent: "help", patterns: [/\bhelp\b/, /what can i say/, /\bcommands?\b/, /what can you do/] },
  { intent: "undo", patterns: [/\bundo\b/, /never ?mind/, /\boops\b/, /wait,? no\b/, /i didn'?t\b/] },
  { intent: "score", patterns: [/\bscores?\b/, /\bpoints?\b/, /leader ?board/, /who'?s winning/, /am i winning/] },
  { intent: "status", patterns: [/\bstatus\b/, /what'?s next/, /what now/, /where are we/, /how (?:long|much)/] },
  { intent: "drop", patterns: [/\bdrop\b/, /put (?:it|this) back/, /someone else (?:can )?take/, /give (?:it|this) (?:back|up)/] },
  { intent: "claim", patterns: [/\bclaim\b/, /i'?ll take\b/, /i'?ll do\b/, /\btake\b/, /i'?ve got\b/, /give me\b/, /\bmine\b/] },
  { intent: "skip", patterns: [/\bskip\b/, /forget (?:that|it)/, /not doing\b/, /cancel that/] },
  { intent: "done", patterns: [/\bdone\b/, /\bfinished?\b/, /\bcomplete(?:d)?\b/, /got it\b/, /that'?s it\b/] },
  { intent: "start", patterns: [/\bstart(?:ing)?\b/, /\bbegin\b/, /let'?s go\b/, /\bon it\b/, /\bgo\b/] },
];

const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();
const contentTokens = (s) =>
  normalize(s)
    .split(" ")
    .map((t) => t.replace(/s$/, ""))
    .filter((t) => t && !STOP_WORDS.has(t));

function detectIntent(text) {
  const norm = normalize(text);
  for (const { intent, patterns } of INTENTS) {
    const hit = patterns.find((p) => p.test(norm));
    if (hit) return { intent, matched: norm.match(hit)?.[0] ?? "" };
  }
  return { intent: "unknown", matched: "" };
}

/** Match the leftover words against a scoped candidate list. */
function resolveStepRef(text, matched, candidates, byId) {
  const rest = normalize(text).replace(matched, " ");
  const tokens = contentTokens(rest);
  if (tokens.length === 0 || candidates.length === 0) return { stepId: null, candidates: [], confidence: "none" };

  const phrase = tokens.join(" ");
  const exact = candidates.filter((id) => normalize(byId[id]?.label || "").includes(phrase));
  if (exact.length === 1) return { stepId: exact[0], candidates: [], confidence: "exact" };

  const scored = candidates
    .map((id) => {
      const labelTokens = new Set(contentTokens(byId[id]?.label || ""));
      const hits = tokens.filter((t) => labelTokens.has(t)).length;
      return { id, score: hits / tokens.length };
    })
    .sort((a, b) => b.score - a.score);

  const [best, runnerUp] = scored;
  if (best && best.score >= 0.5 && best.score - (runnerUp?.score ?? 0) >= 0.2) {
    return { stepId: best.id, candidates: [], confidence: "fuzzy" };
  }
  return { stepId: null, candidates: scored.filter((s) => s.score > 0).slice(0, 3).map((s) => s.id), confidence: "none" };
}

/**
 * @param {string} text  what the cook "said"
 * @param {object} ctx   { nodes, byId, activeStepId, claimable, ownQueue }
 *   `claimable` / `ownQueue` are the pre-scoped candidate lists — the
 *   caller knows the run state, this module deliberately doesn't.
 */
export function parseCommand(text, ctx) {
  const { byId, activeStepId, claimable = [], ownQueue = [] } = ctx;
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

  const resolved = resolveStepRef(text, matched, [...new Set(scope)], byId);
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

export const HELP_TEXT = 'Say "done", "start", "take <task>", "skip", "status", or "score". Every one of those is also a button.';
