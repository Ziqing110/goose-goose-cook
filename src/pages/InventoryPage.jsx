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
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { useSessionRecipes } from "../state/useSessionRecipes.js";
import { mergeRecipesForDisplay, cyclicDependencyIds, cloneGraph } from "../utils/graphLayout.js";
import { missingEquipment, EQUIPMENT_LABELS } from "../utils/scheduleLayout.js";
import RecipeBoard from "../components/RecipeBoard.jsx";
import AddStepPanel from "../components/AddStepPanel.jsx";
import ApprovedPanel from "../components/ApprovedPanel.jsx";
import DeleteStepDialog from "../components/DeleteStepDialog.jsx";
import ImpactList, { ImpactMark } from "../components/ImpactList.jsx";
import Icon from "../components/Icon.jsx";
import KitchenProfileFormModal from "../components/KitchenProfileFormModal.jsx";
import ChefWorkingScreen from "../components/ChefWorkingScreen.jsx";
import { devPreview } from "../dev/preview.js";
import NodeEditorPanel from "../components/NodeEditorPanel.jsx";
import { useStepEditing } from "../state/useStepEditing.js";
import { buildInventory, formatClock, formatStepDuration, PHASE_LABELS } from "../utils/inventory.js";
import { groupStepsByDish, dishPaper, SHARED_PAPER } from "../utils/ingredientGroups.js";
import { categoryIconPaths } from "../utils/categoryIcons.js";
import { GooseProfile } from "../components/GooseMarks.jsx";
import gooseBanner from "../assets/goose-banner.png";
import "./InventoryPage.css";

// How long the thumbs-up frame holds once the recipes land.
const WORKING_DONE_MS = 700;
import { registerVoiceCommands } from "../utils/voicePageCommands.js";
import { normalizeUtterance, CONFIRM_YES_PATTERN, CONFIRM_NO_PATTERN } from "../utils/navCommands.js";
import { matchStepName } from "../utils/stepNameMatch.js";
import { INVENTORY_VOICE, ingredientVoicePhrases, parseAddTaskSpeech } from "../utils/pageVoiceGrammar.js";

// One banner beside the title, whatever the dishes are. It replaces the
// pair of dish marks: two illustrations competed with each other and
// with the title, and neither said anything the title doesn't.
// Served from public/ rather than imported, so a missing file is an
// empty space rather than a failed build.
// The goose and its basket, beside the title. One banner rather than
// the pair of dish marks: two illustrations competed with each other and
// with the title, and said nothing the title doesn't.
const HEADER_BANNER = gooseBanner;

// A webbed print, the goose's own tick. Small enough to sit in a line
// of type, so the verdict stamp reads as pressed on rather than printed.
const PAW_PATH =
  "M13 3.2c1.6 0 2.2 1.6 2.4 3.4l.5 4.6c.1 1.2 1 1.6 2 1.1l3.6-1.8c1.6-.8 2.8.6 1.7 2L14.9 25c-1 1.3-2.6 1.3-3.5 0L2.9 12.6c-1-1.4.2-2.8 1.8-2l3.5 1.8c1 .5 1.9.1 2-1.1l.5-4.6C10.9 4.8 11.4 3.2 13 3.2Z";

// Pressed into the panel when the basket is full: wax, dashes, a paw and
// the goose's own word for it.
function HonkSeal() {
  return (
    <span className="inv-seal" aria-hidden="true">
      <svg viewBox="0 0 100 100" width="92" height="92">
        <path
          d="M50 4.5 61 10 73.5 8.2 80.6 18.3 92 23.5 90.8 35.9 96.5 47 89.2 57.2 90 69.6 78.4 74.3 71.9 84.9 59.6 83.6 50 91.5 40.4 83.6 28.1 84.9 21.6 74.3 10 69.6 10.8 57.2 3.5 47 9.2 35.9 8 23.5 19.4 18.3 26.5 8.2 39 10Z"
          fill="#b8461f"
        />
        <circle cx="50" cy="50" r="33" fill="none" stroke="#f0d7cd" strokeWidth="1.6" strokeDasharray="4 4" opacity="0.85" />
        <path
          d="M50 30.5c2.6 0 3.6 2.6 3.9 5.5l.8 7.5c.2 1.9 1.6 2.6 3.2 1.8l5.9-2.9c2.6-1.3 4.6 1 2.8 3.2L53.1 65.4c-1.6 2.1-4.2 2.1-5.7 0L31.4 45.6c-1.7-2.2.3-4.5 2.9-3.2l5.7 2.9c1.6.8 3.1.1 3.2-1.8l.8-7.5c.4-2.9 1.4-5.5 4-5.5Z"
          fill="#fdeada"
        />
        <text x="50" y="74" textAnchor="middle" className="inv-seal-word">
          HONK
        </text>
      </svg>
    </span>
  );
}

// The overlay panel's width plus its inset — what the board keeps clear.
// Must track .board-panel's own width in BoardPanel.css.
const PANEL_RESERVE = 412 + 16;

// The zoom slider reads 0% at "everything visible" and counts up from
// there, so the number means how far past the fitted view you are —
// the fitted scale itself is a different figure for every dish, and
// showing it (69%, 84%…) only invited "why can't I go lower?".
const ZOOM_STEP = 5;
/** How far in the slider can go: half again over the fitted view. */
const zoomCeiling = (fit) => Math.max(1.5, fit + 0.5);

const EQUIPMENT_GLYPH = { wok: "wok", oven: "oven", pot: "pot", stove_burner: "burner", cutting_board: "cutting-board" };
const withArticle = (label) => `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * One "out" and one "on hand" command per ingredient, matched against its
 * full name. Unlike the kitchen picker's bare distinctive word, these
 * always require a trigger phrase — this page isn't asking "which
 * ingredient", so a bare mention of "ginger" in conversation must not
 * flip anything.
 */
function ingredientVoiceCommands(items, { markOut, markOnHand }) {
  return items.flatMap((item) => {
    const name = normalizeUtterance(item.label);
    if (!name) return [];
    const phrases = ingredientVoicePhrases(name);
    // allowSubject: every phrase names the ingredient, so "I have ginger"
    // is the cook talking to the app. Without it the subject read as two
    // people chatting, and the most natural ways of saying either — "I
    // have ginger", "we're out of ginger" — did nothing.
    return [
      { phrases: phrases.out, allowSubject: true, label: `${item.label} — marked out.`, run: () => markOut(item.id) },
      {
        phrases: phrases.onHand,
        allowSubject: true,
        label: `${item.label} — back on hand.`,
        run: () => markOnHand(item.id, item.label),
      },
    ];
  });
}

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

function Checkbox({ checked, label, onChange, disabled = false }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={`${label} — ${checked ? "on hand" : "out"}`}
      className={`inv-check ${checked ? "is-on" : ""}`}
      disabled={disabled}
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
        <Mono>
          <span className={`inv-step-dur ${step.attended === false ? "is-unattended" : ""}`}>
            {formatStepDuration(step.durationSec)}
            {step.attended === false && " unattended"}
          </span>
        </Mono>
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
/* The line icon at the head of an ingredient category, from the design
   system's own set — see utils/categoryIcons.js. */
function CategoryMark({ category }) {
  const paths = categoryIconPaths(category);
  if (!paths.length) return null;
  return (
    <svg
      className="inv-card-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

function IngredientRow({ item, onToggle, statusLineFor, dishTitles, delay, locked = false }) {
  const onHand = !item.out;
  const [opened, setOpened] = useState(false);
  const expanded = !onHand || opened;
  const detailId = `inv-detail-${item.id}`;
  const reachText = `${item.reach} ${item.reach === 1 ? "step" : "steps"}`;
  const reachTitle = onHand ? `Missing this would affect ${reachText}` : `Missing — affects ${reachText}`;
  const toggleOpen = () => setOpened((v) => !v);
  // Which dish each step belongs to, in dish order with the shared
  // steps last. One group means the heading says nothing the row
  // doesn't, so it isn't drawn.
  const groups = groupStepsByDish(item.usedIn, dishTitles);
  return (
    <li className={`inv-row ${onHand ? "" : "is-out"} ${expanded ? "is-open" : ""}`} style={{ animationDelay: `${delay}ms` }}>
      <div className="inv-row-head">
        <Checkbox checked={onHand} label={item.label} onChange={onToggle} disabled={locked} />
        <span className="inv-row-main">
          <span className="inv-row-title-line" onClick={toggleOpen}>
            <span className="inv-row-title">{item.label}</span>
            {item.amount != null && (
              <span className="inv-row-amount mono">
                {item.amount} {item.unit}
              </span>
            )}
            {!onHand && <span className="inv-chip inv-chip-out">Out</span>}
            {item.isCustom && <span className="inv-chip inv-chip-added">Added by you</span>}
          </span>
          {/* The dish names are a label, not a filter. Filtering by dish
              here answered a question nobody had — an ingredient's
              steps are worth seeing together — and cost a click before
              the steps appeared at all. */}
          <span className="inv-row-meta" onClick={toggleOpen}>
            <span>
              used in {item.usedIn.length} {item.usedIn.length === 1 ? "step" : "steps"}
            </span>
            {item.usesEveryDish ? (
              <span className="inv-dish-pill" title={item.dishes.join(", ")}>
                All &middot; {item.dishes.length} dishes
              </span>
            ) : (
              item.dishes.map((d) => (
                <span key={d} className="inv-dish-pill">
                  {d}
                </span>
              ))
            )}
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
          onClick={toggleOpen}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      {expanded && (
        <div className="inv-row-detail" id={detailId}>
          {groups.map((group, gi) => (
            <div key={group.name} className="inv-step-group">
              {groups.length > 1 && (
                <span className="inv-step-group-head">
                  <span
                    className="inv-step-group-swatch"
                    aria-hidden="true"
                    style={{ background: group.paper.bg, border: group.paper.border }}
                  />
                  <span className="mono inv-step-group-name">{group.name}</span>
                  <span className="mono inv-step-group-count">
                    {group.count} {group.count === 1 ? "step" : "steps"}
                  </span>
                </span>
              )}
              {group.steps.map((step, i) => (
                <StepLine key={step.id} step={step} statusLine={statusLineFor(step)} delay={(gi * 2 + i) * 60} />
              ))}
            </div>
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
  const { catalog, catalogError, retryCatalog, generating } = useSessionRecipes();
  const navigate = useNavigate();
  const [tab, setTab] = useState("ingredients");
  // The board panel: null, { mode: "edit", id } or { mode: "add" }.
  // Which card is open is view state — persisting it meant a reload
  // re-opened the editor on a step nobody had clicked.
  const [panel, setPanel] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  // A voice guess waiting on a yes/no before it acts — a "before X" /
  // "between X and Y" task position, or which step "open X" meant.
  // { question, onYes, onNo }, or null when nothing is pending.
  const [pendingConfirm, setPendingConfirm] = useState(null);
  const [offscreen, setOffscreen] = useState({ left: [], right: [], other: [] });
  const [dismissedEquipment, setDismissedEquipment] = useState(null);
  // null = let the board fit itself to the frame; a number is the
  // cook's own zoom, from the slider under the board.
  const [zoom, setZoom] = useState(null);
  const [fitScale, setFitScale] = useState(1);
  const [editingKitchen, setEditingKitchen] = useState(false);
  const [kitchenError, setKitchenError] = useState(null);
  const tabRowRef = useRef(null);
  // What the dish key on the board actually takes. Six dishes wrap it
  // onto three lines, and the first column of cards has to start below
  // whatever it ends up being.
  const paperLegendRef = useRef(null);
  const [legendKeepOut, setLegendKeepOut] = useState(0);
  const boardRef = useRef(null);
  useEffect(() => {
    const el = paperLegendRef.current;
    if (!el) {
      setLegendKeepOut(0);
      return undefined;
    }
    const measure = () => setLegendKeepOut(Math.round(el.getBoundingClientRect().height) + 10);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // The key only exists on the graph tab; once it is there, the
    // observer covers every reason its height changes — another dish,
    // a narrower board, a longer name.
  }, [tab]);

  // 0% is the fitted view; 100% is the ceiling above. Computed up here
  // (not just before the JSX that reads it) so the voice commands below
  // can drive the same zoom the slider does.
  const zoomTop = zoomCeiling(fitScale);
  const zoomPct = Math.round((((zoom ?? fitScale) - fitScale) / (zoomTop - fitScale)) * 100);
  const setZoomPct = (pct) => setZoom(pct <= 0 ? null : fitScale + (pct / 100) * (zoomTop - fitScale));

  const inv = useMemo(
    () => buildInventory({ recipes, sharedSteps, catalog, outIds: outMaterialIds }),
    [recipes, sharedSteps, catalog, outMaterialIds]
  );

  // The same steps the ingredients are folded under, as a board.
  const { working, draft, approved } = useMemo(() => mergeRecipesForDisplay(recipes, sharedSteps), [recipes, sharedSteps]);
  // Memoised rather than defaulted inline: `working.nodes || []` hands
  // back a fresh array on every render whenever nodes is empty, which
  // would rebuild everything keyed on it for no reason.
  const boardNodes = useMemo(() => working.nodes || [], [working.nodes]);
  const nodeById = useMemo(() => Object.fromEntries(boardNodes.map((n) => [n.id, n])), [boardNodes]);
  // The legend only names the shared sheet when a step is actually on it.
  const hasSharedStep = useMemo(() => boardNodes.some((n) => n._shared), [boardNodes]);

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

  // Which stock a step's slip is cut from: its dish's paper, or the
  // dashed white sheet for one both dishes share.
  const paperFor = (node) => (node._shared ? SHARED_PAPER : dishPaper(recipes.find((r) => r.id === node._recipeId)?.working.title, inv.dishTitles));
  const dishLabelFor = (node) =>
    node._shared ? "Shared" : recipes.find((r) => r.id === node._recipeId)?.working.title || null;
  const { addNode, saveNode, deleteNode, deleteNodes, linkNodes, unlinkNodes, registerMaterial } = useStepEditing();
  // A step can carry materials the catalog doesn't know yet (added from
  // the editor), so the editor sees the catalog plus this run's own.
  const materialsInfo = { ...(catalog || {}), ...(working.custom_materials || {}) };

  const editingNode = !approved && panel?.mode === "edit" ? nodeById[panel.id] || null : null;
  const selectedId = editingNode?.id || null;
  const panelOpen = !approved && (panel?.mode === "add" || Boolean(editingNode));

  const closePanel = () => setPanel(null);
  const selectNode = (id) => {
    if (approved) return;
    if (selectedId === id) closePanel();
    else setPanel({ mode: "edit", id });
  };
  // The board is as tall as what's left of the viewport, so it only
  // fits once the tab row is at the top — otherwise its last row ends
  // up under the sticky footer.
  const showTab = (key) => {
    setTab(key);
    if (key !== "graph") return;
    requestAnimationFrame(() => {
      const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      tabRowRef.current?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
    });
  };

  // A consequence takes you to its cause: the rail's rows open the step
  // on the board.
  const pickImpact = (id) => {
    showTab("graph");
    if (!approved) setPanel({ mode: "edit", id });
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

  // The voice equivalent of the "Approve the plan" button, in the
  // same words printed on it. It doesn't ask first: approving only
  // locks the board, it doesn't leave the page, and "revise" undoes it
  // in one word — a yes/no on top of that was a second approval. It
  // refuses while a step is blocked, exactly as the button does when
  // disabled, and says why rather than quietly doing nothing.
  useEffect(() => {
    // Nothing to approve while the board is still being generated.
    if (recipes.length === 0) return undefined;
    return registerVoiceCommands([
      {
        phrases: INVENTORY_VOICE.approve,
        run: () => {
          if (approved) return "Already approved. Say “continue” to pick the cooks.";
          if (dishIsUndoable) {
            const n = blockedIds.length;
            return `Can't approve yet — ${n} ${n === 1 ? "step is" : "steps are"} blocked. Put the missing ingredients back, or say “remove the blocked steps.”`;
          }
          approve();
          return "Approved. Say “continue” to pick the cooks, or “revise” to change it.";
        },
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approved, dishIsUndoable, blockedIds, recipes.length]);

  const revise = () => {
    recipes.forEach((r) => dispatch({ type: "session/recipes/updateOne", payload: { recipeId: r.id, patch: { approved: null } } }));
    sharedSteps.forEach((st) => dispatch({ type: "session/sharedSteps/updateOne", payload: { sharedStepId: st.id, patch: { approved: null } } }));
  };

  // The escape hatch that makes the gate fair: drop what can't be done
  // and cook the rest. The blocked set is already the full closure.
  const dropBlockedSteps = () => {
    if (!blockedIds.length) return;
    if (!window.confirm(`Remove ${blockedIds.length} step${blockedIds.length === 1 ? "" : "s"} you can't do without those materials?`)) return;
    deleteNodes(blockedIds);
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
  const loading = hasDishes && !catalog && !catalogError;

  // The chef-at-work beat covers recipe generation, which is the one
  // real wait in the flow (the better part of a minute for two dishes).
  // "writing" → "done" → null: the thumbs-up frame holds for a beat
  // once the dishes land, then the board takes over. Starts skipped
  // when the recipes are already there (coming back from Schedule).
  const [beat, setBeat] = useState(() => (hasDishes ? null : "writing"));
  useEffect(() => {
    if (beat === "writing" && hasDishes) setBeat("done");
  }, [beat, hasDishes]);
  useEffect(() => {
    if (beat !== "done") return undefined;
    const t = setTimeout(() => setBeat(null), WORKING_DONE_MS);
    return () => clearTimeout(t);
  }, [beat]);

  useEffect(() => {
    // Nothing on this page takes voice yet while the board is still being
    // written — advertising ingredient/approve commands over an empty
    // page is the same bug the "approve" gate above exists to avoid.
    if (!hasDishes || loading) {
      dispatch({ type: "voice/setHint", payload: { hint: { line: "Writing your recipes — one moment.", sub: null } } });
      return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
    }
    dispatch({
      type: "voice/setHint",
      payload: {
        hint: approved
          ? { line: "Approved. Say “continue” to pick the cooks.", sub: "Or “revise” to change the plan." }
          : {
              line: "Tell me what you're out of — say “no ginger.”",
              sub: "Changed your mind? Say “add ginger back.” You can also say “add a task.”",
            },
      },
    });
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [dispatch, hasDishes, loading, approved]);

  // What's on hand is part of the plan: once it's approved the checklist
  // is as locked as the board, and revising unlocks both. Leaving it
  // editable let an approved plan pick up blocked steps behind its back.
  const APPROVED_LOCK = "The plan's approved — say “revise” to change what's on hand.";
  const setOut = (ids) => dispatch({ type: "session/update", payload: { outMaterialIds: ids } });
  const toggle = (id) => {
    if (approved) return;
    const next = new Set(outMaterialIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setOut([...next]);
  };
  // Voice says which state it wants, not "flip whatever this is" — saying
  // "got ginger" while it's already on hand should do nothing, not put
  // it back out.
  const markOut = (id) => {
    if (approved) return APPROVED_LOCK;
    if (!outMaterialIds.includes(id)) setOut([...outMaterialIds, id]);
    return undefined;
  };
  const markOnHand = (id, label) => {
    if (approved) return APPROVED_LOCK;
    if (!outMaterialIds.includes(id)) return label ? `${label} is already on hand.` : undefined;
    setOut(outMaterialIds.filter((x) => x !== id));
    return undefined;
  };
  // The ingredient most recently marked out that is still on the list:
  // what "put it back" means. outMaterialIds is in the order they went out.
  const lastOut = () => {
    const listed = new Set(inv.ingredients.map((i) => i.id));
    return [...outMaterialIds].reverse().find((id) => listed.has(id)) || null;
  };

  // Mirrors the checkboxes and the "Add a task" button: everything voice
  // can do here is something a click already does, said in the words the
  // hint promises ("say 'no ginger'") instead of promising and ignoring.
  useEffect(() => {
    if (!hasDishes || !catalog) return undefined;
    return registerVoiceCommands([
      ...ingredientVoiceCommands(inv.ingredients, { markOut, markOnHand }),
      {
        phrases: INVENTORY_VOICE.restoreLast,
        allowSubject: true,
        run: () => {
          if (approved) return APPROVED_LOCK;
          const id = lastOut();
          if (!id) return "Nothing's marked out.";
          markOnHand(id);
          return `${labelOfMaterial(id)} — back on hand.`;
        },
      },
      {
        // The button only shows on the recipe graph tab, but the command
        // works from either — it switches tabs itself rather than
        // silently doing nothing because you were looking at ingredients.
        // Everything after "task"/"step" is captured whole and handed to
        // parseAddTaskSpeech, rather than only recognising the name — a
        // position clause ("before X", "between X and Y") lives out here
        // too.
        phrases: INVENTORY_VOICE.addTask,
        run: (m) => {
          if (approved) return "The plan's approved — revise it to add a task.";
          const { name, before, between } = parseAddTaskSpeech((m?.[1] || "").trim());
          showTab("graph");

          const openWith = (position) => setPanel({ mode: "add", initialLabel: name, ...position });

          if (!before && !between) {
            openWith({});
            return name ? `Opening the task form for “${name}.”` : "Opening the task form.";
          }

          const ids = boardNodes.map((n) => n.id);
          const labelOf = (id) => nodeById[id]?.label;

          // "Cut the yellow onion" and "Cut the red onion" read alike —
          // an exact match wires the position straight through; anything
          // closer to a guess (a word dropped, one swapped for something
          // similar) asks first instead of routing the new step to
          // whichever one it happened to score higher.
          if (between) {
            const [mx, my] = between.map((text) => matchStepName(text, ids, labelOf));
            if (mx.confidence === "none" || my.confidence === "none") {
              openWith({});
              return "Opening the task form — I couldn't tell which two steps “between” means, so pick them there.";
            }
            const position = { initialDependsOn: [mx.stepId], initialRunsBefore: [my.stepId] };
            if (mx.confidence === "exact" && my.confidence === "exact") {
              openWith(position);
              return `Opening the task form, between “${mx.label}” and “${my.label}.”`;
            }
            const question = `Between “${mx.label}” and “${my.label}”? Say yes or no.`;
            setPendingConfirm({ question, onYes: () => openWith(position), onNo: () => openWith({}) });
            return question;
          }

          const mb = matchStepName(before, ids, labelOf);
          if (mb.confidence === "none") {
            openWith({});
            return "Opening the task form — I couldn't tell which step “before” means, so pick it there.";
          }
          const position = { initialRunsBefore: [mb.stepId] };
          if (mb.confidence === "exact") {
            openWith(position);
            return `Opening the task form, before “${mb.label}.”`;
          }
          const question = `Before “${mb.label}”? Say yes or no.`;
          setPendingConfirm({ question, onYes: () => openWith(position), onNo: () => openWith({}) });
          return question;
        },
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDishes, catalog, inv.ingredients, outMaterialIds, approved, boardNodes, nodeById]);

  // Board-level commands: switching tabs, opening a step by name, the
  // kitchen-shortfall notice, dropping blocked steps, and un-approving.
  // Everything here mirrors a button already on the page, in its words.
  useEffect(() => {
    if (!hasDishes || !catalog) return undefined;
    const commands = [
      {
        phrases: INVENTORY_VOICE.showIngredients,
        label: "Showing ingredients.",
        run: () => showTab("ingredients"),
      },
      {
        phrases: INVENTORY_VOICE.showGraph,
        label: "Showing the recipe graph.",
        run: () => showTab("graph"),
      },
      {
        phrases: INVENTORY_VOICE.zoomIn,
        run: () => {
          showTab("graph");
          if (zoomPct >= 100) return "Already as close as it goes.";
          setZoomPct(Math.min(100, zoomPct + ZOOM_STEP));
          return null;
        },
      },
      {
        phrases: INVENTORY_VOICE.zoomOut,
        run: () => {
          showTab("graph");
          if (zoomPct <= 0) return "Already fitted.";
          setZoomPct(Math.max(0, zoomPct - ZOOM_STEP));
          return null;
        },
      },
      {
        phrases: INVENTORY_VOICE.fit,
        label: "Fitted.",
        run: () => {
          showTab("graph");
          setZoom(null);
        },
      },
      {
        phrases: INVENTORY_VOICE.panRight,
        run: () => {
          showTab("graph");
          boardRef.current?.scrollBy(320, 0);
        },
      },
      {
        phrases: INVENTORY_VOICE.panLeft,
        run: () => {
          showTab("graph");
          boardRef.current?.scrollBy(-320, 0);
        },
      },
      {
        phrases: INVENTORY_VOICE.panVertical,
        run: (m) => {
          showTab("graph");
          const down = /down/.test(m[0]);
          boardRef.current?.scrollBy(0, down ? 320 : -320);
        },
      },
      {
        phrases: INVENTORY_VOICE.findStep,
        run: (m) => {
          showTab("graph");
          const said = (m?.[1] || "").trim();
          const ids = boardNodes.map((n) => n.id);
          const labelOf = (id) => nodeById[id]?.label;
          const match = matchStepName(said, ids, labelOf);
          if (match.confidence === "none") return "I couldn't tell which step you meant.";
          if (match.confidence === "exact") {
            boardRef.current?.scrollToNode(match.stepId);
            return `Scrolled to “${match.label}.”`;
          }
          const question = `Scroll to “${match.label}”? Say yes or no.`;
          setPendingConfirm({ question, onYes: () => boardRef.current?.scrollToNode(match.stepId), onNo: () => {} });
          return question;
        },
      },
    ];

    if (!approved) {
      commands.push({
        phrases: INVENTORY_VOICE.editStep,
        run: (m) => {
          showTab("graph");
          const said = (m?.[1] || "").trim();
          const ids = boardNodes.map((n) => n.id);
          const labelOf = (id) => nodeById[id]?.label;
          const match = matchStepName(said, ids, labelOf);
          if (match.confidence === "none") return "I couldn't tell which step you meant.";
          if (match.confidence === "exact") {
            setPanel({ mode: "edit", id: match.stepId });
            return `Opening “${match.label}.”`;
          }
          const question = `Open “${match.label}”? Say yes or no.`;
          setPendingConfirm({ question, onYes: () => setPanel({ mode: "edit", id: match.stepId }), onNo: () => {} });
          return question;
        },
      });
    }

    if (dishIsUndoable) {
      commands.push({
        phrases: INVENTORY_VOICE.removeBlocked,
        confirm: `Remove ${blockedIds.length} step${blockedIds.length === 1 ? "" : "s"} you can't do without those materials? Say yes or no.`,
        label: "Removed.",
        run: () => {
          if (!blockedIds.length) return;
          deleteNodes(blockedIds);
          setPanel(null);
        },
      });
    }

    if (showEquipment) {
      if (kitchenProfile) {
        commands.push({
          phrases: INVENTORY_VOICE.editKitchen,
          label: "Opening the kitchen profile.",
          run: () => setEditingKitchen(true),
        });
      }
      commands.push({
        phrases: INVENTORY_VOICE.cookAnyway,
        label: "Okay — cooking with what you've got.",
        run: () => setDismissedEquipment(lackingKey),
      });
    }

    if (approved) {
      commands.push({
        phrases: INVENTORY_VOICE.revise,
        label: "Back to editing.",
        run: () => revise(),
      });
      // What the "Continue to the cooks" button does, said out loud. It
      // lands on the cooks, which is the next step of the session — the
      // schedule is the one after that.
      commands.push({
        phrases: INVENTORY_VOICE.continueOn,
        label: "On to the cooks.",
        run: () => navigate("/session/voice-binding"),
      });
    }

    return registerVoiceCommands(commands);
    // fitScale as well as zoomPct: setZoomPct reads it, and at the fitted
    // view zoomPct stays 0 while the fit itself changes, so a command
    // registered before the board measured itself zoomed off the wrong
    // scale — "zoom in" landed on 60% instead of 5%.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDishes, catalog, approved, boardNodes, nodeById, dishIsUndoable, blockedIds, showEquipment, kitchenProfile, lackingKey, zoomPct, fitScale, navigate]);

  // A guessed step reference — an "open X" that came back close but not
  // exact, or a "before X"/"between X and Y" task position. Same
  // reasoning as the live cook's step matching: firing on a guess among
  // steps that read alike is how the wrong one gets picked.
  const resolvePendingConfirm = (answer) => {
    if (!pendingConfirm) return;
    const { onYes, onNo } = pendingConfirm;
    setPendingConfirm(null);
    if (answer === "yes") onYes();
    else onNo();
  };

  useEffect(() => {
    if (!pendingConfirm) return undefined;
    const unregister = registerVoiceCommands(
      [
        { phrases: [CONFIRM_YES_PATTERN], label: "Got it.", run: () => resolvePendingConfirm("yes") },
        { phrases: [CONFIRM_NO_PATTERN], label: "Okay — pick it in the form.", run: () => resolvePendingConfirm("no") },
      ],
      { priority: 20, exclusive: true }
    );
    // Expires on its own so a stray "yes" a minute later can't be read
    // as an answer to a question nobody remembers asking.
    const timer = setTimeout(() => setPendingConfirm(null), 10_000);
    return () => {
      unregister();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingConfirm]);

  const { coverage } = inv;
  const metaBits = [];
  if (hasDishes) {
    metaBits.push(inv.dishTitles.join(" · ") || inv.title);
    if (inv.servings != null) metaBits.push(<><Mono>{inv.servings}</Mono> servings</>);
    if (catalog) metaBits.push(<><Mono>{inv.ingredients.length}</Mono> ingredients</>);
    metaBits.push(<><Mono>{inv.stepCount}</Mono> steps</>);
    // Hands-on time is the number that decides whether tonight is
    // manageable. The waiting is real but it is not work, and lumping
    // them together told people a 21-minute cook would take 96.
    metaBits.push(<><Mono>{formatClock(inv.attendedSeconds)}</Mono> hands-on</>);
    if (inv.unattendedSeconds > 0) {
      metaBits.push(<><Mono>{formatClock(inv.unattendedSeconds)}</Mono> waiting</>);
    }
  }

  const allOnHand = inv.onHandCount === inv.ingredients.length;

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

  // ?preview=loading / ?preview=done pins the screen (dev only, see dev/preview.js).
  const preview = devPreview();
  const shownBeat = preview === "loading" ? "writing" : preview === "done" ? "done" : beat;
  if (shownBeat) {
    const asked = session.conversation?.answers?.dishIdea;
    const dishes = (Array.isArray(asked) ? asked : [asked])
      .filter(Boolean)
      .map((d) => d.charAt(0).toUpperCase() + d.slice(1));
    const servings = session.conversation?.answers?.servings;
    // The ticket reads as an order the chef is working from, so the
    // session's answers become its line items rather than a caption.
    const order = dishes.length ? dishes.map((name) => ({ qty: 1, name })) : [{ qty: 1, name: "Your dishes" }];
    return (
      <ChefWorkingScreen
        done={shownBeat === "done"}
        title={<>Good food takes a little thought.</>}
        eyebrow="A menu worth waiting for"
        doneEyebrow="Recipes are ready"
        live={generating ? "Writing your recipes" : "Setting your dishes"}
        doneLive="Recipes are written"
        ticket={servings ? `Ticket #${session.id?.slice(-4) || "0923"} · table for ${servings}` : `Ticket #${session.id?.slice(-4) || "0923"}`}
        order={order}
        orderNote={kitchenProfile?.name || "Your kitchen"}
        quote="You bring the appetite. I'll bring the plan."
      />
    );
  }

  return (
    <section className="page inventory-page">
      <header className="inv-title-row">
        <div className="inv-title">
          <span className="ds-title-mark">
            <h1>Inventory</h1>
            <svg className="ds-underline ds-underline-title" viewBox="0 0 430 10" preserveAspectRatio="none" fill="none" aria-hidden="true">
              <path d="M2 7c68-4 144 1 220-2 58-2.5 134 3 206 .5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          {loading ? (
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
        <div className="ds-scene">
          <img src={HEADER_BANNER} alt="" className="ds-scene-art inv-banner" aria-hidden="true" />
        </div>
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
            {coverage.showSeal && <HonkSeal />}
            {/* The verdict before the sentence: a cook scanning the page
                gets the answer from the stamp and the detail from the
                line under it. */}
            <span className={`inv-stamp is-${coverage.stampTone}`}>
              <svg width="11" height="12" viewBox="0 0 26 28" fill="none" aria-hidden="true">
                <path d={PAW_PATH} fill="currentColor" />
              </svg>
              {coverage.stampLabel}
            </span>
            <span className={`inv-summary is-${coverage.tone}`}>
              {/* Drawn by hand rather than set in a box: the mark is the
                  goose's, and a clean run is worth underlining. */}
              {coverage.tone === "critical" && (
                <svg className="inv-summary-strike" viewBox="0 0 200 30" preserveAspectRatio="none" aria-hidden="true">
                  <path
                    d="M2 9.5C40 6 92 5.2 140 6.4c22 .5 40 1.4 57 2.6l1 12.4c-28 1.8-66 2.6-104 2.2-34-.4-66-1.4-92-3.2Z"
                    fill="#e8543c"
                    fillOpacity="0.28"
                  />
                  <path d="M5 20.5c52 2 118 2.4 190-.6" stroke="#e8543c" strokeOpacity="0.22" strokeWidth="3" fill="none" strokeLinecap="round" />
                </svg>
              )}
              <span className="inv-summary-text">{coverage.summary}</span>
            </span>
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
            </div>
            {/* The goose's own reading of the same numbers. It is the
                one line on the page that says what it would DO about
                them. */}
            <span className="inv-goose-line mono">
              {/* The conversation's own profile picture
                  (components/GooseMarks.jsx): one bird across the app
                  rather than a different portrait per page. */}
              <GooseProfile size={30} aria-hidden="true" />
              {coverage.gooseLine}
            </span>
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
                      onClick={() => showTab(t.key)}
                    >
                      {t.label}
                      <span className="inv-tab-count mono">{t.count}</span>
                    </button>
                  ))}
                </div>
                {/* Both live at the right end of the row: the tabs hold
                    the left, and the instruction reads as a caption to
                    the warning beside it rather than as a label on the
                    tab it follows. */}
                <div className="inv-tabrow-end">
                  <span className="inv-hint">
                    {tab === "ingredients"
                      ? approved
                        ? "Approved — revise the plan to change what’s on hand."
                        : "Uncheck whatever you’re out of."
                      : approved
                        ? "Approved — revise the plan to change a step."
                        : "Drag a card to move it. Click one to edit."}
                  </span>
                  {tab === "graph" && (coverage.blocked > 0 || coverage.atRisk > 0) && (
                    <span className={`inv-status-counter is-${coverage.blocked > 0 ? "critical" : "warning"}`} role="status">
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
                    </span>
                  )}
                </div>
              </div>

              {pendingConfirm && (
                <div className="inv-equip" role="status">
                  <div className="inv-equip-main">
                    <span className="inv-equip-title">{pendingConfirm.question}</span>
                    <div className="inv-equip-actions">
                      <button type="button" className="btn inv-equip-edit" onClick={() => resolvePendingConfirm("yes")}>
                        Yes
                      </button>
                      <button type="button" className="btn inv-equip-dismiss" onClick={() => resolvePendingConfirm("no")}>
                        No
                      </button>
                    </div>
                  </div>
                </div>
              )}

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
                            <CategoryMark category={g.key} />
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
                              locked={Boolean(approved)}
                              onToggle={() => toggle(item.id)}
                              statusLineFor={statusLineFor}
                              dishTitles={inv.dishTitles}
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
                    {/* The hole a board hangs by. It is the detail that
                        settles what the ground is: without it the wood
                        is a texture, with it the graph is laid out on a
                        chopping board. */}
                    <span className="inv-board-hang" aria-hidden="true" />
                    {/* Which stock each slip is cut from, on the board
                        with the slips rather than in the caption
                        under it. */}
                    <span className="inv-paper-legend" ref={paperLegendRef}>
                      {inv.dishTitles.map((title) => {
                        const paper = dishPaper(title, inv.dishTitles);
                        return (
                          <span key={title} className="inv-paper-key">
                            <span className="inv-paper-swatch" style={{ background: paper.bg, border: paper.border }} aria-hidden="true" />
                            {title}
                          </span>
                        );
                      })}
                      {hasSharedStep && (
                        <span className="inv-paper-key">
                          <span
                            className="inv-paper-swatch"
                            style={{ background: SHARED_PAPER.bg, border: SHARED_PAPER.border }}
                            aria-hidden="true"
                          />
                          Shared
                        </span>
                      )}
                    </span>
                    <span className="inv-phase-legend" aria-label="Phase colours">
                      {["prep", "cook", "plate"].map((ph) => (
                        <span key={ph} className={`inv-phase-key is-${ph}`}>
                          <span className="inv-phase-swatch" aria-hidden="true" />
                          {PHASE_LABELS[ph]}
                        </span>
                      ))}
                    </span>
                    <RecipeBoard
                      ref={boardRef}
                      nodes={boardNodes}
                      positions={nodePositions}
                      selectedNodeId={selectedId}
                      dishLabelFor={dishLabelFor}
                      paperOf={paperFor}
                      statusOf={statusOf}
                      numberOf={numberOf}
                      onSelect={selectNode}
                      onMove={moveNode}
                      reserveRight={panelOpen ? PANEL_RESERVE : 0}
                      onOffscreen={setOffscreen}
                      zoom={zoom}
                      legendKeepOut={legendKeepOut}
                      onFitScale={setFitScale}
                      onLink={linkNodes}
                      onUnlink={unlinkNodes}
                      readOnly={Boolean(approved)}
                    />

                    {editingNode && (
                      <NodeEditorPanel
                        node={editingNode}
                        allNodes={boardNodes}
                        numberOf={numberOf}
                        blockedDependencyIds={cyclicDependencyIds(boardNodes, editingNode.id)}
                        onClose={closePanel}
                        onSave={(id, nodeDraft, children) => {
                          saveNode(id, nodeDraft, { children });
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
                        materialsInfo={materialsInfo}
                        onRegisterMaterial={(materialDraft, recipeId) =>
                          registerMaterial(materialDraft, materialsInfo, null, recipeId)
                        }
                        onClose={closePanel}
                        initialLabel={panel.initialLabel || ""}
                        initialDependsOn={panel.initialDependsOn || []}
                        initialRunsBefore={panel.initialRunsBefore || []}
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
                      <span className="inv-board-count-lead">
                        {boardNodes.length} {boardNodes.length === 1 ? "step" : "steps"}
                      </span>
                      {!approved && (
                        <span className="inv-board-pan">Drag a card&rsquo;s side dot to link &middot; click an arrow to unlink</span>
                      )}
                      {panHint && <span className="inv-board-pan">{panHint}</span>}
                    </span>

                    <span className="inv-board-tools">
                      {!approved && (
                        <button type="button" className="btn inv-add-btn" aria-pressed={panel?.mode === "add"} onClick={() => setPanel({ mode: "add" })}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                          Add a task
                        </button>
                      )}
                      <button
                        type="button"
                        className="inv-zoom-step"
                        aria-label="Zoom out"
                        disabled={zoomPct <= 0}
                        onClick={() => setZoomPct(Math.max(0, zoomPct - ZOOM_STEP))}
                      >
                        &minus;
                      </button>
                      <button
                        type="button"
                        className="inv-zoom-step"
                        aria-label="Zoom in"
                        disabled={zoomPct >= 100}
                        onClick={() => setZoomPct(Math.min(100, zoomPct + ZOOM_STEP))}
                      >
                        +
                      </button>
                      <span className="inv-zoom-pct mono">{zoomPct > 0 ? `+${zoomPct}%` : "0%"}</span>
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
              {inv.onHandCount} / {inv.ingredients.length} ingredients on hand
            </span>
            <div className="inv-footer-actions">
              {!approved && dishIsUndoable && (
                <button type="button" className="btn inv-footer-secondary inv-btn-remove" onClick={dropBlockedSteps}>
                  Remove the blocked {blockedIds.length === 1 ? "step" : "steps"}
                </button>
              )}
              {/* No arrow: it does not take you anywhere. It writes the
                  approved graphs, and the approved panel opens underneath
                  carrying the button that does go onward. */}
              {!approved && (
                <button type="button" className="btn btn-primary btn-lg" onClick={approve} disabled={dishIsUndoable}>
                  Approve the plan
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
