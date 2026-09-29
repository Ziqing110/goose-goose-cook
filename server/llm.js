// The one client for AssemblyAI's LLM Gateway. Every model call in the
// server goes through `chat`, so auth, timeouts and error shapes are
// decided once.
//
// Auth is the RAW key in `authorization`, as the gateway docs show — the
// same scheme as Streaming STT. See CLAUDE.md for the products that differ.

const GATEWAY_URL = "https://llm-gateway.assemblyai.com/v1/chat/completions";

export const API_KEY = process.env.ASSEMBLYAI_API_KEY || "";

export const MISSING_KEY_MESSAGE =
  "ASSEMBLYAI_API_KEY is not set. Copy .env.example to .env, add the key, and restart the server.";

/** A failed call, with the HTTP status a route should pass on. */
export class GatewayError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * One chat completion.
 *
 * `schema` asks for JSON matching a json_schema (and lets the gateway
 * repair near-misses); `tools` offers function calls. Both are optional.
 *
 * @returns {Promise<object|null>} the first choice ({ message, finish_reason })
 * @throws {GatewayError} 503 without a key, 504 on timeout, 502 when
 *   unreachable, or the gateway's own status when it refuses
 */
export async function chat({
  apiKey = API_KEY,
  model,
  messages,
  maxTokens,
  timeoutMs,
  temperature,
  tools,
  schema,
}) {
  if (!apiKey) throw new GatewayError(MISSING_KEY_MESSAGE, 503);

  let res;
  try {
    res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { authorization: apiKey, "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages,
        ...(temperature !== undefined && { temperature }),
        ...(tools && { tools }),
        ...(schema && {
          response_format: { type: "json_schema", json_schema: schema },
          post_processing_steps: [{ type: "json-repair" }],
        }),
      }),
    });
  } catch (err) {
    if (err.name === "TimeoutError") throw new GatewayError(`The model took longer than ${timeoutMs}ms.`, 504);
    throw new GatewayError(`Could not reach the gateway: ${err.message}`, 502);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new GatewayError(body.error?.message || body.error || `Gateway returned ${res.status}`, res.status);
  }
  const body = await res.json();
  return body.choices?.[0] ?? null;
}

/**
 * Pull a JSON object out of a model reply. A schema-constrained reply is
 * usually bare JSON, but a fenced or prefaced one is the common failure,
 * and looking for the outermost braces costs nothing.
 */
export function extractJson(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Send a caught error as JSON, keeping a GatewayError's status. */
export function sendError(res, err) {
  return res.status(err instanceof GatewayError ? err.status : 500).json({ error: err.message });
}
