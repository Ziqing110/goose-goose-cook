// What was said and done on the pages that keep no record of their own.
//
// The live cook has run.transcript and run.events, which is why its
// conversation rail could be built by reading the run back. Every other
// page has neither: a turn is matched against the page's registered
// commands, acted on, and forgotten. So "say a kitchen's name to pick
// it" either works or appears to do nothing, and there is nothing to
// look at afterwards to tell which.
//
// This is that record for the rest of the app. Session-scoped and never
// persisted: it is there to answer "what just happened", not to be a
// history. A cook's own words are the most personal thing this app
// handles, and outside a run there is no reason for them to outlive the
// tab.
//
// Rows are stored in the shape utils/conversationFeed.js emits, so the
// rail can merge them with a run's own record without either side
// knowing about the other.

// Enough to scroll back through a stage, not so much that a long session
// grows without bound.
const MAX_ROWS = 60;

function createVoiceLog() {
  let rows = [];
  let thinkingSince = null;
  const listeners = new Set();

  const notify = () => listeners.forEach((fn) => fn());

  return {
    /** Something a person said, as the recogniser heard it. */
    heard(text, { name = "You", at = new Date().toISOString() } = {}) {
      if (!text) return;
      rows = [...rows, { kind: "said", at, name, text, via: null }].slice(-MAX_ROWS);
      notify();
    },

    /** Something the agent said back. */
    spoke(text, { at = new Date().toISOString() } = {}) {
      if (!text) return;
      rows = [...rows, { kind: "agent", at, text }].slice(-MAX_ROWS);
      notify();
    },

    /**
     * Something the app did about it — navigating, running a page
     * command. Written as a sentence rather than a verb and a step,
     * because off the live cook there are no steps to name.
     */
    did(text, { at = new Date().toISOString() } = {}) {
      if (!text) return;
      rows = [...rows, { kind: "run", at, text }].slice(-MAX_ROWS);
      notify();
    },

    /** A turn is with the model. Null clears it. */
    setThinking(since) {
      if (thinkingSince === since) return;
      thinkingSince = since;
      notify();
    },

    thinking() {
      return thinkingSince;
    },

    all() {
      return rows;
    },

    /** A new run, or a session being thrown away. */
    reset() {
      rows = [];
      thinkingSince = null;
      notify();
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const voiceLog = createVoiceLog();
