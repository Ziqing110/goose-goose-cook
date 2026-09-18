// Turning a recipe template — seeded or generated — into the session-
// owned instances the board reads.
//
// Pure, and in utils for the reason the project states: no DOM and no
// React, so it can be tested without a renderer. It lived in
// useSessionRecipes.js until a test tried to import it and dragged a
// .jsx context in behind it.
import { cloneGraph, namespaceTemplateNodes } from "./graphLayout.js";

// Demo wiring: every distinct dish in the templates table (grouped by
// dish_idea_raw) gets instantiated into the session together — today
// that's Mapo Tofu + Chicken Noodle Soup — so the multi-recipe-per-
// session data model actually gets exercised instead of sitting unused.
// Within each dish, the requested diet's variant is picked (falling
// back to whatever variant that dish has). This is the documented seam
// for a real LLM tool call later — same role generateRecipeGraph() used
// to play, just choosing among DB-sourced templates instead of
// hand-authoring the graph(s) inline, and eventually picking dishes
// from what the user actually asked for instead of "all of them."
export function matchTemplates(templates, answers) {
  const isMeatFree = answers.diet === "vegetarian" || answers.diet === "vegan";
  const wantDiet = isMeatFree ? "vegetarian" : "none";
  const byDish = new Map();
  templates.forEach((t) => {
    if (!byDish.has(t.dish_idea_raw)) byDish.set(t.dish_idea_raw, []);
    byDish.get(t.dish_idea_raw).push(t);
  });
  return [...byDish.values()].map((variants) => variants.find((t) => t.diet === wantDiet) || variants[0]);
}

// Namespaces one template's nodes under a fresh recipe instance id.
// Sharing detection (extractSharedSteps) runs afterward, once, across
// the whole batch of dishes being instantiated together — namespacing
// itself doesn't know or care whether a node will end up shared.
export function buildNamespacedGraph(template, answers, recipeId) {
  return {
    recipeId,
    templateId: template.id,
    title: template.title,
    dish_idea_raw: template.dish_idea_raw,
    servings: Number(answers.servings) || template.servings_default,
    created_at: new Date().toISOString(),
    nodes: namespaceTemplateNodes(template.nodes, recipeId),
  };
}

export function toRecipeInstance({ recipeId, templateId, nodes, customMaterials, ...rest }) {
  const graph = {
    recipe_id: `recipe_${recipeId}`,
    ...rest,
    nodes,
    // Generated dishes invent their own ingredients, and none of them are
    // in the seeded materials table. Inventory resolves a material as
    // {...catalog, ...working.custom_materials}, so without this every
    // generated ingredient renders as a blank row with no label, no
    // amount and no category. Node ids get namespaced per recipe;
    // material ids deliberately do not, so these keys still match.
    custom_materials: customMaterials || {},
  };
  return {
    id: recipeId,
    templateId,
    draft: graph,
    working: cloneGraph(graph),
    approved: null,
    custom_materials: customMaterials || {},
  };
}


export function toSharedStepInstance(node) {
  return { id: node.id, draft: node, working: cloneGraph(node), approved: null };
}
