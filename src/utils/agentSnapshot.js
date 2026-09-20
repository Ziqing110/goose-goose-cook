// The compact picture of the kitchen the agent's model is shown each
// turn. Pure: the run lives in the browser, so the page builds this and
// posts it with the utterance (see server/routes/agent.js).
//
// Only steps someone could still act on go in. Finished and skipped steps
// are noise to the model and tokens on every turn.
import { readyStepIds } from "./liveCook.js";

const MAX_STEPS = 40;
const MAX_HISTORY = 6;
// Enough for the one- or two-clause instruction these carry ("Fine-mince
// ginger; separate scallion whites from greens."), short enough that
// forty of them don't crowd out the rest of the turn.
const MAX_DESC = 120;

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
      // What the recipe actually says to do. The page has shown this on
      // the step card all along; the model could not see it, so a cook
      // asking "how fine should the ginger be" got a refusal while the
      // answer sat on screen.
      ...(node.description ? { how: String(node.description).slice(0, MAX_DESC) } : null),
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
