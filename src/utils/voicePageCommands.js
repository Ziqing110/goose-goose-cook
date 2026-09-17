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

let registered = [];

/**
 * @param {Array<{phrases: RegExp[], run: Function, label?: string}>} commands
 * @returns {Function} unregister
 */
export function registerVoiceCommands(commands) {
  registered = commands || [];
  return () => {
    registered = [];
  };
}

/**
 * First page command matching this utterance, or null.
 *
 * Page commands are checked BEFORE navigation, so a page can claim a
 * phrase that would otherwise move you. They get the same normalized
 * text the navigation matcher works on.
 */
export function matchPageCommand(said) {
  if (!said) return null;
  return registered.find((c) => c.phrases.some((p) => p.test(said))) || null;
}

/** For tests, and for making sure a stale page can't leave commands behind. */
export function clearVoiceCommands() {
  registered = [];
}
