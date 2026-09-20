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
 *   leadMs  the mic can hear playback slightly after it starts
 *   tailMs  room reverb and the recogniser's own lag after it stops
 *   keep    spans to remember
 */
export function createSpanLog({ leadMs = 150, tailMs = 700, keep = 20 } = {}) {
  let spans = [];
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
      return spans.some((s) => at >= s.start - leadMs && at <= (s.end ?? Infinity) + tailMs);
    },
  };
}
