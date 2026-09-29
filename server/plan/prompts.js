// Schemas and prompts for recipe generation.
//
// The primary path asks in three passes, each with its own schema:
//   1. skeleton       what steps exist and how they depend on each other
//   2. detail         duration, difficulty, equipment, materials, tending
//   3. decomposition  each unattended step's start, checks and end
// Asking all three at once lost the third: check counts came back
// suspiciously round, or a step's start was never told apart from its
// whole run.
//
// The fallback path asks a small model for one dish at a time in a
// single prose-described JSON shape, because it supports no schema.
import { CATEGORIES, DIFFICULTIES, EQUIPMENT, PHASES, TENDING_KINDS } from "./shape.js";

export const SYSTEM =
  "You plan real cooking as a dependency graph. You are precise about time, equipment contention, and what can happen in parallel. You never pad a plan with commentary — every step is something someone does.";

// --- shared prompt parts ------------------------------------------------

const SKILL_DETAIL = {
  beginner:
    "The cook is new to this. Every description should explain the technique, what to look for, and what going wrong looks like — 2 to 3 sentences. Break steps down finely.",
  regular: "The cook cooks regularly. One clear sentence per description. Standard step size.",
  confident:
    "The cook is confident. Keep descriptions to a short phrase — they only need reminding, not teaching. Larger steps are fine.",
};

// Said plainly, because a model told about a beginner will otherwise
// start proposing an easier dish.
const SKILL_IS_NOT_A_GATE =
  "The skill setting controls only how much each description explains. It is NEVER a reason to simplify the dish, substitute an easier technique, or suggest something else. A beginner attempting a hard dish is expected and welcome — teach it properly rather than avoiding it.";

const TENDING_RULES = `- Set the tending field on every step. hands_on is what lets the plan know somebody is occupied; the other three are what let the other cook work during a 40-minute congee instead of standing over it, and what let one person have several pots going.
- Be careful between tended and set_and_forget, because they are treated very differently. Ask: if nobody comes back for ten extra minutes, is anything wrong? Congee scorching on the bottom, a pot boiling over, a poach breaking into a boil — tended. Rice soaking, chicken chilling, meat resting — set_and_forget.
- None of the unattended kinds mean "easy". They mean the cook STARTS it and walks away. Rinsing rice is two minutes of standing at a sink, so it is hands_on even though it is easy; soaking the rinsed rice for thirty minutes is set_and_forget. If the person has to be there while it happens, it is hands_on however little skill it takes.
- Separate "does it need watching" from "does it matter when it ends". A congee needs both, so it is tended. An ice bath needs nothing in between but has to come out at eight minutes, so it is timed. Rice soaking needs neither, so it is set_and_forget.
- If the cook cannot walk away at all — a risotto that wants constant stirring, a custard that splits the moment you stop — that is hands_on for its whole duration, however long. Getting this wrong tells the plan somebody is free when they are standing at the stove.`;

const DEPENDENCY_RULES = (cooks) => `- depends_on refers to step ids in the SAME dish. The graph must be acyclic and every id must exist.
- Steps that could run at the same time must NOT depend on each other. ${cooks} cooks are working, so independent prep is what makes the target time reachable.`;

const SHARING_RULE = (dishes) =>
  dishes.length > 1
    ? `- These dishes share a kitchen. Where two dishes need the IDENTICAL prep (same ingredient, same cut), mark both steps is_shareable true with the same share_key, so the work can be done once. Every other step has is_shareable false and share_key "".`
    : `- Only one dish, so nothing is shareable: is_shareable is false and share_key is "" on every step.`;

const MATERIAL_RULES = (servings) => `- Scale every material_usage amount to ${servings} servings, using about 500g per person as the reference portion for a dish's main ingredient (so a chicken-wing main is roughly 500g for one person, 2500g for five) — adjust for the dish, but do not drift far from that anchor without reason.
- Respect the dietary constraint in ingredient choice. Do not add a note about it; just design around it.
- Every material id used by any step must appear exactly once in the top-level materials list, and nothing else should appear there.`;

/** The kitchen and the cook, described the same way to every pass. */
function planContext({ servings, diet, skill, targetTime, cooks, kitchen }) {
  const kit = [
    `${kitchen.burners} stove burner(s)`,
    kitchen.hasWok && "a wok",
    kitchen.hasOven && "an oven",
    `${kitchen.pots} pot(s)`,
    `${kitchen.cuttingBoards} cutting board(s)`,
  ].filter(Boolean).join(", ");

  const allowed = EQUIPMENT.filter(
    (e) => (e !== "wok" || kitchen.hasWok) && (e !== "oven" || kitchen.hasOven) && (e !== "pot" || kitchen.pots > 0),
  );

  return {
    detail: SKILL_DETAIL[skill] || "One clear sentence per description.",
    equipmentRules: `- required_equipment may only use: ${allowed.join(", ")}. This kitchen has nothing else.
- Never require more of one piece of equipment at the same time than the kitchen has. With ${kitchen.burners} burner(s), at most ${kitchen.burners} steps may occupy a burner concurrently.`,
    header: `SERVINGS: ${servings}\nDIETARY: ${diet}\nTARGET: ${targetTime} minutes from start to plated\nCOOKS: ${cooks} people cooking in parallel\nKITCHEN: ${kit}`,
  };
}

const jsonSchema = (name, properties) => ({
  name,
  strict: true,
  schema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
});

const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

// --- pass 1: skeleton ---------------------------------------------------

export const SKELETON_SCHEMA = jsonSchema("recipe_skeleton", {
  recipes: {
    type: "array",
    items: object({
      title: { type: "string" },
      dish_idea_raw: { type: "string", description: "The dish as the cook named it." },
      servings: { type: "integer" },
      nodes: {
        type: "array",
        items: object({
          id: { type: "string", description: "snake_case, unique within this dish" },
          label: { type: "string", description: "Imperative, under 6 words: 'Cut tofu into cubes'" },
          phase: { type: "string", enum: PHASES },
          depends_on: {
            type: "array",
            items: { type: "string" },
            description: "ids of steps in THIS dish that must finish first. Empty for steps that can start immediately.",
          },
          is_shareable: {
            type: "boolean",
            description: "True only when another dish in this run needs the identical prep and it could be done once.",
          },
          share_key: {
            type: "string",
            description: "Identical string on every step that shares the work, e.g. 'mince_garlic'. Empty string when not shareable.",
          },
        }),
      },
    }),
  },
});

export function buildSkeletonPrompt(params) {
  const { header } = planContext(params);
  return `Plan the cooking for tonight as a dependency graph of steps. This is the FIRST pass: name the steps and how they depend on each other. Duration, difficulty and how unattended time works come later — do not think about them yet.

DISHES (all of them, cooked in the same session): ${params.dishes.join(", ")}
${header}

Rules:
${DEPENDENCY_RULES(params.cooks)}
- Break the dish down at the grain a ${params.skill} cook would actually think in — not so coarse that "cook the dish" is one step, not so fine that stirring twice is two steps.
${SHARING_RULE(params.dishes)}`;
}

// --- pass 2: detail -----------------------------------------------------

const MATERIAL = object({
  id: { type: "string", description: "snake_case" },
  label: { type: "string" },
  category: { type: "string", enum: CATEGORIES },
  amount: { type: "number", description: "Total across the whole run, scaled to servings." },
  unit: { type: "string" },
});

export const DETAIL_SCHEMA = jsonSchema("recipe_detail", {
  materials: { type: "array", description: "Every material referenced by any step, once each.", items: MATERIAL },
  steps: {
    type: "array",
    items: object({
      step_id: { type: "string", description: "Must match a step id from the skeleton exactly." },
      description: { type: "string", description: "How to do it. Length depends on the skill setting." },
      estimated_duration_sec: { type: "integer", description: "The WHOLE step, start to finish, however much of it needs a cook." },
      difficulty: { type: "string", enum: DIFFICULTIES },
      required_equipment: { type: "array", items: { type: "string", enum: EQUIPMENT } },
      required_materials: { type: "array", items: { type: "string" }, description: "material ids used in this step" },
      material_usage: {
        type: "array",
        description: "How much of each material this step uses, already scaled to the serving count.",
        items: object({
          material_id: { type: "string" },
          amount: { type: "number" },
          unit: { type: "string" },
        }),
      },
      tending: {
        type: "string",
        enum: TENDING_KINDS,
        description:
          "How much of a cook this step needs while it runs. hands_on: occupies someone throughout — chopping, stir-frying, anything where they have to be there. tended: runs without a cook but must be CHECKED while it goes and finished on time — a congee that scorches if it is not stirred, a poach held at a bare simmer. timed: runs alone with nothing to do in between, but the END MOMENT matters — an ice bath the chicken comes out of at eight minutes, a blanch. set_and_forget: runs alone and nobody minds when you get back — rice soaking, dough proving, meat resting. Whatever is not hands_on gets broken into an initial task, checks and an ending task in the NEXT pass — do not describe that breakdown here, just classify.",
      },
    }),
  },
});

/** A read-only view of the skeleton, so later passes have context without a reason to touch structure. */
function describeSkeleton(skeleton) {
  return skeleton.recipes
    .map((r) => `${r.title} (${r.servings} servings):\n${r.nodes.map((n) => `  ${n.id} [${n.phase}] ${n.label} — after: ${(n.depends_on || []).join(", ") || "-"}`).join("\n")}`)
    .join("\n\n");
}

export function buildDetailPrompt(params, skeleton) {
  const { detail, equipmentRules, header } = planContext(params);
  return `Here is the step-by-step shape already agreed for tonight's cooking. Fill in the detail for every step. Do not add, remove, rename or reorder steps — one steps entry per step_id below, using its exact id.

${header}

STEP DETAIL: ${detail}

${SKILL_IS_NOT_A_GATE}

STEPS:
${describeSkeleton(skeleton)}

Rules:
${equipmentRules}
${TENDING_RULES}
- estimated_duration_sec is the step's WHOLE wall-clock length, from start to done, whatever its tending — the moments a cook actually spends on it come in the next pass and must fit inside this number.
${MATERIAL_RULES(params.servings)}`;
}

// --- pass 3: decomposition ----------------------------------------------
//
// Checkpoint SPACING is not asked for: a count and an interval invite
// arithmetic that does not add up to the step's duration. The model says
// how many checks; attachUnattended divides the time evenly.

export const DECOMPOSITION_SCHEMA = jsonSchema("unattended_decomposition", {
  steps: {
    type: "array",
    items: object({
      step_id: { type: "string", description: "Must match a step id from the plan exactly." },
      initial_duration_sec: {
        type: "integer",
        description: "The hands-on act of starting it: seasoning, browning, dumping rice in water. Not the whole run.",
      },
      initial_difficulty: { type: "string", enum: DIFFICULTIES },
      checkpoint_count: {
        type: "integer",
        description:
          "How many times a cook must come back WHILE it runs. 0 for timed and set_and_forget — those have nothing to check in between. For tended, how many real checks a step like this needs (a congee stirred every five minutes for forty minutes is about 8), never 0.",
      },
      checkpoint_duration_sec: {
        type: "integer",
        description: "How long one check takes — a stir, a glance at the pot. 0 when checkpoint_count is 0.",
      },
      checkpoint_difficulty: {
        type: "string",
        enum: DIFFICULTIES,
        description: "Difficulty of one check, not the step. Almost always low. Any value when checkpoint_count is 0.",
      },
      ending_duration_sec: {
        type: "integer",
        description:
          "The hands-on act of finishing it — pulling it off, plating, fishing it out of the ice bath. 0 for set_and_forget, which is never collected on a schedule; required and greater than 0 for tended and timed.",
      },
      ending_difficulty: { type: "string", enum: DIFFICULTIES },
    }),
  },
});

/** @param {object[]} nodes  the plan's non-hands_on steps */
export function buildDecompositionPrompt(params, nodes) {
  const { header } = planContext(params);
  const list = nodes
    .map((n) => `${n.id} [${n.tending}, ${Math.round(n.estimated_duration_sec / 60)}min total, ${n.difficulty}]: ${n.label} — ${n.description}`)
    .join("\n");

  return `These steps from tonight's cooking run WITHOUT a cook for some or all of their length. Break each one into the actual hands-on moments inside it — the same idea as any of them in real life: put the pot on, (maybe) come back some number of times, take it off.

${header}

STEPS (tending kind, whole duration, and declared difficulty already decided — do not change them):
${list}

For every step above, in this exact order of reasoning:
1. initial_duration_sec / initial_difficulty — the hands-on act of STARTING it: seasoning, browning, dumping rice in the water. This is a small slice of the whole duration, never the whole thing.
2. checkpoint_count — for "tended" steps, how many times a cook genuinely has to come back while it runs (a congee stirred every five minutes for forty minutes is about 8; be honest, not round). Exactly 0 for "timed" and "set_and_forget" — they have nothing to check in between, by definition.
3. checkpoint_duration_sec / checkpoint_difficulty — how long ONE check takes and how hard it is. Almost always short and low. Any value when checkpoint_count is 0; it is ignored.
4. ending_duration_sec / ending_difficulty — the hands-on act of FINISHING it: pulling it off the heat, plating, fishing it out of an ice bath. Required and greater than 0 for "tended" and "timed". Exactly 0 for "set_and_forget" — nobody collects rice soaking or dough proving on a schedule, so there is no ending moment to score.
- initial_duration_sec plus ending_duration_sec must leave room in the step's whole duration for whatever runs in between; do not make them so large they eat the step.`;
}

// --- fallback: one dish, one call, no schema ----------------------------

// Kept terse on purpose: an earlier version added "check every material
// is declared" and the model answered with 226 materials and no recipes.
export const FALLBACK_FORMAT = `Reply with ONLY a JSON object, no prose and no markdown fence:

{"materials":[{"id":"snake_case","label":"Tofu","category":"${CATEGORIES.join("|")}","amount":400,"unit":"g"}],
 "recipes":[{"title":"Mapo Tofu","dish_idea_raw":"mapo tofu","servings":4,
   "nodes":[{"id":"snake_case","label":"Cut tofu into cubes","description":"How to do it.",
     "estimated_duration_sec":180,"difficulty":"low|medium|high","phase":"prep|cook|plate",
     "required_equipment":["cutting_board"],"required_materials":["tofu"],
     "material_usage":[{"material_id":"tofu","amount":400,"unit":"g"}],
     "depends_on":[],"tending":"hands_on","is_shareable":false,"share_key":""}]}]}

tending is "hands_on" when the step needs hands or eyes throughout,
"tended" when it runs alone but must be checked as it goes (a congee
that scorches), "timed" when nothing is needed in between but it must
end on the minute (an ice bath), and "set_and_forget" when nobody minds
being ten minutes late (soaking, proving, resting).

Every field is required on every node. depends_on holds ids of steps in
this dish. Every material id used by a step must also appear once in the
top-level materials list — and nothing else should appear there.

Quantities: about 500g per person is the reference portion for a dish's
main ingredient (400g tofu above is for 4 servings, so 100g/person —
scale that way, not by guessing a bigger number as servings goes up).`;

export function buildFallbackPrompt(params) {
  const { detail, equipmentRules, header } = planContext(params);
  return `Plan the cooking for tonight as a dependency graph of steps.

DISHES (all of them, cooked in the same session): ${params.dishes.join(", ")}
${header}

STEP DETAIL: ${detail}

${SKILL_IS_NOT_A_GATE}

Rules:
${equipmentRules}
${DEPENDENCY_RULES(params.cooks)}
- The critical path should fit ${params.targetTime} minutes with ${params.cooks} cooks. Say so in no step; just make the graph fit.
${TENDING_RULES}
${MATERIAL_RULES(params.servings)}
${SHARING_RULE(params.dishes)}`;
}
