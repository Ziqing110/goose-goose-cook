// Looking something up mid-cook.
//
// The LLM Gateway has no web search of its own — the `search_web` in
// AssemblyAI's agentic-workflows example is a function you implement.
// This is that function.
//
// Tavily, because it returns a synthesized answer rather than ten blue
// links: the agent has a 30-word budget and a cook with wet hands, so a
// page of snippets for the model to read would cost tokens and seconds
// to reach the same sentence.
//
// Optional by design. With no key the tool is never offered to the model,
// the agent behaves exactly as it did before, and nothing fails at cook
// time — the one moment when a missing key must not be a surprise.
const TAVILY = "https://api.tavily.com/search";

const MAX_RESULTS = 3;
const MAX_CHARS = 600;
const DEFAULT_TIMEOUT_MS = 4000;

export const searchConfigured = () => Boolean(process.env.TAVILY_API_KEY);

/**
 * @returns {Promise<string>} a short digest for the model to answer from,
 *   or a sentence saying it could not look it up. Never throws: a failed
 *   search should degrade to "I couldn't check", not break the turn.
 */
export async function searchWeb(query, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return "Search is not configured.";
  const asked = String(query ?? "").trim().slice(0, 300);
  if (!asked) return "No query given.";

  let body;
  try {
    const res = await fetch(TAVILY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        api_key: key,
        query: asked,
        // Cooking questions are general knowledge, so the shallow index
        // is both enough and faster.
        search_depth: "basic",
        include_answer: true,
        max_results: MAX_RESULTS,
      }),
    });
    if (!res.ok) return `Could not look that up (search returned ${res.status}).`;
    body = await res.json();
  } catch (err) {
    return err.name === "TimeoutError"
      ? "Could not look that up in time."
      : `Could not look that up (${err.message}).`;
  }

  if (body.answer) return String(body.answer).slice(0, MAX_CHARS);
  const digest = (body.results || [])
    .slice(0, MAX_RESULTS)
    .map((r) => `${r.title}: ${r.content}`)
    .join(" ")
    .slice(0, MAX_CHARS);
  return digest || "Nothing useful came back.";
}

/** The tool as the model sees it. Flat OpenAI function shape. */
export const SEARCH_TOOL = {
  type: "function",
  function: {
    name: "search_web",
    description:
      "Look up a cooking question you cannot answer from the recipe: a technique, a substitution, a rescue, a measurement. Costs the cook several seconds of waiting, so use it only when the recipe and ordinary knowledge do not cover it, and never for the state of this run.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for, as a short phrase." },
      },
      required: ["query"],
    },
  },
};
