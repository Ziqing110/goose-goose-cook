// Inventory — stage "Recipe graph": the materials check and the step
// board on one page, left by approving (Claude Design handoff "Recipe
// graph page"). One input: uncheck what you're out of. Everything else
// — coverage, reach, blocked/at-risk steps — is derived in
// utils/inventory.js from the same availability rules the board uses.
// The "out" set is session state (session.outMaterialIds).
//
// Layout: coverage HUD on top (it describes the plan, not a tab), then
// two tabs — Ingredients and Recipe graph. The "What this changes" rail
// stands beside the checklist; on the recipe graph the board takes the
// full width and the rail comes back as a panel over it, which is also
// where a step is edited or added.
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "../state/AppStateContext.jsx";
import { useSessionRecipes } from "../state/useSessionRecipes.js";
import { mergeRecipesForDisplay, cyclicDependencyIds, cloneGraph } from "../utils/graphLayout.js";
import { missingEquipment, EQUIPMENT_LABELS } from "../utils/scheduleLayout.js";
import RecipeBoard from "../components/RecipeBoard.jsx";
import AddStepPanel from "../components/AddStepPanel.jsx";
import ApprovedPanel from "../components/ApprovedPanel.jsx";
import BoardPanel from "../components/BoardPanel.jsx";
import DeleteStepDialog from "../components/DeleteStepDialog.jsx";
import ImpactList, { ImpactMark } from "../components/ImpactList.jsx";
import Icon from "../components/Icon.jsx";
import KitchenProfileFormModal from "../components/KitchenProfileFormModal.jsx";
import NodeEditorPanel from "../components/NodeEditorPanel.jsx";
import { useStepEditing } from "../state/useStepEditing.js";
import { buildInventory, formatClock, formatStepDuration, PHASE_LABELS } from "../utils/inventory.js";
import dishMapoTofu from "../assets/dish-mapo-tofu.png";
import dishNoodleSoup from "../assets/dish-noodle-soup.png";
import "./InventoryPage.css";

// The system's two dish marks. Matched by title keyword; a dish with
// no mark simply shows none (the title carries the meaning).
function dishMarkFor(title) {
  const t = (title || "").toLowerCase();
  if (t.includes("tofu")) return dishMapoTofu;
  if (t.includes("noodle") || t.includes("soup")) return dishNoodleSoup;
  return null;
}

// The overlay panel's width plus its inset — what the board keeps clear.
const PANEL_RESERVE = 376 + 16;

const EQUIPMENT_GLYPH = { wok: "wok", oven: "oven", pot: "pot", stove_burner: "burner", cutting_board: "cutting-board" };
const withArticle = (label) => `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;

const pad2 = (n) => String(n).padStart(2, "0");

/** "01–03" for a run of consecutive step numbers, otherwise "01, 04". */
function numberRange(numbers) {
  const sorted = [...numbers].sort();
  const ints = sorted.map(Number);
  const consecutive = ints.every((n, i) => i === 0 || n === ints[i - 1] + 1);
  if (sorted.length > 2 && consecutive) return `${sorted[0]}–${sorted[sorted.length - 1]}`;
  if (sorted.length > 4) return `${sorted.slice(0, 3).join(", ")} +${sorted.length - 3}`;
  return sorted.join(", ");
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
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7.4 12.4l3.2 3.2 6-6.6" />
          </svg>
        )}
      </span>
    </button>
  );
}

// One step inside an ingredient's detail: the step, then its status
// (if it isn't craftable), then the per-dish split for a shared step.
function StepLine({ step, statusLine, delay }) {
  return (
    <div className="inv-step" style={{ animationDelay: `${delay}ms` }}>
      <span className="inv-step-main">
        <span className="inv-step-num mono">{step.number}</span>
        <span className={`inv-step-phase is-${step.phase}`}>
          <span className="inv-step-phase-dot" />
          {PHASE_LABELS[step.phase] || step.phase}
        </span>
        <span className="inv-step-label">{step.label}</span>
        <span className="inv-step-dur mono">{formatStepDuration(step.durationSec)}</span>
      </span>
      {statusLine && <span className={`inv-step-sub inv-step-status is-${step.status}`}>{statusLine}</span>}
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
    </div>
  );
}

// Step detail stays folded so the list reads as a checklist; a row
// opens on its disclosure, its text or a dish pill, and an "out" row
// opens itself (and lifts off the card) so the cook sees what they just
// affected.
function IngredientRow({ item, onToggle, statusLineFor, delay }) {
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
        <span className="inv-row-main">
          <span className="inv-row-title-line" onClick={() => setOpened((v) => !v)}>
            <span className="inv-row-title">{item.label}</span>
            {item.amount != null && (
              <span className="inv-row-amount mono">
                {item.amount} {item.unit}
              </span>
            )}
            {!onHand && <span className="inv-chip inv-chip-out">Out</span>}
            {item.isCustom && <span className="inv-chip inv-chip-added">Added by you</span>}
          </span>
          <span className="inv-row-meta">
            <span onClick={() => setOpened((v) => !v)}>
              used in {item.usedIn.length} {item.usedIn.length === 1 ? "step" : "steps"}
            </span>
            {item.dishes.map((d) => (
              <button
                key={d}
                type="button"
                className="inv-dish-pill"
                aria-controls={detailId}
                title={`Where ${item.label} goes in ${d}`}
                onClick={() => setOpened(true)}
              >
                {d}
              </button>
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      {expanded && (
        <div className="inv-row-detail" id={detailId}>
          {item.usedIn.map((step, i) => (
            <StepLine key={step.id} step={step} statusLine={statusLineFor(step)} delay={i * 60} />
          ))}
        </div>
      )}
    </li>
  );
}

export default function InventoryPage() {
  const { state, dispatch, editKitchenProfile } = useAppState();
  const session = state.session;
  const { recipes, sharedSteps = [], outMaterialIds = [] } = session;
  const { catalog, catalogError, retryCatalog } = useSessionRecipes();
  const [tab, setTab] = useState("ingredients");
  // The board panel: null, { mode: "impact" }, { mode: "edit", id } or
  // { mode: "add" }. Which card is open is view state — persisting it
  // meant a reload re-opened the editor on a step nobody had clicked.
  const [panel, setPanel] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [offscreen, setOffscreen] = useState({ left: [], right: [], other: [] });
  const [dismissedEquipment, setDismissedEquipment] = useState(null);
  const [editingKitchen, setEditingKitchen] = useState(false);
  const [kitchenError, setKitchenError] = useState(null);
  const tabRowRef = useRef(null);

  const inv = useMemo(
    () => buildInventory({ recipes, sharedSteps, catalog, outIds: outMaterialIds }),
    [recipes, sharedSteps, catalog, outMaterialIds]
  );

  // The same steps the ingredients are folded under, as a board.
  const { working, draft, approved } = useMemo(() => mergeRecipesForDisplay(recipes, sharedSteps), [recipes, sharedSteps]);
  const boardNodes = working.nodes || [];
  const nodeById = useMemo(() => Object.fromEntries(boardNodes.map((n) => [n.id, n])), [boardNodes]);

  // One source for status and numbering, so the HUD, bar, rail, rows
  // and board can't disagree.
  const { statusById, numberById, statusByNumber } = useMemo(() => {
    const statusMap = new Map(inv.steps.map((s) => [s.id, s.status]));
    const numberMap = new Map(inv.steps.map((s, i) => [s.id, pad2(i + 1)]));
    const byNumber = new Map(inv.steps.map((s, i) => [pad2(i + 1), s.status]));
    return { statusById: statusMap, numberById: numberMap, statusByNumber: byNumber };
  }, [inv.steps]);
  const statusOf = (id) => statusById.get(id) || "craftable";
  const numberOf = (id) => numberById.get(id) || "";
  const blockedIds = useMemo(() => inv.steps.filter((s) => s.status === "blocked").map((s) => s.id), [inv.steps]);

  const labelOfMaterial = useMemo(() => {
    const labels = Object.fromEntries(inv.ingredients.map((i) => [i.id, i.label]));
    return (id) => labels[id] || id;
  }, [inv.ingredients]);

  // "blocked — missing ginger, scallion" / "at risk — after 04 Bloom chili oil"
  const statusLineFor = (step) => {
    if (step.status === "craftable") return null;
    const out = new Set(outMaterialIds);
    const missing = (nodeById[step.id]?.required_materials || []).filter((m) => out.has(m)).map(labelOfMaterial);
    const badDeps = step.dependsOn.filter((d) => (statusByNumber.get(d.number) || "craftable") !== "craftable");
    const parts = [];
    if (missing.length) parts.push(<span key="m">missing {missing.join(", ")}</span>);
    if (badDeps.length) {
      parts.push(
        <span key="d">
          after{" "}
          {badDeps.map((d, i) => (
            <span key={d.number}>
              {i > 0 && ", "}
              <Mono>{d.number}</Mono> {d.label}
            </span>
          ))}
        </span>
      );
    }
    return (
      <>
        {step.status === "blocked" ? "blocked" : "at risk"}
        {parts.length > 0 && " — "}
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 && "; "}
            {p}
          </span>
        ))}
      </>
    );
  };

  const dishLabelFor = (node) =>
    node._shared ? "Shared" : recipes.find((r) => r.id === node._recipeId)?.working.title || null;
  const { addNode, saveNode, deleteNode, registerMaterial } = useStepEditing();
  // A step can carry materials the catalog doesn't know yet (added from
  // the editor), so the editor sees the catalog plus this run's own.
  const materialsInfo = { ...(catalog || {}), ...(working.custom_materials || {}) };

  const editingNode = !approved && panel?.mode === "edit" ? nodeById[panel.id] || null : null;
  const selectedId = editingNode?.id || null;
  const panelOpen = !approved && (panel?.mode === "impact" || panel?.mode === "add" || Boolean(editingNode));

  // Closing a step or the add form goes back to the impact list, if
  // there's anything on it; closing the list dismisses the panel.
  const closePanel = () => setPanel(panel?.mode !== "impact" && inv.impact.length > 0 ? { mode: "impact" } : null);
  const selectNode = (id) => {
    if (approved) return;
    if (selectedId === id) closePanel();
    else setPanel({ mode: "edit", id });
  };
  // A consequence takes you to its cause: the rail's rows open the step
  // on the board.
  // The board sits below the HUD, so bring it up to meet the click.
  const pickImpact = (id) => {
    setTab("graph");
    if (!approved) setPanel({ mode: "edit", id });
    requestAnimationFrame(() => {
      const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      tabRowRef.current?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
    });
  };

  // Approval is what the rest of the run reads: the schedule and the
  // live cook run off `approved`, never `working`, so editing a step
  // can't rewrite a plan someone is already cooking from.
  const kitchenProfile = state.kitchenProfiles.find((p) => p.id === session.kitchenProfileId) || null;
  const lacking = missingEquipment(boardNodes, kitchenProfile);
  const lackingKey = lacking.join(",");
  const showEquipment = lacking.length > 0 && dismissedEquipment !== lackingKey;
  const stepsNeedingLacking = boardNodes.filter((n) => (n.required_equipment || []).some((e) => lacking.includes(e))).length;
  const dishIsUndoable = blockedIds.length > 0;

  const approve = () => {
    recipes.forEach((r) =>
      dispatch({ type: "session/recipes/updateOne", payload: { recipeId: r.id, patch: { approved: cloneGraph(r.working) } } })
    );
    sharedSteps.forEach((st) =>
      dispatch({ type: "session/sharedSteps/updateOne", payload: { sharedStepId: st.id, patch: { approved: cloneGraph(st.working) } } })
    );
    setPanel(null);
  };
  const revise = () => {
    recipes.forEach((r) => dispatch({ type: "session/recipes/updateOne", payload: { recipeId: r.id, patch: { approved: null } } }));
    sharedSteps.forEach((st) => dispatch({ type: "session/sharedSteps/updateOne", payload: { sharedStepId: st.id, patch: { approved: null } } }));
  };

  // The escape hatch that makes the gate fair: drop what can't be done
  // and cook the rest. The blocked set is already the full closure.
  const dropBlockedSteps = () => {
    if (!blockedIds.length) return;
    if (!window.confirm(`Remove ${blockedIds.length} step${blockedIds.length === 1 ? "" : "s"} you can't do without those materials?`)) return;
    blockedIds.forEach((id) => deleteNode(id, { confirm: false }));
    setPanel(null);
  };

  const nodePositions = session.nodePositions || {};
  const moveNode = (id, at) =>
    dispatch({ type: "session/update", payload: { nodePositions: { ...nodePositions, [id]: at } } });

  const saveKitchen = async (kitchenDraft) => {
    setKitchenError(null);
    try {
      const { id, ...patch } = kitchenDraft;
      await editKitchenProfile(id, patch);
      setEditingKitchen(false);
    } catch (err) {
      setKitchenError(err.message);
    }
  };

  const hasDishes = recipes.length > 0;
  const hasOut = outMaterialIds.length > 0;
  const loading = hasDishes && !catalog && !catalogError;

  useEffect(() => {
    dispatch({
      type: "voice/setHint",
      payload: { hint: { line: "Tell me what you're out of — say “no ginger.”", sub: "Everything's on hand until you say otherwise." } },
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
    metaBits.push(inv.dishTitles.join(" · ") || inv.title);
    if (inv.servings != null) metaBits.push(<><Mono>{inv.servings}</Mono> servings</>);
    if (catalog) metaBits.push(<><Mono>{inv.ingredients.length}</Mono> ingredients</>);
    metaBits.push(<><Mono>{inv.stepCount}</Mono> steps</>);
    metaBits.push(<Mono>{formatClock(inv.totalSeconds)}</Mono>);
  }

  const legend = [`${coverage.craftable} craftable`];
  if (coverage.atRisk) legend.push(`${coverage.atRisk} at risk`);
  if (coverage.blocked) legend.push(`${coverage.blocked} blocked`);

  const allOnHand = inv.onHandCount === inv.ingredients.length;
  const dishMarks = inv.dishTitles.map((t) => ({ title: t, src: dishMarkFor(t) })).filter((d) => d.src);

  // Caption under the board: where the cards you can't see are.
  const hiddenCount = offscreen.left.length + offscreen.right.length + offscreen.other.length;
  let panHint = null;
  if (hiddenCount > 0) {
    const side = offscreen.left.length === hiddenCount ? "left" : offscreen.right.length === hiddenCount ? "right" : null;
    const ids = [...offscreen.left, ...offscreen.right, ...offscreen.other];
    panHint = side ? (
      <>
        <Mono>{numberRange(ids.map(numberOf))}</Mono> {hiddenCount === 1 ? "is" : "are"} off to the {side} — drag the board to pan
      </>
    ) : (
      <>
        <Mono>{hiddenCount}</Mono> {hiddenCount === 1 ? "step is" : "steps are"} out of view — drag the board to pan
      </>
    );
  }

  const counterTone = coverage.blocked > 0 ? "critical" : "warning";

  return (
    <section className="page inventory-page">
      <header className="inv-title-row">
        <div className="inv-title">
          <h1>Inventory</h1>
          {!hasDishes ? (
            <span className="inv-meta is-tertiary">
              The agent is still setting your dishes <span className="mono inv-dots">…</span>
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
          {/* ---- Coverage HUD: the whole plan, above both tabs ---- */}
          <div className="inv-hud">
            <span className={`inv-summary is-${coverage.tone}`}>{coverage.summary}</span>
            <div className="inv-stats">
              <div className="inv-stat">
                <span className={`inv-stat-value mono inv-roll${allOnHand ? " is-done" : ""}`} style={{ animationDelay: "300ms" }}>
                  {inv.onHandCount}
                  <span className="inv-stat-sep"> / </span>
                  {inv.ingredients.length}
                </span>
                <span className="inv-stat-label">
                  <span className="inv-long">ingredients </span>on hand
                </span>
              </div>
              <div className="inv-stat">
                <span className={`inv-stat-value mono inv-roll ${coverage.atRisk > 0 ? "is-warning" : "is-zero"}`} style={{ animationDelay: "360ms" }}>
                  {coverage.atRisk}
                </span>
                <span className="inv-stat-label">
                  <span className="inv-long">steps </span>at risk
                </span>
              </div>
              <div className="inv-stat">
                <span className={`inv-stat-value mono inv-roll ${coverage.blocked > 0 ? "is-critical" : "is-zero"}`} style={{ animationDelay: "420ms" }}>
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
                role="progressbar"
                aria-label={`${coverage.craftable} of ${coverage.total} steps craftable, ${coverage.atRisk} at risk, ${coverage.blocked} blocked`}
                aria-valuemin={0}
                aria-valuemax={coverage.total}
                aria-valuenow={coverage.craftable}
              >
                {inv.steps.map((s) => (
                  <span key={s.id} className={`inv-stepbar-seg is-${s.status}`} />
                ))}
              </div>
              <span className="mono inv-stepbar-legend">{legend.join(" · ")}</span>
            </div>
          </div>

          {approved && <ApprovedPanel draft={draft} approved={approved} onRevise={revise} />}

          <div className={`inv-split is-${tab}`}>
            <div className="inv-main">
              {/* ---- Tabs + the active tab's controls ---- */}
              <div className="inv-tabrow" ref={tabRowRef}>
                <div className="inv-tabs" role="tablist" aria-label="Inventory view">
                  {[
                    { key: "ingredients", label: "Ingredients", count: inv.ingredients.length },
                    { key: "graph", label: "Recipe graph", count: inv.stepCount },
                  ].map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      role="tab"
                      id={`inv-tab-${t.key}`}
                      aria-selected={tab === t.key}
                      aria-controls={`inv-tabpanel-${t.key}`}
                      className={`inv-tab${tab === t.key ? " is-active" : ""}`}
                      onClick={() => setTab(t.key)}
                    >
                      {t.label}
                      <span className="inv-tab-count mono">{t.count}</span>
                    </button>
                  ))}
                </div>
                <div className="inv-tabrow-end">
                  {tab === "ingredients" ? (
                    <span className="inv-hint">Uncheck whatever you&rsquo;re out of.</span>
                  ) : approved ? (
                    <span className="inv-hint">Approved &mdash; revise the plan to change a step.</span>
                  ) : (
                    <>
                      <span className="inv-hint inv-hint-board">Drag a card to move it. Click one to edit.</span>
                      {inv.impact.length > 0 && (
                        <button
                          type="button"
                          className={`inv-status-counter is-${counterTone}`}
                          aria-pressed={panel?.mode === "impact"}
                          onClick={() => setPanel(panel?.mode === "impact" ? null : { mode: "impact" })}
                        >
                          {coverage.blocked > 0 && (
                            <span className="inv-counter-part">
                              <span className="inv-counter-dot is-blocked" aria-hidden="true" />
                              {coverage.blocked} blocked
                            </span>
                          )}
                          {coverage.atRisk > 0 && (
                            <span className="inv-counter-part">
                              <span className="inv-counter-dot is-atRisk" aria-hidden="true" />
                              {coverage.atRisk} at risk
                            </span>
                          )}
                        </button>
                      )}
                      <button type="button" className="btn inv-add-btn" aria-pressed={panel?.mode === "add"} onClick={() => setPanel({ mode: "add" })}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                        Add a task
                      </button>
                    </>
                  )}
                </div>
              </div>

              {showEquipment && (
                <div className="inv-equip" role="note">
                  <span className="inv-equip-glyph" aria-hidden="true">
                    <Icon glyph={EQUIPMENT_GLYPH[lacking[0]] || "flame"} size={24} />
                  </span>
                  <div className="inv-equip-main">
                    <span className="inv-equip-title">
                      Planned with {lacking.map((e) => withArticle(EQUIPMENT_LABELS[e] || e)).join(" and ")} you don&rsquo;t have
                    </span>
                    <span className="inv-equip-body">
                      {stepsNeedingLacking} {stepsNeedingLacking === 1 ? "step asks" : "steps ask"} for{" "}
                      {lacking.length === 1 ? "it" : "them"}. {kitchenProfile?.name || "Your kitchen"} doesn&rsquo;t list{" "}
                      {lacking.length === 1 ? "one" : "them"}, so the timings assume one anyway &mdash; those steps may run slower
                      than the plan says.
                    </span>
                    <div className="inv-equip-actions">
                      {kitchenProfile && (
                        <button type="button" className="btn inv-equip-edit" onClick={() => setEditingKitchen(true)}>
                          Edit kitchen profile
                        </button>
                      )}
                      <button type="button" className="btn inv-equip-dismiss" onClick={() => setDismissedEquipment(lackingKey)}>
                        Cook it anyway
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {tab === "ingredients" ? (
                <div className="inv-groups" role="tabpanel" id="inv-tabpanel-ingredients" aria-labelledby="inv-tab-ingredients">
                  {inv.groups.map((g, gi) => {
                    const onHand = g.items.filter((i) => !i.out).length;
                    return (
                      <section key={g.key} className="inv-card" style={{ animationDelay: `${160 + gi * 60}ms` }} aria-labelledby={`inv-group-${g.key}`}>
                        <div className="inv-card-head">
                          <span id={`inv-group-${g.key}`} className="inv-card-title">
                            {g.label}
                          </span>
                          <span className={`mono inv-card-count${onHand === g.items.length ? " is-done" : ""}`}>
                            {g.items.length} · {onHand === g.items.length ? "all" : onHand} on hand
                          </span>
                        </div>
                        <ul className="inv-list">
                          {g.items.map((item, i) => (
                            <IngredientRow
                              key={item.id}
                              item={item}
                              onToggle={() => toggle(item.id)}
                              statusLineFor={statusLineFor}
                              delay={220 + gi * 60 + i * 60}
                            />
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="inv-board-wrap" role="tabpanel" id="inv-tabpanel-graph" aria-labelledby="inv-tab-graph">
                  <div className="inv-board">
                    <RecipeBoard
                      nodes={boardNodes}
                      positions={nodePositions}
                      selectedNodeId={selectedId}
                      dishLabelFor={dishLabelFor}
                      statusOf={statusOf}
                      numberOf={numberOf}
                      onSelect={selectNode}
                      onMove={moveNode}
                      reserveRight={panelOpen ? PANEL_RESERVE : 0}
                      onOffscreen={setOffscreen}
                    />

                    {!approved && panel?.mode === "impact" && (
                      <BoardPanel
                        label="What this changes"
                        title="What this changes"
                        tone="ai"
                        mark={<ImpactMark />}
                        onClose={() => setPanel(null)}
                      >
                        <ImpactList entries={inv.impact} onPick={pickImpact} hint="Click a step to select it on the board." />
                      </BoardPanel>
                    )}

                    {editingNode && (
                      <NodeEditorPanel
                        node={editingNode}
                        allNodes={boardNodes}
                        numberOf={numberOf}
                        blockedDependencyIds={cyclicDependencyIds(boardNodes, editingNode.id)}
                        onClose={closePanel}
                        onSave={(id, nodeDraft) => {
                          saveNode(id, nodeDraft);
                          closePanel();
                        }}
                        onDelete={(id) => {
                          // Removing a step other steps wait on changes the
                          // plan's shape, so it asks where they go rather
                          // than silently cutting the link.
                          const dependents = boardNodes.filter((n) => (n.depends_on || []).includes(id));
                          closePanel();
                          if (dependents.length === 0) deleteNode(id);
                          else setPendingDelete({ node: nodeById[id], dependents });
                        }}
                        materialsInfo={materialsInfo}
                        onRegisterMaterial={(materialDraft) => registerMaterial(materialDraft, materialsInfo, editingNode.id)}
                      />
                    )}

                    {!approved && panel?.mode === "add" && (
                      <AddStepPanel
                        recipes={recipes}
                        nodes={boardNodes}
                        numberOf={numberOf}
                        onClose={closePanel}
                        onAdd={(recipeId, spec) => {
                          const id = addNode(recipeId, spec);
                          // Open the new card for the rest of its details.
                          if (id) setPanel({ mode: "edit", id });
                        }}
                      />
                    )}
                  </div>

                  <div className="inv-board-caption">
                    <span className="inv-board-count">
                      <span>
                        <Mono>{boardNodes.length}</Mono> {boardNodes.length === 1 ? "step" : "steps"} on the board
                      </span>
                      {panHint && <span className="inv-board-pan">{panHint}</span>}
                    </span>
                    <span className="inv-phase-legend" aria-label="Phase colours">
                      {["prep", "cook", "plate"].map((p) => (
                        <span key={p} className={`inv-phase-key is-${p}`}>
                          <span className="inv-phase-swatch" aria-hidden="true" />
                          {PHASE_LABELS[p]}
                        </span>
                      ))}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* ---- The rail: stands beside the checklist only ---- */}
            {tab === "ingredients" && (
              <aside className="inv-rail" aria-labelledby="inv-rail-title">
                <div className="inv-rail-inner">
                  <header className="inv-rail-head">
                    <ImpactMark />
                    <span id="inv-rail-title" className="inv-rail-title">
                      What this changes
                    </span>
                    <span className="inv-rail-count mono">{inv.impact.length}</span>
                  </header>
                  <div className="inv-rail-body">
                    <ImpactList entries={inv.impact} onPick={pickImpact} hint="Click a step to find it on the recipe graph." />
                  </div>
                </div>
              </aside>
            )}
          </div>

          {/* ---- Footer band ---- */}
          <div className="inv-footer">
            <span className="mono inv-footer-tag">
              {coverage.craftable} of {coverage.total} steps craftable
            </span>
            <div className="inv-footer-actions">
              {hasOut && (
                <button type="button" className="btn inv-footer-secondary" onClick={markAllOnHand}>
                  Mark everything on hand
                </button>
              )}
              {!approved && dishIsUndoable && (
                <button type="button" className="btn inv-footer-secondary inv-btn-remove" onClick={dropBlockedSteps}>
                  Remove the blocked {blockedIds.length === 1 ? "step" : "steps"}
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

      {editingKitchen && kitchenProfile && (
        <KitchenProfileFormModal
          profile={kitchenProfile}
          error={kitchenError}
          onSave={saveKitchen}
          onClose={() => {
            setEditingKitchen(false);
            setKitchenError(null);
          }}
        />
      )}
    </section>
  );
}
