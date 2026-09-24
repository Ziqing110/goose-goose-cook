// Page-scoped voice commands.
//
// VoiceBar knows how to navigate, but it cannot know that Home can
// "resume the run" or that Inventory can mark an ingredient out — those
// belong to the pages, along with the functions that do them.
//
// This exists because the pages were already advertising such commands
// in their VoiceBar hint ("Ready when you are — say 'resume the run'")
// while nothing listened for them. Copy written before the microphone
// was real. A bar that promises a command and then ignores it is worse
// than one that promises nothing.
//
// A module-level registry rather than app state: these hold functions,
// which have no business in a reducer, and there is exactly one page
// mounted at a time.

// A stack, not a slot. What you are allowed to say depends on what state
// the page is in, and a page has states inside it: a modal open over
// Home is a different set of valid inputs from Home itself, and while it
// is open "resume the run" is not one of them.
//
// So every registration is a layer, and only the topmost one is live.
// That is what makes a modal modal. `priority` exists because the page
// underneath keeps re-registering as its own state changes — Home swaps
// its command set when the hero state changes — and a later push from
// the page must not end up shadowing the dialog sitting above it.
// Layers register at a depth rather than in arrival order.
let layers = [];

// Every layer at the highest priority is live, not just the last one
// registered there. A page is free to register its commands in more than
// one place — Inventory keeps the ingredient commands next to the
// ingredient list and the board commands next to the board — and those
// are peers, not a stack. Keeping only the last of them made the other
// unreachable: "show the recipe graph" worked and "no ginger" did
// nothing, on a page whose own hint told you to say it.
//
// Shadowing is still what priority is for. A dialog registers above the
// page, so everything the page offers drops out while it is open.
const livePriority = () =>
  layers.reduce((top, l) => (top === null || l.priority > top ? l.priority : top), null);

const liveLayers = () => {
  const top = livePriority();
  return top === null ? [] : layers.filter((l) => l.priority === top);
};

/**
 * @param {Array<object>} commands
 *   phrases  RegExp[]  matched against the normalized utterance
 *   run      Function  what the button does
 *   label    string    optional confirmation shown after it runs
 *   confirm  string    optional question to ask FIRST. Use it for
 *                      anything irreversible: approving a recipe,
 *                      starting a cook. Mishearing those costs more
 *                      than one extra sentence.
 * @returns {Function} unregister
 */
export function registerVoiceCommands(commands, { priority = 0, exclusive = false } = {}) {
  const layer = { commands: commands || [], priority, exclusive };
  layers = [...layers, layer];
  return () => {
    // Remove this layer specifically, wherever it now sits. A late
    // cleanup from the page you just left therefore cannot wipe the
    // commands the page you just arrived on has already registered —
    // it only ever takes away its own.
    layers = layers.filter((l) => l !== layer);
  };
}

// Politeness and filler words nobody wrote a phrase for. "show me
// ingredients" failed against `\bshow (?:the )?ingredients\b` because
// "me" sat in a slot the pattern didn't expect — the phrase was right,
// the words around it weren't the exact ones anticipated. Rather than
// hand-editing every command's regex for every filler someone might
// say, they're stripped once here and the phrases are tried again
// against what's left. The command vocabulary itself stays closed —
// this only forgives the padding around it.
const FILLER_WORDS =
  /\b(?:please|kindly|just|go ahead and|could you|can you|would you|will you|i want to|i'd like to|let's)\b/g;
const BARE_ME = /\bme\b/g;
const loosen = (said) => said.replace(FILLER_WORDS, " ").replace(BARE_ME, " ").replace(/\s+/g, " ").trim();

/**
 * First page command matching this utterance, or null.
 *
 * Page commands are checked BEFORE navigation, so a page can claim a
 * phrase that would otherwise move you. They get the same normalized
 * text the navigation matcher works on.
 */
export function matchPageCommand(said) {
  if (!said) return null;
  const live = liveLayers();
  if (!live.length) return null;
  // Tried in order — command grammar is closed and this only widens how
  // the same words can be padded, so the first hit either way is the
  // right one.
  const candidates = [said];
  const loosened = loosen(said);
  if (loosened && loosened !== said) candidates.push(loosened);
  for (const text of candidates) {
    for (const c of live.flatMap((l) => l.commands)) {
      for (const p of c.phrases) {
        const match = p.exec(text);
        // The match comes back with the command so `run` can read what
        // was captured — "set burners to four" has to tell the form
        // *four*, and a command that can only fire or not fire cannot
        // do that.
        if (match) return { ...c, match };
      }
    }
  }
  return null;
}

/**
 * Does the live layer claim the microphone outright?
 *
 * A dialog does. While one is open, navigating away by voice would leave
 * a half-filled form behind and look like the app losing your work, so
 * the only way out is a command the dialog itself offers.
 */
export function voiceCommandsAreExclusive() {
  return liveLayers().some((l) => l.exclusive);
}

/** For tests, and for making sure a stale page can't leave commands behind. */
export function clearVoiceCommands() {
  layers = [];
}

// --- dictation ----------------------------------------------------------
//
// The conversation page doesn't want commands, it wants what you said.
// Every utterance there is an answer to a question, so while it is
// listening the command matchers stand down entirely — otherwise
// answering "go back to basics" would navigate instead of being typed.
//
// Partials are forwarded too, so the answer bar fills as you speak
// rather than appearing all at once when the turn ends.

let dictation = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

/**
 * @param {object} handlers
 *   route           the pathname this dictation belongs to. Required.
 *   onPartial       (text) => void, called as the words arrive
 *   onFinal         (text) => void, called once the turn ends
 *   takeover        optional boolean. Every turn goes to onFinal(text, turn)
 *                   as-is: no navigation, no page commands. For a page with
 *                   its own conversation (the live cook), where "back"
 *                   and "next" mean something else and leaving mid-cook
 *                   by voice is exactly what must not happen.
 *   keyterms        optional string[] sent to the recogniser while this
 *                   page listens, and cleared when it stops.
 *   turnDetection   optional {min_turn_silence, max_turn_silence, ...}
 *                   applied to the live connection while this page is
 *                   listening, and restored when it stops.
 * @returns {Function} unregister
 */
export function registerVoiceDictation(handlers) {
  dictation = handlers;
  notify();
  return () => {
    if (dictation === handlers) {
      dictation = null;
      notify();
    }
  };
}

/**
 * The dictation handler for the page you are actually on, or null.
 *
 * The route argument is the point. Unregistering on unmount is not
 * enough on its own: it depends on React tearing this down before the
 * next page's effects run, and when that slipped, a registration made
 * on the conversation page was still live on Home — so Home's own
 * commands never got a turn and speaking there did nothing. Every
 * utterance was being handed to an answer box that no longer existed.
 *
 * Scoping by route makes that failure impossible rather than unlikely.
 * A registration that outlives its page is inert, whatever the cause.
 */
export function getVoiceDictation(route) {
  if (!dictation) return null;
  if (route !== undefined && dictation.route !== route) return null;
  return dictation;
}

/**
 * VoiceBar subscribes so it can react to a page starting or stopping
 * dictation — the registry is a plain module variable, so without this
 * nothing would tell React that turn detection needs reconfiguring.
 */
export function subscribeVoiceRegistry(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
