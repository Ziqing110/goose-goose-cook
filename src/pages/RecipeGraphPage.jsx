import { useEffect, useState } from "react";
import { useAppState } from "../state/AppStateContext.jsx";
import {
  generateRecipeGraph,
  nextNodeId,
  slugifyMaterialId,
  MATERIAL_INFO,
  MATERIAL_CATEGORY_LABELS,
  MATERIAL_CATEGORY_ORDER,
} from "../data/dishes.js";
import {
  diffGraphs,
  cloneGraph,
  groupByPhase,
  computeStepAvailability,
  computeDownstreamClosure,
  layoutLevels,
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

export default function RecipeGraphPage() {
  const { state, dispatch } = useAppState();
  const { draft, working, approved, selectedNodeId } = state.session.graph;
  const kitchenProfile = state.kitchenProfiles.find((p) => p.id === state.session.kitchenProfileId) || null;
  const [unavailableMaterials, setUnavailableMaterials] = useState(new Set());

  useEffect(() => {
    if (!draft) {
      const generated = generateRecipeGraph(state.session.conversation.answers);
      dispatch({ type: "session/graph/init", payload: generated });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const { impossible: impossibleSteps, affected: affectedSteps } = computeStepAvailability(
    working?.nodes || [],
    unavailableMaterials
  );

  // If the step whose editor is open just became impossible (e.g. its
  // last material got unchecked), its card is now disabled and can no
  // longer be clicked to close — so close the popover automatically.
  const selectedIsImpossible = Boolean(selectedNodeId && impossibleSteps.has(selectedNodeId));
  useEffect(() => {
    if (selectedIsImpossible) {
      dispatch({ type: "session/graph/update", payload: { selectedNodeId: null } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIsImpossible]);

  if (!working) return null; // session/graph/init effect above fires on the next render

  const draftById = Object.fromEntries(draft.nodes.map((n) => [n.id, n]));
  const isEdited = (node) => draftById[node.id] && JSON.stringify(draftById[node.id]) !== JSON.stringify(node);
  const editedCount = working.nodes.filter(isEdited).length;
  const totalMinutes = Math.round(working.nodes.reduce((sum, n) => sum + n.estimated_duration_sec, 0) / 60);

  // Materials the user adds while editing a step live on the graph
  // (working.custom_materials), merged with the built-in dish defaults —
  // this is the full set of "known" materials for this recipe.
  const materialsInfo = { ...MATERIAL_INFO, ...(working.custom_materials || {}) };
  const materialLabel = (m) => materialsInfo[m]?.label || m;

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
      return (materialsInfo[b]?.amount || 0) - (materialsInfo[a]?.amount || 0);
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

  // Registers a material that doesn't exist yet on the recipe (so it's
  // available to every step, not just the one being edited) and returns
  // its id. Doesn't touch any step's required_materials — the editor
  // adds it to its own in-progress draft, applied on Save like every
  // other field.
  const registerMaterial = (draft) => {
    const label = draft.label.trim();
    if (!label) return null;
    const id = slugifyMaterialId(label);
    if (!materialsInfo[id]) {
      const next = cloneGraph(working);
      next.custom_materials = { ...(next.custom_materials || {}) };
      next.custom_materials[id] = {
        label,
        category: draft.category || "other",
        amount: Number(draft.amount) || 1,
        unit: draft.unit.trim() || "unit",
      };
      dispatch({ type: "session/graph/update", payload: { working: next } });
    }
    return id;
  };

  // Commits a step's staged edits (from the drawer) in one go and closes it.
  const saveNode = (nodeId, draftNode) => {
    const next = cloneGraph(working);
    const index = next.nodes.findIndex((n) => n.id === nodeId);
    if (index === -1) return;
    next.nodes[index] = draftNode;
    dispatch({ type: "session/graph/update", payload: { working: next, selectedNodeId: null } });
  };


  const addNode = () => {
    const next = cloneGraph(working);
    const id = nextNodeId("step");
    next.nodes.push({
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
    dispatch({ type: "session/graph/update", payload: { working: next, selectedNodeId: id } });
  };

  const deleteNode = (nodeId) => {
    if (!window.confirm("Remove this step? Any step depending on it will lose that dependency.")) return;
    const next = cloneGraph(working);
    next.nodes = next.nodes.filter((n) => n.id !== nodeId).map((n) => ({ ...n, depends_on: n.depends_on.filter((d) => d !== nodeId) }));
    dispatch({
      type: "session/graph/update",
      payload: { working: next, selectedNodeId: selectedNodeId === nodeId ? null : selectedNodeId },
    });
  };

  const selectNode = (nodeId) => dispatch({ type: "session/graph/update", payload: { selectedNodeId: nodeId } });
  const approve = () => dispatch({ type: "session/graph/update", payload: { approved: cloneGraph(working), selectedNodeId: null } });
  const revise = () => dispatch({ type: "session/graph/update", payload: { approved: null } });

  const phaseGroups = groupByPhase(working.nodes);
  // Step numbers should reflect cook order (dependency depth), not raw
  // array position — otherwise a freshly-added, dependency-free step
  // (always appended to the end of the array) gets numbered last even
  // though nothing actually depends on it or comes after it.
  const stepOrder = layoutLevels(working.nodes).flat();

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
                    const info = materialsInfo[m];
                    return (
                      <label className={`checkbox-pill ${unavailableMaterials.has(m) ? "is-unavailable" : ""}`} key={m}>
                        <input type="checkbox" checked={!unavailableMaterials.has(m)} onChange={() => toggleMaterial(m)} />
                        <span>
                          {materialLabel(m)}
                          {info && (
                            <span className="mono materials-portion">
                              {" "}
                              &middot; {info.amount} {info.unit}
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
