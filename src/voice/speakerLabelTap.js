// Which diarization label each recent turn came under.
//
// Same shape and reasoning as audioTap next door: one module-level
// buffer, because the app has exactly one microphone. VoiceBar fills it
// from every finished turn; the voice-binding page reads a window out of
// it to learn which label a cook was speaking under.
//
// Only the label and the time are kept — never the words. This exists to
// answer "which voice", and a transcript ring would be a second place
// for what people said to live.
//
// Deciding anything from these samples is utils/speakerLabels.js; this
// only remembers them.

// Enrollment is one line read aloud, so a couple of minutes is far more
// than any window will ask for. Bounded so a long cook cannot grow it.
const KEEP_MS = 120_000;
const MAX_SAMPLES = 400;

function createLabelTap() {
  let samples = [];

  return {
    /** Record a finished turn's label. Turns without one are ignored. */
    push(label, at = Date.now()) {
      if (!label) return;
      samples.push({ label, at });
      const cutoff = at - KEEP_MS;
      if (samples.length > MAX_SAMPLES || samples[0].at < cutoff) {
        samples = samples.filter((s) => s.at >= cutoff).slice(-MAX_SAMPLES);
      }
    },

    /** Everything still held, oldest first. The caller picks its window. */
    all() {
      return samples.slice();
    },

    /** Start of a fresh session, or a cook re-recording. */
    reset() {
      samples = [];
    },
  };
}

export const speakerLabelTap = createLabelTap();
