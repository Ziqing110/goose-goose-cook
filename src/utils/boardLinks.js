// The rules for drawing a dependency by hand on the recipe board.
//
// Kept out of the board component because they are the same rules the
// step editor's "runs after" / "unlocks next" pickers have to obey, and
// because a link that makes a loop is a graph fact, not a UI detail: the
// scheduler walks these arrows, and a cycle makes it unschedulable.
import { cyclicDependencyIds } from "./graphLayout.js";

/**
 * Why `parentId -> childId` can't be drawn, as a line to show the cook,
 * or null when it can.
 *
 * "Downstream" is the same closure the editor greys its dependency
 * options with (cyclicDependencyIds), so the board and the panel can
 * never disagree about what would make a loop.
 */
export function linkRejection(nodes, parentId, childId) {
  if (!parentId || !childId || parentId === childId) return "A step can't wait on itself";
  const child = nodes.find((n) => n.id === childId);
  const parent = nodes.find((n) => n.id === parentId);
  if (!child || !parent) return null;
  if ((child.depends_on || []).includes(parentId)) return "Already linked";
  if (cyclicDependencyIds(nodes, childId).has(parentId)) return "That link would make a loop";
  return null;
}

/** The steps that wait on this one, directly. */
export function childrenOf(nodes, nodeId) {
  return nodes.filter((n) => (n.depends_on || []).includes(nodeId)).map((n) => n.id);
}

/**
 * Steps this one could be made to wait on: not itself, not one it
 * already waits on, not one that already waits on it, and nothing
 * downstream of it (that way round is the loop).
 */
export function eligibleParents(nodes, nodeId, { deps = [], children = [] } = {}) {
  const downstream = cyclicDependencyIds(nodes, nodeId);
  const taken = new Set([...deps, ...children]);
  return nodes.filter((n) => n.id !== nodeId && !taken.has(n.id) && !downstream.has(n.id));
}

/**
 * Steps that could be made to wait on this one: the mirror image —
 * nothing upstream of it, since that way round is the loop.
 */
export function eligibleChildren(nodes, nodeId, { deps = [], children = [] } = {}) {
  const taken = new Set([...deps, ...children]);
  return nodes.filter((n) => n.id !== nodeId && !taken.has(n.id) && !cyclicDependencyIds(nodes, n.id).has(nodeId));
}
