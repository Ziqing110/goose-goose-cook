// Second pass: a cook reading the plan back before anyone starts cooking.
//
// Not a second opinion on structure: validate() already proves there are
// no cycles, dangling dependencies or undeclared materials. What code
// cannot check is whether the cooking is right: a cold dish served hot, a
// congee marked set_and_forget that will scorch, rinsing rice marked
// unattended while somebody stands at the sink.
//
// It returns PATCHES, never a plan. Each fix is vetted on its own, and
// the worst case is the original plan unchanged, which already passed
// validation.
import { chat, extractJson } from "../llm.js";
import { DIFFICULTIES, EQUIPMENT, PHASES, TENDING_KINDS, attachUnattended, heuristicDecompose, validate } from "./shape.js";

const MAX_TOKENS = 4000;

// A reviewer that wants to change twenty things has not found twenty
// bugs, it has decided to rewrite the plan.
const MAX_FIXES = 8;

// Only these may be touched. Ids, materials and equipment are either
// load-bearing for the graph or already enforced.
const ALLOWED_VALUES = {
  tending: TENDING_KINDS,
  difficulty: DIFFICULTIES,
  phase: PHASES,
  label: null,
  description: null,
  estimated_duration_sec: null,
};

// Nothing in a home kitchen takes under ten seconds or over four hours;
// a reviewer that says so has miscounted a unit.
const MIN_STEP_SEC = 10;
const MAX_STEP_SEC = 4 * 60 * 60;

const SCHEMA = {
  name: "plan_review",
  strict: true,
  schema: {
    type: "object",
    properties: {
      fixes: {
        type: "array",
        description: "Only real problems. An empty list is the right answer for a good plan.",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["set_field", "add_step", "add_dependency"] },
            step_id: { type: "string", description: "The step being corrected, or the step a new one must come before. Empty for none." },
            field: { type: "string", description: `For set_field: ${Object.keys(ALLOWED_VALUES).join(", ")}. Empty otherwise.` },
            value: { type: "string", description: "For set_field: the new value as a string; numbers as digits. Empty otherwise." },
            depends_on_id: { type: "string", description: "For add_dependency: the step that must finish first. Empty otherwise." },
            new_step: {
              type: "object",
              description: "For add_step only. Ignored otherwise.",
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                description: { type: "string" },
                estimated_duration_sec: { type: "integer" },
                difficulty: { type: "string", enum: DIFFICULTIES },
                phase: { type: "string", enum: PHASES },
                tending: { type: "string", enum: TENDING_KINDS },
                // The decomposition pass's fields, so a new unattended step
                // can carry its own breakdown. 0 where one does not apply.
                initial_duration_sec: { type: "integer", description: "0 when tending is hands_on." },
                initial_difficulty: { type: "string", enum: DIFFICULTIES },
                checkpoint_count: { type: "integer", description: "0 unless tending is tended." },
                checkpoint_duration_sec: { type: "integer" },
                checkpoint_difficulty: { type: "string", enum: DIFFICULTIES },
                ending_duration_sec: { type: "integer", description: "0 when tending is hands_on or set_and_forget." },
                ending_difficulty: { type: "string", enum: DIFFICULTIES },
                required_equipment: { type: "array", items: { type: "string", enum: EQUIPMENT } },
                depends_on: { type: "array", items: { type: "string" } },
              },
              required: [
                "id", "label", "description", "estimated_duration_sec", "difficulty", "phase", "tending",
                "initial_duration_sec", "initial_difficulty", "checkpoint_count", "checkpoint_duration_sec",
                "checkpoint_difficulty", "ending_duration_sec", "ending_difficulty",
                "required_equipment", "depends_on",
              ],
              additionalProperties: false,
            },
            why: {
              type: "string",
              description:
                "ALWAYS fill this in, for every fix, whatever its kind. One short sentence saying what is wrong in cooking terms — it is what a person reads in the log when they wonder why the plan changed under them. The other fields may be left empty when they do not apply to this kind; this one never may.",
            },
          },
          required: ["kind", "step_id", "field", "value", "depends_on_id", "new_step", "why"],
          additionalProperties: false,
        },
      },
    },
    required: ["fixes"],
    additionalProperties: false,
  },
};

const SYSTEM = `You are an experienced cook reading a plan back before anyone starts.

You are NOT checking structure. Dependencies, ids and ingredient lists
have already been machine-verified and are correct. Do not report them.

Look for cooking that is wrong, and for four things in particular:

1. A dish made incorrectly. The commonest by far is a cold dish served
   hot — mouth-watering chicken is poached, CHILLED, then chopped and
   sauced; a plan that goes poach, chop, sauce has made a different dish.
   Add the missing step rather than describing the problem.

2. tending set wrong. hands_on means someone must be there throughout.
   tended means it runs alone but must be checked as it goes and finished
   on time — a congee that scorches. timed means nothing to do in between
   but the end moment matters — an ice bath. set_and_forget means nobody
   minds being ten minutes late — soaking, proving, resting. Rinsing rice
   is two minutes at a sink, so it is hands_on however easy it is. A pot
   that cannot be left at all — a risotto stirred constantly — is
   hands_on for its whole duration, not tended.

3. Durations that are not real. A whole chicken does not poach in five
   minutes; garlic is not minced in fifteen.

4. An order that is wrong even though it is legal — a sauce built before
   its aromatics are prepared, a garnish cut after the dish is plated.

Report nothing you are not confident about. An empty list is the right
answer for a good plan, and is much better than an invented fix.`;

// Whole minutes hide short steps: a 20s garnish rounds to "0min" and the
// reviewer then "fixes" a duration that was never zero.
const formatDuration = (sec) => (sec < 120 ? `${Math.round(sec)}s` : `${Math.round(sec / 60)}min`);

function compactPlan(plan) {
  return plan.recipes
    .map((r) => {
      const steps = r.nodes
        .map((n) => {
          const every = n.unattended?.checkpoints ? ` every ${Math.round(n.unattended.checkpoints.interval_sec / 60)}min` : "";
          const after = (n.depends_on || []).join(",") || "-";
          return `    ${n.id} | ${n.label} | ${formatDuration(n.estimated_duration_sec)} | ${n.difficulty} | ${n.phase} | ${n.tending}${every} | after: ${after}\n      ${n.description}`;
        })
        .join("\n");
      return `  ${r.title} (${r.servings} servings)\n${steps}`;
    })
    .join("\n\n");
}

/** Ask for corrections. Returns [] on any failure — never throws. */
export async function reviewPlan({ plan, params, model, timeoutMs }) {
  const user = `${params.dishes.join(", ")} for ${params.servings}, ${params.diet}, target ${params.targetTime} minutes, ${params.cooks} cooks.

${compactPlan(plan)}`;

  try {
    const choice = await chat({
      model,
      maxTokens: MAX_TOKENS,
      timeoutMs,
      temperature: 0,
      schema: SCHEMA,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    });
    const fixes = extractJson(choice?.message?.content)?.fixes;
    return Array.isArray(fixes) ? fixes : [];
  } catch (err) {
    console.warn("Plan review failed; keeping the plan as generated:", err.message);
    return [];
  }
}

function replaceNode(hit, node) {
  hit.recipe.nodes[hit.recipe.nodes.indexOf(hit.node)] = node;
  hit.node = node;
}

// Each returns an error reason, or applies the fix and returns null.
const APPLY = {
  set_field(fix, steps) {
    const hit = steps.get(fix.step_id);
    if (!hit) return "no such step";
    if (!(fix.field in ALLOWED_VALUES)) return `field ${fix.field} is not patchable`;
    const allowed = ALLOWED_VALUES[fix.field];
    if (allowed && !allowed.includes(fix.value)) return `bad ${fix.field}`;

    if (fix.field === "estimated_duration_sec") {
      const sec = Number(fix.value);
      if (!Number.isFinite(sec) || sec < MIN_STEP_SEC || sec > MAX_STEP_SEC) return `${fix.value}s is not a plausible step length`;
      hit.node.estimated_duration_sec = Math.round(sec);
      return null;
    }
    if (!String(fix.value).trim()) return "empty value";
    hit.node[fix.field] = String(fix.value);
    // A new tending kind needs a breakdown shaped for that kind.
    if (fix.field === "tending") {
      const { unattended, ...node } = hit.node;
      replaceNode(hit, heuristicDecompose(node));
    }
    return null;
  },

  add_dependency(fix, steps) {
    const hit = steps.get(fix.step_id);
    const dep = steps.get(fix.depends_on_id);
    if (!hit || !dep) return "unknown step";
    if (hit.recipe !== dep.recipe) return "crosses dishes";
    if (hit.node.depends_on.includes(fix.depends_on_id)) return "already there";
    hit.node.depends_on.push(fix.depends_on_id);
    return null;
  },

  // The anchor is made to depend on the new step, which is the point:
  // the chill goes between the poach and the chop.
  add_step(fix, steps) {
    const anchor = steps.get(fix.step_id);
    const step = fix.new_step;
    if (!anchor) return "no anchor step";
    if (!step?.id || steps.has(step.id)) return "missing or duplicate id";

    const known = new Set(anchor.recipe.nodes.map((n) => n.id));
    let node = {
      id: step.id,
      label: step.label,
      description: step.description,
      estimated_duration_sec: step.estimated_duration_sec,
      difficulty: step.difficulty,
      phase: step.phase,
      tending: step.tending,
      required_equipment: step.required_equipment,
      depends_on: (step.depends_on || []).filter((d) => known.has(d)),
      required_materials: [],
      material_usage: [],
      is_shareable: false,
      share_key: "",
    };
    // Trust the reviewer's own breakdown when it gave one; otherwise
    // derive it the way the fallback path does.
    if (node.tending !== "hands_on") {
      node = Number(step.initial_duration_sec) > 0 ? attachUnattended(node, step) : heuristicDecompose(node);
    }
    anchor.recipe.nodes.push(node);
    if (!anchor.node.depends_on.includes(node.id)) anchor.node.depends_on.push(node.id);
    steps.set(node.id, { node, recipe: anchor.recipe });
    return null;
  },
};

const describe = (fix) =>
  fix.kind === "add_step"
    ? `+${fix.new_step?.id} before ${fix.step_id}`
    : fix.kind === "add_dependency"
      ? `${fix.step_id} after ${fix.depends_on_id}`
      : `${fix.step_id}.${fix.field} = ${fix.value}`;

/**
 * Apply what is safe to apply. A fix naming a step that does not exist, a
 * field nobody may touch, or a value outside its enum is dropped on its
 * own; one bad suggestion does not cost the others. If the patched plan
 * does not validate, the original stands.
 */
export function applyFixes(plan, fixes) {
  const next = structuredClone(plan);
  const steps = new Map();
  next.recipes.forEach((recipe) => recipe.nodes.forEach((node) => steps.set(node.id, { node, recipe })));

  const applied = [];
  const rejected = [];
  for (const fix of (fixes || []).slice(0, MAX_FIXES)) {
    // A correction nobody can explain is not a correction: in testing,
    // every silent rewrite the reviewer made was also a wrong one.
    const reason = !String(fix.why || "").trim()
      ? "no reason given"
      : APPLY[fix.kind]
        ? APPLY[fix.kind](fix, steps)
        : `unknown kind ${fix.kind}`;
    if (reason) rejected.push(`${describe(fix)}: ${reason}`);
    else applied.push(`${describe(fix)} (${fix.why})`);
  }

  const problem = validate(next);
  if (problem) return { plan, applied: [], rejected: [...rejected, `patched plan invalid: ${problem}`] };
  return { plan: next, applied, rejected };
}
