// Pure helpers for laying out and diffing a RecipeGraph — no DOM, no
// React, so they're easy to unit test independent of rendering.

/** Groups nodes into columns by dependency depth (topological level). */
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

  const maxLevel = nodes.length ? Math.max(...nodes.map((n) => levelOf(n.id))) : 0;
  const columns = Array.from({ length: maxLevel + 1 }, () => []);
  nodes.forEach((n) => columns[levelOf(n.id)].push(n));
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
