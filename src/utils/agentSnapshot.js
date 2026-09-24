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
// The brief is four short values; anything longer is somebody pasting
// an essay into the free-text box.
const MAX_BRIEF = 80;

/**
 * @param {object} args
 *   run, nodes   the live run and the approved graph nodes
 *   cooks        [{ id, name }]
 *   speakerId    who is talking
 *   paused       boolean
 */
// What the cook told us before any of this was planned.
//
// These answers built the recipe and were then dropped, so the agent
// mid-cook did not know the run was vegetarian and would cheerfully
// suggest fish sauce -- the constraint was on file and unread. Four
// short strings, so it costs a few dozen tokens a turn.
//
// `skill` is the one that changes how the agent TALKS rather than what
// it knows: the conversation asked how much to explain, and until now
// nothing downstream used the answer.
function briefFrom(conversation) {
  const answers = conversation?.answers || {};
  const take = (key) => {
    const value = answers[key];
    if (value == null) return null;
    const text = String(Array.isArray(value) ? value.join(", ") : value).trim();
    return text ? text.slice(0, MAX_BRIEF) : null;
  };
  const brief = {
    diet: take("diet"),
    servings: take("servings"),
    skill: take("skill"),
    targetTime: take("targetTime"),
  };
  // Every key absent means an unanswered conversation. Send nothing
  // rather than a shape full of nulls for the model to read past.
  return Object.values(brief).some(Boolean)
    ? Object.fromEntries(Object.entries(brief).filter(([, v]) => v))
    : null;
}

export function buildAgentSnapshot({ run, nodes, cooks, speakerId, paused = false, conversation = null }) {
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

  const brief = briefFrom(conversation);

  return {
    mode: run.mode === "competition" ? "versus" : "coop",
    ...(brief ? { brief } : null),
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
