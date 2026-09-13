import { useEffect } from "react";
import { useAppState } from "../state/AppStateContext.jsx";
import { generateRecipeGraph, nextNodeId } from "../data/dishes.js";
import { diffGraphs, cloneGraph, groupByPhase } from "../utils/graphLayout.js";
import StepCard from "../components/StepCard.jsx";
import GraphCanvas from "../components/GraphCanvas.jsx";
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

  useEffect(() => {
    if (!draft) {
      const generated = generateRecipeGraph(state.session.conversation.answers);
      dispatch({ type: "session/graph/init", payload: generated });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  if (!working) return null; // session/graph/init effect above fires on the next render

  const draftById = Object.fromEntries(draft.nodes.map((n) => [n.id, n]));
  const isEdited = (node) => draftById[node.id] && JSON.stringify(draftById[node.id]) !== JSON.stringify(node);
  const editedCount = working.nodes.filter(isEdited).length;
  const totalMinutes = Math.round(working.nodes.reduce((sum, n) => sum + n.estimated_duration_sec, 0) / 60);

  const updateNode = (nodeId, patchFn) => {
    const next = cloneGraph(working);
    const node = next.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    patchFn(node);
    dispatch({ type: "session/graph/update", payload: { working: next } });
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
                    index={working.nodes.indexOf(node)}
                    allNodes={working.nodes}
                    isEdited={isEdited(node)}
                    isSelected={!approved && selectedNodeId === node.id}
                    onSelect={approved ? () => {} : selectNode}
                    onChange={updateNode}
                    onDelete={deleteNode}
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
