// Shared by every page that reads the run's recipes (Inventory, the
// main line): loads the reference data (recipe templates + materials
// catalog) and, once templates are in, instantiates the session's
// recipes if it doesn't have any yet. Lives here rather than in
// the pages so whichever one the cook reaches first does the
// instantiation and the others just find it done.
import { useEffect, useRef, useState } from "react";
import { useAppState } from "./AppStateContext.jsx";
import { listRecipeTemplates, listMaterials } from "../api/recipeTemplates.js";
import { generateRecipes } from "../api/recipes.js";
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
  // Generation state, surfaced so Inventory can show a spinner instead of
  // an empty board for the half-minute this takes.
  const [generating, setGenerating] = useState(false);
  const [generatedBy, setGeneratedBy] = useState(null);
  const [missingDishes, setMissingDishes] = useState([]);
  // A ref, not state: the effect must not fire twice while the first
  // request is still out, and StrictMode runs it twice on mount.
  const generatingRef = useRef(false);

  const kitchenProfile =
    state.kitchenProfiles.find((p) => p.id === state.session.kitchenProfileId) || null;
  const cooks = Number(state.session.conversation?.answers?.cooks) || 2;

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
    if (!templates || recipes.length > 0 || generatingRef.current) return;
    generatingRef.current = true;

    // The dishes the cook actually asked for, generated for their actual
    // kitchen — the thing matchTemplates has been describing as "later"
    // since it was written. The seeded templates stay as the fallback,
    // and only as the fallback: they are two fixed demo dishes, so a run
    // that lands on them is showing somebody else's dinner.
    const instantiate = (graphs) => {
      const { recipes: splitGraphs, sharedSteps: extracted } = extractSharedSteps(graphs);
      splitGraphs.forEach((g) => addRecipeToSession(toRecipeInstance(g)));
      extracted.forEach((node) => addSharedStepToSession(toSharedStepInstance(node)));
    };

    const fromTemplates = () =>
      matchTemplates(templates, conversation.answers).map((template) =>
        buildNamespacedGraph(template, conversation.answers, crypto.randomUUID()),
      );

    const asked = conversation.answers?.dishIdea;
    const hasDishes = Array.isArray(asked) ? asked.length > 0 : Boolean(asked);
    if (!hasDishes) {
      instantiate(fromTemplates());
      setGenerating(false);
      return;
    }

    setGenerating(true);
    generateRecipes(conversation.answers, kitchenProfile, cooks)
      .then((result) => {
        setGeneratedBy(result.generatedBy || null);
        setMissingDishes(result.missingDishes || []);

        // Every generated dish carries the whole materials list. It is a
        // handful of entries and the alternative — working out which
        // dish uses which — would drop an ingredient the moment a step
        // got edited to use something another dish declared.
        const customMaterials = Object.fromEntries(
          (result.materials || []).map((m) => [
            m.id,
            { label: m.label, category: m.category, amount: m.amount, unit: m.unit },
          ]),
        );
        instantiate(
          result.templates.map((t) => ({
            ...buildNamespacedGraph(t, conversation.answers, crypto.randomUUID()),
            customMaterials,
          })),
        );
      })
      .catch((err) => {
        // Loud in the log, quiet on screen: the cook still gets a usable
        // board, just not the one they asked for. The page reads
        // `generatedBy` to say so.
        console.error("Recipe generation failed, using seeded templates:", err.message);
        setGeneratedBy(null);
        instantiate(fromTemplates());
      })
      .finally(() => setGenerating(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, recipes.length]);

  return {
    templates,
    catalog,
    catalogError,
    retryCatalog: () => setCatalogAttempt((n) => n + 1),
    generating,
    // null when the seeded templates were used, so a page can tell the
    // cook this is a demo board rather than their dinner.
    generatedBy,
    missingDishes,
  };
}
