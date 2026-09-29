// One agent turn, end to end: the addressing gate, the model call, and
// validation. The route and the calibration runner both call this, so
// what gets calibrated is exactly what ships.
import { chat } from "../llm.js";
import { buildSystemPrompt, buildTools, buildUserMessage, cleanReply, isAddressed, isUrgent, parseChoice } from "./turn.js";
import { searchConfigured, searchWeb } from "./search.js";

// The whole turn, not each leg. A search turn is two model calls plus a
// lookup, each with its own budget; without a wall clock the cook would
// wait for the sum. One search, never an open-ended loop.
const SEARCH_TURN_BUDGET_MS = 14_000;
// Generous because this budget is shared with the model's own reasoning
// tokens, which on gemini-2.5-flash-lite run ~90 for a one-sentence
// answer. At 300 a cooking answer ran out mid-word and was spoken aloud
// that way ("recipe doesn't say how much dou"). What actually bounds the
// reply is MAX_REPLY_CHARS, after the model has finished a sentence.
const MAX_TOKENS = 700;

/**
 * @returns {Promise<{addressed, calls, reply, rejected, ms, model}>}
 * @throws {GatewayError} with the HTTP status the route should pass on
 */
export async function requestTurn({ apiKey, model, text, agentName, engaged = false, shared = false, snapshot, timeoutMs = 6000 }) {
  // `named` is whether the agent's name was actually said. `engaged` alone
  // (answering its question) lets a turn through but is a weaker claim on
  // the agent's attention, and the caller uses the difference.
  const named = isAddressed(text, agentName, false);
  // Trouble, or a cry for help, with no name on it. Let through, because
  // the cook in trouble is the one least likely to say the name; the
  // model is told why it is hearing this and to stay quiet if it misread.
  const urgent = !named && !engaged && isUrgent(text);
  // No name heard, no open question, no trouble. Still sent to the model,
  // because the recogniser mangles the name ("Boost", "juice") past what
  // isAddressed forgives; the model is told nobody clearly said it and
  // decides, with silence as the default.
  const unnamed = !named && !engaged && !urgent;
  const started = Date.now();
  const search = searchConfigured();
  const tools = buildTools(snapshot, { search });
  const messages = [
    { role: "system", content: buildSystemPrompt({ agentName, speakerName: snapshot.speakerName, search }) },
    { role: "user", content: buildUserMessage(snapshot, text, { shared, urgent, unnamed }) },
  ];

  // A turn that never searches keeps its original budget exactly; one
  // that does gets the larger one, spent down leg by leg.
  const deadline = started + (search ? SEARCH_TURN_BUDGET_MS : timeoutMs);
  const left = () => Math.max(250, Math.min(timeoutMs, deadline - Date.now()));

  const ask = () => chat({ apiKey, model, maxTokens: MAX_TOKENS, timeoutMs: left(), tools, messages });

  const choice = await ask();
  const lookups = (choice?.message?.tool_calls || []).filter((c) => c?.function?.name === "search_web");
  const vetted = parseChoice(choice, snapshot, { shared });
  // There was no way to answer "did the model even try to name a cook,
  // or did vetting throw it out?" after the fact -- both looked
  // identical from the client, an assignment silently landing on the
  // speaker. This is the raw tool call the model actually produced,
  // cook_name included, next to what survived vetting and why anything
  // didn't.
  console.info("[agent] turn", {
    speaker: snapshot.speakerName,
    text,
    rawCalls: (choice?.message?.tool_calls || []).map((c) => ({ name: c?.function?.name, args: c?.function?.arguments })),
    calls: vetted.calls,
    rejected: vetted.rejected,
  });

  // The model's verdict on an unnamed turn: it acted or looked something
  // up. A reply alone is NOT enough -- a model told to be playful will
  // answer "did you watch the game" however it is asked not to, and a
  // real cooking question still calls a tool (status, score, explain).
  // Anything short of that is talk between cooks, handed back as not
  // addressed so the client keeps routing it to room talk (banter).
  const inferred = unnamed && (vetted.calls.length > 0 || lookups.length > 0);
  if (unnamed && !inferred) {
    return { addressed: false, named, urgent, inferred: false, calls: [], reply: "", rejected: vetted.rejected, ms: Date.now() - started, model };
  }

  if (!lookups.length) {
    return { addressed: true, named, urgent, inferred, ...vetted, searched: false, ms: Date.now() - started, model };
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
    urgent,
    inferred,
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
