// What somebody meant, on a page whose own commands did not match.
//
// Every page outside the live cook listens with a closed grammar:
// regexes over the normalized transcript. That is right for deciding
// what to DO, and wrong as the only way in. A cook the recogniser wrote
// down as "Zina" could not say "no, it's Zeina, Z-E-I-N-A" -- nothing
// matches that sentence -- and was left to type it.
//
// So when nothing matches, the page's own commands come here, and the
// model's one job is to rewrite what was said as ONE of them: "call the
// first cook Zeina". It does not act, and it cannot invent an action.
// The rewrite goes back through the same matcher in the browser, which
// either accepts it as a command the page already had or drops it, and
// even then the goose asks before doing it.
//
// Not the live cook's agent (agent/turn.js): there the model chooses
// among tools over a run it can see. Here it only translates, and the
// grammar stays the authority.
import { cleanReply, isAddressed } from "./turn.js";

const GATEWAY = "https://llm-gateway.assemblyai.com/v1/chat/completions";
const MAX_TOKENS = 200;
const MAX_UTTERANCE_CHARS = 200;
// Somebody is standing there waiting for an answer to a sentence the
// app did not understand. Past this they have already said it again.
const TIMEOUT_MS = 5000;

export class InterpretError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const TOOL = {
  type: "function",
  function: {
    name: "say_command",
    description: "Rewrite what they said as exactly one of the page's commands, in words that command accepts.",
    parameters: {
      type: "object",
      properties: {
        utterance: {
          type: "string",
          description: "The command as it should have been said, e.g. \"call the first cook Zeina\". Lowercase is fine; keep names in the spelling they gave.",
        },
      },
      required: ["utterance"],
    },
  },
};

export function buildInterpretPrompt(agentName) {
  return `You are ${agentName}, the voice of a cooking app. People talk to it through a microphone in a kitchen, and speech recognition turns that into text, sometimes badly.

What they just said did not match any command on the page they are looking at. Your only job is to decide whether they meant one of the page's commands, and if so call say_command with that command rewritten in words it accepts.

Rules:
- Use only the commands listed. Each shows example wordings and the pattern it must match; your utterance must match one pattern. Prefer the wording of the examples.
- One command, never more.
- When one command clearly fits, call it. The app reads it back and asks them to confirm before anything happens, so never ask permission yourself.
- Names and values come from what they said, never from you. If they spell something out letter by letter ("Z-E-I-N-A", "z e i n a", "zed e i n a"), join the letters and use that exact spelling.
- A correction ("no, it's Zeina", "not Zina, Zeina") means change the thing named in the page state to what they said.
- Use the page state to decide which thing they mean ("the first cook", "her"). If it is still unclear which one, call nothing and ask one short question.
- If they are talking to someone else, or nothing listed fits, call nothing and reply with an empty string. Doing nothing is the right answer to most kitchen talk.
- Your reply is spoken aloud: at most 15 words, plain speech. Leave it empty when you call say_command.`;
}

export function buildInterpretMessage({ text, route, context, commands, destinations }) {
  const lines = [`Page: ${route}`];
  if (context?.length) lines.push("Page state:", ...context.map((c) => `- ${c}`));
  lines.push("", "Commands:");
  commands.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.description || "(no description)"}`);
    if (c.examples?.length) lines.push(`   say: ${c.examples.map((e) => `"${e}"`).join(", ")}`);
    if (c.patterns?.length) lines.push(`   must match: ${c.patterns.map((p) => `/${p}/`).join("  ")}`);
  });
  if (destinations?.length) {
    lines.push(`${commands.length + 1}. Go to another page`, `   say: ${destinations.map((d) => `"go to ${d}"`).join(", ")}`);
  }
  lines.push("", `They said: "${text}"`);
  return lines.join("\n");
}

/**
 * The model's choice, vetted into what the browser may act on.
 * Nothing here trusts the model's wording to be a valid command; the
 * browser's matcher decides that. This only keeps it to one short string.
 */
export function parseInterpretation(choice) {
  const call = (choice?.message?.tool_calls || []).find((c) => c?.function?.name === "say_command");
  let utterance = "";
  if (call) {
    try {
      utterance = String(JSON.parse(call.function.arguments || "{}").utterance || "");
    } catch {
      utterance = "";
    }
  }
  utterance = utterance.replace(/\s+/g, " ").trim().slice(0, MAX_UTTERANCE_CHARS);
  // A reply is only ever words to say. The model sometimes answers in
  // half-formed JSON instead of calling the tool, and reading that aloud
  // is worse than silence.
  let reply = utterance ? "" : cleanReply(choice?.message?.content);
  if (/[{}[\]]/.test(reply)) reply = "";
  return { utterance: utterance || null, reply };
}

/**
 * @returns {Promise<{utterance: string|null, reply: string, named: boolean, ms: number, model: string}>}
 * @throws {InterpretError}
 */
export async function requestInterpretation({ apiKey, model, agentName, text, route, context, commands, destinations, timeoutMs = TIMEOUT_MS }) {
  if (!apiKey) throw new InterpretError("ASSEMBLYAI_API_KEY is not set.", 503);
  const started = Date.now();
  let upstream;
  try {
    upstream = await fetch(GATEWAY, {
      method: "POST",
      // Raw key, no "Bearer" -- see CLAUDE.md.
      headers: { authorization: apiKey, "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        tools: [TOOL],
        messages: [
          { role: "system", content: buildInterpretPrompt(agentName) },
          { role: "user", content: buildInterpretMessage({ text, route, context, commands, destinations }) },
        ],
      }),
    });
  } catch (err) {
    if (err.name === "TimeoutError") throw new InterpretError(`The model took longer than ${timeoutMs}ms.`, 504);
    throw new InterpretError(`Could not reach the gateway: ${err.message}`, 502);
  }
  const body = await upstream.json().catch(() => ({}));
  if (!upstream.ok) throw new InterpretError(body.error?.message || body.error || `Gateway ${upstream.status}`, upstream.status);
  return {
    ...parseInterpretation(body.choices?.[0]),
    named: isAddressed(text, agentName, false),
    ms: Date.now() - started,
    model,
  };
}
