// Opening and closing Goose's Notes from outside the rail.
//
// The rail keeps its own open state, since a tap on its handle is the
// ordinary way in. Voice needs to reach it from anywhere -- a page's
// commands, the live cook's own turns -- so requests come through here,
// the same shape as speakerSelection next door.

const listeners = new Set();

export const notesPanel = {
  /** Ask the rail to open (true) or tuck away (false). */
  request(open) {
    listeners.forEach((fn) => fn(Boolean(open)));
  },
  /** The rail listens; returns the unsubscribe. */
  onRequest(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
