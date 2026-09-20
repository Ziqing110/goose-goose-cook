// Client for the live-cook agent's brain (server/routes/agent.js).
//
// One utterance plus a snapshot of the kitchen in, vetted tool calls and
// a spoken reply out. It is the caller's job to fall back to the keyword
// grammar when this throws: a cook is standing there with wet hands, and
// "the model was slow" is not an answer.
import { apiRequest } from "./client.js";

// A little over the server's own 6s budget, so the server's readable
// timeout error wins the race rather than an anonymous abort.
const TIMEOUT_MS = 8000;
// Collecting a looked-up answer is a separate, slower request: the
// server holds it open until the search and the second model call are
// done. It is off the turn queue, so nothing is waiting behind it.
const ANSWER_TIMEOUT_MS = 20_000;

/**
 * @returns {Promise<{addressed:boolean, calls:{name:string, stepId:string|null}[],
 *   reply:string, rejected:object[], ms:number, model:string|null,
 *   pendingId?:string}>}
 *   `pendingId` means the agent is looking something up. Everything else
 *   in the response applies NOW; pass the id to collectAnswer for the
 *   part it had to read up on.
 */
export function agentTurn({ text, agentName, engaged, snapshot }) {
  return apiRequest("/api/agent", "/turn", {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({ text, agentName, engaged, snapshot }),
  });
}

/**
 * Wait for an answer the agent had to look up.
 *
 * Deliberately not queued with the turns: a cook who asked "can I use a
 * shallot" should still be able to say "done with the garlic" while the
 * answer is being fetched. Throws if the answer expired or the lookup
 * failed — the caller treats that as Goose having nothing to add.
 *
 * @returns {Promise<{reply:string, ms:number, model:string|null}>}
 */
export function collectAnswer(pendingId) {
  return apiRequest("/api/agent", `/answer/${encodeURIComponent(pendingId)}`, {
    signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS),
  });
}
