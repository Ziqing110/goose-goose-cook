// Seeds a session through the API so a page can be opened without clicking
// through the flow to reach it: conversation complete, recipes approved, two
// cooks bound. Shared by the e2e (scripts/livecook-e2e.mjs) and by
// `npm run seed`, which leaves the session in place for looking around.
//
// The recipes are the app's FALLBACK path, on purpose. With no dish named in
// the conversation the app instantiates its seeded templates (Mapo Tofu +
// Chicken Noodle Soup, with the shared garlic) with no model call, so the
// result is the same every time and needs no API key. It uses the app's own
// helpers, so it cannot drift from what the page would build.
//
// Note: starting a session closes out any other active one. That is the
// API's invariant, not this script's choice, so a run you had going is
// abandoned.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { matchTemplates, buildNamespacedGraph, toRecipeInstance, toSharedStepInstance } from "../src/utils/recipeInstances.js";
import { extractSharedSteps, cloneGraph } from "../src/utils/graphLayout.js";

export async function seedSession(base) {
  const api = async (method, path, body) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };

  const kitchens = await api("GET", "/kitchens");
  const kitchen =
    kitchens[0] ??
    (await api("POST", "/kitchens", { name: "E2E Kitchen", burners: 4, hasWok: true, hasOven: true, cuttingBoards: 2, pots: 2 }));

  const sessionId = randomUUID();
  await api("POST", "/sessions", { id: sessionId, kitchenProfileId: kitchen.id });

  // No dishIdea: that is what sends the page down the template fallback.
  const answers = { servings: "2", diet: "none", cooks: "2", skill: "regular", targetTime: "90" };
  const templates = await api("GET", "/recipe-templates");
  const graphs = matchTemplates(templates, answers).map((t) => buildNamespacedGraph(t, answers, randomUUID()));
  assert.ok(
    graphs.some((g) => /mapo/i.test(g.title)),
    `the seeded templates should include Mapo Tofu, got: ${graphs.map((g) => g.title).join(", ") || "none"}`,
  );
  const { recipes: splitGraphs, sharedSteps } = extractSharedSteps(graphs);

  for (const graph of splitGraphs) {
    const recipe = toRecipeInstance(graph);
    await api("POST", `/sessions/${sessionId}/recipes`, {
      id: recipe.id,
      templateId: recipe.templateId,
      draft: recipe.draft,
      working: recipe.working,
      custom_materials: recipe.custom_materials,
    });
    // Approval is a snapshot of the working copy, as the Inventory page does it.
    await api("PATCH", `/sessions/${sessionId}/recipes/${recipe.id}`, { approved: cloneGraph(recipe.working) });
  }
  for (const node of sharedSteps) {
    const step = toSharedStepInstance(node);
    await api("POST", `/sessions/${sessionId}/shared-steps`, { id: step.id, draft: step.draft, working: step.working });
    await api("PATCH", `/sessions/${sessionId}/shared-steps/${step.id}`, { approved: cloneGraph(step.working) });
  }

  await api("PATCH", `/sessions/${sessionId}`, {
    conversation: { complete: true, transcript: [], answers, understanding: {}, questionIndex: 5 },
    cooks: [
      { id: randomUUID(), name: "Mia", bound: true, avatar: "spoon" },
      { id: randomUUID(), name: "Leo", bound: true, avatar: "whisk" },
    ],
  });

  return { sessionId, remove: () => api("DELETE", `/sessions/${sessionId}`) };
}
