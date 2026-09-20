// The live-cook agent's brain: one turn in, vetted tool calls and a spoken
// reply out.
//
// POST /api/agent/turn
//   { text, agentName, engaged, snapshot }
//   -> { addressed, calls: [{name, stepId}], reply, rejected, ms, model }
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

export const agentRouter = Router();

const API_KEY = process.env.ASSEMBLYAI_API_KEY || "";
const MODEL = process.env.AAI_AGENT_MODEL || "gpt-4.1";
const MAX_TEXT_CHARS = 500;

agentRouter.post("/turn", async (req, res) => {
  const { text, agentName, engaged, snapshot } = req.body || {};
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
      snapshot,
    });
    return res.json(turn);
  } catch (err) {
    if (err instanceof TurnError) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});
