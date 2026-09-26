// Whether the agent's turn leaves the door open for an unnamed reply.
//
// Every spoken turn must say the agent's name, or it is treated as talk
// between cooks and ignored. That is the right default in a room where
// two people are talking to each other over a fan -- but it made a
// conversation impossible:
//
//   "Goose, what does mix sauce mean?"  -> answered
//   "How long does that take?"          -> silence. Not addressed.
//
// The name is a claim on the agent's attention. Once it has just ANSWERED
// something, it already has that attention, and demanding the name again
// for the obvious follow-up is the difference between something you talk
// to and a command line you speak at.
//
// The line drawn here: **answering opens the door, acting does not.**
//
// A question the agent asked, or an answer it gave, is half of an
// exchange and the other half is probably coming. "Onion done." is not
// -- it is the end of a thing, and leaving the mic wide open after every
// completed step would feed the model every word said near it.
//
// The window is short and single-use (see ENGAGED_MS in LiveCookPage),
// so the cost of being wrong is one stray turn the model is separately
// told to ignore.
//
// Pure: no DOM, no React.

// Tools that answer rather than change the run. Deliberately the same
// idea as READ_ONLY in server/agent/turn.js, kept separate because that
// one is a security boundary and this is a conversational hint -- they
// should be free to diverge.
const ANSWERING = new Set(["explain", "status", "score", "help"]);

/**
 * @param {object} turn
 *   reply  what the agent said
 *   calls  the vetted tool calls, [{ name }]
 * @returns {boolean}
 */
export function opensFollowUp({ reply = "", calls = [] } = {}) {
  // The agent asked something. Its answer is the next thing said, and it
  // will not have a name on it.
  if (/\?\s*$/.test(String(reply || ""))) return true;
  // The agent answered something. The follow-up usually drops the name.
  return (calls || []).some((c) => ANSWERING.has(c?.name));
}
