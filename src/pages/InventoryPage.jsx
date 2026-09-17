// Inventory — the materials check between the conversation and the
// main line (design/claude-design-materials-prompt.md, "Kitchen Path
// Inventory v3"). One input: uncheck what you're out of. Everything
// else — coverage, reach, blocked/at-risk steps — is derived in
// utils/inventory.js from the same availability rules the main line
// uses. The "out" set is session state (session.outMaterialIds) so the
// main line reads the same thing.
import { useEffect, useMemo, useState } from "react";
import { useAppState } from "../state/AppStateContext.jsx";
import { useSessionRecipes } from "../state/useSessionRecipes.js";
import { mergeRecipesForDisplay, computeStepAvailability, cyclicDependencyIds, cloneGraph } from "../utils/graphLayout.js";
import { missingEquipment, EQUIPMENT_LABELS } from "../utils/scheduleLayout.js";
import RecipeBoard from "../components/RecipeBoard.jsx";
import AddStepPanel from "../components/AddStepPanel.jsx";
import ApprovedPanel from "../components/ApprovedPanel.jsx";
import DeleteStepDialog from "../components/DeleteStepDialog.jsx";
import Drawer from "../components/Drawer.jsx";
import NodeEditorPanel from "../components/NodeEditorPanel.jsx";
import { useStepEditing } from "../state/useStepEditing.js";
import { buildInventory, formatClock, formatStepDuration, PHASE_LABELS } from "../utils/inventory.js";
import dishMapoTofu from "../assets/dish-mapo-tofu.png";
import dishNoodleSoup from "../assets/dish-noodle-soup.png";
import "./InventoryPage.css";
import { registerVoiceCommands } from "../utils/voicePageCommands.js";

// The system's two dish marks. Matched by title keyword; a dish with
// no mark simply shows none (the title carries the meaning).
function dishMarkFor(title) {
  const t = (title || "").toLowerCase();
  if (t.includes("tofu")) return dishMapoTofu;
  if (t.includes("noodle") || t.includes("soup")) return dishNoodleSoup;
  return null;
}

function Mono({ children }) {
  return <span className="mono">{children}</span>;
}

function Checkbox({ checked, label, onChange }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={`${label} — ${checked ? "on hand" : "out"}`}
      className={`inv-check ${checked ? "is-on" : ""}`}
      onClick={onChange}
    >
      <span className="inv-check-box" aria-hidden="true">
        {checked && (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7.4 12.4l3.2 3.2 6-6.6" />
          </svg>
        )}
      </span>
    </button>
  );
}

function StepLine({ step, delay }) {
  return (
    <div className="inv-step" style={{ animationDelay: `${delay}ms` }}>
      <span className="inv-step-main">
        <Mono>
          <span className="inv-step-num">{step.number}</span>
        </Mono>
        <span className={`inv-step-phase is-${step.phase}`}>
          <span className="inv-step-phase-dot" />
          <Mono>{PHASE_LABELS[step.phase] || step.phase}</Mono>
        </span>
        <span className="inv-step-label">{step.label}</span>
        <Mono>
          <span className="inv-step-dur">{formatStepDuration(step.durationSec)}</span>
        </Mono>
      </span>
      {step.split.length > 0 && (
        <span className="inv-step-sub">
          {step.split.map((s, i) => (
            <span key={s.title}>
              {i > 0 && " · "}
              <Mono>
                {s.amount} {s.unit}
              </Mono>{" "}
              — {s.title}
            </span>
          ))}
        </span>
      )}
      {step.dependsOn.length > 0 && (
        <span className="inv-step-sub inv-step-deps">
          after{" "}
          {step.dependsOn.map((d, i) => (
            <span key={d.number}>
              {i > 0 && " · "}
              <Mono>{d.number}</Mono> {d.label}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

// Step detail stays folded so the list reads as a checklist; a row
// opens on its disclosure (or by clicking its text), and an "out" row
// opens itself so the cook sees what they just affected.
function IngredientRow({ item, onToggle, delay }) {
  const onHand = !item.out;
  const [opened, setOpened] = useState(false);
  const expanded = !onHand || opened;
  const detailId = `inv-detail-${item.id}`;
  const reachText = `${item.reach} ${item.reach === 1 ? "step" : "steps"}`;
  const reachTitle = onHand ? `Missing this would affect ${reachText}` : `Missing — affects ${reachText}`;
  return (
    <li className={`inv-row ${onHand ? "" : "is-out"} ${expanded ? "is-open" : ""}`} style={{ animationDelay: `${delay}ms` }}>
      <div className="inv-row-head">
        <Checkbox checked={onHand} label={item.label} onChange={onToggle} />
        <span className="inv-row-main" onClick={() => setOpened((v) => !v)}>
          <span className="inv-row-title-line">
            <span className="inv-row-title">{item.label}</span>
            {item.amount != null && (
              <Mono>
                <span className="inv-row-amount">
                  {item.amount} {item.unit}
                </span>
              </Mono>
            )}
            {!onHand && <span className="inv-chip inv-chip-out">Out</span>}
            {item.isCustom && <span className="inv-chip inv-chip-added">Added by you</span>}
          </span>
          <span className="inv-row-meta">
            <span>
              used in <Mono>{item.usedIn.length}</Mono> {item.usedIn.length === 1 ? "step" : "steps"}
            </span>
            {item.dishes.map((d) => (
              <span key={d} className="inv-chip inv-chip-dish">
                {d}
              </span>
            ))}
          </span>
        </span>
        <span className={`inv-reach mono is-${item.reachTone}`} title={reachTitle} aria-label={reachTitle}>
          → {reachText}
        </span>
        <button
          type="button"
          className="inv-row-toggle"
          aria-expanded={expanded}
          aria-controls={detailId}
          aria-label={`${expanded ? "Hide" : "Show"} the steps that use ${item.label}`}
          onClick={() => setOpened((v) => !v)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      {expanded && (
        <div className="inv-row-detail" id={detailId}>
          {item.usedIn.map((step, i) => (
            <StepLine key={step.id} step={step} delay={i * 60} />
          ))}
        </div>
      )}
    </li>
  );
}

export default function InventoryPage() {
  const { state, dispatch } = useAppState();
  const session = state.session;
  const { recipes, sharedSteps = [], outMaterialIds = [] } = session;
  const { catalog, catalogError, retryCatalog, generating } = useSessionRecipes();
  const [showAllImpact, setShowAllImpact] = useState(false);

  const inv = useMemo(
    () => buildInventory({ recipes, sharedSteps, catalog, outIds: outMaterialIds }),
    [recipes, sharedSteps, catalog, outMaterialIds]
  );

  // The same steps the ingredients above are folded under, as a board.
  const { working, draft, approved } = useMemo(() => mergeRecipesForDisplay(recipes, sharedSteps), [recipes, sharedSteps]);
  // `|| []` makes a new array whenever nodes is absent, which would
  // re-run the memo below on every render and defeat the point of it.
  const boardNodes = useMemo(() => working.nodes || [], [working.nodes]);
  const blockedIds = useMemo(
    () => computeStepAvailability(boardNodes, new Set(outMaterialIds)).impossible,
    [boardNodes, outMaterialIds]
  );
  const dishLabelFor = (node) =>
    node._shared ? "Shared" : recipes.find((r) => r.id === node._recipeId)?.working.title || null;
  const { addNode, saveNode, deleteNode, registerMaterial } = useStepEditing();
  // Which card is open is view state: persisting it meant a reload
  // re-opened the editor on a step nobody had just clicked.
  const [selectedId, setSelectedId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  // A step can carry materials the catalog doesn't know yet (added from
  // the editor), so the editor sees the catalog plus this run's own.
  const materialsInfo = { ...(catalog || {}), ...(working.custom_materials || {}) };
  const selectedNode = selectedId ? boardNodes.find((n) => n.id === selectedId) || null : null;

  // Approval is what the rest of the run reads: the schedule and the
  // live cook run off `approved`, never `working`, so editing a step
  // can't rewrite a plan someone is already cooking from.
  const kitchenProfile = state.kitchenProfiles.find((p) => p.id === session.kitchenProfileId) || null;
  const lacking = missingEquipment(boardNodes, kitchenProfile);
  const dishIsUndoable = blockedIds.size > 0;

  const approve = () => {
    recipes.forEach((r) =>
      dispatch({ type: "session/recipes/updateOne", payload: { recipeId: r.id, patch: { approved: cloneGraph(r.working) } } })
    );
    sharedSteps.forEach((st) =>
      dispatch({ type: "session/sharedSteps/updateOne", payload: { sharedStepId: st.id, patch: { approved: cloneGraph(st.working) } } })
    );
    setSelectedId(null);
  };
  // The voice equivalent of the "Approve and schedule" button, in the
  // same words printed on it. Approving locks the graph, so it asks
  // first — and it refuses while a step is blocked, exactly as the
  // button does when disabled. A voice command that quietly does
  // nothing because a button was greyed out is a bug report waiting to
  // happen, so it says why.
  useEffect(() => {
    return registerVoiceCommands([
      {
        phrases: [/\bapprove\b/],
        confirm: "Approve the board and move to scheduling? Say yes or no.",
        label: "Approved.",
        run: () => {
          if (dishIsUndoable) return;
          approve();
        },
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dishIsUndoable]);

  const revise = () => {
    recipes.forEach((r) => dispatch({ type: "session/recipes/updateOne", payload: { recipeId: r.id, patch: { approved: null } } }));
    sharedSteps.forEach((st) => dispatch({ type: "session/sharedSteps/updateOne", payload: { sharedStepId: st.id, patch: { approved: null } } }));
  };

  // The escape hatch that makes the gate fair: drop what can't be done
  // and cook the rest. blockedIds is already the full closure.
  const dropBlockedSteps = () => {
    const ids = [...blockedIds.keys()];
    if (!ids.length) return;
    if (!window.confirm(`Remove ${ids.length} step${ids.length === 1 ? "" : "s"} you can't do without those materials?`)) return;
    ids.forEach((id) => deleteNode(id, { confirm: false }));
    setSelectedId(null);
  };

  const nodePositions = session.nodePositions || {};
  const moveNode = (id, at) =>
    dispatch({ type: "session/update", payload: { nodePositions: { ...nodePositions, [id]: at } } });
  const selectNode = (id) => setSelectedId((cur) => (cur === id ? null : id));

  const hasDishes = recipes.length > 0;
  const hasOut = outMaterialIds.length > 0;
  const loading = hasDishes && !catalog && !catalogError;

  useEffect(() => {
    dispatch({
      type: "voice/setHint",
      payload: {
        hint: {
          line: "Say “approve and schedule” when the board looks right.",
          sub: "Or “back”, “home”, “help”.",
        },
      },
    });
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [dispatch]);

  const setOut = (ids) => dispatch({ type: "session/update", payload: { outMaterialIds: ids } });
  const toggle = (id) => {
    const next = new Set(outMaterialIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setOut([...next]);
  };
  const markAllOnHand = () => setOut([]);

  const { coverage } = inv;
  const metaBits = [];
  if (hasDishes) {
    metaBits.push(inv.title);
    if (inv.servings != null) metaBits.push(<><Mono>{inv.servings}</Mono> servings</>);
    if (catalog) metaBits.push(<><Mono>{inv.ingredients.length}</Mono> ingredients</>);
    metaBits.push(<><Mono>{inv.stepCount}</Mono> steps</>);
    metaBits.push(<Mono>{formatClock(inv.totalSeconds)}</Mono>);
  }

  // Blocked entries and at-risk entries with their own missing
  // ingredient always show; pure downstream cascades fold past the
  // first few so the panel stays a summary, not a second step list.
  const IMPACT_VISIBLE = 5;
  const impactVisible = showAllImpact ? inv.impact : inv.impact.slice(0, IMPACT_VISIBLE);
  const impactHidden = inv.impact.length - impactVisible.length;

  const dishMarks = inv.dishTitles.map((t) => ({ title: t, src: dishMarkFor(t) })).filter((d) => d.src);

  return (
    <section className="page inventory-page">
      <header className="inv-title-row">
        <div className="inv-title">
          <h1>Inventory</h1>
          {!hasDishes ? (
            <span className="inv-meta is-tertiary">
              {/* Generation is a real half-minute of model work, so say
                  what is happening rather than leaving a bare ellipsis
                  that reads as a hang. */}
              {generating ? "Writing your recipes — this takes a moment" : "The agent is still setting your dishes"}{" "}
              <span className="mono inv-dots">…</span>
            </span>
          ) : loading ? (
            <span className="inv-meta is-tertiary">Loading your ingredients…</span>
          ) : (
            <span className="inv-meta">
              {metaBits.map((bit, i) => (
                <span key={i}>
                  {i > 0 && " · "}
                  {bit}
                </span>
              ))}
            </span>
          )}
        </div>
        {dishMarks.length > 0 && (
          <span className="inv-dish-marks" aria-hidden="true">
            {dishMarks.map((d, i) => (
              <img key={d.title} src={d.src} alt="" className="inv-dish-mark" style={{ animationDelay: `${120 + i * 80}ms` }} />
            ))}
          </span>
        )}
      </header>

      {/* The board below only renders once the recipes exist, so without
          this the page is blank for the half-minute generation takes. */}
      {!hasDishes && (
        <div className="inv-hud" role="status" aria-live="polite">
          <span className="inv-meta">
            {generating ? "Writing your recipes" : "Setting your dishes"}{' '}
            <span className="mono inv-dots">…</span>
          </span>
        </div>
      )}

      {hasDishes && catalogError && (
        <div className="inv-hud inv-hud-error">
          <div className="inv-error-block">Couldn&rsquo;t load the ingredient catalog: {catalogError}</div>
          <button type="button" className="btn" onClick={retryCatalog}>
            Retry
          </button>
        </div>
      )}

      {hasDishes && catalog && (
        <>
          {/* ---- Coverage HUD ---- */}
          <div className="inv-hud">
            <div className="inv-hud-head">
              <span className={`inv-summary is-${coverage.tone}`}>{coverage.summary}</span>
              {hasOut && (
                <button type="button" className="btn btn-ghost inv-btn-accent" onClick={markAllOnHand}>
                  Mark everything on hand
                </button>
              )}
            </div>
            <div className="inv-stats">
              <div className="inv-stat inv-stat-wide">
                <span className="inv-stat-value mono inv-roll" style={{ animationDelay: "300ms" }}>
                  {inv.onHandCount}
                  <span className="inv-stat-sep"> / </span>
                  {inv.ingredients.length}
                </span>
                <span className="inv-stat-label">
                  <span className="inv-long">ingredients </span>on hand
                </span>
              </div>
              <div className="inv-stat">
                <span className="inv-stat-value mono inv-roll" style={{ animationDelay: "360ms" }}>
                  {coverage.atRisk}
                </span>
                <span className="inv-stat-label">
                  <span className="inv-long">steps </span>at risk
                </span>
              </div>
              <div className="inv-stat">
                <span className={`inv-stat-value mono inv-roll ${coverage.blocked > 0 ? "is-critical" : ""}`} style={{ animationDelay: "420ms" }}>
                  {coverage.blocked}
                </span>
                <span className="inv-stat-label">
                  <span className="inv-long">steps </span>blocked
                </span>
              </div>
            </div>
            <div className="inv-stepbar-wrap">
              <div
                className="inv-stepbar"
                role="img"
                aria-label={`${coverage.craftable} craftable, ${coverage.atRisk} at risk, ${coverage.blocked} blocked`}
              >
                {inv.steps.map((s) => (
                  <span key={s.id} className={`inv-stepbar-seg is-${s.status}`} />
                ))}
              </div>
              <span className="mono inv-stepbar-legend">
                {coverage.craftable} craftable · {coverage.atRisk} at risk · {coverage.blocked} blocked
              </span>
            </div>
          </div>

          {/* ---- Groups + impact ---- */}
          <div className="inv-columns">
            <div className="inv-groups">
              {inv.groups.map((g, gi) => (
                <section key={g.key} className="inv-card" style={{ animationDelay: `${160 + gi * 60}ms` }} aria-labelledby={`inv-group-${g.key}`}>
                  <div className="inv-card-head">
                    <span id={`inv-group-${g.key}`} className="inv-card-title">
                      {g.label}
                    </span>
                    <span className="mono inv-card-count">
                      {g.items.length} · {g.items.filter((i) => !i.out).length} on hand
                    </span>
                  </div>
                  <ul className="inv-list">
                    {g.items.map((item, i) => (
                      <IngredientRow key={item.id} item={item} onToggle={() => toggle(item.id)} delay={220 + gi * 60 + i * 60} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            <aside className="inv-impact inv-card" aria-labelledby="inv-impact-title">
              <div className="inv-card-head">
                <span id="inv-impact-title" className="inv-card-title">
                  What this changes
                </span>
              </div>
              {inv.impact.length === 0 ? (
                <div className="inv-impact-empty">Nothing — everything&rsquo;s craftable.</div>
              ) : (
                <ul className="inv-list">
                  {impactVisible.map((e, i) => (
                    <li key={e.id} className={`inv-impact-row is-${e.status}`} style={{ animationDelay: `${i * 60}ms` }}>
                      <span className="inv-impact-dot" aria-hidden="true" />
                      <span className="inv-impact-main">
                        <span className="inv-impact-title-line">
                          <span className="inv-impact-label">{e.label}</span>
                          <Mono>
                            <span className="inv-impact-dur">{formatStepDuration(e.durationSec)}</span>
                          </Mono>
                        </span>
                        <span className="inv-impact-reason">{e.reason}</span>
                      </span>
                    </li>
                  ))}
                  {impactHidden > 0 && (
                    <li>
                      <button type="button" className="inv-impact-more" onClick={() => setShowAllImpact(true)}>
                        + {impactHidden} more at risk downstream
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </aside>
          </div>

          {/* ---- The steps themselves, as a board you can rearrange ---- */}
          {boardNodes.length > 0 && (
            <section className="inv-card inv-board-card" aria-labelledby="inv-board-title">
              <div className="inv-card-head">
                <span id="inv-board-title" className="inv-card-title">
                  The main line
                </span>
                <span className="inv-meta is-tertiary">Drag a card to move it. Click one to edit.</span>
              </div>
              {!approved && (
              <AddStepPanel
                recipes={recipes}
                nodes={boardNodes}
                onAdd={(recipeId, spec) => {
                  const id = addNode(recipeId, spec);
                  if (id) setSelectedId(id); // open the new card for the details
                }}
              />
              )}
              <RecipeBoard
                nodes={boardNodes}
                positions={nodePositions}
                selectedNodeId={selectedId}
                dishLabelFor={dishLabelFor}
                blockedIds={blockedIds}
                onSelect={approved ? () => {} : selectNode}
                onMove={moveNode}
              />
            </section>
          )}

          {lacking.length > 0 && (
            <div className="inv-card inv-equipment-warning">
              <span className="inv-card-title">
                Planned with {lacking.map((e) => EQUIPMENT_LABELS[e] || e).join(" and ")} you don&rsquo;t have
              </span>
              <span className="inv-meta">
                {kitchenProfile?.name} has none configured, so these timings assume exactly one of each.
              </span>
            </div>
          )}

          {approved && <ApprovedPanel draft={draft} approved={approved} onRevise={revise} />}

          {/* ---- Footer band ---- */}
          <div className="inv-footer">
            <span className="mono inv-footer-tag">
              {coverage.craftable} of {coverage.total} steps craftable
            </span>
            <div className="inv-footer-actions">
              {coverage.blocked > 0 && (
                <button type="button" className="btn btn-ghost inv-btn-accent" onClick={markAllOnHand}>
                  Mark everything on hand
                </button>
              )}
              {!approved && dishIsUndoable && (
                <button type="button" className="btn btn-ghost" onClick={dropBlockedSteps}>
                  Remove the blocked {blockedIds.size === 1 ? "step" : "steps"}
                </button>
              )}
              {!approved && (
                <button type="button" className="btn btn-primary btn-lg" onClick={approve} disabled={dishIsUndoable}>
                  Approve and schedule &rarr;
                </button>
              )}
            </div>
          </div>
        </>
      )}
      {pendingDelete && (
        <DeleteStepDialog
          node={pendingDelete.node}
          dependents={pendingDelete.dependents}
          allNodes={boardNodes}
          onCancel={() => setPendingDelete(null)}
          onConfirm={(reattach) => {
            deleteNode(pendingDelete.node.id, { confirm: false, reattach });
            setPendingDelete(null);
          }}
        />
      )}

      {selectedNode && (
        <Drawer label="Edit step" onClose={() => setSelectedId(null)}>
          <NodeEditorPanel
            node={selectedNode}
            allNodes={boardNodes}
            blockedDependencyIds={cyclicDependencyIds(boardNodes, selectedId)}
            onSave={(id, draft) => {
              saveNode(id, draft);
              setSelectedId(null);
            }}
            onDelete={(id) => {
              // Removing a step other steps wait on changes the plan's
              // shape, so it asks where they go rather than silently
              // cutting the link.
              const dependents = boardNodes.filter((n) => (n.depends_on || []).includes(id));
              setSelectedId(null);
              if (dependents.length === 0) deleteNode(id);
              else setPendingDelete({ node: boardNodes.find((n) => n.id === id), dependents });
            }}
            materialsInfo={materialsInfo}
            onRegisterMaterial={(draft) => registerMaterial(draft, materialsInfo, selectedId)}
          />
        </Drawer>
      )}
    </section>
  );
}
