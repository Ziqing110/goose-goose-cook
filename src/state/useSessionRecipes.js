// Shared by every page that reads the run's recipes (Inventory, the
// main line): loads the reference data (recipe templates + materials
// catalog) and, once templates are in, instantiates the session's
// recipes if it doesn't have any yet. Lives here rather than in
// RecipeGraphPage so whichever page the cook reaches first does the
// instantiation and the others just find it done.
import { useEffect, useState } from "react";
import { useAppState } from "./AppStateContext.jsx";
import { listRecipeTemplates, listMaterials } from "../api/recipeTemplates.js";
import { cloneGraph, namespaceTemplateNodes, extractSharedSteps } from "../utils/graphLayout.js";

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

export function toRecipeInstance({ recipeId, templateId, nodes, ...rest }) {
  const graph = { recipe_id: `recipe_${recipeId}`, ...rest, nodes };
  return { id: recipeId, templateId, draft: graph, working: cloneGraph(graph), approved: null, custom_materials: {} };
}

export function toSharedStepInstance(node) {
  return { id: node.id, draft: node, working: cloneGraph(node), approved: null };
}

/**
 * Returns the materials catalog keyed by id ({ label, category, amount,
 * unit }) plus its load status, and makes sure the session has recipes.
 * `catalog` is null while loading; `catalogError` is set (and `catalog`
 * stays null) when GET /api/materials fails — call `retryCatalog` to
 * try again.
 */
export function useSessionRecipes() {
  const { state, addRecipeToSession, addSharedStepToSession } = useAppState();
  const { conversation, recipes } = state.session;
  const [templates, setTemplates] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState(null);
  const [catalogAttempt, setCatalogAttempt] = useState(0);

  useEffect(() => {
    listRecipeTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCatalogError(null);
    listMaterials()
      .then((rows) => {
        if (cancelled) return;
        const next = {};
        rows.forEach((m) => {
          next[m.id] = { label: m.label, category: m.category, amount: m.amount, unit: m.unit };
        });
        setCatalog(next);
      })
      .catch((err) => {
        if (!cancelled) setCatalogError(err.message || "Failed to fetch");
      });
    return () => {
      cancelled = true;
    };
  }, [catalogAttempt]);

  // Once templates have loaded, instantiate one recipe per distinct dish
  // for this session if it doesn't have any recipes yet. Shareable steps
  // (e.g. mincing garlic for both dishes) are detected once across the
  // whole batch and split out into session-owned shared steps before
  // any of it is persisted.
  useEffect(() => {
    if (!templates || recipes.length > 0) return;
    const graphs = matchTemplates(templates, conversation.answers).map((template) =>
      buildNamespacedGraph(template, conversation.answers, crypto.randomUUID())
    );
    const { recipes: splitGraphs, sharedSteps: extracted } = extractSharedSteps(graphs);
    splitGraphs.forEach((g) => addRecipeToSession(toRecipeInstance(g)));
    extracted.forEach((node) => addSharedStepToSession(toSharedStepInstance(node)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, recipes.length]);

  return {
    templates,
    catalog,
    catalogError,
    retryCatalog: () => setCatalogAttempt((n) => n + 1),
  };
}
