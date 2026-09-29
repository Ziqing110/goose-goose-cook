// Thin client around the setup-chat reader (server/routes/understanding.js).
//
// The LLM is a network call to a rate-limited gateway, and a cook
// mid-sentence cannot be left waiting on it. So every failure — rate
// limit, timeout, server down, no connection — resolves to null, and the
// page falls back to the local regex readers in utils/understanding.js.
import { apiRequest } from "./client.js";

// Above the server's own 11s gateway budget, so a slow model still wins;
// anything past this is the network or the proxy, not the model thinking.
const READ_TIMEOUT_MS = 12_000;

/**
 * Read one turn of the setup chat against ALL the questions at once. Any
 * slot can be answered or changed on any turn, and the reply says where
 * the chat goes next.
 *
 * @param {object} args
 * @param {Array<{id, question, answer}>} args.slots  in order; answer "" when empty
 * @param {string} args.focus    the question the chat is on
 * @param {Array<{speaker, text}>} args.history  the chat so far, before `text`
 * @param {string} args.text     what the cook just said
 * @returns {Promise<{updates, focus, done, reply} | null>}  null when the
 *          model could not be reached
 */
export async function readTurn({ slots, focus, history, text }) {
  try {
    const turn = await apiRequest("/api/understanding", "/turn", {
      method: "POST",
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      body: JSON.stringify({ slots, focus, history: history.slice(-12), text }),
    });
    if (turn && Array.isArray(turn.updates) && typeof turn.reply === "string") return turn;
  } catch (err) {
    console.info("[understanding] turn reader unavailable, reading locally:", err.message);
  }
  return null;
}
