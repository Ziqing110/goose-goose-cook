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
  const deleteNode = (nodeId, { confirm = true } = {}) => {
    if (confirm && !window.confirm("Remove this step? Any step depending on it will lose that dependency.")) return;
    const shared = findSharedStep(nodeId);
    if (shared) {
      deleteSharedStepFromSession(shared.id);
    } else {
      const recipe = findRecipeForNode(nodeId);
      if (!recipe) return;
      updateRecipeWorking(recipe.id, (w) => {
        w.nodes = w.nodes
          .filter((n) => n.id !== nodeId)
          .map((n) => ({ ...n, depends_on: (n.depends_on || []).filter((d) => d !== nodeId) }));
      });
    }
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

  return { addNode, deleteNode, saveNode, registerMaterial, findRecipeForNode, findSharedStep, updateRecipeWorking };
}
