// Seeds a session through the API so a page can be opened without clicking
// through the flow to reach it: conversation complete, recipes approved, two
// cooks bound. Shared by the e2e (scripts/livecook-e2e.mjs), by `npm run
// seed`, which leaves the session in place for looking around, and by the
// dev-only /jump/* routes (src/dev/DevJump.jsx), which run it in the
// browser — so it uses only what Node and browsers both have (global
// `fetch` and `crypto.randomUUID`), no `node:` imports.
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
import { matchTemplates, buildNamespacedGraph, toRecipeInstance, toSharedStepInstance } from "../src/utils/recipeInstances.js";
import { extractSharedSteps, cloneGraph } from "../src/utils/graphLayout.js";
import { CHEF_AVATARS } from "../src/utils/cooks.js";

const TEST_COOK_NAMES = ["Mia", "Leo", "Avery", "Kai", "Nora", "Sam", "Toni", "Zoe"];

function randomDistinct(items, count) {
  return [...items].sort(() => Math.random() - 0.5).slice(0, count);
}

function withUnattendedStep(graph) {
  const preferred = graph.nodes.find((node) => node.label === "Blanch tofu") ||
    graph.nodes.find((node) => /\b(heat|preheat|simmer|bake|roast)\b/i.test(node.label)) ||
    graph.nodes.find((node) => node.required_equipment?.includes("pot"));
  if (!preferred) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((node) => node.id === preferred.id
      ? {
          ...node,
          tending: "timed",
          attended: false,
          unattended: {
            initial: { duration_sec: 10, difficulty: "low" },
            checkpoints: null,
            ending: { duration_sec: 20, difficulty: "low" },
          },
        }
      : node),
  };
}

export async function seedSession(base, {
  randomizeCooks = false,
  ensureUnattended = false,
  dishes = [],
  cookNames = null,
  avatarIds = null,
} = {}) {
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

  const sessionId = crypto.randomUUID();
  await api("POST", "/sessions", { id: sessionId, kitchenProfileId: kitchen.id });

  const requestedDishes = dishes.map((dish) => dish.trim()).filter(Boolean);
  const answers = {
    servings: "2",
    diet: "none",
    cooks: "2",
    skill: "regular",
    targetTime: "90",
    ...(requestedDishes.length ? { dishIdea: requestedDishes } : {}),
  };
  let graphs;
  if (requestedDishes.length) {
    const generated = await api("POST", "/recipes/generate", {
      dishes: requestedDishes,
      servings: 2,
      diet: "none",
      skill: "regular",
      targetTime: 90,
      cooks: 2,
      kitchen: {
        burners: kitchen.burners,
        hasWok: kitchen.hasWok,
        hasOven: kitchen.hasOven,
        pots: kitchen.pots,
        cuttingBoards: kitchen.cuttingBoards,
      },
    });
    if (generated.missingDishes?.length || generated.templates.length !== requestedDishes.length) {
      throw new Error(`could not seed every requested dish: ${generated.missingDishes?.join(", ") || `${generated.templates.length}/${requestedDishes.length} returned`}`);
    }
    const customMaterials = Object.fromEntries((generated.materials || []).map((material) => [
      material.id,
      { label: material.label, category: material.category, amount: material.amount, unit: material.unit },
    ]));
    graphs = generated.templates.map((template) => ({
      ...buildNamespacedGraph(template, answers, crypto.randomUUID()),
      customMaterials,
    }));
  } else {
    // No dishIdea: that is what sends the page down the template fallback.
    const templates = await api("GET", "/recipe-templates");
    graphs = matchTemplates(templates, answers).map((t) => buildNamespacedGraph(t, answers, crypto.randomUUID()));
    if (!graphs.some((g) => /mapo/i.test(g.title))) {
      throw new Error(`the seeded templates should include Mapo Tofu, got: ${graphs.map((g) => g.title).join(", ") || "none"}`);
    }
  }
  if (ensureUnattended) {
    graphs = graphs.map((graph, index) => index === 0 ? withUnattendedStep(graph) : graph);
    if (!graphs.some((graph) => graph.nodes.some((node) => node.unattended))) {
      throw new Error("the dev session needs at least one unattended task, but no suitable step was found");
    }
  }
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

  const names = cookNames || (randomizeCooks ? randomDistinct(TEST_COOK_NAMES, 2) : ["Mia", "Leo"]);
  const avatars = avatarIds || (randomizeCooks ? randomDistinct(CHEF_AVATARS, 2).map((avatar) => avatar.id) : ["spoon", "whisk"]);
  await api("PATCH", `/sessions/${sessionId}`, {
    conversation: { complete: true, transcript: [], answers, understanding: {}, questionIndex: 5 },
    cooks: [
      { id: crypto.randomUUID(), name: names[0], bound: true, avatar: avatars[0] },
      { id: crypto.randomUUID(), name: names[1], bound: true, avatar: avatars[1] },
    ],
  });

  return { sessionId, remove: () => api("DELETE", `/sessions/${sessionId}`) };
}
