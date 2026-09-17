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
import { interpretAnswer } from "../utils/understanding.js";

/**
 * Read one answer.
 *
 * @param {object} question   the ELICITATION_QUESTIONS entry
 * @param {string} text       what the cook said or typed
 * @param {string} [followUpAsked]  the follow-up already put to them, so a
 *        bare "three" is read as answering THAT rather than the original
 *        question
 * @returns {Promise<{value, display, status, followUp, source}>}
 *          Always resolves. There is no error path on purpose: a failed
 *          read is a worse reading, never a broken page.
 */
export async function readAnswer(question, text, followUpAsked) {
  // A quick-answer chip is the cook picking an exact option. There is
  // nothing to interpret, so don't spend a network round trip — or risk
  // an LLM second-guessing a button they deliberately pressed.
  const chosen = question.options.find((o) => o.label === text.trim());
  if (chosen) {
    return { value: chosen.value, display: chosen.label, status: "confirmed", followUp: null, source: "option" };
  }

  try {
    const reading = await apiRequest("/api/understanding", "/read", {
      method: "POST",
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

  return { ...interpretAnswer(question, text), followUp: null, source: "local" };
}
