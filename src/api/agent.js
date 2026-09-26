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
export function agentTurn({ text, agentName, engaged, shared, snapshot }) {
  return apiRequest("/api/agent", "/turn", {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({ text, agentName, engaged, shared, snapshot }),
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

/**
 * Ask for one unprompted remark about a quiet kitchen.
 *
 * Whether the silence has been earned is decided before this is called
 * (see utils/commentary.js). Resolves to an empty line rather than
 * throwing on any failure: the fallback for a remark nobody asked for is
 * simply not making it, and a cook should never see an error about one.
 *
 * @returns {Promise<{line: string}>}
 */
export function agentAside({ agentName, snapshot }) {
  return apiRequest("/api/agent", "/aside", {
    method: "POST",
    body: JSON.stringify({ agentName, snapshot }),
  }).catch(() => ({ line: "" }));
}

/**
 * A few sentences about how a finished cook went.
 *
 * Resolves to an empty story rather than throwing: the summary card is
 * complete without it, and a diary page should never show an error where
 * a nice paragraph was going to be.
 *
 * @returns {Promise<{story: string}>}
 */
export function agentNarrate({ agentName, record }) {
  return apiRequest("/api/agent", "/narrate", {
    method: "POST",
    body: JSON.stringify({ agentName, record }),
  }).catch(() => ({ story: "" }));
}

/**
 * What somebody meant, on a page whose own commands did not match.
 * Resolves to a rewrite into one of `commands` (or a destination), or a
 * short reply, or neither. The rewrite is a suggestion: the caller runs
 * it back through the page's matcher and asks before acting.
 *
 * @returns {Promise<{utterance: string|null, reply: string, named: boolean}>}
 */
export function interpretUtterance({ text, agentName, route, context, commands, destinations }) {
  return apiRequest("/api/agent", "/interpret", {
    method: "POST",
    // A little over the server's 5s, so its readable timeout wins.
    signal: AbortSignal.timeout(7000),
    body: JSON.stringify({ text, agentName, route, context, commands, destinations }),
  });
}
