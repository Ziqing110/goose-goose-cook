// Pure derivations for the Inventory page (session step: the materials
// check). Everything here is computed from the run's recipes, shared
// steps, the materials catalog and the "out" set — the availability
// rules themselves live in graphLayout.computeStepAvailability and are
// only *read back* here, never re-derived.
import { MATERIAL_CATEGORY_LABELS, MATERIAL_CATEGORY_ORDER } from "../data/dishes.js";
import {
  computeDownstreamClosure,
  computeMaterialTotals,
  computeStepAvailability,
  layoutLevels,
  mergeRecipesForDisplay,
} from "./graphLayout.js";
import { isAttended } from "./tending.js";

export const PHASE_LABELS = { prep: "Prep", cook: "Cook", plate: "Plate" };

/** "42:00" from seconds — mm:ss, minutes unpadded past 99. */
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** "3:00" — the per-step duration format used in step detail lines. */
export function formatStepDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "4 min" (or "45 s" under a minute) — the glanceable format on board cards and the impact list. */
export function formatMinutes(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  if (s < 60) return `${s} s`;
  const m = Math.round((s / 60) * 10) / 10;
  return `${m} min`;
}

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * Builds everything the page renders. `catalog` is { [id]: { label,
 * category, amount, unit } } (null while loading — then only run-level
 * figures are available); `outIds` is an iterable of material ids the
 * cook marked "Out".
 */
export function buildInventory({ recipes, sharedSteps = [], catalog, outIds }) {
  const out = new Set(outIds || []);
  const { working } = mergeRecipesForDisplay(recipes, sharedSteps);
  const nodes = working.nodes || [];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const isMultiDish = recipes.length > 1;

  // Cook order: dependency depth, so "01" is something you can start on.
  const stepOrder = layoutLevels(nodes).flat();
  const stepNumber = new Map(stepOrder.map((n, i) => [n.id, i + 1]));
  const sortedNodes = [...nodes].sort((a, b) => stepNumber.get(a.id) - stepNumber.get(b.id));

  const totalSeconds = nodes.reduce((sum, n) => sum + (Number(n.estimated_duration_sec) || 0), 0);
  // Split, because the total on its own is misleading in both readings.
  // A congee run totals 96 minutes: it is not 96 minutes of work (21 is)
  // and it is not 96 minutes of evening (about 44 is, once the waiting
  // overlaps). Saying which is which is the only honest version, and it
  // tells the cook what kind of evening this is before they commit.
  const attendedSeconds = nodes
    .filter(isAttended)
    .reduce((sum, n) => sum + (Number(n.estimated_duration_sec) || 0), 0);
  const unattendedSeconds = totalSeconds - attendedSeconds;
  const recipeTitle = (recipeId) => recipes.find((r) => r.id === recipeId)?.working.title || null;
  const dishesForNode = (n) => {
    if (n._shared) {
      const fromBreakdown = (n.usage_breakdown || []).map((u) => u.title).filter(Boolean);
      return fromBreakdown.length ? fromBreakdown : recipes.map((r) => r.working.title);
    }
    const t = recipeTitle(n._recipeId);
    return t ? [t] : [];
  };

  // Player-added materials (recipe.custom_materials) win over the catalog.
  const materialsInfo = { ...(catalog || {}), ...(working.custom_materials || {}) };
  const labelOf = (id) => materialsInfo[id]?.label || id;
  const totals = computeMaterialTotals(nodes, materialsInfo);
  const closure = computeDownstreamClosure(nodes);

  const { impossible: blocked, affected: atRisk } = computeStepAvailability(nodes, out);
  const stepStatus = (id) => (blocked.has(id) ? "blocked" : atRisk.has(id) ? "atRisk" : "craftable");

  // Reason copy, exactly as the main line phrases it.
  const blockedReason = (id) => {
    const r = blocked.get(id);
    if (!r) return null;
    if (r.type === "materials") return `missing ${r.materials.map(labelOf).join(", ")}`;
    return `depends on ${r.dependsOnLabels.map((l) => `“${l}”`).join(" and ")}, which isn't doable`;
  };
  const atRiskReason = (id) => {
    const r = atRisk.get(id);
    if (!r) return null;
    const bits = [];
    if (r.missingMaterials.length) bits.push(`missing ${r.missingMaterials.map(labelOf).join(", ")}`);
    if (r.degradedDepLabels.length) bits.push(`depends on ${r.degradedDepLabels.map((l) => `“${l}”`).join(", ")}, which isn't fully available`);
    return bits.join("; ");
  };

  // ---- ingredients: only what some step actually uses ----
  const ids = [...new Set(nodes.flatMap((n) => n.required_materials || []))];
  const ingredients = ids.map((id) => {
    const usedIn = sortedNodes.filter((n) => (n.required_materials || []).includes(id));
    const reachSet = new Set();
    usedIn.forEach((n) => closure.get(n.id)?.forEach((x) => reachSet.add(x)));
    const dishes = [...new Set(usedIn.flatMap(dishesForNode))];
    const isOut = out.has(id);
    // Does this ingredient's absence, on its own, block a step? (Only
    // "materials"-type blocks name ingredients; dependency cascades don't.)
    const blocksStep = isOut && [...blocked.values()].some((r) => r.type === "materials" && r.materials.includes(id));
    return {
      id,
      label: labelOf(id),
      category: materialsInfo[id]?.category || "other",
      amount: totals[id]?.amount ?? materialsInfo[id]?.amount ?? null,
      unit: totals[id]?.unit ?? materialsInfo[id]?.unit ?? "",
      isCustom: Boolean(working.custom_materials?.[id]) && !(catalog && catalog[id]),
      out: isOut,
      reach: reachSet.size,
      reachTone: !isOut ? "neutral" : blocksStep ? "critical" : "warning",
      usedIn: usedIn.map((n) => ({
        id: n.id,
        number: pad2(stepNumber.get(n.id)),
        label: n.label,
        phase: n.phase,
        durationSec: n.estimated_duration_sec,
        // So a 40-minute wait does not read like 40 minutes of standing
        // over a pot in the step list.
        attended: isAttended(n),
        status: stepStatus(n.id),
        dependsOn: (n.depends_on || [])
          .map((d) => byId[d])
          .filter(Boolean)
          .sort((a, b) => stepNumber.get(a.id) - stepNumber.get(b.id))
          .map((d) => ({ number: pad2(stepNumber.get(d.id)), label: d.label })),
        // Per-dish split for a shared step that carries usage_breakdown.
        split: (n.usage_breakdown || [])
          .map((u) => ({ title: u.title, usage: u.material_usage?.[id] }))
          .filter((u) => u.usage)
          .map((u) => ({ title: u.title, amount: u.usage.amount, unit: u.usage.unit })),
      })),
      dishes: isMultiDish ? dishes : [],
    };
  });

  // Category groups in the fixed order; within a group by reach desc, then amount desc.
  const groups = MATERIAL_CATEGORY_ORDER.map((cat) => ({
    key: cat,
    label: MATERIAL_CATEGORY_LABELS[cat] || cat,
    items: ingredients
      .filter((i) => i.category === cat)
      .sort((a, b) => b.reach - a.reach || (b.amount || 0) - (a.amount || 0)),
  })).filter((g) => g.items.length > 0);

  // ---- coverage ----
  const total = nodes.length;
  const blockedCount = blocked.size;
  const atRiskCount = atRisk.size;
  const craftableCount = total - blockedCount - atRiskCount;
  let tone = "done";
  let summary = "Full inventory — every step is craftable";
  if (blockedCount > 0) {
    tone = "critical";
    summary = `Run blocked — ${blockedCount} of ${total} steps can't be done`;
  } else if (atRiskCount > 0) {
    tone = "warning";
    summary = `${atRiskCount} of ${total} steps at risk`;
  }

  // ---- impact panel: blocked first, then at risk, each in cook order ----
  const impactEntry = (n) => ({
    id: n.id,
    number: pad2(stepNumber.get(n.id)),
    label: n.label,
    durationSec: n.estimated_duration_sec,
    status: stepStatus(n.id),
    reason: blocked.has(n.id) ? blockedReason(n.id) : atRiskReason(n.id),
  });
  const impact = [
    ...sortedNodes.filter((n) => blocked.has(n.id)).map(impactEntry),
    ...sortedNodes.filter((n) => atRisk.has(n.id)).map(impactEntry),
  ];

  return {
    title: working.title || "",
    servings: working.servings ?? null,
    isMultiDish,
    dishTitles: recipes.map((r) => r.working.title),
    stepCount: total,
    totalSeconds,
    attendedSeconds,
    unattendedSeconds,
    steps: sortedNodes.map((n) => ({ id: n.id, status: stepStatus(n.id) })),
    ingredients,
    groups,
    onHandCount: ingredients.filter((i) => !i.out).length,
    coverage: { total, craftable: craftableCount, atRisk: atRiskCount, blocked: blockedCount, tone, summary },
    impact,
  };
}
