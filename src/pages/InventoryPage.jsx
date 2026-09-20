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
import ChefWorkingScreen from "../components/ChefWorkingScreen.jsx";
import { devPreview } from "../dev/preview.js";
import NodeEditorPanel from "../components/NodeEditorPanel.jsx";
import { useStepEditing } from "../state/useStepEditing.js";
import { buildInventory, formatClock, formatStepDuration, PHASE_LABELS } from "../utils/inventory.js";
import dishMapoTofu from "../assets/dish-mapo-tofu.png";
import dishNoodleSoup from "../assets/dish-noodle-soup.png";
import "./InventoryPage.css";

// How long the thumbs-up frame holds once the recipes land.
const WORKING_DONE_MS = 700;
import { registerVoiceCommands } from "../utils/voicePageCommands.js";
import { normalizeUtterance, CONFIRM_YES_PATTERN, CONFIRM_NO_PATTERN } from "../utils/navCommands.js";
import { matchStepName } from "../utils/stepNameMatch.js";

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

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Every way someone says an ingredient just ran out, or just turned up —
// mirroring the checkboxes' own words ("out" / "on hand") plus how people
// actually talk in a kitchen. Off is checked before on in the command
// list below, same reasoning as the kitchen form's wok/oven toggle: a
// phrase that could read either way should read as off.
const OUT_PHRASES = (name) => [
  new RegExp(`\\bno (?:more )?${name}\\b`),
  new RegExp(`\\bout of ${name}\\b`),
  new RegExp(`\\b${name} is out\\b`),
  new RegExp(`\\b(?:don't|dont) have (?:any )?${name}\\b`),
  new RegExp(`\\bmark ${name} out\\b`),
];
const ON_HAND_PHRASES = (name) => [
  new RegExp(`\\bgot (?:the |some )?${name}\\b`),
  new RegExp(`\\bhave (?:the |some )?${name}\\b`),
  new RegExp(`\\bfound (?:the |some )?${name}\\b`),
  new RegExp(`\\b${name} is (?:back|on hand)\\b`),
  new RegExp(`\\bmark ${name} on hand\\b`),
];

/**
 * One "out" and one "on hand" command per ingredient, matched against its
 * full name. Unlike the kitchen picker's bare distinctive word, these
 * always require a trigger phrase — this page isn't asking "which
 * ingredient", so a bare mention of "ginger" in conversation must not
 * flip anything.
 */
function ingredientVoiceCommands(items, { markOut, markOnHand }) {
  return items.flatMap((item) => {
    const name = escapeRe(normalizeUtterance(item.label));
    if (!name) return [];
    return [
      { phrases: OUT_PHRASES(name), label: `${item.label} — marked out.`, run: () => markOut(item.id) },
      { phrases: ON_HAND_PHRASES(name), label: `${item.label} — back on hand.`, run: () => markOnHand(item.id) },
    ];
  });
}

/**
 * Pulls the task's own name and any position clause out of what follows
 * "add a task" / "add a step" — "between X and Y" checked first since
 * "before" alone would otherwise swallow it (`between mix the batter and
 * pour it` contains no "before", so order only matters for a phrase
 * that could plausibly satisfy both, which doesn't happen here, but
 * "between" is the more specific claim and goes first on principle).
 *
 * The name itself is only recognised behind a connector word
 * (to/called/named/for). Without one, "add a task toast the sesame
 * seeds before plating" has no reliable way to tell the task's name
 * apart from the position clause, so it's left for the form rather
 * than guessed at.
 */
function parseAddTaskSpeech(rest) {
  const empty = { name: "", before: null, between: null };
  if (!rest) return empty;
  const named = "(?:(?:to|called|named|for) (.+?) )?";

  const between = new RegExp(`^${named}between (.+) and (.+)$`).exec(rest);
  if (between) return { name: (between[1] || "").trim(), before: null, between: [between[2].trim(), between[3].trim()] };

  const before = new RegExp(`^${named}before (.+)$`).exec(rest);
  if (before) return { name: (before[1] || "").trim(), before: before[2].trim(), between: null };

  const namedOnly = /^(?:to|called|named|for) (.+)$/.exec(rest);
  if (namedOnly) return { name: namedOnly[1].trim(), before: null, between: null };

  return empty;
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
  const { catalog, catalogError, retryCatalog, generating } = useSessionRecipes();
  const [tab, setTab] = useState("ingredients");
  // The board panel: null, { mode: "impact" }, { mode: "edit", id } or
  // { mode: "add" }. Which card is open is view state — persisting it
  // meant a reload re-opened the editor on a step nobody had clicked.
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
  const boardRef = useRef(null);
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
  const { addNode, saveNode, deleteNode, deleteNodes, registerMaterial } = useStepEditing();
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

  // The voice equivalent of the "Approve and schedule" button, in the
  // same words printed on it. Approving locks the graph, so it asks
  // first — and it refuses while a step is blocked, exactly as the
  // button does when disabled. A voice command that quietly does
  // nothing because a button was greyed out is a bug report waiting to
  // happen, so it says why.
  useEffect(() => {
    // Nothing to approve while the board is still being generated — a
    // stray "approve" overheard during that wait would otherwise open a
    // spoken confirm for a plan that doesn't exist yet.
    if (recipes.length === 0) return undefined;
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
  }, [dishIsUndoable, recipes.length]);

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
  const hasOut = outMaterialIds.length > 0;
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
        hint: {
          line: "Tell me what you're out of — say “no ginger.”",
          sub: "Everything's on hand until you say otherwise. You can also say “add a task.”",
        },
      },
    });
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [dispatch, hasDishes, loading]);

  const setOut = (ids) => dispatch({ type: "session/update", payload: { outMaterialIds: ids } });
  const toggle = (id) => {
    const next = new Set(outMaterialIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setOut([...next]);
  };
  // Voice says which state it wants, not "flip whatever this is" — saying
  // "got ginger" while it's already on hand should do nothing, not put
  // it back out.
  const markOut = (id) => {
    if (!outMaterialIds.includes(id)) setOut([...outMaterialIds, id]);
  };
  const markOnHand = (id) => {
    if (outMaterialIds.includes(id)) setOut(outMaterialIds.filter((x) => x !== id));
  };
  const markAllOnHand = () => setOut([]);

  // Mirrors the checkboxes and the "Add a task" button: everything voice
  // can do here is something a click already does, said in the words the
  // hint promises ("say 'no ginger'") instead of promising and ignoring.
  useEffect(() => {
    if (!hasDishes || !catalog) return undefined;
    return registerVoiceCommands([
      ...ingredientVoiceCommands(inv.ingredients, { markOut, markOnHand }),
      {
        phrases: [/\beverything(?:'s| is)? on hand\b/, /\bmark everything on hand\b/, /\ball on hand\b/],
        label: "Everything's on hand.",
        run: () => hasOut && markAllOnHand(),
      },
      {
        // The button only shows on the recipe graph tab, but the command
        // works from either — it switches tabs itself rather than
        // silently doing nothing because you were looking at ingredients.
        // Everything after "task"/"step" is captured whole and handed to
        // parseAddTaskSpeech, rather than only recognising the name — a
        // position clause ("before X", "between X and Y") lives out here
        // too.
        phrases: [/\badd (?:a |another )?task\b(.*)$/, /\badd (?:a |another )?step\b(.*)$/],
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
  }, [hasDishes, catalog, inv.ingredients, outMaterialIds, hasOut, approved, boardNodes, nodeById]);

  // Board-level commands: switching tabs, opening a step by name, the
  // kitchen-shortfall notice, dropping blocked steps, and un-approving.
  // Everything here mirrors a button already on the page, in its words.
  useEffect(() => {
    if (!hasDishes || !catalog) return undefined;
    const commands = [
      {
        phrases: [/\bshow (?:me )?(?:the )?ingredients\b/, /\bingredients tab\b/, /\bgo to (?:the )?ingredients\b/],
        label: "Showing ingredients.",
        run: () => showTab("ingredients"),
      },
      {
        phrases: [/\bshow (?:me )?(?:the )?(?:recipe graph|board)\b/, /\brecipe graph\b/, /\bgo to (?:the )?(?:recipe graph|board)\b/],
        label: "Showing the recipe graph.",
        run: () => showTab("graph"),
      },
      {
        phrases: [/\bzoom in\b/, /\bzoom (?:in )?closer\b/],
        run: () => {
          showTab("graph");
          if (zoomPct >= 100) return "Already as close as it goes.";
          setZoomPct(Math.min(100, zoomPct + ZOOM_STEP));
          return null;
        },
      },
      {
        phrases: [/\bzoom out\b/],
        run: () => {
          showTab("graph");
          if (zoomPct <= 0) return "Already fitted.";
          setZoomPct(Math.max(0, zoomPct - ZOOM_STEP));
          return null;
        },
      },
      {
        phrases: [/\bfit (?:the )?(?:board|graph)\b/, /\breset zoom\b/, /\bzoom to fit\b/],
        label: "Fitted.",
        run: () => {
          showTab("graph");
          setZoom(null);
        },
      },
      {
        phrases: [/\bscroll (?:to the )?right\b/, /\bpan (?:to the )?right\b/],
        run: () => {
          showTab("graph");
          boardRef.current?.scrollBy(320, 0);
        },
      },
      {
        phrases: [/\bscroll (?:to the )?left\b/, /\bpan (?:to the )?left\b/],
        run: () => {
          showTab("graph");
          boardRef.current?.scrollBy(-320, 0);
        },
      },
      {
        phrases: [/\bscroll (?:up|down)\b/, /\bpan (?:up|down)\b/],
        run: (m) => {
          showTab("graph");
          const down = /down/.test(m[0]);
          boardRef.current?.scrollBy(0, down ? 320 : -320);
        },
      },
      {
        phrases: [/\bscroll to (?:the )?step (.+)$/, /\bfind (?:the )?step (.+)$/, /\bshow me (?:the )?step (.+)$/],
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
        phrases: [/\bopen (?:the )?step (.+)$/, /\bedit (?:the )?step (.+)$/, /\bselect (?:the )?step (.+)$/],
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
        phrases: [/\bremove (?:the )?blocked steps?\b/, /\bdrop (?:the )?blocked steps?\b/],
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
          phrases: [/\bedit (?:the )?kitchen profile\b/, /\bedit (?:the |my )?kitchen\b/],
          label: "Opening the kitchen profile.",
          run: () => setEditingKitchen(true),
        });
      }
      commands.push({
        phrases: [/\bcook it anyway\b/],
        label: "Okay — cooking with what you've got.",
        run: () => setDismissedEquipment(lackingKey),
      });
    }

    if (approved) {
      commands.push({
        phrases: [/\brevise\b/, /\bunapprove\b/, /\bgo back to editing\b/],
        label: "Back to editing.",
        run: () => revise(),
      });
    }

    return registerVoiceCommands(commands);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDishes, catalog, approved, boardNodes, nodeById, dishIsUndoable, blockedIds, showEquipment, kitchenProfile, lackingKey, zoomPct]);

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

  // ?preview=loading / ?preview=done pins the screen (dev only, see dev/preview.js).
  const preview = devPreview();
  const shownBeat = preview === "loading" ? "writing" : preview === "done" ? "done" : beat;
  if (shownBeat) {
    const asked = session.conversation?.answers?.dishIdea;
    const dishes = (Array.isArray(asked) ? asked : [asked])
      .filter(Boolean)
      .map((d) => d.charAt(0).toUpperCase() + d.slice(1));
    const servings = session.conversation?.answers?.servings;
    const details = [
      dishes.length ? dishes.join(" + ") : "Your dishes",
      servings ? <><Mono>{servings}</Mono> servings</> : null,
      kitchenProfile?.name || "Your kitchen",
    ].filter(Boolean);
    return (
      <ChefWorkingScreen
        done={shownBeat === "done"}
        eyebrow="A menu worth waiting for"
        doneEyebrow="Recipes are ready"
        title={<>Good food takes<br />a little thought.</>}
        desc={<>Your chef is writing every step for tonight&rsquo;s dishes,<br className="inv-long" /> and checking them over before you see them.</>}
        live={generating ? "Writing your recipes" : "Setting your dishes"}
        doneLive="Recipes are written"
        details={details}
        quote="You bring the appetite. I'll bring the plan."
      />
    );
  }

  const counterTone = coverage.blocked > 0 ? "critical" : "warning";

  return (
    <section className="page inventory-page">
      <header className="inv-title-row">
        <div className="inv-title">
          <h1>Inventory</h1>
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
                      onClick={() => showTab(t.key)}
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
                      statusOf={statusOf}
                      numberOf={numberOf}
                      onSelect={selectNode}
                      onMove={moveNode}
                      reserveRight={panelOpen ? PANEL_RESERVE : 0}
                      onOffscreen={setOffscreen}
                      zoom={zoom}
                      onFitScale={setFitScale}
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
                      <span>
                        <Mono>{boardNodes.length}</Mono> {boardNodes.length === 1 ? "step" : "steps"} on the board
                      </span>
                      {panHint && <span className="inv-board-pan">{panHint}</span>}
                    </span>
                    <span className="inv-zoom">
                      <button
                        type="button"
                        className="inv-zoom-step"
                        aria-label="Zoom out"
                        disabled={zoomPct <= 0}
                        onClick={() => setZoomPct(Math.max(0, zoomPct - ZOOM_STEP))}
                      >
                        &minus;
                      </button>
                      <input
                        className="inv-zoom-slider"
                        type="range"
                        min={0}
                        max={100}
                        step={ZOOM_STEP}
                        value={zoomPct}
                        aria-label="Zoom"
                        aria-valuetext={zoomPct === 0 ? "Fitted — every step visible" : `${zoomPct}% past the fitted view`}
                        onChange={(e) => setZoomPct(Number(e.target.value))}
                      />
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
                      <button type="button" className="inv-zoom-fit" disabled={zoom === null} onClick={() => setZoom(null)}>
                        Fit
                      </button>
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
