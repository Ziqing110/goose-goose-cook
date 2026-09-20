// The compact picture of the kitchen the agent's model is shown each
// turn. Pure: the run lives in the browser, so the page builds this and
// posts it with the utterance (see server/routes/agent.js).
//
// Only steps someone could still act on go in. Finished and skipped steps
// are noise to the model and tokens on every turn.
import { readyStepIds } from "./liveCook.js";

const MAX_STEPS = 40;
const MAX_HISTORY = 6;

/**
 * @param {object} args
 *   run, nodes   the live run and the approved graph nodes
 *   cooks        [{ id, name }]
 *   speakerId    who is talking
 *   paused       boolean
 */
export function buildAgentSnapshot({ run, nodes, cooks, speakerId, paused = false }) {
  const readySet = new Set(readyStepIds(nodes, run));
  const nameOf = (id) => cooks.find((c) => c.id === id)?.name ?? null;

  const steps = nodes
    .map((n) => ({ node: n, record: run.steps[n.id] }))
    .filter(({ record }) => record && (record.status === "pending" || record.status === "active"))
    .slice(0, MAX_STEPS)
    .map(({ node, record }) => ({
      id: node.id,
      label: node.label,
      status: record.status,
      // An active step is by definition past readiness; the model only
      // needs the flag for pending ones.
      ready: record.status === "active" || readySet.has(node.id),
      holder: nameOf(record.cookId),
    }));

  return {
    mode: run.mode === "competition" ? "versus" : "coop",
    paused,
    speakerName: nameOf(speakerId) ?? "Someone",
    cooks: cooks.map((c) => ({ name: c.name })),
    steps,
    history: (run.transcript || []).slice(-MAX_HISTORY).map((t) => ({
      speaker: t.speaker === "agent" ? "agent" : nameOf(t.speaker) ?? "someone",
      text: t.text,
    })),
  };
}
