// Pure logic for the live-cook agent's turn: no I/O, so the addressing
// gate and the tool-call validation can be tested without a gateway or a
// key. The route in routes/agent.js only does the fetch.
//
// The client owns the run (it lives in the browser), so every request
// carries a compact snapshot and the server stays stateless. The model
// never writes to anything: it proposes tool calls, this file checks them
// against the snapshot, and the client executes the survivors through the
// same handlers a tap uses.

/** Tool names are the intent names parseCommand already produces. */
export const INTENTS = [
  "claim", "start", "done", "skip", "drop", "undo",
  "pause", "resume", "finish_run", "status", "score", "help",
];

const NEEDS_STEP = new Set(["claim", "start", "done", "skip", "drop"]);
const MAX_CALLS = 3;
const MAX_REPLY_CHARS = 200;

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * Was the agent spoken to?
 *
 * Deterministic on purpose. It runs before the model, so speech that
 * isn't for the agent never leaves the machine and never costs a call,
 * and the rule is one we can calibrate rather than a model's mood.
 *
 * `engaged` is true for a short window after the agent last spoke, so
 * "yes" or "the garlic one" answering its question doesn't need the name
 * repeated.
 *
 * Speech recognition won't always spell the name right, so a word within
 * one edit of it counts, but only for names of four letters or more:
 * one edit on a three-letter name matches half the dictionary.
 */
export function isAddressed(text, name, engaged = false) {
  if (engaged) return true;
  const target = norm(name);
  if (!target) return false;
  const slack = target.length >= 4 ? 1 : 0;
  return norm(text)
    .split(" ")
    .some((word) => word === target || (slack && Math.abs(word.length - target.length) <= slack && editDistance(word, target) <= slack));
}

/**
 * The tool list for this moment in the run. Step ids are an enum built
 * from the snapshot, so the model cannot name a step that doesn't exist,
 * and a tool with no legal target isn't offered at all.
 */
export function buildTools(snapshot) {
  const steps = snapshot.steps || [];
  const ids = {
    claim: steps.filter((s) => s.status === "pending" && s.ready).map((s) => s.id),
    start: steps.filter((s) => s.status === "pending" && s.ready).map((s) => s.id),
    done: steps.filter((s) => s.status === "active").map((s) => s.id),
    skip: steps.filter((s) => s.status === "active" || s.status === "pending").map((s) => s.id),
    drop: steps.filter((s) => s.status === "active").map((s) => s.id),
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
  };
  return INTENTS.filter((name) => !NEEDS_STEP.has(name) || ids[name].length).map((name) => ({
    type: "function",
    function: {
      name,
      description: describe[name],
      parameters: NEEDS_STEP.has(name)
        ? {
            type: "object",
            properties: { step_id: { type: "string", enum: ids[name] } },
            required: name === "claim" || name === "start" ? ["step_id"] : [],
          }
        : { type: "object", properties: {} },
    },
  }));
}

export function buildSystemPrompt({ agentName, speakerName }) {
  return `You are ${agentName}, a playful sous-chef assistant in a live cook. You listen through a microphone in a noisy kitchen, so what you read is speech recognition and may be garbled.

${speakerName} is speaking. Act only on what ${speakerName} asked, by calling tools. Call one tool per action; several are fine when they asked for several things ("done with the onions, start the garlic").

Rules:
- Use only the step ids you are given. Match by meaning, not exact words: "the onion thing" is the step about onions.
- If it is unclear which step they mean, call no tool and ask one short question.
- Act on the steps they name or clearly describe, and no others: "the chopping one" is one step, not every step that involves a knife.
- Questions about progress, what is next, who is doing what, or the score: call status or score. Never answer these from memory; the app reads out the real state.
- If they are clearly talking to someone else in the room, call no tool and reply with an empty string.
- Your reply is spoken aloud: at most 15 words, plain speech, no lists, markdown or emoji. Be warm and a little funny, never at the cost of being clear. After a plain action, a two-word acknowledgement or an empty reply is right.
- Anything unrelated to this cook (weather, trivia, chit-chat): call no tool, and decline in one short, friendly sentence. Do not call help for it.
- Never claim to have done something you did not call a tool for.`;
}

/** The user message: state of the kitchen, recent talk, then the words. */
export function buildUserMessage(snapshot, text) {
  const open = (snapshot.steps || []).map((s) => ({
    id: s.id,
    label: s.label,
    status: s.status,
    ready: s.ready,
    holder: s.holder ?? null,
  }));
  const lines = [
    `Mode: ${snapshot.mode || "coop"}. ${snapshot.paused ? "PAUSED." : "Running."}`,
    `Cooks: ${(snapshot.cooks || []).map((c) => c.name).join(", ")}.`,
    `Open steps: ${JSON.stringify(open)}`,
  ];
  if (snapshot.history?.length) {
    lines.push(`Recent: ${snapshot.history.slice(-6).map((h) => `${h.speaker}: ${h.text}`).join(" | ")}`);
  }
  lines.push(`${snapshot.speakerName} said: "${text}"`);
  return lines.join("\n");
}

/**
 * Turn a gateway choice into vetted calls plus a reply.
 * Anything the snapshot doesn't back up is dropped and reported, never
 * executed: a model that names a finished step or a made-up id gets
 * ignored, not obeyed.
 */
export function parseChoice(choice, snapshot) {
  const message = choice?.message || {};
  const steps = snapshot.steps || [];
  const tools = Object.fromEntries(buildTools(snapshot).map((t) => [t.function.name, t.function.parameters]));
  const calls = [];
  const rejected = [];

  for (const raw of message.tool_calls || []) {
    if (calls.length >= MAX_CALLS) break; // cap what survives, not what was attempted
    const name = raw?.function?.name;
    let args = {};
    try {
      args = JSON.parse(raw?.function?.arguments || "{}") || {};
    } catch {
      rejected.push({ name, reason: "bad_json" });
      continue;
    }
    if (!tools[name]) {
      rejected.push({ name, reason: "not_offered" });
      continue;
    }
    const stepId = args.step_id ? String(args.step_id) : null;
    if (stepId && !steps.some((s) => s.id === stepId)) {
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

  const reply = String(message.content ?? "")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_REPLY_CHARS);

  return { calls, reply, rejected };
}
