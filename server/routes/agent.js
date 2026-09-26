// The live-cook agent's brain: one turn in, vetted tool calls and a spoken
// reply out.
//
// POST /api/agent/turn
//   { text, agentName, engaged, snapshot }
//   -> { addressed, calls: [{name, stepId}], reply, rejected, ms, model,
//        pendingId? }
//
// GET /api/agent/answer/:id
//   -> { reply, ms, model }
//
// A turn where the agent looks something up answers TWICE. The first
// response comes back at once, carrying anything it already decided to
// do and a line to say out loud; `pendingId` is then collected from the
// second endpoint, off the caller's turn queue, so the cook can keep
// giving commands while Goose reads. See agent/pending.js.
//
// The run lives in the browser, so the snapshot travels with each
// request and this stays stateless. Nothing here executes anything: the
// client applies `calls` through the same handlers a tap uses.
//
// Same gateway and same raw-key auth as understanding.js. The model is
// its own knob (AAI_AGENT_MODEL) because a turn is judged on latency
// first, and it must support `tools`. Gateway streaming works on OpenAI
// models only, so replies arrive whole. The logic is in agent/gateway.js
// so the calibration runner exercises the same path.
import { Router } from "express";
import { requestTurn, TurnError } from "../agent/gateway.js";
import { collect, park } from "../agent/pending.js";
import { requestAside } from "../agent/aside.js";
import { requestNarration } from "../agent/narrate.js";
import { requestInterpretation, InterpretError } from "../agent/interpret.js";

export const agentRouter = Router();

const API_KEY = process.env.ASSEMBLYAI_API_KEY || "";
const MODEL = process.env.AAI_AGENT_MODEL || "gpt-4.1";
const MAX_TEXT_CHARS = 500;
// A garnish must never compete with a cook who actually asked for
// something, so it gets its own model knob and a cheap default.
const ASIDE_MODEL = process.env.AAI_ASIDE_MODEL || "gemini-2.5-flash-lite";
// The cook is over and nobody is waiting on a hot pan, which makes this
// the one call in the app where a slower, better model is the right
// trade. It runs once per run and the result is stored on the summary.
const NARRATE_MODEL = process.env.AAI_NARRATE_MODEL || "claude-sonnet-4-6";

/**
 * Collect a parked answer. Holds the request open until the lookup
 * finishes, which is what makes this a plain await on the client rather
 * than a polling loop.
 */
agentRouter.get("/answer/:id", async (req, res) => {
  const promise = collect(req.params.id);
  // Already collected, expired, or never existed. Not an error worth
  // shouting about: the answer is simply gone, and the cook has moved on.
  if (!promise) return res.status(404).json({ error: "No answer is waiting under that id." });
  try {
    return res.json(await promise);
  } catch (err) {
    if (err instanceof TurnError) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

/**
 * An unprompted remark into a quiet kitchen.
 *
 * Whether the silence has been earned is decided in the browser (see
 * utils/commentary.js), which is the only place that knows who is busy
 * and how long the room has been quiet. This just writes the line.
 *
 * Never fails: every problem comes back as an empty line, because the
 * correct fallback for a remark nobody asked for is not making it.
 */
agentRouter.post("/aside", async (req, res) => {
  const { agentName, snapshot } = req.body || {};
  if (!agentName || !Array.isArray(snapshot?.steps)) {
    return res.status(400).json({ error: "agentName and snapshot {steps} are required." });
  }
  const { line } = await requestAside({ apiKey: API_KEY, model: ASIDE_MODEL, agentName, snapshot });
  return res.json({ line });
});

/**
 * A few sentences about how a finished cook went.
 *
 * Never fails: an empty story means the card keeps the deterministic
 * headline it has always had, which is a complete card, not a broken
 * one.
 */
agentRouter.post("/narrate", async (req, res) => {
  const { agentName, record } = req.body || {};
  if (!agentName || !record || typeof record !== "object") {
    return res.status(400).json({ error: "agentName and record are required." });
  }
  const { story } = await requestNarration({ apiKey: API_KEY, model: NARRATE_MODEL, agentName, record });
  return res.json({ story });
});

/**
 * What somebody meant, on a page whose commands did not match it. The
 * reply is a rewrite into one of those commands, or nothing; the browser
 * re-matches it and asks before acting. See agent/interpret.js.
 */
agentRouter.post("/interpret", async (req, res) => {
  const { text, agentName, route, context, commands, destinations } = req.body || {};
  const said = String(text ?? "").trim().slice(0, MAX_TEXT_CHARS);
  if (!said || !agentName || !Array.isArray(commands)) {
    return res.status(400).json({ error: "text, agentName and commands are required." });
  }
  const strings = (list, max) => (Array.isArray(list) ? list.slice(0, max).map((x) => String(x).slice(0, 300)) : []);
  try {
    return res.json(
      await requestInterpretation({
        apiKey: API_KEY,
        model: MODEL,
        agentName: String(agentName).slice(0, 40),
        text: said,
        route: String(route ?? "").slice(0, 100),
        context: strings(context, 20),
        // Inventory registers two commands per ingredient.
        commands: commands.slice(0, 100).map((c) => ({
          description: String(c?.description ?? "").slice(0, 200),
          examples: strings(c?.examples, 6),
          patterns: strings(c?.patterns, 6),
        })),
        destinations: strings(destinations, 12),
      }),
    );
  } catch (err) {
    if (err instanceof InterpretError) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

agentRouter.post("/turn", async (req, res) => {
  const { text, agentName, engaged, shared, snapshot } = req.body || {};
  const said = String(text ?? "").trim().slice(0, MAX_TEXT_CHARS);
  if (!said || !agentName || !snapshot?.speakerName || !Array.isArray(snapshot.steps)) {
    return res.status(400).json({ error: "text, agentName and snapshot {speakerName, steps} are required." });
  }
  try {
    const turn = await requestTurn({
      apiKey: API_KEY,
      model: MODEL,
      text: said,
      agentName,
      engaged: Boolean(engaged),
      shared: Boolean(shared),
      snapshot,
    });
    // A detached lookup: park the promise, hand back its id, and answer
    // now. `resume` itself must not cross the wire.
    const { resume, ...rest } = turn;
    if (resume) return res.json({ ...rest, pendingId: park(resume) });
    return res.json(rest);
  } catch (err) {
    if (err instanceof TurnError) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});
