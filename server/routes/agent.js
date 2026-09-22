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

export const agentRouter = Router();

const API_KEY = process.env.ASSEMBLYAI_API_KEY || "";
const MODEL = process.env.AAI_AGENT_MODEL || "gpt-4.1";
const MAX_TEXT_CHARS = 500;

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
