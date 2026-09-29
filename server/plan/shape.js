// What a recipe plan is, and the proof that one is executable.
//
// Every pass that produces or edits a plan (generation, the per-dish
// fallback, the review) goes through this module, so they all speak the
// same vocabulary and are held to the same checks. The vocabulary itself
// comes from the client, which renders and schedules these plans.
import { EQUIPMENT_OPTIONS, MATERIAL_CATEGORY_ORDER } from "../../src/data/dishes.js";
import { LEAVABLE_GAP_SEC, TENDING } from "../../src/utils/tending.js";

export const EQUIPMENT = EQUIPMENT_OPTIONS;
export const PHASES = ["prep", "cook", "plate"];
export const DIFFICULTIES = ["low", "medium", "high"];
export const TENDING_KINDS = Object.values(TENDING);
// "other" is the client's bucket for a material it never classified, not
// a choice worth offering a model.
export const CATEGORIES = MATERIAL_CATEGORY_ORDER.filter((c) => c !== "other");

const isHandsOn = (node) => !node.tending || node.tending === TENDING.HANDS_ON;
const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const positiveInt = (value) => Math.max(1, Math.round(Number(value)) || 1);

/**
 * Ids unique, every dependency points at a real step, no cycle.
 * @returns {string|null} what is wrong, or null
 */
export function checkGraphShape(nodes) {
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) return "has duplicate step ids";
  for (const n of nodes) {
    for (const dep of n.depends_on || []) {
      if (!ids.has(dep)) return `has a step "${n.id}" depending on "${dep}", which does not exist`;
    }
  }
  // Kahn's algorithm: anything left unvisited is in a cycle.
  const indegree = new Map(nodes.map((n) => [n.id, (n.depends_on || []).length]));
  const queue = [...indegree].filter(([, d]) => d === 0).map(([id]) => id);
  let seen = 0;
  while (queue.length) {
    const id = queue.shift();
    seen++;
    for (const n of nodes) {
      if ((n.depends_on || []).includes(id)) {
        const left = indegree.get(n.id) - 1;
        indegree.set(n.id, left);
        if (left === 0) queue.push(n.id);
      }
    }
  }
  return seen === nodes.length ? null : "has a circular dependency";
}

// The checks every stage shares: the right number of dishes, each with a
// title and steps, each step with an id, label, phase and dependency
// list, and a sound graph.
function checkRecipes(plan, expectedDishCount, checkNode) {
  if (!plan?.recipes?.length) return "no recipes returned";
  // Nothing in a schema stops a model merging two requested dishes into
  // one recipe, or dropping one; the plan would otherwise pass every
  // other check with a dish missing.
  if (expectedDishCount != null && plan.recipes.length !== expectedDishCount) {
    return `expected ${expectedDishCount} dish(es), got ${plan.recipes.length}`;
  }
  for (const r of plan.recipes) {
    if (typeof r.title !== "string" || !r.title) return "a recipe has no title";
    if (!r.nodes?.length) return `"${r.title}" has no steps`;
    for (const n of r.nodes) {
      if (typeof n.id !== "string" || !n.id) return `"${r.title}" has a step with no id`;
      if (typeof n.label !== "string" || !n.label) return `step "${n.id}" has no label`;
      if (!PHASES.includes(n.phase)) return `step "${n.id}" has an invalid phase "${n.phase}"`;
      if (!Array.isArray(n.depends_on)) return `step "${n.id}" has no depends_on list`;
      const problem = checkNode?.(n);
      if (problem) return problem;
    }
    const shapeProblem = checkGraphShape(r.nodes);
    if (shapeProblem) return `"${r.title}" ${shapeProblem}`;
  }
  return null;
}

/** The first generation pass: structure only, before any detail exists. */
export const validateSkeleton = (skeleton, expectedDishCount) => checkRecipes(skeleton, expectedDishCount);

// A non-hands_on step must carry the breakdown its kind allows: checks
// only where checks make sense, an ending only where one is collected.
function checkUnattended(n) {
  if (isHandsOn(n)) return n.unattended ? `step "${n.id}" is hands_on but was decomposed anyway` : null;
  const u = n.unattended;
  if (!u || typeof u !== "object") return `step "${n.id}" is ${n.tending} but was never decomposed`;
  if (!(u.initial?.duration_sec > 0)) return `step "${n.id}" has no initial hands-on moment`;
  if (n.tending === TENDING.TENDED) {
    if (!(u.checkpoints?.count > 0)) return `step "${n.id}" is tended but has no checkpoints`;
    if (!(u.checkpoints.interval_sec > 0)) return `step "${n.id}" has a non-positive checkpoint interval`;
  } else if (u.checkpoints) {
    return `step "${n.id}" is ${n.tending} but has checkpoints`;
  }
  if (n.tending === TENDING.SET_AND_FORGET) {
    if (u.ending) return `step "${n.id}" is set_and_forget but has an ending moment`;
  } else if (!(u.ending?.duration_sec > 0)) {
    return `step "${n.id}" is ${n.tending} but has no ending moment`;
  }
  return null;
}

/**
 * Reject a plan the app cannot execute. A schema constrains shapes, not
 * sense: it cannot stop a dangling dependency, a cycle or a null
 * duration, and any of those would stall the scheduler.
 *
 * @param {object} plan  { materials, recipes }
 * @param {number} [expectedDishCount]
 * @param {object} [options]
 * @param {boolean} [options.skipUnattended]  before the decomposition pass
 * @returns {string|null} what is wrong, or null
 */
export function validate(plan, expectedDishCount, { skipUnattended = false } = {}) {
  const declared = new Set((plan?.materials || []).map((m) => m.id));
  return checkRecipes(plan, expectedDishCount, (n) => {
    if (!Number.isFinite(n.estimated_duration_sec) || n.estimated_duration_sec <= 0) {
      return `step "${n.id}" has an invalid duration`;
    }
    if (!DIFFICULTIES.includes(n.difficulty)) return `step "${n.id}" has an invalid difficulty "${n.difficulty}"`;
    if (!Array.isArray(n.required_materials)) return `step "${n.id}" has no required_materials list`;
    const undeclared = n.required_materials.find((m) => !declared.has(m));
    if (undeclared) return `step "${n.id}" uses material "${undeclared}", which is not in the materials list`;
    return skipUnattended ? null : checkUnattended(n);
  });
}

// A step too short to leave a real gap between checks was never tended,
// whatever it was called: it is somebody standing at the stove.
function demoteIfTooTight(node, checkpoints) {
  if (!checkpoints || checkpoints.interval_sec >= LEAVABLE_GAP_SEC) return null;
  const { unattended, ...rest } = node;
  return { ...rest, tending: TENDING.HANDS_ON };
}

/**
 * Attach the start / checks / end breakdown a model gave for a
 * non-hands_on step. The model says how many checks; the spacing is
 * derived here from the step's own duration, so the numbers can never
 * disagree. Field names are the decomposition schema's.
 */
export function attachUnattended(node, dec) {
  if (!dec) return node; // validate() reports the gap
  const initial = {
    duration_sec: positiveInt(dec.initial_duration_sec),
    difficulty: oneOf(dec.initial_difficulty, DIFFICULTIES, "low"),
  };
  const ending =
    node.tending !== TENDING.SET_AND_FORGET && Number(dec.ending_duration_sec) > 0
      ? { duration_sec: positiveInt(dec.ending_duration_sec), difficulty: oneOf(dec.ending_difficulty, DIFFICULTIES, "low") }
      : null;

  let checkpoints = null;
  if (node.tending === TENDING.TENDED && Number(dec.checkpoint_count) > 0) {
    const count = Math.round(Number(dec.checkpoint_count));
    const reserved = initial.duration_sec + (ending?.duration_sec || 0);
    const remaining = Math.max(count, Math.round(Number(node.estimated_duration_sec)) - reserved);
    checkpoints = {
      count,
      interval_sec: Math.max(1, Math.round(remaining / count)),
      duration_sec: positiveInt(dec.checkpoint_duration_sec),
      difficulty: oneOf(dec.checkpoint_difficulty, DIFFICULTIES, "low"),
    };
  }
  return demoteIfTooTight(node, checkpoints) || { ...node, unattended: { initial, checkpoints, ending } };
}

/**
 * A deterministic breakdown for a non-hands_on step no model decomposed:
 * the per-dish fallback, and any step the review adds or re-classifies.
 * A short fixed slice off each end, checks spaced evenly in between.
 */
export function heuristicDecompose(node) {
  if (isHandsOn(node)) return node;
  const total = Math.max(1, Math.round(Number(node.estimated_duration_sec)) || 60);
  const edge = Math.min(120, Math.max(20, Math.round(total * 0.08)));
  const difficulty = node.difficulty || "low";
  const initial = { duration_sec: edge, difficulty };
  const ending = node.tending === TENDING.SET_AND_FORGET ? null : { duration_sec: edge, difficulty };

  let checkpoints = null;
  if (node.tending === TENDING.TENDED) {
    const remaining = Math.max(1, total - initial.duration_sec - (ending?.duration_sec || 0));
    const targetInterval = Math.max(LEAVABLE_GAP_SEC, Math.round(total / 8));
    const count = Math.max(1, Math.round(remaining / targetInterval));
    checkpoints = {
      count,
      interval_sec: Math.max(1, Math.round(remaining / count)),
      duration_sec: Math.min(30, Math.max(5, Math.round(total * 0.01))),
      difficulty: "low",
    };
  }
  return demoteIfTooTight(node, checkpoints) || { ...node, unattended: { initial, checkpoints, ending } };
}

/** Into the shape the app's own templates use. */
export function toTemplates(plan, { diet, dishes }) {
  const usageMap = (list) =>
    Object.fromEntries((list || []).map((u) => [u.material_id, { amount: u.amount, unit: u.unit }]));

  return plan.recipes.map((r, i) => ({
    id: `gen_${Date.now()}_${i}`,
    title: r.title,
    dish_idea_raw: r.dish_idea_raw || dishes[i] || r.title,
    diet: diet === "vegetarian" || diet === "vegan" ? "vegetarian" : "none",
    servings_default: r.servings,
    nodes: r.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      description: n.description,
      estimated_duration_sec: n.estimated_duration_sec,
      difficulty: n.difficulty,
      required_equipment: n.required_equipment,
      required_materials: n.required_materials,
      material_usage: usageMap(n.material_usage),
      depends_on: n.depends_on,
      status: "pending",
      phase: n.phase,
      // Unknown falls back to hands_on: assuming a step needs a cook is
      // the safe way to be wrong.
      tending: oneOf(n.tending, TENDING_KINDS, TENDING.HANDS_ON),
      ...(n.unattended && { unattended: n.unattended }),
      ...(n.is_shareable && n.share_key && { is_shareable: true, share_key: n.share_key }),
    })),
  }));
}
