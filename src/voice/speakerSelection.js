// Who the live cook credits a turn to when nothing better says so: the
// speaker toggle.
//
// It lived in LiveCookPage's own state while the toggle sat in Toque's
// drawer on that page. The toggle now sits in the conversation rail,
// which is mounted once in AppShell, so the choice needs a home both can
// read -- same shape and reasoning as voiceLog next door. Session-scoped
// and never persisted: it names whoever is standing at the counter now.

function createSpeakerSelection() {
  let cookId = null;
  const listeners = new Set();

  return {
    get() {
      return cookId;
    },

    set(next) {
      if (next === cookId) return;
      cookId = next ?? null;
      listeners.forEach((fn) => fn());
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const speakerSelection = createSpeakerSelection();

/**
 * The selected cook if they are still in the line-up, else the first.
 * The selection can outlive a line-up change, and speech must never be
 * credited to a ghost.
 */
export function resolveSpeaker(cookId, cooks = []) {
  return cooks.some((c) => c.id === cookId) ? cookId : cooks[0]?.id;
}
