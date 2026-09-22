// One agent turn, end to end: the addressing gate, the gateway call, and
// validation. The route and the calibration runner both call this, so
// what gets calibrated is exactly what ships.
import { buildSystemPrompt, buildTools, buildUserMessage, cleanReply, isAddressed, parseChoice } from "./turn.js";
import { searchConfigured, searchWeb } from "./search.js";

const GATEWAY = "https://llm-gateway.assemblyai.com/v1/chat/completions";
// One search, not an open-ended agentic loop. Every extra hop is another
// few seconds of a cook standing over a hot wok, and no cooking question
// worth asking mid-service needs two lookups to answer.
// The whole turn, not each leg. Without a wall clock a search turn is
// two model calls plus a lookup, each with its own budget, and the cook
// waits for the sum. This caps what they can actually experience.
const SEARCH_TURN_BUDGET_MS = 14_000;
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
export async function requestTurn({ apiKey, model, text, agentName, engaged = false, shared = false, snapshot, timeoutMs = 6000 }) {
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
  const search = searchConfigured();
  const tools = buildTools(snapshot, { search });
  const messages = [
    { role: "system", content: buildSystemPrompt({ agentName, speakerName: snapshot.speakerName, search }) },
    { role: "user", content: buildUserMessage(snapshot, text, { shared }) },
  ];

  // A turn that never searches keeps its original budget exactly; one
  // that does gets the larger one, spent down leg by leg.
  const deadline = started + (search ? SEARCH_TURN_BUDGET_MS : timeoutMs);
  const left = () => Math.max(250, Math.min(timeoutMs, deadline - Date.now()));

  const ask = async () => {
    let upstream;
    try {
      upstream = await fetch(GATEWAY, {
        method: "POST",
        // Raw key, no "Bearer": the gateway follows Streaming STT here,
        // not the Voice Agent API. See CLAUDE.md.
        headers: { authorization: apiKey, "content-type": "application/json" },
        signal: AbortSignal.timeout(left()),
        body: JSON.stringify({ model, max_tokens: MAX_TOKENS, tools, messages }),
      });
    } catch (err) {
      if (err.name === "TimeoutError") throw new TurnError(`The model took longer than ${timeoutMs}ms.`, 504);
      throw new TurnError(`Could not reach the gateway: ${err.message}`, 502);
    }
    const body = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      throw new TurnError(body.error?.message || body.error || `Gateway ${upstream.status}`, upstream.status);
    }
    return body.choices?.[0];
  };

  const choice = await ask();
  const lookups = (choice?.message?.tool_calls || []).filter((c) => c?.function?.name === "search_web");
  const vetted = parseChoice(choice, snapshot, { shared });

  if (!lookups.length) {
    return { addressed: true, named, ...vetted, searched: false, ms: Date.now() - started, model };
  }

  // The model wants to look something up. Do NOT wait for it here: the
  // caller's turn queue is serial, so blocking would hold every later
  // utterance behind this one question. Hand back what the model already
  // decided, plus something to say, and let the caller collect the
  // answer whenever it lands.
  const resume = (async () => {
    messages.push(choice.message);
    for (const call of lookups) {
      let query = "";
      try {
        query = JSON.parse(call.function.arguments || "{}").query || "";
      } catch { /* a malformed argument is just an empty search */ }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: await searchWeb(query, { timeoutMs: Math.min(4000, left()) }),
      });
    }
    const answer = await ask();
    // Reply only. The board has had several seconds to move on, and the
    // snapshot this was vetted against is that old too — acting on it
    // now would be acting on a kitchen that no longer exists. Anything
    // the model wanted to DO it had its chance to say in the first
    // response, which was applied immediately.
    return { reply: cleanReply(answer?.message?.content), ms: Date.now() - started, model };
  })();

  return {
    addressed: true,
    named,
    ...vetted,
    // Something to say now, so nobody is left listening to silence while
    // it reads. The model's own line if it offered one, ours if not.
    reply: vetted.reply || "Let me look that up.",
    searched: true,
    resume,
    ms: Date.now() - started,
    model,
  };
}
