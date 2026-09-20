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

/**
 * @returns {Promise<{addressed:boolean, calls:{name:string, stepId:string|null}[],
 *   reply:string, rejected:object[], ms:number, model:string|null}>}
 */
export function agentTurn({ text, agentName, engaged, snapshot }) {
  return apiRequest("/api/agent", "/turn", {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({ text, agentName, engaged, snapshot }),
  });
}
