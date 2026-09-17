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
import { extractSharedSteps } from "../utils/graphLayout.js";
import {
  matchTemplates,
  buildNamespacedGraph,
  toRecipeInstance,
  toSharedStepInstance,
} from "../utils/recipeInstances.js";

// Re-exported because they used to live here and this is where callers
// look for them.
export { matchTemplates, buildNamespacedGraph, toRecipeInstance, toSharedStepInstance };

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

        // Nothing on screen distinguishes a primary run from a fallback
        // one yet, and they differ enough to matter: the fallback shares
        // no prep and can drop a dish entirely. Until the page says so,
        // the console does — otherwise a degraded board is indis-
        // tinguishable from a good one while debugging.
        const fellBack = !result.sharedStepsPossible;
        console[fellBack ? "warn" : "info"](
          `[recipes] ${result.templates.length} dish(es) by ${result.generatedBy}` +
            `${fellBack ? " — FALLBACK: no shared prep" : ""}`,
        );
        if (result.missingDishes?.length) {
          console.warn(`[recipes] could not generate: ${result.missingDishes.join("; ")}`);
        }

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
