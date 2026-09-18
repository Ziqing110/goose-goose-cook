// Editing a step, independent of what's rendering it. Lifted out of
// RecipeGraphPage so the board on the Inventory page can offer the same
// operations without a second copy of the rules — the awkward parts
// (shared steps belong to the session, not a dish; a shared step's
// dependents live in other dishes) are easy to get subtly wrong twice.
import { useAppState } from "./AppStateContext.jsx";
import { cloneGraph } from "../utils/graphLayout.js";
import { nextNodeId, slugifyMaterialId } from "../data/dishes.js";

// The merged view tags every node with the recipe instance it came from
// (or _shared for a session-owned shared step) for rendering; strip
// those back off before persisting a node.
export function stripRecipeTag(node) {
  const clean = { ...node };
  delete clean._recipeId;
  delete clean._shared;
  return clean;
}

export function useStepEditing() {
  const { state, dispatch, deleteSharedStepFromSession } = useAppState();
  const { recipes, sharedSteps = [] } = state.session;

  const findRecipeForNode = (nodeId) => recipes.find((r) => r.working.nodes.some((n) => n.id === nodeId));
  const findSharedStep = (nodeId) => sharedSteps.find((s) => s.working.id === nodeId);

  const updateRecipeWorking = (recipeId, mutateFn) => {
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) return;
    const nextWorking = cloneGraph(recipe.working);
    mutateFn(nextWorking);
    dispatch({ type: "session/recipes/updateOne", payload: { recipeId, patch: { working: nextWorking } } });
  };

  /**
   * A new step belongs to exactly one dish, so the target is explicit.
   * So is the duration: the scheduler treats estimated_duration_sec as
   * fact, so a step that quietly defaulted to a minute would shorten
   * the plan by however long the task really takes.
   */
  const addNode = (
    recipeId,
    { phase = "prep", dependsOn = [], label = "New step", durationSec, difficulty = "low", equipment = [] } = {}
  ) => {
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) return null;
    const id = nextNodeId("step");
    updateRecipeWorking(recipe.id, (w) => {
      w.nodes.push({
        id,
        label,
        description: "",
        estimated_duration_sec: Math.max(15, Math.round(durationSec ?? 120)),
        difficulty,
        required_equipment: equipment,
        required_materials: [],
        depends_on: dependsOn,
        status: "pending",
        phase,
      });
    });
    return id;
  };

  // Deleting a shared step has to scrub depends_on across every recipe
  // instance and every other shared step, since it can be a dependency
  // across dish boundaries — deleteSharedStepFromSession owns that full
  // scrub, locally and server-side. A plain per-recipe node only ever
  // needs scrubbing within its own recipe.
  /**
   * Removes a step. `reattach` maps each dependent to what it should
   * wait on instead — without it, dependents silently lose the link and
   * become startable immediately, which shortens the plan for a reason
   * nobody chose.
   *
   * The reattach and the removal are applied in ONE pass per recipe.
   * Two updateRecipeWorking calls in the same tick both read `recipes`
   * from the render closure, so the second silently overwrote the
   * first — the dependents' new links were lost the moment the step
   * itself went.
   */
  const deleteNode = (nodeId, { confirm = true, reattach = null } = {}) => {
    if (confirm && !window.confirm("Remove this step? Any step depending on it will lose that dependency.")) return;

    // A step can't be made to wait on itself or on the step being cut.
    const depsFor = (id, current) => {
      const next = reattach?.[id] ?? current;
      return [...new Set(next.filter((d) => d !== nodeId && d !== id))];
    };

    const shared = findSharedStep(nodeId);

    // Shared steps are session-owned; their delete scrubs depends_on
    // everywhere through the reducer, so reattaching one is a separate
    // dispatch target and can't clobber.
    sharedSteps.forEach((step) => {
      if (step.working.id === nodeId || !reattach?.[step.working.id]) return;
      dispatch({
        type: "session/sharedSteps/updateOne",
        payload: {
          sharedStepId: step.id,
          patch: { working: { ...step.working, depends_on: depsFor(step.working.id, step.working.depends_on || []) } },
        },
      });
    });

    recipes.forEach((recipe) => {
      const touched =
        recipe.working.nodes.some((n) => n.id === nodeId) ||
        recipe.working.nodes.some((n) => reattach?.[n.id] || (n.depends_on || []).includes(nodeId));
      if (!touched) return;
      updateRecipeWorking(recipe.id, (w) => {
        w.nodes = w.nodes
          .filter((n) => n.id !== nodeId)
          .map((n) => ({ ...n, depends_on: depsFor(n.id, n.depends_on || []) }));
      });
    });

    if (shared) deleteSharedStepFromSession(shared.id);
  };

  /** Removes several steps from the same state snapshot. */
  const deleteNodes = (nodeIds) => {
    const ids = new Set(nodeIds);
    if (!ids.size) return;

    recipes.forEach((recipe) => {
      const touched = recipe.working.nodes.some(
        (node) => ids.has(node.id) || (node.depends_on || []).some((dependencyId) => ids.has(dependencyId))
      );
      if (!touched) return;
      updateRecipeWorking(recipe.id, (working) => {
        working.nodes = working.nodes
          .filter((node) => !ids.has(node.id))
          .map((node) => ({
            ...node,
            depends_on: (node.depends_on || []).filter((dependencyId) => !ids.has(dependencyId)),
          }));
      });
    });

    sharedSteps
      .filter((step) => ids.has(step.working.id))
      .forEach((step) => deleteSharedStepFromSession(step.id));
  };

  /** Commits a step's staged edits (from the drawer) in one go and closes it. */
  const saveNode = (nodeId, draftNode) => {
    const shared = findSharedStep(nodeId);
    if (shared) {
      dispatch({
        type: "session/sharedSteps/updateOne",
        payload: { sharedStepId: shared.id, patch: { working: stripRecipeTag(draftNode) } },
      });
      return;
    }
    const recipe = findRecipeForNode(nodeId);
    if (!recipe) return;
    updateRecipeWorking(recipe.id, (w) => {
      const index = w.nodes.findIndex((n) => n.id === nodeId);
      if (index !== -1) w.nodes[index] = stripRecipeTag(draftNode);
    });
  };

  // Registers a material that doesn't exist yet so it's available to
  // every step, not just the one being edited. It lands on the dish
  // whose step is open, so it travels with that dish; a shared step
  // belongs to no single dish, so it falls back to the first recipe.
  const registerMaterial = (draft, materialsInfo, forNodeId) => {
    const label = draft.label.trim();
    if (!label) return null;
    const id = slugifyMaterialId(label);
    if (!materialsInfo[id]) {
      const recipe = (forNodeId && findRecipeForNode(forNodeId)) || recipes[0];
      if (!recipe) return null;
      const nextCustom = {
        ...(recipe.custom_materials || {}),
        [id]: {
          label,
          category: draft.category || "other",
          amount: Number(draft.amount) || 1,
          unit: draft.unit.trim() || "unit",
        },
      };
      dispatch({ type: "session/recipes/updateOne", payload: { recipeId: recipe.id, patch: { custom_materials: nextCustom } } });
    }
    return id;
  };

  return { addNode, deleteNode, deleteNodes, saveNode, registerMaterial, findRecipeForNode, findSharedStep, updateRecipeWorking };
}
