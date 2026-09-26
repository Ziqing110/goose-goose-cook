// One unprompted remark into a quiet kitchen.
//
// Nothing like an agent turn, despite the shared subject: nobody asked a
// question, no tool may be called, and the only acceptable output is one
// short spoken sentence or nothing at all. So it is its own call with
// its own prompt rather than a mode on requestTurn, which exists to turn
// a request into actions.
//
// Whether this is ALLOWED to happen at all is decided in the browser
// (src/utils/commentary.js) from the run's own state -- who is busy, how
// long the room has been quiet, how recently the goose last spoke.
// Nothing here relitigates that; by the time the request arrives the
// silence has already been earned.
//
// Cheap model, deliberately. This is a garnish: it must never compete
// for tokens or latency with a cook who actually asked for something,
// and if it fails the kitchen is simply quiet, which is where it started.

const GATEWAY = "https://llm-gateway.assemblyai.com/v1/chat/completions";
// One sentence. The cap is on characters after the fact as well, because
// a model that ignores "short" costs a cook their attention, not tokens.
const MAX_TOKENS = 120;
const MAX_CHARS = 140;
// Shorter than an agent turn's: nobody is waiting for this, which means
// nobody will wait for it either. A late aside lands in a kitchen that
// has moved on.
const TIMEOUT_MS = 4000;

export function buildAsidePrompt(agentName) {
  return `You are ${agentName}, a sous-chef watching a live cook. The kitchen has gone quiet: everyone is head-down on their own step and nobody has spoken for a while.

Say ONE short line, under twenty words, about what you can see in the run below. Good lines notice something specific and true: who is ahead, what is coming up next, someone about to finish, a step running long.

Rules:
- Nobody asked you anything. This is a remark, not an answer, and not a question.
- Say nothing that is not in the state below. Never invent progress, times or events.
- Never give an instruction or tell anyone to do something. They are already working.
- Plain speech, no lists, no markdown, no emoji. It is read aloud.
- If there is nothing worth remarking on, reply with an empty string. A quiet kitchen is a fine outcome.`;
}

/** The run, flattened to what a remark could reasonably be about. */
export function buildAsideMessage(snapshot) {
  const steps = (snapshot.steps || []).map((s) => ({
    label: s.label,
    status: s.status,
    holder: s.holder ?? null,
  }));
  return [
    `Mode: ${snapshot.mode || "coop"}.`,
    `Cooks: ${(snapshot.cooks || []).map((c) => c.name).join(", ")}.`,
    `Steps: ${JSON.stringify(steps)}`,
  ].join("\n");
}

/**
 * @returns {Promise<{line: string, model: string|null}>} an empty line
 *   means "say nothing", which is a normal outcome and not an error.
 */
export async function requestAside({ apiKey, model, agentName, snapshot, timeoutMs = TIMEOUT_MS }) {
  if (!apiKey) return { line: "", model: null };

  const body = {
    model,
    messages: [
      { role: "system", content: buildAsidePrompt(agentName) },
      { role: "user", content: buildAsideMessage(snapshot) },
    ],
    max_tokens: MAX_TOKENS,
  };

  // Every failure is the same failure: the kitchen stays quiet. There is
  // no error worth surfacing to a cook for a line nobody asked for.
  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { line: "", model: null };
    const json = await res.json();
    return { line: cleanAside(json?.choices?.[0]?.message?.content), model };
  } catch {
    return { line: "", model: null };
  }
}

/** One sentence, no decoration, or nothing. */
export function cleanAside(raw) {
  const text = String(raw ?? "")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  // A question is the one shape this must never take: it would leave the
  // kitchen owing an answer to something nobody was asked.
  if (text.endsWith("?")) return "";
  return text.length > MAX_CHARS ? "" : text;
}
