// Second pass: a cook reading the plan back before anyone starts cooking.
//
// Deliberately NOT a second opinion on the whole thing. validate() in
// recipes.js already proves the structural facts — no cycles, no
// dangling depends_on, no undeclared materials, no duplicate ids — and
// it proves them, where a model would only have an opinion. Asking twice
// would be slower and worse.
//
// What code cannot check is whether the cooking is right. Sonnet served
// mouth-watering chicken hot, skipping the chill it is named for, and
// produced a perfectly valid graph doing it. Models mark a congee
// set_and_forget and it scorches; they mark rinsing rice unattended and
// the plan thinks somebody is free who is standing at a sink. Those are
// the failures this pass exists for.
//
// It returns PATCHES, never a plan. A reviewer having a bad day can then
// be ignored fix by fix, and the worst case is the original plan
// unchanged — which is a plan that already passed validation.
// Nothing is imported from recipes.js on purpose. It imports THIS
// module, and a cycle between them meant the review schema touched
// EQUIPMENT before recipes.js had finished initialising — the server
// would not start. The dependency runs one way now: recipes owns the
// plan shape and hands in what this needs.

const GATEWAY = "https://llm-gateway.assemblyai.com/v1/chat/completions";

// Read-and-correct is a smaller job than writing the plan was, and it
// runs after a cook has already waited thirty seconds. It gets a tighter
// budget, and failing it is never fatal.
const TIMEOUT_MS = 45_000;
const MAX_TOKENS = 4000;

// A reviewer that wants to change twenty things has not found twenty
// bugs, it has decided to rewrite the plan. Past this we keep the
// original, which we know is valid.
const MAX_FIXES = 8;

// Only these may be touched. Everything else — ids, materials, the
// equipment vocabulary — is either load-bearing for the graph or already
// enforced, and letting a review rewrite it turns a correction into a
// second generation with no validation behind it.
const PATCHABLE = new Set([
  "tending",
  "check_every_sec",
  "difficulty",
  "estimated_duration_sec",
  "label",
  "description",
  "phase",
]);

// Bounds on what a single step can plausibly take. Ten seconds is
// faster than anyone does anything worth writing down; four hours is
// longer than any one step of a home dinner.
const MIN_STEP_SEC = 10;
const MAX_STEP_SEC = 4 * 60 * 60;

const TENDING = ["hands_on", "tended", "timed", "set_and_forget"];
const DIFFICULTIES = ["low", "medium", "high"];
const PHASES = ["prep", "cook", "plate"];

/**
 * Built per call rather than at module load, because the equipment
 * vocabulary belongs to whoever owns the plan shape and is passed in.
 */
export const buildReviewSchema = (equipment) => ({
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
            kind: {
              type: "string",
              enum: ["set_field", "add_step", "add_dependency"],
            },
            step_id: { type: "string", description: "The step being corrected, or the step a new one must come before. Empty for none." },
            field: { type: "string", description: "For set_field: tending, check_every_sec, difficulty, estimated_duration_sec, label, description or phase. Empty otherwise." },
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
                tending: { type: "string", enum: TENDING },
                check_every_sec: { type: "integer" },
                required_equipment: { type: "array", items: { type: "string", enum: equipment } },
                depends_on: { type: "array", items: { type: "string" } },
              },
              required: [
                "id", "label", "description", "estimated_duration_sec", "difficulty",
                "phase", "tending", "check_every_sec", "required_equipment", "depends_on",
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
});

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

function compactPlan(plan) {
  return plan.recipes
    .map((r) => {
      const steps = r.nodes
        .map(
          (n) =>
            `    ${n.id} | ${n.label} | ${Math.round(n.estimated_duration_sec / 60)}min | ${n.difficulty} | ${n.phase} | ${n.tending}${
              n.check_every_sec ? ` every ${Math.round(n.check_every_sec / 60)}min` : ""
            } | after: ${(n.depends_on || []).join(",") || "-"}\n      ${n.description}`,
        )
        .join("\n");
      return `  ${r.title} (${r.servings} servings)\n${steps}`;
    })
    .join("\n\n");
}

/** Ask for corrections. Returns [] on any failure — never throws. */
export async function reviewPlan({ plan, params, model, apiKey, equipment }) {
  const user = `${params.dishes.join(", ")} for ${params.servings}, ${params.diet}, target ${params.targetTime} minutes, ${params.cooks} cooks.

${compactPlan(plan)}`;

  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { authorization: apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
        response_format: { type: "json_schema", json_schema: buildReviewSchema(equipment) },
        post_processing_steps: [{ type: "json-repair" }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`Plan review unavailable (${res.status}); keeping the plan as generated.`);
      return [];
    }
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    return Array.isArray(parsed?.fixes) ? parsed.fixes : [];
  } catch (err) {
    console.warn("Plan review failed; keeping the plan as generated:", err?.message || err);
    return [];
  }
}

/**
 * Apply what is safe to apply.
 *
 * Every fix is checked against the plan before it lands, and the whole
 * patched plan is re-validated afterwards by the caller. A fix naming a
 * step that does not exist, a field nobody may touch, or a value outside
 * its enum is dropped on its own — one bad suggestion does not cost the
 * others.
 */
export function applyFixes(plan, fixes, validate) {
  const next = JSON.parse(JSON.stringify(plan));
  const stepsById = new Map();
  next.recipes.forEach((r) => r.nodes.forEach((n) => stepsById.set(n.id, { node: n, recipe: r })));

  const applied = [];
  const rejected = [];
  const note = (fix, reason) => rejected.push(`${fix.kind} ${fix.step_id || ""}: ${reason}`);

  for (const fix of (fixes || []).slice(0, MAX_FIXES)) {
    // A correction nobody can explain is not a correction. Asked to
    // review a plan, the model once returned eight fixes: one genuine
    // missing dependency, with a reason — and seven silent rewrites of a
    // single step, including setting a plating step to three seconds. The
    // seven had no `why` between them. Requiring one costs nothing and
    // caught all of them.
    if (!String(fix.why || "").trim()) { note(fix, "no reason given"); continue; }
    if (fix.kind === "set_field") {
      const hit = stepsById.get(fix.step_id);
      if (!hit) { note(fix, "no such step"); continue; }
      if (!PATCHABLE.has(fix.field)) { note(fix, `field ${fix.field} is not patchable`); continue; }
      const raw = fix.value;
      if (fix.field === "tending" && !TENDING.includes(raw)) { note(fix, "bad tending"); continue; }
      if (fix.field === "difficulty" && !DIFFICULTIES.includes(raw)) { note(fix, "bad difficulty"); continue; }
      if (fix.field === "phase" && !PHASES.includes(raw)) { note(fix, "bad phase"); continue; }
      if (fix.field === "check_every_sec" || fix.field === "estimated_duration_sec") {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) { note(fix, "not a number"); continue; }
        // Nothing in a kitchen takes three seconds or eight hours. A
        // reviewer that says so has miscounted a unit, and letting it
        // through would quietly wreck the schedule the plan is built on.
        if (fix.field === "estimated_duration_sec" && (n < MIN_STEP_SEC || n > MAX_STEP_SEC)) {
          note(fix, `${n}s is not a plausible step length`);
          continue;
        }
        // check_every_sec means nothing on a step nobody is leaving.
        if (fix.field === "check_every_sec" && hit.node.tending !== "tended") {
          note(fix, `check_every_sec on a ${hit.node.tending} step`);
          continue;
        }
        hit.node[fix.field] = Math.round(n);
      } else {
        if (!String(raw).trim()) { note(fix, "empty value"); continue; }
        hit.node[fix.field] = String(raw);
      }
      applied.push(`${fix.step_id}.${fix.field} = ${raw} (${fix.why})`);
      continue;
    }

    if (fix.kind === "add_dependency") {
      const hit = stepsById.get(fix.step_id);
      const dep = stepsById.get(fix.depends_on_id);
      if (!hit || !dep) { note(fix, "unknown step"); continue; }
      if (hit.recipe !== dep.recipe) { note(fix, "crosses dishes"); continue; }
      if ((hit.node.depends_on || []).includes(fix.depends_on_id)) { note(fix, "already there"); continue; }
      hit.node.depends_on = [...(hit.node.depends_on || []), fix.depends_on_id];
      applied.push(`${fix.step_id} after ${fix.depends_on_id} (${fix.why})`);
      continue;
    }

    if (fix.kind === "add_step") {
      const anchor = stepsById.get(fix.step_id);
      const step = fix.new_step;
      if (!anchor) { note(fix, "no anchor step"); continue; }
      if (!step?.id || stepsById.has(step.id)) { note(fix, "missing or duplicate id"); continue; }
      // A new step may only depend on steps already in that dish, and
      // the anchor is made to depend on IT — which is the whole point:
      // the chill goes between the poach and the chop.
      const known = new Set(anchor.recipe.nodes.map((n) => n.id));
      const deps = (step.depends_on || []).filter((d) => known.has(d));
      const node = {
        ...step,
        depends_on: deps,
        required_materials: [],
        material_usage: [],
        status: "pending",
        is_shareable: false,
        share_key: "",
      };
      anchor.recipe.nodes.push(node);
      anchor.node.depends_on = [...new Set([...(anchor.node.depends_on || []), node.id])];
      stepsById.set(node.id, { node, recipe: anchor.recipe });
      applied.push(`+${node.id} before ${fix.step_id} (${fix.why})`);
      continue;
    }

    note(fix, `unknown kind ${fix.kind}`);
  }

  // The reviewer is not trusted to have kept the graph sound. If the
  // patched plan does not validate, the original stands — it already did.
  const problem = validate ? validate(next) : null;
  if (problem) return { plan, applied: [], rejected: [...rejected, `patched plan invalid: ${problem}`] };
  return { plan: next, applied, rejected };
}
