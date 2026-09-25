// Thin client around the answer reader (server/routes/understanding.js).
//
// The point of this module is the FALLBACK, not the fetch. The LLM makes
// the conversation understand what people actually say, but it is a
// network call to a rate-limited gateway, and a cook mid-sentence cannot
// be left waiting on it. So every failure — rate limit, timeout, server
// down, a browser with no connection — lands on the regex readers that
// were here before, and the conversation carries on.
//
// Nothing above this line ever has to know which one answered, except
// that the reading carries `source` so a bug can be traced to the right
// half.
import { apiRequest } from "./client.js";
import { interpretAnswer, matchChineseConfirmation } from "../utils/understanding.js";
import { matchConfirmation } from "../utils/navCommands.js";

// Comfortably above what this actually takes — measured 1.1-1.5s end to
// end, warm — but below the point where a cook decides the app has hung.
// The server's own gateway budget is 8s, so anything past this is the
// network or the proxy, not the model thinking.
const READ_TIMEOUT_MS = 12_000;

/**
 * Read one answer.
 *
 * @param {object} question   the ELICITATION_QUESTIONS entry
 * @param {string} text       what the cook said or typed
 * @param {string} [followUpAsked]  the follow-up already put to them, so a
 *        bare "three" is read as answering THAT rather than the original
 *        question
 * @param {object} [suggestion]  { value, display } that follow-up offered
 *        ("Did you mean vegan?"), for a yes to accept
 * @returns {Promise<{value, display, status, followUp, source}>}
 *          Always resolves. There is no error path on purpose: a failed
 *          read is a worse reading, never a broken page.
 */
export async function readAnswer(question, text, followUpAsked, suggestion = null) {
  // A quick-answer chip is the cook picking an exact option. There is
  // nothing to interpret, so don't spend a network round trip — or risk
  // an LLM second-guessing a button they deliberately pressed.
  const chosen = question.options.find((o) => o.label === text.trim());
  if (chosen) {
    return { value: chosen.value, display: chosen.label, status: "confirmed", followUp: null, source: "option" };
  }

  // A yes or no to "Did you mean vegan?" is settled here. Only this page
  // knows what was offered; a model handed a bare "yes" would have to guess.
  const local = { alreadyAsked: Boolean(followUpAsked), suggestion };
  if (suggestion && (matchConfirmation(text) || matchChineseConfirmation(text))) {
    return { followUp: null, ...interpretAnswer(question, text, local), source: "local" };
  }

  try {
    const reading = await apiRequest("/api/understanding", "/read", {
      method: "POST",
      // The server already caps its own call to the gateway; this caps
      // everything in front of it — the dev proxy, a stalled socket, a
      // server that accepted the request and went quiet. Without it a
      // hung request leaves the answer bar saying "Reading…" forever,
      // which is worse than the regex reading it would fall back to.
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      body: JSON.stringify({
        slot: question.id,
        question: question.agentText,
        text,
        followUpAsked,
      }),
    });
    if (reading && reading.status) return reading;
  } catch (err) {
    // Expected often enough not to be noise: the gateway rate limits at
    // a couple of calls in quick succession. Logged, never surfaced.
    console.info("[understanding] falling back to local reader:", err.message);
  }

  // followUp first, so a reader that asks again keeps its question.
  return { followUp: null, ...interpretAnswer(question, text, local), source: "local" };
}
