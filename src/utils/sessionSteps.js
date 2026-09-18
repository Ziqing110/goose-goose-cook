// The one ordered list of session stages, shared by the in-session
// progress chrome (SessionProgress), Home's run card (runStats) and the
// "resume where you left off" redirect (App). Each stage knows how to
// tell whether the session has finished it, so every surface agrees on
// which stage is current.
import { isFullyApproved } from "./graphLayout.js";
import { areCooksBound } from "./cooks.js";
import { ELICITATION_QUESTIONS } from "../data/dishes.js";

export const CONVERSATION_QUESTION_COUNT = ELICITATION_QUESTIONS.length;

export const SESSION_STEPS = [
  { key: "kitchen-setup", label: "Kitchen", path: "/session/kitchen-setup", isDone: (s) => Boolean(s.kitchenProfileId) },
  { key: "conversation", label: "Conversation", path: "/session/conversation", isDone: (s) => Boolean(s.conversation?.complete) },
  // Inventory and the recipe graph are one page: the ingredients and
  // the step board live together, and you leave by approving. Labelled
  // with the agent's own word for it ("I'll draft your recipe graph"). Approval is
  // the completion signal — strictly stronger than the "did they look
  // at it" flag this stage used when they were two pages.
  {
    key: "inventory",
    label: "Recipe graph",
    path: "/session/inventory",
    isDone: (s) => (s.recipes || []).length > 0 && isFullyApproved(s.recipes, s.sharedSteps || []),
  },
  { key: "voice-binding", label: "Cooks", path: "/session/voice-binding", isDone: (s) => areCooksBound(s.cooks || []) },
  // Picking a mode isn't leaving the schedule — only "Go live" is, which
  // is when the run gets created.
  { key: "schedule", label: "Schedule", path: "/session/schedule", isDone: (s) => Boolean(s.run) },
  { key: "live-cook", label: "Live cook", path: "/session/live-cook", isDone: (s) => Boolean(s.run?.endedAt) },
];

/** Mono progress string under the current stage ("2 of 5"), or null. */
function stageCount(step, session) {
  if (step.key === "conversation") {
    const answered = Math.min(session.conversation?.questionIndex || 0, CONVERSATION_QUESTION_COUNT);
    return `${answered} of ${CONVERSATION_QUESTION_COUNT}`;
  }
  if (step.key === "inventory" && (session.recipes || []).length > 0) {
    const approved = session.recipes.filter((r) => r.approved).length;
    return `${approved} of ${session.recipes.length}`;
  }
  return null;
}

/**
 * [{ key, label, path, state, count }] with state "done" | "current" |
 * "future". A stage counts as done once it — or anything after it — is
 * done, so a stage that was skipped (deep link, an older session from
 * before it existed) never shows as unfinished behind a finished one.
 */
export function sessionStageStates(session) {
  if (!session) return SESSION_STEPS.map((s) => ({ ...s, state: "future", count: null }));
  const doneFlags = SESSION_STEPS.map((s) => s.isDone(session));
  const lastDone = doneFlags.lastIndexOf(true);
  const currentIndex = Math.min(lastDone + 1, SESSION_STEPS.length - 1);
  return SESSION_STEPS.map((step, i) => {
    const state = i <= lastDone ? "done" : i === currentIndex ? "current" : "future";
    return { key: step.key, label: step.label, path: step.path, state, count: state === "current" ? stageCount(step, session) : null };
  });
}

/** Where "resume the run" lands: the current stage's route. */
export function currentSessionPath(session) {
  return sessionStageStates(session).find((s) => s.state === "current")?.path || SESSION_STEPS[SESSION_STEPS.length - 1].path;
}
