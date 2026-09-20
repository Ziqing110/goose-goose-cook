// One agent turn, end to end: the addressing gate, the gateway call, and
// validation. The route and the calibration runner both call this, so
// what gets calibrated is exactly what ships.
import { buildSystemPrompt, buildTools, buildUserMessage, isAddressed, parseChoice } from "./turn.js";

const GATEWAY = "https://llm-gateway.assemblyai.com/v1/chat/completions";
// Generous because this budget is shared with the model's own reasoning
// tokens, which on gemini-2.5-flash-lite run ~90 for a one-sentence
// answer. At 300 a cooking answer ran out mid-word and was spoken aloud
// that way ("recipe doesn't say how much dou"). What actually bounds the
// reply is MAX_REPLY_CHARS, after the model has finished a sentence.
const MAX_TOKENS = 700;

export class TurnError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * @returns {Promise<{addressed, calls, reply, rejected, ms, model}>}
 * @throws {TurnError} with an HTTP-ish `status` the route can pass on
 */
export async function requestTurn({ apiKey, model, text, agentName, engaged = false, snapshot, timeoutMs = 6000 }) {
  // `named` is whether the agent's name was actually said. `engaged` alone
  // (answering its question) lets a turn through but is a weaker claim on
  // the agent's attention, and the caller uses the difference.
  const named = isAddressed(text, agentName, false);
  if (!named && !engaged) {
    return { addressed: false, named, calls: [], reply: "", rejected: [], ms: 0, model: null };
  }
  if (!apiKey) {
    throw new TurnError("ASSEMBLYAI_API_KEY is not set. Copy .env.example to .env, add the key, and restart the server.", 503);
  }

  const started = Date.now();
  let upstream;
  try {
    upstream = await fetch(GATEWAY, {
      method: "POST",
      // Raw key, no "Bearer": the gateway follows Streaming STT here,
      // not the Voice Agent API. See CLAUDE.md.
      headers: { authorization: apiKey, "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        tools: buildTools(snapshot),
        messages: [
          { role: "system", content: buildSystemPrompt({ agentName, speakerName: snapshot.speakerName }) },
          { role: "user", content: buildUserMessage(snapshot, text) },
        ],
      }),
    });
  } catch (err) {
    if (err.name === "TimeoutError") throw new TurnError(`The model took longer than ${timeoutMs}ms.`, 504);
    throw new TurnError(`Could not reach the gateway: ${err.message}`, 502);
  }

  const body = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    throw new TurnError(body.error?.message || body.error || `Gateway ${upstream.status}`, upstream.status);
  }
  return { addressed: true, named, ...parseChoice(body.choices?.[0], snapshot), ms: Date.now() - started, model };
}
