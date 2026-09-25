// Pure logic for the live-cook agent's turn: no I/O, so the addressing
// gate and the tool-call validation can be tested without a gateway or a
// key. The route in routes/agent.js only does the fetch.
//
// The client owns the run (it lives in the browser), so every request
// carries a compact snapshot and the server stays stateless. The model
// never writes to anything: it proposes tool calls, this file checks them
// against the snapshot, and the client executes the survivors through the
// same handlers a tap uses.

// The addressing rule is shared with the client, which uses it to decide
// what is worth sending at all. One copy, so the two can't disagree about
// whether a turn was meant for the agent.
export { isAddressed } from "../../src/utils/addressing.js";
import { SEARCH_TOOL } from "./search.js";

/** Tool names are the intent names parseCommand already produces. */
export const INTENTS = [
  "claim", "start", "done", "skip", "drop", "undo",
  "pause", "resume", "finish_run", "status", "score", "help", "explain",
];

// explain needs one too, but unlike the others it may name a step
// nobody is on and nobody can claim yet -- "what does mix sauce mean"
// is a fair question about step nineteen. Its enum is built
// separately, over everything still open.
const NEEDS_STEP = new Set(["claim", "start", "done", "skip", "drop", "explain"]);

// Tools that answer rather than act, and so survive a two-speaker turn.
const READ_ONLY = new Set(["explain", "search_web"]);
const MAX_CALLS = 3;
const MAX_REPLY_CHARS = 200;


/**
 * The tool list for this moment in the run. Step ids are an enum built
 * from the snapshot, so the model cannot name a step that doesn't exist,
 * and a tool with no legal target isn't offered at all.
 */
export function buildTools(snapshot, { search = false } = {}) {
  const steps = snapshot.steps || [];
  const ids = {
    claim: steps.filter((s) => s.status === "pending" && s.ready).map((s) => s.id),
    start: steps.filter((s) => s.status === "pending" && s.ready).map((s) => s.id),
    done: steps.filter((s) => s.status === "active").map((s) => s.id),
    skip: steps.filter((s) => s.status === "active" || s.status === "pending").map((s) => s.id),
    drop: steps.filter((s) => s.status === "active").map((s) => s.id),
    // Any step on the board, finished ones included. Asking what
    // something means is not acting on it, so readiness, ownership and
    // being over are all beside the point -- and "what was that tofu
    // step?" is a fair question once the tofu is done.
    explain: [...steps.map((s) => s.id), ...(snapshot.finished || []).map((s) => s.id)],
  };
  const describe = {
    claim: "The speaker takes a step that is ready but not started.",
    start: "The speaker starts a step they own or just claimed.",
    done: "The speaker finished a step. Omit step_id for the one they are on.",
    skip: "Skip a step. Omit step_id for the speaker's current one.",
    drop: "The speaker gives a step back so someone else can take it.",
    undo: "Undo the speaker's last action.",
    pause: "Pause every clock.",
    resume: "Resume after a pause.",
    finish_run: "End the whole cook. Only when they say the whole meal is finished, never one step.",
    status: "Read out who is doing what and how far along the cook is.",
    score: "Read out the scoreboard.",
    help: "List what the agent can do.",
    explain: "The speaker asked what a step means, how to do it, or how long it takes. The app reads the recipe's own wording back, so call this rather than describing the step yourself.",
  };
  const actions = INTENTS.filter((name) => !NEEDS_STEP.has(name) || ids[name].length).map((name) => ({
    type: "function",
    function: {
      name,
      description: describe[name],
      parameters: NEEDS_STEP.has(name)
        ? {
            type: "object",
            properties: { step_id: { type: "string", enum: ids[name] } },
            // explain is always about a named step; there is no "the one
            // I am on" reading of "what does that mean".
            required: ["claim", "start", "explain"].includes(name) ? ["step_id"] : [],
          }
        : { type: "object", properties: {} },
    },
  }));
  // Offered only when a search key exists. An advertised tool the server
  // cannot run is worse than no tool: the model calls it, gets an error
  // back, and the cook waits through a round trip for nothing.
  return search ? [...actions, SEARCH_TOOL] : actions;
}

export function buildSystemPrompt({ agentName, speakerName, search = false }) {
  return `You are ${agentName}, a playful sous-chef assistant in a live cook. You listen through a microphone in a noisy kitchen, so what you read is speech recognition and may be garbled.

${speakerName} is speaking. Act only on what ${speakerName} asked, by calling tools. Call one tool per action; several are fine when they asked for several things ("done with the onions, start the garlic").

Rules:
- Use only the step ids you are given. Match by meaning, not exact words: "the onion thing" is the step about onions.
- If it is unclear which step they mean, call no tool and ask one short question.
- Act on the steps they name or clearly describe, and no others: "the chopping one" is one step, not every step that involves a knife.
- Questions about progress, what is next, who is doing what, or the score: call status or score. Never answer these from memory; the app reads out the real state.
- If they are clearly talking to someone else in the room, call no tool and reply with an empty string.
- Your reply is spoken aloud: at most 15 words, plain speech, no lists, markdown or emoji. Be warm and a little funny, never at the cost of being clear. After a plain action, a two-word acknowledgement or an empty reply is right.
- The step ids you are given per tool are the only legal ones for it. If they say they finished, skipped or are dropping a step whose id is not in that tool's list, they have not taken it yet: say so in one line and call no tool. Do not ask which step they meant -- you already know which, it is simply not theirs.
- A short step name can hide what it actually involves. If they ask what a step means, how to do it, what it needs, or how long it takes, call explain with that step id rather than answering from the step name -- the app reads back the recipe's own wording, which you cannot see in full.
- A Brief line, when present, is what they asked for before any of this was planned. Honour it without being asked: never suggest something their diet rules out, and let their stated skill level set how much you explain.
- Anything unrelated to this cook (weather, trivia, chit-chat): call no tool, and decline in one short, friendly sentence. Do not call help for it.
- Never claim to have done something you did not call a tool for.${search ? `
- You can call search_web for a cooking question the recipe does not answer. It makes ${speakerName} wait several seconds, so use it only when you genuinely do not know, never for anything about this run.` : ""}`;
}

/** The user message: state of the kitchen, recent talk, then the words. */
export function buildUserMessage(snapshot, text, { shared = false } = {}) {
  const open = (snapshot.steps || []).map((s) => ({
    id: s.id,
    label: s.label,
    // What the recipe says to do for this step, when it says anything.
    ...(s.how ? { how: s.how } : null),
    status: s.status,
    ready: s.ready,
    holder: s.holder ?? null,
  }));
  const lines = [
    `Mode: ${snapshot.mode || "coop"}. ${snapshot.paused ? "PAUSED." : "Running."}`,
    `Cooks: ${(snapshot.cooks || []).map((c) => c.name).join(", ")}.`,
    `Open steps: ${JSON.stringify(open)}`,
  ];
  // Labels, so a question about a finished step can be matched to one.
  // Explain-only: the tool enums are what stop anything being done to
  // them, and the prompt says so too.
  if (snapshot.finished?.length) {
    lines.push(`Already finished (can only be explained, never acted on): ${JSON.stringify(snapshot.finished)}`);
  }
  // Before the open steps would bury it; after them it reads as a
  // footnote. It goes first because it constrains every answer below.
  if (snapshot.brief) {
    lines.unshift(`Brief: ${JSON.stringify(snapshot.brief)}`);
  }
  if (snapshot.history?.length) {
    lines.push(`Recent: ${snapshot.history.slice(-6).map((h) => `${h.speaker}: ${h.text}`).join(" | ")}`);
  }
  if (shared) {
    // The transcript is one turn holding two people, so it may be two
    // half-sentences stitched together and the name on it is a coin
    // flip. Say so plainly rather than letting the model puzzle over a
    // sentence that contradicts itself.
    lines.push(
      `TWO COOKS SPOKE AT ONCE and this is both of them in one transcript, so it may be two half-sentences and the speaker above may be the wrong one. Take no action. Ask, in one short question, which of them meant it and what they wanted: "${text}"`,
    );
    return lines.join("\n");
  }
  lines.push(`${snapshot.speakerName} said: "${text}"`);
  return lines.join("\n");
}


// Small models narrate. Asked a cooking question they sometimes emit their
// own scratchpad as the answer — "Thinking Process: 1. Identify the user's
// intent...", or a stray "toolcode print(default_api.status())" — and this
// reply is SPOKEN ALOUD, so it cannot be passed through on the hope that it
// is prose. Seen on gemini-2.5-flash-lite in calibration, 2 runs in 23.
const SCAFFOLDING = [
  /thinking process/i,
  /\btool_?code\b/i,
  /\bdefault_?api\b/i,
  /^(?:the user|this is a cooking question|i should (?:answer|call|use))/i,
  /^okay,? (?:so )?(?:the user|let'?s think)/i,
];

/**
 * What the agent actually says. Two jobs beyond tidying markdown:
 *
 * Drop a reply that is the model thinking out loud rather than talking to
 * the cook. Silence is a fine outcome — the action still ran, and the page
 * speaks its own line for that.
 *
 * Cut to whole sentences. The character cap used to slice mid-word, and a
 * chopped-off sentence read by a text-to-speech voice is worse than a
 * shorter one ("recipe doesn't say how much dou").
 */
export function cleanReply(content) {
  const text = String(content ?? "")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (SCAFFOLDING.some((re) => re.test(text))) return "";
  if (text.length <= MAX_REPLY_CHARS) return text;

  // Keep whole sentences up to the cap; if the first one alone is longer
  // than that, fall back to cutting at a word boundary.
  const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
  let out = "";
  for (const sentence of sentences) {
    if ((out + sentence).trim().length > MAX_REPLY_CHARS) break;
    out += sentence;
  }
  out = out.trim();
  if (out) return out;
  return `${text.slice(0, MAX_REPLY_CHARS).replace(/\s+\S*$/, "")}...`;
}

/**
 * Turn a gateway choice into vetted calls plus a reply.
 * Anything the snapshot doesn't back up is dropped and reported, never
 * executed: a model that names a finished step or a made-up id gets
 * ignored, not obeyed.
 */
export function parseChoice(choice, snapshot, { shared = false } = {}) {
  const message = choice?.message || {};
  const steps = snapshot.steps || [];
  const tools = Object.fromEntries(buildTools(snapshot).map((t) => [t.function.name, t.function.parameters]));
  const calls = [];
  const rejected = [];

  for (const raw of message.tool_calls || []) {
    if (calls.length >= MAX_CALLS) break; // cap what survives, not what was attempted
    const name = raw?.function?.name;
    // Two cooks in one turn: nothing that CHANGES anything fires,
    // whatever the model decided. The prompt asks it to hold off and ask
    // instead, but a prompt is a request and this is the guarantee —
    // acting on a turn whose speaker is a coin flip is the exact failure
    // we set out to stop, and it is not worth leaving to a model having
    // a bad day.
    //
    // explain and search_web are exempt because neither writes anything.
    // Getting the speaker wrong on a claim credits the wrong cook;
    // getting it wrong on "what does that mean" reads the recipe out to
    // a room that already contains both of them.
    if (shared && !READ_ONLY.has(name)) {
      rejected.push({ name, reason: "two_speakers" });
      continue;
    }
    let args = {};
    try {
      args = JSON.parse(raw?.function?.arguments || "{}") || {};
    } catch {
      rejected.push({ name, reason: "bad_json" });
      continue;
    }
    // search_web is the agent's own business, run inside the gateway
    // loop before we ever get here. It is not an action on the board.
    if (name === "search_web") continue;
    if (!tools[name]) {
      rejected.push({ name, reason: "not_offered" });
      continue;
    }
    const stepId = args.step_id ? String(args.step_id) : null;
    // Finished steps are real steps; they are simply not actionable.
    // The per-tool enum below is what keeps them explain-only.
    const known = [...steps, ...(snapshot.finished || [])];
    if (stepId && !known.some((s) => s.id === stepId)) {
      rejected.push({ name, reason: "unknown_step", stepId });
      continue;
    }
    const allowed = tools[name].properties?.step_id?.enum;
    if (stepId && allowed && !allowed.includes(stepId)) {
      rejected.push({ name, reason: "step_not_eligible", stepId });
      continue;
    }
    calls.push({ name, stepId });
  }

  return { calls, reply: cleanReply(message.content), rejected };
}
