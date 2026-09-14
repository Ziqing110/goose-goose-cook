import { useEffect, useState } from "react";
import { useAppState } from "../state/AppStateContext.jsx";
import { nextNodeId, slugifyMaterialId, MATERIAL_CATEGORY_LABELS, MATERIAL_CATEGORY_ORDER } from "../data/dishes.js";
import { listRecipeTemplates, listMaterials } from "../api/recipeTemplates.js";
import {
  diffGraphs,
  cloneGraph,
  groupByPhase,
  computeStepAvailability,
  computeDownstreamClosure,
  computeMaterialTotals,
  layoutLevels,
  namespaceTemplateNodes,
  mergeRecipesForDisplay,
  extractSharedSteps,
} from "../utils/graphLayout.js";
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
function matchTemplates(templates, answers) {
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
function buildNamespacedGraph(template, answers, recipeId) {
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

function toRecipeInstance({ recipeId, templateId, nodes, ...rest }) {
  const graph = { recipe_id: `recipe_${recipeId}`, ...rest, nodes };
  return { id: recipeId, templateId, draft: graph, working: cloneGraph(graph), approved: null, custom_materials: {} };
}

function toSharedStepInstance(node) {
  return { id: node.id, draft: node, working: cloneGraph(node), approved: null };
}

// The merged view tags every node with the recipe instance it came
// from (or _shared for a session-owned shared step) for rendering;
// strip those back off before persisting a node.
function stripRecipeTag(node) {
  const { _recipeId, _shared, ...clean } = node;
  return clean;
}

export default function RecipeGraphPage() {
  const { state, dispatch, addRecipeToSession, addSharedStepToSession, deleteSharedStepFromSession } = useAppState();
  const { conversation, selectedNodeId, recipes, sharedSteps = [] } = state.session;
  const kitchenProfile = state.kitchenProfiles.find((p) => p.id === state.session.kitchenProfileId) || null;
  const [unavailableMaterials, setUnavailableMaterials] = useState(new Set());
  const [templates, setTemplates] = useState(null);
  const [baseMaterials, setBaseMaterials] = useState(null);

  // Reference data (recipe templates + the materials catalog) now comes
  // from the database instead of being hardcoded in src/data/dishes.js.
  useEffect(() => {
    listRecipeTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
    listMaterials()
      .then((rows) => {
        const catalog = {};
        rows.forEach((m) => {
          catalog[m.id] = { label: m.label, category: m.category, amount: m.amount, unit: m.unit };
        });
        setBaseMaterials(catalog);
      })
      .catch(() => setBaseMaterials({}));
  }, []);

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
    setUnavailableMaterials((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
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

  // TODO: New steps are added to the session's first/primary recipe —
  // there's no per-dish UI yet to pick a target when a session holds
  // more than one. Harmless today (recipes[0] is always Mapo Tofu, so
  // it's a silent-but-consistent misattribution), but revisit once
  // dishes can be added/removed mid-session (e.g. via LLM querying) —
  // that's when "always recipes[0]" stops being safe to ignore.
  const addNode = () => {
    const recipe = recipes[0];
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
        phase: "prep",
      });
    });
    selectNode(id);
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
  // its id. Lives on the session's first/primary recipe for now.
  // TODO: same recipes[0] misattribution as addNode above — a material
  // added while editing a Chicken Noodle Soup step is silently attached
  // to Mapo Tofu's custom_materials instead. Invisible today because
  // mergeRecipesForDisplay unions custom_materials across all recipes
  // for display, but would surface if that owning recipe were ever
  // removed from the session. Revisit alongside addNode's TODO.
  const registerMaterial = (draft) => {
    const label = draft.label.trim();
    if (!label) return null;
    const id = slugifyMaterialId(label);
    if (!materialsInfo[id]) {
      const recipe = recipes[0];
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

  const phaseGroups = groupByPhase(working.nodes);
  // Step numbers should reflect cook order (dependency depth), not raw
  // array position — otherwise a freshly-added, dependency-free step
  // (always appended to the end of the array) gets numbered last even
  // though nothing actually depends on it or comes after it.
  const stepOrder = layoutLevels(working.nodes).flat();
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
          <p className="hint">All selected by default — uncheck what you don't have to see what's still craftable.</p>
          <div className="materials-groups">
            {orderedCategories.map((cat) => (
              <div className="materials-group" key={cat}>
                <span className="materials-group-label mono">{MATERIAL_CATEGORY_LABELS[cat] || cat}</span>
                <div className="checkbox-grid">
                  {materialsByCategory[cat].map((m) => {
                    const total = materialTotals[m];
                    return (
                      <label className={`checkbox-pill ${unavailableMaterials.has(m) ? "is-unavailable" : ""}`} key={m}>
                        <input type="checkbox" checked={!unavailableMaterials.has(m)} onChange={() => toggleMaterial(m)} />
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
                    index={stepOrder.indexOf(node)}
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
                {!approved && (
                  <button type="button" className="btn phase-add-btn" onClick={addNode}>
                    + Add step
                  </button>
                )}
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
          </div>
          <div className="band-footer-right">
            <button className="btn btn-primary btn-lg" onClick={approve}>
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
        <button className="btn btn-primary" disabled title="Coming soon">
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
