// When the goose is allowed to say something nobody asked for.
//
// A cook has long quiet stretches: two people heads-down on their own
// steps, nothing to report, nobody talking. That silence is where a live
// cook stops feeling live. A well-timed aside -- who is ahead, what is
// coming, that someone just beat their estimate -- is the difference
// between an app and a kitchen with somebody in it.
//
// It is also the fastest way to make the thing insufferable, so the
// rules are deliberately mean. An aside has to earn all of:
//
//   - the run is actually running,
//   - every cook is busy, so nobody is standing about waiting to be
//     told something they could have been asked,
//   - the room has been quiet for a while, so it is not talking over a
//     conversation it simply has not heard the end of,
//   - and it has kept its mouth shut recently.
//
// Barge-in still applies on top of this: an aside goes out through the
// same speak() as everything else, so a cook talking over it stops it
// dead. That is the backstop, not the plan -- an aside that gets talked
// over was a badly timed aside.
//
// Pure: no DOM, no React, no clock of its own.

// Long enough that it is clearly a lull rather than a pause for breath.
// A turn ends after ~700ms of silence, so this is not close.
export const QUIET_MS = 25_000;
// And this long between asides, so a genuinely quiet stretch produces
// the occasional remark rather than a monologue.
export const COOLDOWN_MS = 90_000;

/**
 * @param {object} state
 *   busyCooks       how many cooks are on a step right now
 *   cookCount       how many cooks are in the kitchen
 *   paused          the run is paused
 *   ended           the run is over
 *   msSinceVoice    since anyone last SPOKE (the agent included)
 *   msSinceComment  since the last aside; Infinity if there has been none
 * @returns {{ok: boolean, reason: string}}
 */
export function shouldCommentate({
  busyCooks = 0,
  cookCount = 0,
  paused = false,
  ended = false,
  msSinceVoice = 0,
  msSinceComment = Infinity,
} = {}) {
  if (ended) return { ok: false, reason: "run over" };
  if (paused) return { ok: false, reason: "paused" };
  // One cook talking to themselves is a different app. Asides are about
  // a kitchen with people in it.
  if (cookCount < 2) return { ok: false, reason: "not enough cooks" };
  // Somebody free is somebody who could be given a task, or who might be
  // about to speak. Both are better than being talked at.
  if (busyCooks < cookCount) return { ok: false, reason: "someone is free" };
  if (msSinceVoice < QUIET_MS) return { ok: false, reason: "not quiet yet" };
  if (msSinceComment < COOLDOWN_MS) return { ok: false, reason: "too soon after the last one" };
  return { ok: true, reason: "ok" };
}
