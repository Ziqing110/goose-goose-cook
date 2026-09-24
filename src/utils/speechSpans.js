// When was the agent audibly speaking?
//
// The mic hears the agent's own voice through the room, and the recogniser
// dutifully transcribes it. Telling that apart from a cook has to be done
// by WHEN the words were spoken, not when the transcript arrives: a turn
// only finalizes after its trailing silence, so by the time the agent's
// own sentence comes back as text the agent has usually finished, and an
// "is it speaking right now" check lets it through.
//
// Spans are wall-clock intervals of actual playback. A turn whose speech
// started inside one (allowing for output latency at the front and room
// tail at the back) is the agent, not a person.
//
// Pure: no DOM, so the boundaries are testable.

/**
 * @param {object} opts
 *   leadMs   the mic can hear playback slightly after it starts
 *   tailMs   room reverb and the recogniser's own lag after it stops
 *   keep     spans to remember
 *   maxOpenMs how long an unclosed span can still be believed. The
 *            agent's replies are capped at fifteen words, so anything
 *            past this is a span that never got closed rather than a
 *            very long sentence.
 */
export function createSpanLog({ leadMs = 150, tailMs = 700, keep = 20, maxOpenMs = 30_000 } = {}) {
  let spans = [];
  // A span that is still open means "speaking right now", so it reaches
  // up to the present — but only for as long as speaking is plausible.
  // Playback that never reports its end (a TTS voice that fires onstart
  // and no onend, which is what a browser with no voices installed does)
  // would otherwise leave `end` null and match every future turn, and
  // the agent would treat everything it heard from then on as its own
  // voice and go deaf for the rest of the session.
  const endOf = (s) => s.end ?? Math.min(Date.now(), s.start + maxOpenMs);
  return {
    begin(at = Date.now()) {
      spans.push({ start: at, end: null });
      if (spans.length > keep) spans = spans.slice(-keep);
    },
    end(at = Date.now()) {
      const open = spans[spans.length - 1];
      if (open && open.end === null) open.end = at;
    },
    /** Was the agent speaking (or just done) at wall-clock time `at`? */
    covers(at) {
      return spans.some((s) => at >= s.start - leadMs && at <= endOf(s) + tailMs);
    },
  };
}
