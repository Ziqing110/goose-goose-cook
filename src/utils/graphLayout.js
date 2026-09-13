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
