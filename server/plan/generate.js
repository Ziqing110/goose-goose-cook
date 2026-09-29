// Turning the conversation's dishes into a validated plan.
//
// PRIMARY: one model sees every dish at every pass (skeleton, detail,
// decomposition). Seeing the dishes together is what makes shared prep
// possible at all: a model that never sees two dishes together cannot
// notice they both need garlic minced. gemini-3.8-flash was chosen on a
// three-dish benchmark: it was the fastest model that remembered
// mouth-watering chicken is CHILLED before it is sauced. (claude-sonnet-5
// and claude-opus-5 are not options: neither supports response_format on
// the gateway.)
//
// FALLBACK: the small model a free-tier account always has. Asked for
// several dishes at once it merged them or ran out of tokens, but one
// dish at a time it is reliable in about four seconds. So it plans each
// dish separately and the results are merged; nothing is shared, which is
// a worse plan but still a working one.
//
// Then a different model reviews the plan (see review.js).
import { chat, extractJson, GatewayError } from "../llm.js";
import {
  SYSTEM,
  SKELETON_SCHEMA,
  DETAIL_SCHEMA,
  DECOMPOSITION_SCHEMA,
  FALLBACK_FORMAT,
  buildSkeletonPrompt,
  buildDetailPrompt,
  buildDecompositionPrompt,
  buildFallbackPrompt,
} from "./prompts.js";
import { attachUnattended, heuristicDecompose, validate, validateSkeleton } from "./shape.js";
import { reviewPlan, applyFixes } from "./review.js";

const MODEL = process.env.AAI_RECIPE_MODEL || "gemini-3.8-flash";
const FALLBACK_MODEL = process.env.AAI_RECIPE_FALLBACK_MODEL || "qwen3.5-4b-32k-fast";
// A second model reads the plan back. Writing a plan and reviewing one
// are different skills: given four planted faults, Sonnet 4.6 found all
// four, both Gemini models only one.
const REVIEW_MODEL = process.env.AAI_RECIPE_REVIEW_MODEL || "claude-sonnet-4-6";
const REVIEW_ENABLED = process.env.AAI_RECIPE_REVIEW !== "off";

// One wall clock for the whole request, inside the client's 150s: every
// pass, the fallback and the review spend from it, so no chain of
// per-call timeouts can outlast the browser that is waiting. The primary
// may use only part of it, so a stalled primary still leaves the
// fallback time to run.
const TOTAL_BUDGET_MS = 140_000;
const PRIMARY_BUDGET_MS = 100_000;
// A whole multi-dish graph is a lot of tokens, and a truncated graph is
// worse than none. The fallback model runs away when given room, so it
// is capped by the same number rather than more.
const MAX_TOKENS = 8000;
const FALLBACK_TIMEOUT_MS = 60_000;
const REVIEW_TIMEOUT_MS = 45_000;
// Not worth starting a review with less than this left.
const MIN_REVIEW_MS = 10_000;

/** A model reply that was not a usable plan. */
class PlanError extends Error {}

const unattended = (n) => n.tending && n.tending !== "hands_on";

/** Every step the detail pass marked as needing more than a cook's hands. */
export const unattendedNodes = (plan) => plan.recipes.flatMap((r) => r.nodes.filter(unattended));

/**
 * Fold the detail pass onto the skeleton by step id. Structure (id,
 * label, phase, depends_on, sharing) comes from the already-validated
 * skeleton; `problem` names a step the detail pass skipped.
 */
export function mergeDetail(skeleton, detail) {
  const byId = new Map((detail?.steps || []).map((s) => [s.step_id, s]));
  let problem = null;
  const recipes = skeleton.recipes.map((r) => ({
    title: r.title,
    dish_idea_raw: r.dish_idea_raw,
    servings: r.servings,
    nodes: r.nodes.map((n) => {
      const d = byId.get(n.id);
      if (!d) problem ??= `step "${n.id}" was never detailed`;
      return {
        id: n.id,
        label: n.label,
        phase: n.phase,
        depends_on: n.depends_on,
        is_shareable: n.is_shareable,
        share_key: n.share_key,
        description: d?.description ?? "",
        estimated_duration_sec: d?.estimated_duration_sec ?? 0,
        difficulty: d?.difficulty ?? "low",
        required_equipment: d?.required_equipment ?? [],
        required_materials: d?.required_materials ?? [],
        material_usage: d?.material_usage ?? [],
        tending: d?.tending ?? "hands_on",
      };
    }),
  }));
  return { plan: { materials: detail?.materials || [], recipes }, problem };
}

/** Attach the decomposition pass to the steps it covers. */
export function mergeDecomposition(plan, decomposition) {
  const byId = new Map((decomposition?.steps || []).map((d) => [d.step_id, d]));
  return {
    ...plan,
    recipes: plan.recipes.map((r) => ({
      ...r,
      nodes: r.nodes.map((n) => (unattended(n) ? attachUnattended(n, byId.get(n.id)) : n)),
    })),
  };
}

function budget(deadline, cap = Infinity) {
  const left = deadline - Date.now();
  if (left <= 0) throw new GatewayError("Recipe generation ran out of time.", 504);
  return Math.min(cap, left);
}

/** One schema-constrained pass of the primary model, parsed. */
async function primaryPass({ user, schema, deadline, pass }) {
  const choice = await chat({
    model: MODEL,
    maxTokens: MAX_TOKENS,
    timeoutMs: budget(deadline),
    // Planning is not writing: left at the default temperature this model
    // once produced a step called "submerge_big_wall" using a material
    // named "f".
    temperature: 0,
    schema,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
  });
  const parsed = extractJson(choice?.message?.content);
  if (!parsed) throw new PlanError(`${pass}: unparseable (finish_reason ${choice?.finish_reason})`);
  return parsed;
}

async function generateTogether(params, deadline) {
  const expected = params.dishes.length;
  const check = (problem, pass) => {
    if (problem) throw new PlanError(pass ? `${pass}: ${problem}` : problem);
  };

  const skeleton = await primaryPass({ user: buildSkeletonPrompt(params), schema: SKELETON_SCHEMA, deadline, pass: "skeleton" });
  check(validateSkeleton(skeleton, expected), "skeleton");

  const detail = await primaryPass({ user: buildDetailPrompt(params, skeleton), schema: DETAIL_SCHEMA, deadline, pass: "detail" });
  const { plan: detailed, problem } = mergeDetail(skeleton, detail);
  check(problem, "detail");
  check(validate(detailed, expected, { skipUnattended: true }));

  let plan = detailed;
  const toDecompose = unattendedNodes(plan);
  if (toDecompose.length) {
    const decomposition = await primaryPass({
      user: buildDecompositionPrompt(params, toDecompose),
      schema: DECOMPOSITION_SCHEMA,
      deadline,
      pass: "decomposition",
    });
    plan = mergeDecomposition(plan, decomposition);
  }
  check(validate(plan, expected));
  return { plan, model: MODEL, shared: true };
}

/** One dish with the fallback model, validated on its own. */
async function planOneDish(params, dish, deadline) {
  const choice = await chat({
    model: FALLBACK_MODEL,
    maxTokens: MAX_TOKENS,
    timeoutMs: budget(deadline, FALLBACK_TIMEOUT_MS),
    temperature: 0,
    messages: [
      { role: "system", content: `${SYSTEM}\n\n${FALLBACK_FORMAT}` },
      { role: "user", content: buildFallbackPrompt({ ...params, dishes: [dish] }) },
    ],
  });
  const plan = extractJson(choice?.message?.content);
  if (!plan?.recipes?.length) throw new PlanError(`unparseable (finish_reason ${choice?.finish_reason})`);

  // This model is never asked for the decomposition pass; the breakdown
  // is derived here so validate() sees a complete plan.
  for (const recipe of plan.recipes) {
    recipe.nodes = (recipe.nodes || []).map(heuristicDecompose);
    // The call was about ONE dish we named, so its identity is not the
    // model's to decide: asked for mouth-watering chicken it once titled
    // the result "Mapo Chicken".
    recipe.dish_idea_raw = dish;
    recipe.title = dish;
  }
  const problem = validate(plan, 1);
  if (problem) throw new PlanError(problem);
  return plan;
}

/**
 * Each dish in its own call, in parallel, with one retry apiece (the
 * failures seen here are transient far more often than not). Dishes
 * that still fail are named in `failed` rather than silently dropped.
 */
async function generatePerDish(params, deadline) {
  const results = await Promise.allSettled(
    params.dishes.map((dish) =>
      planOneDish(params, dish, deadline).catch((err) => {
        console.warn(`Recipe fallback retrying "${dish}" after: ${err.message}`);
        return planOneDish(params, dish, deadline);
      }),
    ),
  );

  const merged = { materials: [], recipes: [] };
  const stepIds = new Set();
  const failed = [];

  results.forEach((result, i) => {
    if (result.status === "rejected") {
      failed.push(`${params.dishes[i]}: ${result.reason.message}`);
      return;
    }
    const plan = result.value;
    for (const recipe of plan.recipes) {
      // Each call names its steps without knowing the others, so ids can
      // collide, and a collision would tie one dish's step to another's.
      const renamed = new Map();
      for (const node of recipe.nodes) {
        let id = node.id;
        for (let n = 2; stepIds.has(id); n++) id = `${node.id}_${n}`;
        if (id !== node.id) renamed.set(node.id, id);
        stepIds.add(id);
        node.id = id;
      }
      for (const node of recipe.nodes) {
        node.depends_on = node.depends_on.map((d) => renamed.get(d) ?? d);
      }
      merged.recipes.push(recipe);
    }
    for (const material of plan.materials || []) {
      if (!merged.materials.some((m) => m.id === material.id)) merged.materials.push(material);
    }
  });

  if (!merged.recipes.length) throw new PlanError(`every dish failed (${failed.join("; ")})`);
  const problem = validate(merged);
  if (problem) throw new PlanError(problem);
  return { plan: merged, model: FALLBACK_MODEL, shared: false, failed };
}

/**
 * The whole job: primary, fallback if it fails for any reason but a rate
 * limit (which the fallback would hit too), then review.
 *
 * @returns {Promise<{plan, model, shared, failed?, reviewFixes: string[]}>}
 * @throws {GatewayError|PlanError}
 */
export async function generatePlan(params) {
  const started = Date.now();
  const deadline = started + TOTAL_BUDGET_MS;

  let result;
  try {
    result = await generateTogether(params, started + PRIMARY_BUDGET_MS);
  } catch (err) {
    if (err.status === 429) throw err;
    console.warn(`Recipe primary (${MODEL}) failed: ${err.message}`);
    result = await generatePerDish(params, deadline);
    console.info(`Recipe fallback (${FALLBACK_MODEL}) produced ${result.plan.recipes.length} dish(es), unshared.`);
  }

  // Only ever improves the plan or leaves it alone: reviewPlan returns []
  // on any failure, and applyFixes keeps the original if the patched plan
  // does not validate.
  let reviewFixes = [];
  const reviewMs = Math.min(REVIEW_TIMEOUT_MS, deadline - Date.now());
  if (REVIEW_ENABLED && reviewMs >= MIN_REVIEW_MS) {
    const fixes = await reviewPlan({ plan: result.plan, params, model: REVIEW_MODEL, timeoutMs: reviewMs });
    if (fixes.length) {
      const review = applyFixes(result.plan, fixes);
      review.applied.forEach((a) => console.info(`Recipe review fixed: ${a}`));
      review.rejected.forEach((r) => console.warn(`Recipe review rejected: ${r}`));
      result = { ...result, plan: review.plan };
      reviewFixes = review.applied;
    }
  }
  return { ...result, reviewedBy: REVIEW_ENABLED ? REVIEW_MODEL : null, reviewFixes };
}
