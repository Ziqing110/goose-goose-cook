// Pure derivations Home needs to render a run (session) as a "level
// card": title, difficulty flames, HUD stats, phase split, stage path,
// and run-log timings. Everything here is computed from data the
// backend already returns (see AppStateContext.jsx) — no new fields.
import { ELICITATION_QUESTIONS } from "../data/dishes.js";

export const CONVERSATION_QUESTION_COUNT = ELICITATION_QUESTIONS.length;

const DIFFICULTY_FLAMES = { low: 1, medium: 2, high: 3 };

/** Every step node in a session: per-recipe working nodes plus shared steps. */
export function allWorkingNodes(session) {
  if (!session) return [];
  const recipeNodes = (session.recipes || []).flatMap((r) => r.working?.nodes || []);
  const sharedNodes = (session.sharedSteps || []).map((s) => s.working).filter(Boolean);
  return [...recipeNodes, ...sharedNodes];
}

export function runTitle(session) {
  if (!session) return "Untitled run";
  const fromRecipes = (session.recipes || [])
    .map((r) => r.working?.title)
    .filter(Boolean)
    .join(" + ");
  return fromRecipes || session.conversation?.answers?.dishIdea || "Untitled run";
}

/** 0 when no steps exist yet, else 1–3 from the hardest step. */
export function runFlames(session) {
  return allWorkingNodes(session).reduce((max, n) => Math.max(max, DIFFICULTY_FLAMES[n.difficulty] || 0), 0);
}

export function runPlayers(session) {
  const cooks = Number(session?.conversation?.answers?.cooks);
  return Number.isFinite(cooks) && cooks > 0 ? cooks : null;
}

export function runServings(session) {
  const fromRecipe = session?.recipes?.[0]?.working?.servings;
  if (fromRecipe != null) return fromRecipe;
  const fromAnswer = Number(session?.conversation?.answers?.servings);
  return Number.isFinite(fromAnswer) && fromAnswer > 0 ? fromAnswer : null;
}

export function runTotalSeconds(session) {
  return allWorkingNodes(session).reduce((sum, n) => sum + (Number(n.estimated_duration_sec) || 0), 0);
}

export function runPhaseCounts(session) {
  const counts = { prep: 0, cook: 0, plate: 0 };
  allWorkingNodes(session).forEach((n) => {
    if (n.phase in counts) counts[n.phase] += 1;
  });
  return counts;
}

/**
 * The three stages of a run. Returns [{ id, label, state, count }] where
 * state is "done" | "current" | "future" and count is the mono progress
 * string shown under the current stage ("2 of 5").
 */
export function runStages(session) {
  const hasKitchen = Boolean(session?.kitchenProfileId);
  const conversation = session?.conversation || { complete: false, questionIndex: 0 };
  const recipes = session?.recipes || [];
  const mainLineDone = recipes.length > 0 && recipes.every((r) => r.approved);

  const kitchen = hasKitchen ? "done" : "current";
  let conversationState = "future";
  let mainLine = "future";
  if (hasKitchen) {
    conversationState = conversation.complete ? "done" : "current";
    if (conversation.complete) mainLine = mainLineDone ? "done" : "current";
  }

  const answered = Math.min(conversation.questionIndex || 0, CONVERSATION_QUESTION_COUNT);
  const approvedCount = recipes.filter((r) => r.approved).length;

  return [
    { id: "kitchen", label: "Kitchen", state: kitchen, count: null },
    {
      id: "conversation",
      label: "Conversation",
      state: conversationState,
      count: conversationState === "current" ? `${answered} of ${CONVERSATION_QUESTION_COUNT}` : null,
    },
    {
      id: "mainLine",
      label: "Main line",
      state: mainLine,
      count: mainLine === "current" && recipes.length > 0 ? `${approvedCount} of ${recipes.length}` : null,
    },
  ];
}

/** "42:00" — always mm:ss, minutes unpadded past 99. */
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** "started 2h ago" — coarse relative time from an ISO string. */
export function relativeTime(iso, now = Date.now()) {
  const diffSec = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "just now";
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

/** "Sep 14" */
export function formatShortDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * History arrives in two shapes: full session objects from the server
 * (GET /api/sessions?status=completed,abandoned) and the compact summary
 * the reducer appends locally when a run ends. Normalise both to one
 * row shape for the run log.
 */
export function summarizeRun(item, kitchenProfiles) {
  const isFull = Array.isArray(item.recipes);
  const profile = kitchenProfiles.find((p) => p.id === item.kitchenProfileId) || null;
  const startedAt = item.startedAt;
  const endedAt = item.endedAt;
  const durationSec =
    startedAt && endedAt ? Math.max(0, (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000) : null;
  return {
    id: item.id,
    title: isFull ? runTitle(item) : item.dish || "Untitled run",
    servings: isFull ? runServings(item) : item.servings ?? null,
    kitchenName: profile?.name || item.kitchenProfileName || null,
    startedAt,
    endedAt,
    durationSec,
    status: item.status,
  };
}

/** Header record line: "3 runs · 2 done · best 38:20" (best only when a completed run exists). */
export function runLogRecord(rows) {
  const done = rows.filter((r) => r.status === "completed");
  const best = done.filter((r) => r.durationSec != null).reduce((b, r) => (b == null || r.durationSec < b ? r.durationSec : b), null);
  const parts = [`${rows.length} ${rows.length === 1 ? "run" : "runs"}`, `${done.length} done`];
  if (best != null) parts.push(`best ${formatClock(best)}`);
  return { line: parts.join(" · "), bestSec: best };
}
