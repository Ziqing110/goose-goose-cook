// Pure helpers for laying out and diffing a RecipeGraph — no DOM, no
// React, so they're easy to unit test independent of rendering.

/** Groups nodes into columns by dependency depth (topological level).
 * A node flagged `is_end_step` always renders in the last column instead
 * of its own natural depth — when multiple dishes share one merged
 * graph, this keeps each dish's serving step visually aligned even
 * though their dependency chains run to different lengths. Safe because
 * an end step is terminal (nothing depends on it), so moving it doesn't
 * affect any other node's computed level. */
export function layoutLevels(nodes) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const memo = new Map();

  function levelOf(id, guard = new Set()) {
    if (memo.has(id)) return memo.get(id);
    if (guard.has(id)) return 0; // cycle guard — shouldn't happen, but stay safe
    guard.add(id);
    const node = byId[id];
    const deps = (node?.depends_on || []).filter((d) => byId[d]);
    const level = deps.length ? 1 + Math.max(...deps.map((d) => levelOf(d, guard))) : 0;
    memo.set(id, level);
    return level;
  }

  const naturalLevels = nodes.map((n) => levelOf(n.id));
  const maxLevel = nodes.length ? Math.max(...naturalLevels) : 0;
  const columns = Array.from({ length: maxLevel + 1 }, () => []);
  nodes.forEach((n, i) => columns[n.is_end_step ? maxLevel : naturalLevels[i]].push(n));
  return columns;
}

/**
 * For each node, returns the set of node ids "downstream" of it — itself
 * plus every step that transitively depends on it (directly or via a
 * chain of depends_on edges). A material used early in a long chain
 * (e.g. the tofu everything downstream builds on) is more central to
 * the dish than one used in a leaf step, even if each is only listed
 * as a required material once — this is what lets that inherit through
 * the dependency graph instead of only counting direct usage.
 */
export function computeDownstreamClosure(nodes) {
  const dependents = new Map(nodes.map((n) => [n.id, []]));
  nodes.forEach((n) => {
    (n.depends_on || []).forEach((depId) => {
      if (dependents.has(depId)) dependents.get(depId).push(n.id);
    });
  });

  const closure = new Map();
  function closureOf(id, guard = new Set()) {
    if (closure.has(id)) return closure.get(id);
    if (guard.has(id)) return new Set([id]); // cycle guard — shouldn't happen, but stay safe
    guard.add(id);
    const set = new Set([id]);
    (dependents.get(id) || []).forEach((depId) => {
      closureOf(depId, guard).forEach((x) => set.add(x));
    });
    closure.set(id, set);
    return set;
  }

  nodes.forEach((n) => closureOf(n.id));
  return closure;
}

/**
 * The true amount of a material this session actually needs is the sum
 * of every step's own `material_usage` for it (e.g. a shared "mince
 * garlic" step whose usage_breakdown already folds in every dish it
 * serves) — not the flat per-catalog-row default, which doesn't know
 * how many dishes are drawing on the same ingredient. Falls back to the
 * catalog's own amount/unit for a material no step states a usage for,
 * so materials without per-step data keep behaving exactly as before.
 */
export function computeMaterialTotals(nodes, materialsInfo) {
  const totals = {};
  Object.keys(materialsInfo).forEach((id) => {
    const usages = nodes.map((n) => n.material_usage?.[id]).filter(Boolean);
    totals[id] = usages.length
      ? { amount: usages.reduce((sum, u) => sum + u.amount, 0), unit: usages[0].unit }
      : { amount: materialsInfo[id].amount, unit: materialsInfo[id].unit };
  });
  return totals;
}

const PHASES = ["prep", "cook", "plate"];

/** Groups nodes into the three cooking-phase columns (defaults to "prep" for nodes with no phase set). */
export function groupByPhase(nodes) {
  const groups = { prep: [], cook: [], plate: [] };
  nodes.forEach((n) => {
    const phase = PHASES.includes(n.phase) ? n.phase : "prep";
    groups[phase].push(n);
  });
  return groups;
}

/**
 * Determines each step's availability given a set of unavailable
 * materials. A step is "impossible" only when EVERY one of its own
 * required materials is missing, or — cascading transitively — when
 * ALL of its dependencies are themselves impossible. If a step depends
 * on several prior steps and only some are impossible, it's merely
 * "affected" (still doable, just degraded), not impossible: losing one
 * of several inputs doesn't necessarily block the whole step. "Affected"
 * also cascades (an affected dependency flags its consumers as affected
 * too), but never escalates into "impossible" on its own.
 *
 * Returns { impossible, affected }, each a Map of nodeId -> reason.
 */
export function computeStepAvailability(nodes, unavailableMaterials) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const impossible = new Map();
  const affected = new Map();

  nodes.forEach((n) => {
    const materials = n.required_materials || [];
    if (materials.length > 0 && materials.every((m) => unavailableMaterials.has(m))) {
      impossible.set(n.id, { type: "materials", materials });
    }
  });

  let changed = true;
  while (changed) {
    changed = false;
    nodes.forEach((n) => {
      if (impossible.has(n.id)) return;
      const deps = n.depends_on || [];
      if (deps.length > 0 && deps.every((d) => impossible.has(d))) {
        impossible.set(n.id, { type: "dependency", dependsOnLabels: deps.map((d) => byId[d]?.label || d) });
        changed = true;
      }
    });
  }

  changed = true;
  while (changed) {
    changed = false;
    nodes.forEach((n) => {
      if (impossible.has(n.id) || affected.has(n.id)) return;
      const materials = n.required_materials || [];
      const missingOwn = materials.filter((m) => unavailableMaterials.has(m));
      const partialOwnMaterials = missingOwn.length > 0 && missingOwn.length < materials.length;

      const degradedDeps = (n.depends_on || []).filter((d) => impossible.has(d) || affected.has(d));

      if (partialOwnMaterials || degradedDeps.length > 0) {
        affected.set(n.id, {
          missingMaterials: missingOwn,
          degradedDepLabels: degradedDeps.map((d) => byId[d]?.label || d),
        });
        changed = true;
      }
    });
  }

  return { impossible, affected };
}

/** Prefixes every node id (and depends_on reference) with the owning
 * recipe instance id, so multiple instances of the same template in
 * one session never collide. Applied once, when a template is
 * instantiated into a session's recipe list. */
export function namespaceTemplateNodes(nodes, recipeId) {
  const prefix = (id) => `${recipeId}::${id}`;
  return nodes.map((n) => ({
    ...n,
    id: prefix(n.id),
    depends_on: (n.depends_on || []).map(prefix),
  }));
}

/**
 * Combines a session's recipe instances (and any session-owned shared
 * steps — see extractSharedSteps below) into one "virtual" graph-like
 * view for rendering — phase columns, the dependency graph, and the
 * materials checklist all read from this rather than one recipe at a
 * time, so today's single-dish case and a future multi-dish session
 * share the same rendering path. Each merged node carries `_recipeId`
 * (the owning recipe instance, or null for a shared step) so mutations
 * can be routed back to whichever record actually owns it; a shared
 * step is additionally tagged `_shared: true` as the explicit
 * discriminator. This is display-only: each recipe/shared step keeps
 * its own independent draft/working/approved underneath, untouched.
 */
export function isFullyApproved(recipes, sharedSteps = []) {
  return recipes.length > 0 && recipes.every((r) => r.approved) && sharedSteps.every((s) => s.approved);
}

export function mergeRecipesForDisplay(recipes, sharedSteps = []) {
  const tag = (nodes, recipeId) => nodes.map((n) => ({ ...n, _recipeId: recipeId }));
  const tagShared = (node) => ({ ...node, _recipeId: null, _shared: true });

  const working = {
    title: recipes.map((r) => r.working.title).join(" + "),
    servings:
      recipes.length === 1 ? recipes[0].working.servings : recipes.reduce((sum, r) => sum + (r.working.servings || 0), 0),
    nodes: [...recipes.flatMap((r) => tag(r.working.nodes, r.id)), ...sharedSteps.map((s) => tagShared(s.working))],
    custom_materials: Object.assign({}, ...recipes.map((r) => r.custom_materials || {})),
  };

  const draft = {
    nodes: [...recipes.flatMap((r) => tag(r.draft.nodes, r.id)), ...sharedSteps.map((s) => tagShared(s.draft))],
  };

  const allApproved = isFullyApproved(recipes, sharedSteps);
  const approved = allApproved
    ? {
        title: working.title,
        servings: working.servings,
        nodes: [...recipes.flatMap((r) => tag(r.approved.nodes, r.id)), ...sharedSteps.map((s) => tagShared(s.approved))],
      }
    : null;

  return { working, draft, approved };
}

/**
 * Combines the contributing dishes' copies of a shareable step into one
 * synthetic shared node — done once instead of once per dish, to speed
 * up cooking. Its `description` stays the plain instruction (no
 * quantity text baked in); `material_usage` holds the true combined
 * total per material (surfaced in the top "Required materials" panel),
 * and `usage_breakdown` keeps each contributing dish's own amount
 * separately (surfaced on the step card itself) so the per-dish split
 * doesn't get lost just because the step is now done as one. Duration
 * is summed across contributors — mincing 5 cloves for two dishes
 * genuinely takes longer than mincing 3 for one, so the merged step
 * should still reflect the real total time spent, not the longer of
 * the two individual estimates.
 */
function buildMergedSharedNode(sharedId, shareKey, members) {
  const first = members[0].node;
  const union = (key) => [...new Set(members.flatMap((m) => m.node[key] || []))];

  const materialUsage = {};
  members.forEach((m) => {
    Object.entries(m.node.material_usage || {}).forEach(([matId, u]) => {
      if (!materialUsage[matId]) materialUsage[matId] = { amount: 0, unit: u.unit };
      materialUsage[matId].amount += u.amount;
    });
  });
  const usageBreakdown = members
    .filter((m) => m.node.material_usage && Object.keys(m.node.material_usage).length > 0)
    .map((m) => ({ title: m.title, material_usage: m.node.material_usage }));

  return {
    id: sharedId,
    share_key: shareKey,
    is_shareable: true,
    label: first.label,
    description: first.description,
    estimated_duration_sec: members.reduce((sum, m) => sum + m.node.estimated_duration_sec, 0),
    difficulty: first.difficulty,
    required_equipment: union("required_equipment"),
    required_materials: union("required_materials"),
    material_usage: materialUsage,
    usage_breakdown: usageBreakdown,
    depends_on: union("depends_on"),
    status: "pending",
    phase: first.phase,
  };
}

/**
 * Splits cross-dish shareable steps out of a batch of already-namespaced
 * recipe node lists (see namespaceTemplateNodes) into standalone shared-
 * step node objects, rewiring every depends_on reference — in the
 * recipes stripped of the step, and in any other shared step in the
 * same batch — to the new shared id. Only steps flagged `is_shareable`
 * with a matching `share_key` across 2+ recipes in THIS batch are
 * extracted; a shareable step used by only one dish in the batch is
 * left as a normal per-recipe step.
 *
 * Runs once, against the initial batch of recipes instantiated together
 * (RecipeGraphPage's mount effect). There is no support for promoting
 * an existing per-dish step into a shared one after the fact.
 */
export function extractSharedSteps(recipeGraphs) {
  const groups = new Map(); // share_key -> [{ recipeId, title, node }]
  recipeGraphs.forEach(({ recipeId, title, nodes }) => {
    nodes.forEach((node) => {
      if (!node.is_shareable || !node.share_key) return;
      if (!groups.has(node.share_key)) groups.set(node.share_key, []);
      groups.get(node.share_key).push({ recipeId, title, node });
    });
  });

  const idRemap = new Map(); // old namespaced id -> new shared id
  const extractedIds = new Set();
  const sharedSteps = [];

  groups.forEach((members, shareKey) => {
    if (members.length < 2) return; // only one dish wants it this time — stays per-recipe
    const sharedId = `shared::${crypto.randomUUID()}`;
    members.forEach((m) => {
      idRemap.set(m.node.id, sharedId);
      extractedIds.add(m.node.id);
    });
    sharedSteps.push(buildMergedSharedNode(sharedId, shareKey, members));
  });

  if (sharedSteps.length === 0) return { recipes: recipeGraphs, sharedSteps: [] };

  const remap = (id) => idRemap.get(id) || id;
  const recipes = recipeGraphs.map((g) => ({
    ...g,
    nodes: g.nodes
      .filter((n) => !extractedIds.has(n.id))
      .map((n) => ({ ...n, depends_on: (n.depends_on || []).map(remap) })),
  }));
  const remappedSharedSteps = sharedSteps.map((s) => ({ ...s, depends_on: s.depends_on.map(remap) }));

  return { recipes, sharedSteps: remappedSharedSteps };
}

export function diffGraphs(draft, approved) {
  const draftById = Object.fromEntries(draft.nodes.map((n) => [n.id, n]));
  const approvedById = Object.fromEntries(approved.nodes.map((n) => [n.id, n]));

  const added = approved.nodes.filter((n) => !draftById[n.id]).map((n) => n.label);
  const removed = draft.nodes.filter((n) => !approvedById[n.id]).map((n) => n.label);
  const edited = approved.nodes
    .filter((n) => draftById[n.id] && JSON.stringify(draftById[n.id]) !== JSON.stringify(n))
    .map((n) => n.label);

  return { added, removed, edited };
}

export function cloneGraph(graph) {
  return JSON.parse(JSON.stringify(graph));
}

export function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
