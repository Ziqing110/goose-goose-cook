// Editing steps on the recipe graph, whichever component asks.
//
// A step lives either in one dish (a recipe instance's working graph) or,
// when two dishes share it, in the session's shared steps, and a
// dependency can cross between the two. Every edit here is dispatched as
// a function the reducer applies to the state it lands on, so several
// edits in one tick (a step and the steps that wait on it) all survive
// instead of each overwriting the last with a stale copy.
import { useAppState } from "./AppStateContext.jsx";
import { nextNodeId, slugifyMaterialId } from "../data/dishes.js";

// The merged view tags nodes with where they came from; those tags are
// for rendering and never persisted.
const untagged = ({ _recipeId, _shared, ...node }) => node;

const unique = (ids) => [...new Set(ids)];

export function useStepEditing() {
  const { state, dispatch, deleteSharedStepFromSession } = useAppState();
  const { recipes, sharedSteps = [] } = state.session;

  const findRecipeForNode = (nodeId) => recipes.find((r) => r.working.nodes.some((n) => n.id === nodeId));
  const findSharedStep = (nodeId) => sharedSteps.find((s) => s.working.id === nodeId);

  const editRecipe = (recipeId, edit) => dispatch({ type: "session/recipes/edit", payload: { recipeId, edit } });
  const editNodes = (recipeId, edit) => editRecipe(recipeId, (r) => ({ ...r, working: { ...r.working, nodes: edit(r.working.nodes) } }));
  const editSharedStep = (sharedStepId, edit) => dispatch({ type: "session/sharedSteps/edit", payload: { sharedStepId, edit } });

  /** Apply `edit` to one step, wherever it lives. */
  const editNode = (nodeId, edit) => {
    const shared = findSharedStep(nodeId);
    if (shared) return editSharedStep(shared.id, edit);
    const recipe = findRecipeForNode(nodeId);
    if (recipe) editNodes(recipe.id, (nodes) => nodes.map((n) => (n.id === nodeId ? edit(n) : n)));
  };

  /** Rewrite one step's dependencies from its current ones. */
  const updateDeps = (nodeId, next) =>
    editNode(nodeId, (n) => ({ ...n, depends_on: unique(next(n.depends_on || [])).filter((d) => d !== nodeId) }));

  /**
   * A new step in one dish. The duration is explicit because the
   * scheduler treats it as fact.
   *
   * `dependsOn` wires the new step's own predecessors. `runsBefore` is the
   * other half of inserting "before X" or "between X and Y": each of those
   * steps now waits on the new one, and drops any predecessor it shared
   * with it, so X -> Y becomes X -> new -> Y rather than both.
   *
   * @returns {string|null} the new step's id
   */
  const addNode = (
    recipeId,
    { phase = "prep", dependsOn = [], runsBefore = [], label = "New step", durationSec, difficulty = "low", equipment = [], materials = [], materialUsage = {} } = {},
  ) => {
    if (!recipes.some((r) => r.id === recipeId)) return null;
    const id = nextNodeId("step");
    editNodes(recipeId, (nodes) => [
      ...nodes,
      {
        id,
        label,
        description: "",
        estimated_duration_sec: Math.max(15, Math.round(durationSec ?? 120)),
        difficulty,
        required_equipment: equipment,
        required_materials: [...materials],
        material_usage: { ...materialUsage },
        depends_on: dependsOn,
        status: "pending",
        phase,
      },
    ]);
    runsBefore.forEach((targetId) => updateDeps(targetId, (deps) => [...deps.filter((d) => !dependsOn.includes(d)), id]));
    return id;
  };

  /**
   * Remove steps. Whatever waited on them loses the link, unless
   * `reattach` maps that dependent to what it should wait on instead.
   */
  const deleteNodes = (nodeIds, reattach = {}) => {
    const ids = new Set(nodeIds);
    if (!ids.size) return;
    const rewired = (n) => ({
      ...n,
      depends_on: unique(reattach[n.id] ?? n.depends_on ?? []).filter((d) => !ids.has(d) && d !== n.id),
    });
    const touched = (n) => ids.has(n.id) || n.id in reattach || (n.depends_on || []).some((d) => ids.has(d));

    recipes
      .filter((r) => r.working.nodes.some(touched))
      .forEach((r) => editNodes(r.id, (nodes) => nodes.filter((n) => !ids.has(n.id)).map(rewired)));
    // Deleting a shared step scrubs it from every dish and shared step.
    sharedSteps.forEach((s) => {
      if (ids.has(s.working.id)) deleteSharedStepFromSession(s.id);
      else if (s.working.id in reattach) editSharedStep(s.id, rewired);
    });
  };

  const deleteNode = (nodeId, { reattach } = {}) => deleteNodes([nodeId], reattach);

  /**
   * Save one step's edits, and when `children` is given, make exactly
   * those steps the ones that wait on it.
   */
  const saveNode = (nodeId, draftNode, { children } = {}) => {
    editNode(nodeId, () => untagged(draftNode));
    if (!children) return;
    const wanted = new Set(children);
    [...recipes.flatMap((r) => r.working.nodes), ...sharedSteps.map((s) => s.working)].forEach((n) => {
      if (n.id === nodeId) return;
      const waits = (n.depends_on || []).includes(nodeId);
      if (waits === wanted.has(n.id)) return;
      updateDeps(n.id, (deps) => (waits ? deps.filter((d) => d !== nodeId) : [...deps, nodeId]));
    });
  };

  /**
   * Add a material the catalog doesn't know, so every step can use it. It
   * travels with the dish whose step is being edited; a step being added
   * names its dish outright, and a shared step falls back to the first.
   *
   * @returns {string|null} the material id
   */
  const registerMaterial = (draft, materialsInfo, forNodeId, forRecipeId) => {
    const label = draft.label.trim();
    if (!label) return null;
    const id = slugifyMaterialId(label);
    if (materialsInfo[id]) return id;
    const recipe =
      (forNodeId && findRecipeForNode(forNodeId)) || (forRecipeId && recipes.find((r) => r.id === forRecipeId)) || recipes[0];
    if (!recipe) return null;
    const material = {
      label,
      category: draft.category || "other",
      amount: Number(draft.amount) || 1,
      unit: draft.unit.trim() || "unit",
      // Tells it apart from a generated material the catalog also lacks
      // (see inventory.js's isCustom).
      addedByUser: true,
    };
    editRecipe(recipe.id, (r) => ({ ...r, custom_materials: { ...(r.custom_materials || {}), [id]: material } }));
    return id;
  };

  /** Draw or cut one arrow on the board. */
  const linkNodes = (parentId, childId) => updateDeps(childId, (deps) => [...deps, parentId]);
  const unlinkNodes = (parentId, childId) => updateDeps(childId, (deps) => deps.filter((d) => d !== parentId));

  return { addNode, deleteNode, deleteNodes, saveNode, linkNodes, unlinkNodes, registerMaterial };
}
