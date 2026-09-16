import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { nextNodeId, slugifyMaterialId, MATERIAL_CATEGORY_LABELS, MATERIAL_CATEGORY_ORDER } from "../data/dishes.js";
import { useSessionRecipes } from "../state/useSessionRecipes.js";
import {
  diffGraphs,
  cloneGraph,
  groupByPhase,
  computeStepAvailability,
  computeDownstreamClosure,
  computeMaterialTotals,
  layoutLevels,
  mergeRecipesForDisplay,
} from "../utils/graphLayout.js";
import { missingEquipment, EQUIPMENT_LABELS } from "../utils/scheduleLayout.js";
import StepCard from "../components/StepCard.jsx";
import GraphCanvas from "../components/GraphCanvas.jsx";
import Drawer from "../components/Drawer.jsx";
import NodeEditorPanel from "../components/NodeEditorPanel.jsx";
import "./RecipeGraphPage.css";

const PHASE_COLUMNS = [
  { key: "prep", label: "Prep" },
  { key: "cook", label: "Cook" },
  { key: "plate", label: "Plate" },
];

// The merged view tags every node with the recipe instance it came
// from (or _shared for a session-owned shared step) for rendering;
// strip those back off before persisting a node.
function stripRecipeTag(node) {
  const { _recipeId, _shared, ...clean } = node;
  return clean;
}

export default function RecipeGraphPage() {
  const { state, dispatch, deleteSharedStepFromSession } = useAppState();
  const { selectedNodeId, recipes, sharedSteps = [] } = state.session;
  const kitchenProfile = state.kitchenProfiles.find((p) => p.id === state.session.kitchenProfileId) || null;
  // "Out" ingredients are session state, set on the Inventory page and
  // persisted with the session, so the main line and Inventory agree —
  // and it gates approval below.
  const unavailableMaterials = useMemo(
    () => new Set(state.session.outMaterialIds || []),
    [state.session.outMaterialIds]
  );
  const [addPickerPhase, setAddPickerPhase] = useState(null); // which column's "which dish?" picker is open
  const { catalog: baseMaterials } = useSessionRecipes();

  const { working, draft, approved } = mergeRecipesForDisplay(recipes, sharedSteps);

  const { impossible: impossibleSteps, affected: affectedSteps } = computeStepAvailability(
    working.nodes || [],
    unavailableMaterials
  );

  // If the step whose editor is open just became impossible (e.g. its
  // last material got unchecked), its card is now disabled and can no
  // longer be clicked to close — so close the drawer automatically.
  const selectedIsImpossible = Boolean(selectedNodeId && impossibleSteps.has(selectedNodeId));
  useEffect(() => {
    if (selectedIsImpossible) {
      dispatch({ type: "session/update", payload: { selectedNodeId: null } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIsImpossible]);

  if (!baseMaterials || recipes.length === 0) {
    return (
      <section className="page recipe-graph-page">
        <p className="hint">Loading your recipe&hellip;</p>
      </section>
    );
  }

  const draftById = Object.fromEntries(draft.nodes.map((n) => [n.id, n]));
  const isEdited = (node) => draftById[node.id] && JSON.stringify(draftById[node.id]) !== JSON.stringify(node);
  const editedCount = working.nodes.filter(isEdited).length;
  const totalMinutes = Math.round(working.nodes.reduce((sum, n) => sum + n.estimated_duration_sec, 0) / 60);
  const isMultiDish = recipes.length > 1;

  // Materials a user adds while editing a step live on the owning
  // recipe instance (recipe.custom_materials), merged with the DB
  // catalog — this is the full set of "known" materials for this session.
  const materialsInfo = { ...baseMaterials, ...working.custom_materials };
  const materialLabel = (m) => materialsInfo[m]?.label || m;

  // The catalog's amount/unit is a flat default that doesn't know how
  // many steps (or dishes) actually draw on it — a shared step's own
  // material_usage states the true combined need, so the checklist
  // shows that total instead wherever a step has stated one.
  const materialTotals = computeMaterialTotals(working.nodes, materialsInfo);

  // A material's priority is how many steps its availability ultimately
  // affects — the step(s) it's directly used in, plus everything
  // downstream of those (inherited through the dependency graph), not
  // just a raw count of where it's literally listed.
  const downstreamClosure = computeDownstreamClosure(working.nodes);
  const materialPriority = (m) => {
    const affected = new Set();
    working.nodes.forEach((n) => {
      if ((n.required_materials || []).includes(m)) {
        downstreamClosure.get(n.id)?.forEach((id) => affected.add(id));
      }
    });
    return affected.size;
  };

  const allMaterials = [...new Set(working.nodes.flatMap((n) => n.required_materials || []))];
  const lacking = missingEquipment(working.nodes, kitchenProfile);
  const affectedStepCount = affectedSteps.size;
  const dishIsUndoable = impossibleSteps.size > 0;

  // Group by basic ingredient type, then order within each group by how
  // many steps depend on it (most-depended-on first), falling back to
  // portion size to break ties.
  const materialsByCategory = {};
  allMaterials.forEach((m) => {
    const category = materialsInfo[m]?.category || "other";
    if (!materialsByCategory[category]) materialsByCategory[category] = [];
    materialsByCategory[category].push(m);
  });
  const orderedCategories = MATERIAL_CATEGORY_ORDER.filter((cat) => materialsByCategory[cat]?.length > 0);
  orderedCategories.forEach((cat) => {
    materialsByCategory[cat].sort((a, b) => {
      const byPriority = materialPriority(b) - materialPriority(a);
      if (byPriority !== 0) return byPriority;
      return (materialTotals[b]?.amount || 0) - (materialTotals[a]?.amount || 0);
    });
  });

  const formatImpossibleReason = (reason) => {
    if (!reason) return null;
    if (reason.type === "materials") return `missing ${reason.materials.map(materialLabel).join(", ")}`;
    return `depends on ${reason.dependsOnLabels.map((l) => `"${l}"`).join(" and ")}, which isn't doable`;
  };

  const formatAffectedReason = (reason) => {
    if (!reason) return null;
    const bits = [];
    if (reason.missingMaterials.length > 0) bits.push(`missing ${reason.missingMaterials.map(materialLabel).join(", ")}`);
    if (reason.degradedDepLabels.length > 0) bits.push(`depends on ${reason.degradedDepLabels.map((l) => `"${l}"`).join(", ")}, which isn't fully available`);
    return bits.join("; ");
  };

  const toggleMaterial = (id) => {
    const next = new Set(unavailableMaterials);
    next.has(id) ? next.delete(id) : next.add(id);
    dispatch({ type: "session/update", payload: { outMaterialIds: [...next] } });
  };

  // The escape hatch that makes the approval gate below fair: rather
  // than only being told the cook isn't doable, drop what can't be done
  // and cook the rest. `impossibleSteps` is already the full closure —
  // the steps missing materials plus everything downstream of them — so
  // removing the whole set leaves a graph with no dangling work.
  const dropBlockedSteps = () => {
    const blockedIds = [...impossibleSteps.keys()];
    if (blockedIds.length === 0) return;
    if (!window.confirm(`Remove ${blockedIds.length} step${blockedIds.length === 1 ? "" : "s"} you can't do without those materials?`))
      return;
    const blocked = new Set(blockedIds);
    // Shared steps are session-owned; their delete scrubs depends_on
    // across every dish, which a per-recipe edit can't reach.
    sharedSteps.filter((s) => blocked.has(s.working.id)).forEach((s) => deleteSharedStepFromSession(s.id));
    recipes.forEach((recipe) => {
      if (!recipe.working.nodes.some((n) => blocked.has(n.id) || (n.depends_on || []).some((d) => blocked.has(d)))) return;
      updateRecipeWorking(recipe.id, (w) => {
        w.nodes = w.nodes
          .filter((n) => !blocked.has(n.id))
          .map((n) => ({ ...n, depends_on: (n.depends_on || []).filter((d) => !blocked.has(d)) }));
      });
    });
    if (selectedNodeId && blocked.has(selectedNodeId)) selectNode(null);
  };

  const findRecipeForNode = (nodeId) => recipes.find((r) => r.working.nodes.some((n) => n.id === nodeId));
  const findSharedStep = (nodeId) => sharedSteps.find((s) => s.working.id === nodeId);

  const updateRecipeWorking = (recipeId, mutateFn) => {
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) return;
    const nextWorking = cloneGraph(recipe.working);
    mutateFn(nextWorking);
    dispatch({ type: "session/recipes/updateOne", payload: { recipeId, patch: { working: nextWorking } } });
  };

  const updateSharedStepWorking = (sharedStepId, mutateFn) => {
    const step = sharedSteps.find((s) => s.id === sharedStepId);
    if (!step) return;
    const nextWorking = cloneGraph(step.working);
    mutateFn(nextWorking);
    dispatch({ type: "session/sharedSteps/updateOne", payload: { sharedStepId, patch: { working: nextWorking } } });
  };

  const selectNode = (nodeId) => dispatch({ type: "session/update", payload: { selectedNodeId: nodeId } });

  const updateNode = (nodeId, patchFn) => {
    const shared = findSharedStep(nodeId);
    if (shared) return updateSharedStepWorking(shared.id, patchFn);
    const recipe = findRecipeForNode(nodeId);
    if (!recipe) return;
    updateRecipeWorking(recipe.id, (w) => {
      const node = w.nodes.find((n) => n.id === nodeId);
      if (node) patchFn(node);
    });
  };

  // A new step belongs to exactly one dish, so with more than one dish
  // in the session the target has to be chosen explicitly — see the
  // per-column dish picker below. The phase comes from whichever column
  // the step was added in.
  const addNode = (recipeId, phase) => {
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) return;
    const id = nextNodeId("step");
    updateRecipeWorking(recipe.id, (w) => {
      w.nodes.push({
        id,
        label: "New step",
        description: "",
        estimated_duration_sec: 60,
        difficulty: "low",
        required_equipment: [],
        required_materials: [],
        depends_on: [],
        status: "pending",
        phase,
      });
    });
    setAddPickerPhase(null);
    selectNode(id);
  };

  // One dish: nothing to choose, add straight away. Two or more: open
  // the picker for that column instead.
  const handleAddClick = (phase) => {
    if (recipes.length === 1) return addNode(recipes[0].id, phase);
    setAddPickerPhase(phase);
  };

  // Deleting a shared step needs to scrub depends_on across every recipe
  // instance (and every other shared step) since it can be a dependency
  // across dish boundaries — deleteSharedStepFromSession owns that full
  // scrub, both locally and server-side. Deleting a plain per-recipe
  // node only ever needs to scrub within that one recipe, since nothing
  // outside it can depend on it.
  const deleteNode = (nodeId) => {
    if (!window.confirm("Remove this step? Any step depending on it will lose that dependency.")) return;
    const shared = findSharedStep(nodeId);
    if (shared) {
      deleteSharedStepFromSession(shared.id);
    } else {
      const recipe = findRecipeForNode(nodeId);
      if (!recipe) return;
      updateRecipeWorking(recipe.id, (w) => {
        w.nodes = w.nodes.filter((n) => n.id !== nodeId).map((n) => ({ ...n, depends_on: n.depends_on.filter((d) => d !== nodeId) }));
      });
    }
    if (selectedNodeId === nodeId) selectNode(null);
  };

  // Commits a step's staged edits (from the drawer) in one go and closes it.
  const saveNode = (nodeId, draftNode) => {
    const shared = findSharedStep(nodeId);
    if (shared) {
      dispatch({ type: "session/sharedSteps/updateOne", payload: { sharedStepId: shared.id, patch: { working: stripRecipeTag(draftNode) } } });
      selectNode(null);
      return;
    }
    const recipe = findRecipeForNode(nodeId);
    if (!recipe) return;
    updateRecipeWorking(recipe.id, (w) => {
      const index = w.nodes.findIndex((n) => n.id === nodeId);
      if (index !== -1) w.nodes[index] = stripRecipeTag(draftNode);
    });
    selectNode(null);
  };

  // Registers a material that doesn't exist yet on the recipe (so it's
  // available to every step, not just the one being edited) and returns
  // its id. It's stored on the dish whose step is currently open in the
  // editor, so it travels with that dish rather than always landing on
  // the first one. A shared step belongs to no single dish, so a
  // material added from one falls back to the first recipe.
  const registerMaterial = (draft) => {
    const label = draft.label.trim();
    if (!label) return null;
    const id = slugifyMaterialId(label);
    if (!materialsInfo[id]) {
      const recipe = (selectedNodeId && findRecipeForNode(selectedNodeId)) || recipes[0];
      if (!recipe) return null;
      const nextCustom = {
        ...(recipe.custom_materials || {}),
        [id]: { label, category: draft.category || "other", amount: Number(draft.amount) || 1, unit: draft.unit.trim() || "unit" },
      };
      dispatch({ type: "session/recipes/updateOne", payload: { recipeId: recipe.id, patch: { custom_materials: nextCustom } } });
    }
    return id;
  };

  // Approve/revise apply to every recipe instance (and every shared
  // step) in the session at once — there's no per-dish approval control yet.
  const approve = () => {
    recipes.forEach((recipe) => {
      dispatch({ type: "session/recipes/updateOne", payload: { recipeId: recipe.id, patch: { approved: cloneGraph(recipe.working) } } });
    });
    sharedSteps.forEach((step) => {
      dispatch({ type: "session/sharedSteps/updateOne", payload: { sharedStepId: step.id, patch: { approved: cloneGraph(step.working) } } });
    });
    selectNode(null);
  };
  const revise = () => {
    recipes.forEach((recipe) => {
      dispatch({ type: "session/recipes/updateOne", payload: { recipeId: recipe.id, patch: { approved: null } } });
    });
    sharedSteps.forEach((step) => {
      dispatch({ type: "session/sharedSteps/updateOne", payload: { sharedStepId: step.id, patch: { approved: null } } });
    });
  };

  // Step numbers should reflect cook order (dependency depth), not raw
  // array position — otherwise a freshly-added, dependency-free step
  // (always appended to the end of the array) gets numbered last even
  // though nothing actually depends on it or comes after it. The cards
  // in each phase column are sorted the same way, so the numbers read
  // top-to-bottom instead of jumping around (9, 10, 12, 14, 11, 13…).
  const stepOrder = layoutLevels(working.nodes).flat();
  const stepIndex = new Map(stepOrder.map((n, i) => [n.id, i]));
  const phaseGroups = groupByPhase(working.nodes);
  Object.values(phaseGroups).forEach((group) => group.sort((a, b) => stepIndex.get(a.id) - stepIndex.get(b.id)));
  const dishLabelFor = (node) => (node._shared ? "Shared" : recipes.find((r) => r.id === node._recipeId)?.working.title || null);

  // A merged shared step's own material_usage only holds the combined
  // total (shown in the Required materials panel); usage_breakdown keeps
  // each contributing dish's own amount so the per-dish split is still
  // visible on the step itself, even though it's now done as one step.
  const usageBreakdownFor = (node) => {
    if (!node.usage_breakdown?.length) return null;
    return node.usage_breakdown.map(
      (entry) =>
        `${Object.values(entry.material_usage).map((u) => `${u.amount} ${u.unit}`).join(", ")} — ${entry.title}`
    );
  };

  return (
    <section className="page recipe-graph-page">
      <div className="band-header">
        <div className="band-header-left">
          <div>
            <p className="band-eyebrow">Kitchen Path Agent</p>
            <h1>{working.title}</h1>
          </div>
        </div>
        <div className="band-header-right">
          <span className="hint">
            {working.nodes.length} steps &middot; {totalMinutes} min &middot; {working.servings} servings
            {kitchenProfile && <> &middot; {kitchenProfile.name}</>}
          </span>
        </div>
      </div>

      {lacking.length > 0 && (
        <div className="card equipment-warning">
          <span className="mini-title">
            Needs {lacking.map((e) => EQUIPMENT_LABELS[e] || e).join(" and ")} — {kitchenProfile?.name} hasn&rsquo;t got
            {lacking.length === 1 ? " one" : " them"}
          </span>
          <p className="hint">
            I&rsquo;ll plan as if there were exactly one, so the timings still work. Improvise, or edit the kitchen to
            match what you really have.
          </p>
        </div>
      )}

      {allMaterials.length > 0 && (
        <div className="card materials-card">
          <div className="materials-card-head">
            <span className="mini-title">Required materials</span>
            <span className={`hint ${dishIsUndoable ? "materials-summary-critical" : ""}`}>
              {dishIsUndoable
                ? `Not doable as-is — ${impossibleSteps.size} of ${working.nodes.length} steps blocked`
                : affectedStepCount > 0
                ? `${affectedStepCount} of ${working.nodes.length} steps affected`
                : "All steps covered"}
            </span>
          </div>
          <p className="hint">
            {approved
              ? "Locked in with the plan — hit Revise to change what you have."
              : "All selected by default — uncheck what you don't have and the steps that need it drop out."}
          </p>
          <div className="materials-groups">
            {orderedCategories.map((cat) => (
              <div className="materials-group" key={cat}>
                <span className="materials-group-label mono">{MATERIAL_CATEGORY_LABELS[cat] || cat}</span>
                <div className="checkbox-grid">
                  {materialsByCategory[cat].map((m) => {
                    const total = materialTotals[m];
                    return (
                      <label
                        className={`checkbox-pill ${unavailableMaterials.has(m) ? "is-unavailable" : ""} ${
                          approved ? "is-locked" : ""
                        }`}
                        key={m}
                      >
                        <input
                          type="checkbox"
                          checked={!unavailableMaterials.has(m)}
                          disabled={Boolean(approved)}
                          onChange={() => toggleMaterial(m)}
                        />
                        <span>
                          {materialLabel(m)}
                          {total && (
                            <span className="mono materials-portion">
                              {" "}
                              &middot; {total.amount} {total.unit}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="graph-page-layout">
        <div className="phase-columns">
          {PHASE_COLUMNS.map((col) => (
            <div className="phase-column" key={col.key}>
              <div className="phase-column-head">
                <span className={`phase-dot phase-dot-${col.key}`} aria-hidden="true" />
                <span className="mini-title">{col.label}</span>
                <span className="hint">{phaseGroups[col.key].length}</span>
              </div>
              <div className="phase-column-list">
                {phaseGroups[col.key].map((node) => (
                  <StepCard
                    key={node.id}
                    node={node}
                    index={stepIndex.get(node.id)}
                    allNodes={working.nodes}
                    isEdited={isEdited(node)}
                    isSelected={!approved && selectedNodeId === node.id}
                    onSelect={approved ? () => {} : selectNode}
                    isImpossible={impossibleSteps.has(node.id)}
                    impossibleReason={formatImpossibleReason(impossibleSteps.get(node.id))}
                    isAffected={affectedSteps.has(node.id)}
                    affectedReason={formatAffectedReason(affectedSteps.get(node.id))}
                    dishLabel={isMultiDish ? dishLabelFor(node) : null}
                    usageBreakdown={usageBreakdownFor(node)}
                  />
                ))}
                {!approved &&
                  (addPickerPhase === col.key ? (
                    <div className="phase-add-picker">
                      <span className="mini-title">Add to which dish?</span>
                      {recipes.map((recipe) => (
                        <button
                          type="button"
                          className="btn phase-add-dish-btn"
                          key={recipe.id}
                          onClick={() => addNode(recipe.id, col.key)}
                        >
                          {recipe.working.title}
                        </button>
                      ))}
                      <button type="button" className="btn btn-ghost" onClick={() => setAddPickerPhase(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="btn phase-add-btn" onClick={() => handleAddClick(col.key)}>
                      + Add step
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>

        <div className="card dependency-graph-card">
          <span className="mini-title">Dependency graph</span>
          <GraphCanvas
            nodes={working.nodes}
            selectedNodeId={selectedNodeId}
            onSelect={(id) => !approved && selectNode(id)}
          />
        </div>
      </div>

      {approved ? (
        <ApprovedPanel draft={draft} approved={approved} onRevise={revise} />
      ) : (
        <div className="band-footer">
          <div className="band-footer-left">
            <span className="tag">{working.nodes.length} steps</span>
            {editedCount > 0 && <span className="tag step-card-edited">{editedCount} edited by you</span>}
            {/* Unchecking a material has to mean something. Scheduling a
                plan whose steps can't be done would be planning a cook
                that fails at the stove. */}
            {dishIsUndoable && (
              <span className="hint materials-summary-critical">
                {impossibleSteps.size} step{impossibleSteps.size === 1 ? "" : "s"} can&rsquo;t be done with what you have.
              </span>
            )}
          </div>
          <div className="band-footer-right">
            {dishIsUndoable && (
              <button className="btn btn-ghost" onClick={dropBlockedSteps}>
                Remove the blocked {impossibleSteps.size === 1 ? "step" : "steps"}
              </button>
            )}
            <button className="btn btn-primary btn-lg" onClick={approve} disabled={dishIsUndoable}>
              Approve and schedule &rarr;
            </button>
          </div>
        </div>
      )}

      {!approved &&
        selectedNodeId &&
        (() => {
          const selectedNode = working.nodes.find((n) => n.id === selectedNodeId);
          if (!selectedNode) return null;
          return (
            <Drawer label="Edit step" onClose={() => selectNode(null)}>
              <NodeEditorPanel
                node={selectedNode}
                allNodes={working.nodes}
                onSave={saveNode}
                onDelete={deleteNode}
                materialsInfo={materialsInfo}
                onRegisterMaterial={registerMaterial}
              />
            </Drawer>
          );
        })()}
    </section>
  );
}

function ApprovedPanel({ draft, approved, onRevise }) {
  const navigate = useNavigate();
  const diff = diffGraphs(draft, approved);
  const hasChanges = diff.added.length || diff.removed.length || diff.edited.length;

  return (
    <div className="card approved-panel">
      <span className="mini-title">Approved &check;</span>

      <div className="diff-block">
        <DiffSection title="Added" items={diff.added} tone="success" />
        <DiffSection title="Removed" items={diff.removed} tone="danger" />
        <DiffSection title="Edited" items={diff.edited} tone="warning" />
        {!hasChanges && <p className="hint">No changes — approved exactly as drafted.</p>}
      </div>

      <div className="approve-row approve-row-split">
        <button className="btn btn-ghost" onClick={onRevise}>
          &larr; Revise
        </button>
        <button className="btn btn-primary" onClick={() => navigate("/session/voice-binding")}>
          Continue to schedule &rarr;
        </button>
      </div>
    </div>
  );
}

function DiffSection({ title, items, tone }) {
  if (!items.length) return null;
  return (
    <div className="diff-group">
      <span className={`diff-group-title diff-${tone}`}>
        {title} ({items.length})
      </span>
      <ul className="diff-list">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
