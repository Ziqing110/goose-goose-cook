// Thin client around recipe generation (server/routes/recipes.js).
//
// Unlike the answer reader, this one is allowed to fail loudly. A failed
// answer read degrades to a regex and the conversation carries on; a
// failed generation has no equivalent — the caller decides whether to
// fall back to the seeded demo templates, and it needs to know.
import { apiRequest } from "./client.js";

// Generation is a big model call behind a loading state, so the budget is
// generous. Measured 29s for three dishes on the primary and about 10s on
// the per-dish fallback; the server's own ceiling is 120s.
const GENERATE_TIMEOUT_MS = 150_000;

/**
 * Turn the conversation's answers into recipe graphs.
 *
 * @param {object} conversationAnswers  session.conversation.answers
 * @param {object} kitchen              the active kitchen profile
 * @param {number} cooks
 * @returns {Promise<{templates, materials, generatedBy, sharedStepsPossible, missingDishes?}>}
 */
export function generateRecipes(conversationAnswers, kitchen, cooks = 2) {
  const { dishIdea, servings, diet, skill, targetTime } = conversationAnswers || {};

  // dishIdea is a list now, but sessions from before that change stored a
  // string, and they still have to generate rather than crash.
  const dishes = Array.isArray(dishIdea) ? dishIdea : [dishIdea].filter(Boolean);

  return apiRequest("/api/recipes", "/generate", {
    method: "POST",
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    body: JSON.stringify({
      dishes,
      servings: Number(servings) || 2,
      diet: diet || "none",
      skill: skill || "regular",
      targetTime: Number(targetTime) || 45,
      cooks,
      kitchen: {
        burners: kitchen?.burners,
        hasWok: kitchen?.hasWok,
        hasOven: kitchen?.hasOven,
        pots: kitchen?.pots,
        cuttingBoards: kitchen?.cuttingBoards,
      },
    }),
  });
}
