// Client for the live-cook agent's brain (server/routes/agent.js).
//
// One utterance plus a snapshot of the kitchen in, vetted tool calls and
// a spoken reply out. It is the caller's job to fall back to the keyword
// grammar when this throws: a cook is standing there with wet hands, and
// "the model was slow" is not an answer.
import { apiRequest } from "./client.js";

// A little over the server's own budget, so the server's readable
// timeout error wins the race rather than an anonymous abort. The
// budget is 6s for an ordinary turn and 14s for one where the agent
// looks something up, so this covers the longer case.
const TIMEOUT_MS = 16_000;

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
