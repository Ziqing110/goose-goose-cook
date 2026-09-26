// Voice navigation: spoken words -> a route, or nothing.
//
// Deliberately a matcher and not an LLM. The vocabulary is small and
// closed, and paying a model round-trip to move between pages would add
// latency to the one interaction with no tolerance for it — you said
// "next" and you are staring at the screen waiting for it to happen.
//
// ENGLISH ONLY, deliberately. The model still code-switches and the
// transcript can still come back in Mandarin — that is worth keeping for
// dish names and for the live cook, where two people really do switch
// mid-sentence. But the COMMAND vocabulary is English.
//
// The reason is word boundaries. Every guard here leans on the regex
// word-boundary anchor, and CJK has no equivalent: a two-character
// command word matches inside any longer word containing it, with
// nothing to stop it. Half-guarded commands in one language and
// fully-guarded ones in another is worse than one language done
// properly. Multilingual belongs in the live cook, which is about what
// people say rather than what they command.
//
// CJK still survives normalization below — dish names arrive in
// Mandarin and other code has to read them.
//
// There is deliberately NO generic "next". "Next page" is a developer's
// model of this app; nobody standing in a kitchen thinks in pages. They
// think "approve and schedule" or "start cooking" — the words already
// printed on the button in front of them.
//
// So forward motion belongs to the pages, which register commands
// mirroring their own primary buttons (see voicePageCommands.js). What
// stays here is only what is unambiguous from anywhere: going back,
// going home, and naming a destination outright.
//
// Everything here is reversible. Irreversible actions live on the pages
// that own them and ask before acting.

/** Routes reachable by name, with what people actually call them. */
const DESTINATIONS = [
  { path: "/", names: ["home", "the start"] },
  {
    path: "/session/kitchen-setup",
    names: ["kitchen setup", "the kitchen", "equipment"],
  },
  {
    path: "/session/conversation",
    names: ["conversation", "the questions"],
  },
  {
    path: "/session/inventory",
    names: ["inventory", "the recipe", "the board", "ingredients"],
  },
  {
    path: "/session/voice-binding",
    names: ["voice binding", "voices", "the cooks"],
  },
  {
    path: "/session/schedule",
    names: ["schedule", "the timeline", "the plan"],
  },
  {
    path: "/session/live-cook",
    names: ["live cook", "cooking", "the cook"],
  },
];

// A bare movement word only counts as a command in a SHORT utterance.
// "next" is a command; "we should do this again next week" is
// conversation that happens to contain it. Cruder than parsing intent,
// but the right shape — nobody navigates a wizard in a long sentence.
const MAX_BARE_COMMAND_WORDS = 4;

// While a page is dictating, even a named destination has to be said
// briefly. "go back to home" is six words at most; anything longer that
// merely mentions a page is almost certainly an answer about it.
const STRICT_MAX_WORDS = 6;

// Phrases where a movement word is doing ordinary work. A blocklist is
// whack-a-mole by nature — it only knows the idioms someone thought of —
// so it is the LAST line of defence here, not the first. The structural
// rules below do the real work.
const NOT_NAVIGATION = [
  /\bnext (?:week|time|day|month|year|morning|one)\b/,
  /\bback (?:in|up|off)\b/,
  /\bcontinue (?:to|with|cooking|stirring|until)\b/,
  // Putting a thing back, not going back: "add the ginger back", "put it
  // back". On Inventory this left the page mid-checklist.
  /\b(?:put|bring|add|give|take|get)\b(?: \S+){0,3} back\b/,
];

// A command has no subject. You say "next", not "we should go next" —
// the moment a sentence names who is doing something, it is describing
// or discussing, not instructing the app.
//
// This is the structural version of the blocklist, and it generalises:
// "we should go back", "I'll be back", "you go back" are all caught by
// the same rule, without anyone having to predict them. Applied only to
// bare words — "take me to the schedule" contains
// "me" and is unambiguously a command, but it matches as a destination
// before this is ever consulted.
const HAS_SUBJECT =
  /\b(?:i|i'll|i'm|i've|we|we'll|we're|you|you'll|you're|he|she|they|let|lets|let's)\b/;

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

const YES = /^(?:yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|confirm|please)\b/;
const LEADING_FILLER = /^(?:(?:um+|uh+|er+|erm|ah+|oh|hmm+|mm+|well|so)\s+)+/;
const NO = /^(?:no|nope|nah|don't|do not|cancel|never ?mind|stop|wait)\b/;

// Exported so a page that runs its own yes/no confirmation (rather than
// VoiceBar's generic askToConfirm) can gate on the same wording as
// matchConfirmation, instead of drifting from it with a second list.
export const CONFIRM_YES_PATTERN = YES;
export const CONFIRM_NO_PATTERN = NO;

/**
 * Utterance length in units comparable across scripts: words for Latin,
 * characters for CJK. Commands are English now, but Mandarin still
 * arrives in the transcript, and treating a whole Chinese sentence as
 * one "word" would let it past every length gate.
 */
function countUnits(said) {
  const latin = said.replace(/[一-鿿]/g, " ").split(" ").filter(Boolean).length;
  const cjk = (said.match(/[一-鿿]/g) || []).length;
  return latin + cjk;
}

/**
 * Answer to a pending confirmation.
 * @returns {"yes"|"no"|null} null when it isn't an answer at all, which
 *          the caller should treat as abandoning the question rather
 *          than as a "no" — the person moved on to something else.
 */
export function matchConfirmation(text) {
  // "Uh, yes" is a yes. Speech opens with a filler often enough, and
  // missing the answer behind it closed the question and handed the
  // "yes" to whatever came next — on the conversation page, as an answer.
  const said = normalize(text).replace(LEADING_FILLER, "");
  if (!said) return null;
  // Answers are short. "no, the other one next to the stock" is someone
  // pointing at a jar, not declining a prompt.
  if (countUnits(said) > 4) return null;
  if (YES.test(said)) return "yes";
  if (NO.test(said)) return "no";
  return null;
}

/** A destructive voice action requires its full passphrase, never yes/no. */
export function matchesConfirmationPhrase(text, phrase) {
  return Boolean(phrase) && normalize(text) === normalize(phrase);
}

// Two kinds of pattern per action:
//   explicit — unmistakably an instruction. Allowed at any length,
//              because the phrasing itself is the evidence.
//   bare     — a word that merely means movement. Short utterances only.
// Ordered so "go back" is never read as "go to ...".
const ACTIONS = [
  {
    action: "back",
    // "go back" is explicit because it takes three words to say — the
    // phrasing itself is the evidence. Bare "back" hides inside "back in
    // a minute", so it stays gated.
    explicit: [/\bgo back\b/, /\b(?:last|previous) (?:page|step|screen)\b/],
    bare: [/\bback\b/, /\bprevious\b/],
  },
  {
    action: "help",
    // Asking a question moves nobody, so length never disqualifies it.
    explicit: [/\bwhat can i say\b/, /\bhelp\b/, /\bcommands?\b/],
    bare: [],
  },
];

const normalize = (s) =>
  (s || "")
    .toLowerCase()
    // CJK survives normalization even though no command uses it: dish
    // names come through in Mandarin, and dropping those characters
    // here would corrupt text that other code (and the live cook) still
    // needs to read.
    .replace(/[^a-z0-9\s'一-鿿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Filler a command may carry and still be a command. Matches the page
// commands' list (voicePageCommands.js), plus "lets" as transcribed
// without its apostrophe.
const FILLER =
  /\b(?:please|kindly|just|go ahead and|could you|can you|would you|will you|i want to|i'd like to|let's|lets)\b/g;
const stripFiller = (said) => said.replace(FILLER, " ").replace(/\s+/g, " ").trim();

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whole words only. A substring test sent "show me the homemade sauce"
// Home and "open the cooker" to the live cook.
const DESTINATION_PATTERNS = DESTINATIONS.flatMap((dest) =>
  dest.names.map((name) => ({ dest, re: new RegExp(`\\b${escapeRe(normalize(name))}\\b`) })),
);

// A name alone isn't a command — "the schedule looks tight" is talking
// about it, not asking to go there. It needs a verb.
const NAV_VERB = /\b(?:go|open|show|take me|jump|switch|navigate)\b/;

function findDestination(said) {
  if (!NAV_VERB.test(said)) return null;
  return DESTINATION_PATTERNS.find(({ re }) => re.test(said))?.dest ?? null;
}

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
/**
 * @param {boolean} [ctx.strict] For pages taking dictation. Only a named
 *   destination said as a short, confident phrase counts; bare movement
 *   words never do. "go back to home" is plainly navigation even while
 *   answering questions; "go back to basics" is an answer that happens
 *   to contain "back", and typing it is the right call.
 */
export function matchNavCommand(text, { route = "/", reachable, confidence, strict = false } = {}) {
  const said = normalize(text);
  if (!said) return { action: "none" };

  // Named destinations first: "go to the schedule" contains "go", which
  // a bare movement pattern would otherwise swallow.
  const dest = findDestination(said);
  if (dest) {
    const units = countUnits(said);
    const unsure = typeof confidence === "number" && confidence < MIN_BARE_CONFIDENCE;
    const doubtful = unsure && confidence >= CONFIRM_CONFIDENCE;
    // A subject means someone is talking about going somewhere, not
    // asking to: "we should go home" is two cooks chatting. The filler
    // a command is allowed ("can you", "I want to", "let's") is taken
    // off first, so "can you take me home" still counts.
    const talking = HAS_SUBJECT.test(stripFiller(said));
    // While a page is taking dictation, a destination only counts if
    // the whole utterance is short and clearly heard. "go back to home"
    // is plainly navigation; "go back to the recipe my mum used to
    // make" names a page inside an answer, and typing it is the right
    // call. Falling through lets the answer box have it.
    const skip = talking || (strict && (units > STRICT_MAX_WORDS || unsure)) || (unsure && !doubtful);
    if (!skip) {
      if (dest.path === route) return { action: "already", path: dest.path };
      if (reachable && !reachable.includes(dest.path)) {
        return { action: "blocked", path: dest.path };
      }
      // Heard, but not clearly. The same garbled turn that should not
      // move anyone on a bare "back" should not move them here either —
      // but a named page is worth asking about rather than dropping.
      if (doubtful) return { action: "goto", path: dest.path, confirm: true };
      return { action: "goto", path: dest.path };
    }
    // Naming a page and then being passed over is not a bare "back"
    // either: "we should go back to the schedule" was said to someone,
    // not to the app.
    return { action: "none" };
  }

  // Bare movement words are never commands on a dictation page: "back"
  // is a perfectly ordinary word in an answer, and there is no way to
  // tell it from an instruction without a destination attached.
  if (strict) return { action: "none" };

  if (NOT_NAVIGATION.some((p) => p.test(said))) return { action: "none" };

  const wordCount = countUnits(said);

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

/**
 * What to say on this page, for the VoiceBar hint.
 *
 * The example destination is one you can actually reach. The first name
 * on the list used to be offered regardless, which on Home was "go to
 * kitchen setup" — a page that only exists when a kitchen was deleted,
 * so the one suggestion on screen answered "not yet".
 *
 * @param {string} route
 * @param {string[]} [reachable] as for matchNavCommand; omit to allow any
 */
export function navHintFor(route, reachable) {
  const elsewhere = reachableDestinations(route, reachable).find((d) => d.path !== "/");
  return {
    line: elsewhere
      ? `Say “go back”, “go home”, or “go to ${elsewhere.names[0]}”.`
      : "Say “go back” or “go home”.",
    sub: "Each page also takes the words on its own buttons.",
  };
}

/** What "help" answers: the pages you could go to from here. */
export function navHelpLine(route, reachable) {
  const names = reachableDestinations(route, reachable).map((d) => d.names[0]);
  if (!names.length) return "Try: “go back”.";
  return `Try: “go back”, or “go to” ${names.slice(0, 3).join(", ")}.`;
}

// Later stages first: where you are headed is a better suggestion than
// where you have been.
function reachableDestinations(route, reachable) {
  return DESTINATIONS.filter((d) => d.path !== route && (!reachable || reachable.includes(d.path))).reverse();
}

/** Destination names, for the "help" action. */
export function navCommandList() {
  return DESTINATIONS.map((d) => d.names[0]);
}

/** Friendly name for a route, for confirmation prompts. */
export function pathLabel(path) {
  return DESTINATIONS.find((d) => d.path === path)?.names[0] ?? "that page";
}

/** The shared text normalizer, so page commands match the same way. */
export function normalizeUtterance(text) {
  return normalize(text);
}

/**
 * Does this utterance look like conversation rather than an instruction?
 *
 * Exported so page-registered commands get the same treatment as
 * navigation. Without it, "resume" was guarded three ways but
 * "we should resume later" — registered by Home — fired immediately,
 * which is the exact bug the guards exist to prevent.
 */
/**
 * Is there a subject pronoun in here? "We should resume later" is a
 * sentence about resuming, not a request to resume.
 *
 * Split out from isLikelyConversation because callers need to tell this
 * apart from a poorly-heard command: one is somebody talking near the
 * microphone, the other is somebody talking into it.
 */
export function hasSubject(said) {
  return HAS_SUBJECT.test(said);
}

export function isLikelyConversation(said, confidence, { allowSubject = false } = {}) {
  // "I'm Mia" is a command whose first word is a subject. A command
  // opts in; the confidence floor still applies to it.
  if (!allowSubject && HAS_SUBJECT.test(said)) return true;
  if (typeof confidence === "number" && confidence < CONFIRM_CONFIDENCE) return true;
  return false;
}
