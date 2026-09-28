// When the goose may chime in on talk that was not meant for it.
//
// Cooks joke with each other. A kitchen companion that never laughs
// along is a command line with a funny voice; one that pipes up after
// every sentence is the colleague nobody wants on shift. So the goose
// gets a rare turn at the room's conversation, on rules as mean as the
// asides' (see commentary.js):
//
//   - the run is running,
//   - there is an actual exchange -- two lines or more, recently, from
//     the room -- not one remark into the air,
//   - the goose itself has not spoken recently, and
//   - it has not chimed in for a good while.
//
// Passing all of that only earns the right to ASK. The model is told
// that saying nothing is the usual answer, and it mostly will.
//
// Pure: no DOM, no React, no clock of its own.

// How far back the room's talk is kept, and how much of it.
export const ROOM_WINDOW_MS = 60_000;
export const ROOM_MAX_LINES = 6;
// Enough of an exchange to have a joke in it.
export const MIN_ROOM_LINES = 2;
// At most this often. Rare is the whole point.
export const BANTER_COOLDOWN_MS = 180_000;
// The goose spoke recently, so it is already part of the conversation
// or has just been talked over. Either way, not now.
export const AGENT_QUIET_MS = 20_000;

/** The room's recent unaddressed talk, newest last, old lines dropped. */
export function recentRoomTalk(lines, now) {
  return (lines || []).filter((l) => now - l.at <= ROOM_WINDOW_MS).slice(-ROOM_MAX_LINES);
}

/**
 * @param {object} state
 *   roomLines       recentRoomTalk(), [{ speaker, text, at }]
 *   paused, ended   the run's state
 *   busy            a banter request is already in flight
 *   msSinceBanter   since the goose last chimed in; Infinity if never
 *   msSinceAgent    since the goose last said anything at all
 * @returns {{ok: boolean, reason: string}}
 */
export function shouldBanter({
  roomLines = [],
  paused = false,
  ended = false,
  busy = false,
  msSinceBanter = Infinity,
  msSinceAgent = Infinity,
} = {}) {
  if (ended) return { ok: false, reason: "run over" };
  if (paused) return { ok: false, reason: "paused" };
  if (busy) return { ok: false, reason: "already asking" };
  if (roomLines.length < MIN_ROOM_LINES) return { ok: false, reason: "no conversation" };
  if (msSinceAgent < AGENT_QUIET_MS) return { ok: false, reason: "goose spoke recently" };
  if (msSinceBanter < BANTER_COOLDOWN_MS) return { ok: false, reason: "too soon after the last one" };
  return { ok: true, reason: "ok" };
}
