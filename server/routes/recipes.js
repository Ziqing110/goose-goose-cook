// Generates recipe graphs with an LLM, through AssemblyAI's LLM Gateway.
//
// This is the seam matchTemplates() has been describing since it was
// written: "eventually picking dishes from what the user actually asked
// for instead of 'all of them'." The conversation now collects the
// dishes, so this turns them into the same node graphs the seeded
// templates use.
//
// MODEL. gemini-3.8-flash, chosen on a three-dish benchmark — two dishes
// turned out to be too easy to separate anything, since any model notices
// that two dishes both need garlic.
//
// The deciding case was mouth-watering chicken, which is served COLD: the
// poached chicken must chill before it is chopped and sauced. Sonnet 4.6
// and Haiku 4.5 both skipped the chill and served it hot, which is not
// the dish. Gemini 3.8 Flash got it right in 39s, the fastest of the
// models that did, with no missing ingredient amounts.
//
// Note that claude-sonnet-5 and claude-opus-5 are not options at all:
// neither supports `response_format` on the gateway (they take `tools`
// instead), and a recipe graph has far too much structure to ask for in
// prose and hope. Verified against the live account, not the docs table.
//
// This is a slow, one-off call behind a loading state, unlike the
// per-answer reader in understanding.js, which is why it can afford a
// large model and a 60s budget where that one gets 5s.
import { Router } from "express";
import { reviewPlan, applyFixes } from "./reviewPlan.js";

export const recipesRouter = Router();

const API_KEY = process.env.ASSEMBLYAI_API_KEY || "";
const GATEWAY = "https://llm-gateway.assemblyai.com/v1/chat/completions";
const MODEL = process.env.AAI_RECIPE_MODEL || "gemini-3.8-flash";

// A whole multi-dish graph is a lot of tokens, and a truncated graph is
// worse than none: it would arrive with steps depending on ids that were
// never emitted.
// Measured: two dishes at beginner detail took 58.9s, which is what a
// 60s budget would have thrown away a second before it arrived. Beginner
// descriptions are long and two dishes double them, so the slowest real
// case is roughly the worst case — but not by much, and losing a whole
// generation to a timeout is the one outcome with nothing to show.
const TIMEOUT_MS = 120_000;
const MAX_TOKENS = 8000;

// The model a free-tier account has when it has nothing else, so this is
// the one that runs when AAI_RECIPE_MODEL is not reachable. See the note
// above generatePerDish for what it can and cannot do.
const FALLBACK_MODEL = process.env.AAI_RECIPE_FALLBACK_MODEL || "qwen3.5-4b-32k-fast";
// One dish measured about four seconds, so these are generous rather
// than hopeful. The token cap stays well below the primary's on purpose:
// this model runs away when given room — asked for three dishes it once
// emitted 226 materials and no recipes — and a truncated plan is worse
// than a refused one.
// The review pass is on unless turned off. It costs a second model call
// on top of a generation the cook is already waiting through, and it
// only ever improves the plan or leaves it alone — but a demo that needs
// the fastest possible answer can switch it off without a code change.
const REVIEW_ENABLED = process.env.AAI_RECIPE_REVIEW !== "off";
// A DIFFERENT model from the generator, on purpose and by measurement.
// Given a plan with four deliberate faults, Sonnet 4.6 found all four —
// including the missing chill on mouth-watering chicken, which is the
// exact mistake it makes when it is the one generating. Gemini 3.8 Flash
// and Gemini 2.5 Pro each found one, the implausible duration. Writing a
// plan and reading one back are not the same skill, and the model that
// is best at the first is not automatically best at the second.
const REVIEW_MODEL = process.env.AAI_RECIPE_REVIEW_MODEL || "claude-sonnet-4-6";

const FALLBACK_TIMEOUT_MS = 60_000;
const FALLBACK_MAX_TOKENS = 8000;

// Mirrors LEAVABLE_GAP_SEC in src/utils/tending.js: below this gap
// nobody can actually leave the kitchen, so a check spaced closer than
// this is not a real checkpoint. Duplicated rather than imported —
// server/ has no business reaching into src/ for one constant, and this
// one is a physical fact about kitchens, not something the two sides
// are likely to want to drift apart on.
const MIN_CHECK_GAP_SEC = 120;

// The vocabulary the app already speaks. Everything here is checked
// after generation too — a model that invents an equipment id would
// otherwise produce steps the scheduler can never satisfy.
export const EQUIPMENT = ["stove_burner", "wok", "oven", "pot", "cutting_board"];
const PHASES = ["prep", "cook", "plate"];
const DIFFICULTIES = ["low", "medium", "high"];
const CATEGORIES = ["protein", "vegetable", "grain", "pantry"];

// --- pass 3: decomposing every non-hands_on step -------------------------
//
// A tended/timed/set_and_forget step is not one task, it is a fixed
// bundle of small hands-on moments with an idle gap between them: put it
// on, (maybe) come back and check on it some number of times, take it
// off. Treating the whole 40-minute simmer as one long hands-on task
// would occupy a cook who is supposed to be free to do other things;
// treating it as nothing charges no one for the moments that do need a
// person. This pass exists to name those moments once the step-detail
// pass has already decided a step needs them at all.
//
// Checkpoint spacing is computed here in code, not asked of the model:
// asking for both a count AND an interval invites arithmetic that does
// not add up to the step's own duration. The model says how many checks
// a step like this really needs; the server divides the remaining time
// evenly. That also settles "even or uneven cadence" by construction —
// always even — which is right for the vast majority of real steps
// (stir a congee every five minutes) and cheap to live without for the
// rare step whose checks should taper (a risotto's early aggressive
// stirring), which is not worth the schema complexity yet.
const unattendedSchema = {
  type: "object",
  properties: {
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
  },
  required: [
    "step_id", "initial_duration_sec", "initial_difficulty",
    "checkpoint_count", "checkpoint_duration_sec", "checkpoint_difficulty",
    "ending_duration_sec", "ending_difficulty",
  ],
  additionalProperties: false,
};

export const DECOMPOSITION_SCHEMA = {
  name: "unattended_decomposition",
  strict: true,
  schema: {
    type: "object",
    properties: {
      steps: { type: "array", items: unattendedSchema },
    },
    required: ["steps"],
    additionalProperties: false,
  },
};

/**
 * Everything every generation pass needs to know about the request.
 * Pulled out once so the skeleton, detail and decomposition prompts
 * describe the same kitchen and the same cook the same way — a
 * mismatch here (one pass told about the wok, another not) would show
 * up as passes silently disagreeing about what is possible.
 */
function planContext({ servings, diet, skill, targetTime, cooks, kitchen }) {
  const kit = [
    `${kitchen.burners} stove burner(s)`,
    kitchen.hasWok ? "a wok" : null,
    kitchen.hasOven ? "an oven" : null,
    `${kitchen.pots} pot(s)`,
    `${kitchen.cuttingBoards} cutting board(s)`,
  ].filter(Boolean).join(", ");

  const allowed = EQUIPMENT.filter(
    (e) =>
      (e !== "wok" || kitchen.hasWok) &&
      (e !== "oven" || kitchen.hasOven) &&
      (e !== "pot" || kitchen.pots > 0),
  );

  // Skill changes how much each step SAYS, never what gets attempted.
  // Said plainly and more than once, because a model asked about a
  // beginner will otherwise start proposing an easier dish.
  const detail = {
    beginner:
      "The cook is new to this. Every description should explain the technique, what to look for, and what going wrong looks like — 2 to 3 sentences. Break steps down finely.",
    regular: "The cook cooks regularly. One clear sentence per description. Standard step size.",
    confident:
      "The cook is confident. Keep descriptions to a short phrase — they only need reminding, not teaching. Larger steps are fine.",
  }[skill] || "One clear sentence per description.";

  return {
    kit,
    allowed,
    detail,
    header: `SERVINGS: ${servings}\nDIETARY: ${diet}\nTARGET: ${targetTime} minutes from start to plated\nCOOKS: ${cooks} people cooking in parallel\nKITCHEN: ${kit}`,
  };
}

export function buildPrompt({ dishes, servings, diet, skill, targetTime, cooks, kitchen }) {
  const { allowed, detail, header } = planContext({ servings, diet, skill, targetTime, cooks, kitchen });

  return `Plan the cooking for tonight as a dependency graph of steps.

DISHES (all of them, cooked in the same session): ${dishes.join(", ")}
${header}

STEP DETAIL: ${detail}

The skill setting controls only how much each description explains. It is
NEVER a reason to simplify the dish, substitute an easier technique, or
suggest something else. A beginner attempting a hard dish is expected and
welcome — teach it properly rather than avoiding it.

Rules:
- required_equipment may only use: ${allowed.join(", ")}. This kitchen has nothing else.
- Never require more of one piece of equipment at the same time than the kitchen has. With ${kitchen.burners} burner(s), at most ${kitchen.burners} steps may occupy a burner concurrently.
- depends_on refers to step ids in the SAME dish. The graph must be acyclic and every id must exist.
- Steps that could run at the same time must NOT depend on each other. ${cooks} cooks are working, so independent prep is what makes the target time reachable.
- The critical path should fit ${targetTime} minutes with ${cooks} cooks. Say so in no step; just make the graph fit.
- Set the tending field on every step. hands_on is what lets the plan know somebody is occupied; the other two are what let the other cook work during a 40-minute congee instead of standing over it, and what let one person have several pots going.
- Be careful between tended and set_and_forget, because they are treated very differently. Ask: if nobody comes back for ten extra minutes, is anything wrong? Congee scorching on the bottom, a pot boiling over, a poach breaking into a boil — tended. Rice soaking, chicken chilling, meat resting — set_and_forget. A tended step is scored as harder work than its hands-on part suggests, because having to keep coming back for forty minutes is the difficult part of it.
- None of the unattended kinds mean "easy". They mean the cook STARTS it and walks away. Rinsing rice is two minutes of standing at a sink, so it is hands_on even though it is easy; soaking the rinsed rice for thirty minutes is set_and_forget. If the person has to be there while it happens, it is hands_on however little skill it takes.
- Separate "does it need watching" from "does the end moment matter". A congee needs both, so it is tended. An ice bath needs nothing in between but has to come out at eight minutes, so it is timed. Rice soaking needs neither, so it is set_and_forget and is treated as a single task done the moment it is started.
- If the cook cannot walk away at all — a risotto that wants constant stirring, a custard that splits the moment you stop — that is hands_on for its whole duration, however long. It is not a wait that needs a lot of checking. Getting this wrong tells the plan somebody is free when they are standing at the stove.
- Scale every material_usage amount to ${servings} servings.
- Respect the dietary constraint in ingredient choice. Do not add a note about it; just design around it.
${dishes.length > 1
  ? `- These dishes share a kitchen. Where two dishes need the IDENTICAL prep (same ingredient, same cut), mark both steps is_shareable true with the same share_key, so the work can be done once. Every other step has is_shareable false and share_key "".`
  : `- Only one dish, so nothing is shareable: is_shareable is false and share_key is "" on every step.`}
- Every material id used in any step must appear exactly once in the top-level materials list.`;
}

// --- the 3-pass primary generation --------------------------------------
//
// One call asked for a step's shape, its duration, AND how a 40-minute
// simmer breaks into a start/checks/end all at once, and that is asking
// three different kinds of reasoning in one breath. In practice the
// third kind lost: check counts came back suspiciously round, or the
// initial/ending moments were never distinguished from the whole run at
// all. Splitting the reasoning into three calls — what exists, what each
// step needs, then how the unattended ones break down — gives each its
// own attention. Cost is not a concern at this stage (see the note this
// replaced), so trading three calls for three sharper answers is a clean
// win with nothing given up.
const skeletonNodeSchema = {
  type: "object",
  properties: {
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
  },
  required: ["id", "label", "phase", "depends_on", "is_shareable", "share_key"],
  additionalProperties: false,
};

export const SKELETON_SCHEMA = {
  name: "recipe_skeleton",
  strict: true,
  schema: {
    type: "object",
    properties: {
      recipes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            dish_idea_raw: { type: "string", description: "The dish as the cook named it." },
            servings: { type: "integer" },
            nodes: { type: "array", items: skeletonNodeSchema },
          },
          required: ["title", "dish_idea_raw", "servings", "nodes"],
          additionalProperties: false,
        },
      },
    },
    required: ["recipes"],
    additionalProperties: false,
  },
};

/** Pass 1: what steps exist, in what order, sharing what prep. No timing or difficulty yet. */
export function buildSkeletonPrompt({ dishes, servings, diet, skill, targetTime, cooks, kitchen }) {
  const { header } = planContext({ servings, diet, skill, targetTime, cooks, kitchen });
  return `Plan the cooking for tonight as a dependency graph of steps. This is the FIRST pass: name the steps and how they depend on each other. Duration, difficulty and how unattended time works come later — do not think about them yet.

DISHES (all of them, cooked in the same session): ${dishes.join(", ")}
${header}

Rules:
- depends_on refers to step ids in the SAME dish. The graph must be acyclic and every id must exist.
- Steps that could run at the same time must NOT depend on each other. ${cooks} cooks are working, so independent prep is what makes the target time reachable.
- Break the dish down at the grain a ${skill} cook would actually think in — not so coarse that "cook the dish" is one step, not so fine that stirring twice is two steps.
${dishes.length > 1
  ? `- These dishes share a kitchen. Where two dishes need the IDENTICAL prep (same ingredient, same cut), mark both steps is_shareable true with the same share_key, so the work can be done once. Every other step has is_shareable false and share_key "".`
  : `- Only one dish, so nothing is shareable: is_shareable is false and share_key is "" on every step.`}`;
}

const materialSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "snake_case" },
    label: { type: "string" },
    category: { type: "string", enum: CATEGORIES },
    amount: { type: "number", description: "Total across the whole run, scaled to servings." },
    unit: { type: "string" },
  },
  required: ["id", "label", "category", "amount", "unit"],
  additionalProperties: false,
};

const detailStepSchema = {
  type: "object",
  properties: {
    step_id: { type: "string", description: "Must match a step id from the skeleton exactly." },
    description: { type: "string", description: "How to do it. Length depends on the skill setting." },
    estimated_duration_sec: { type: "integer", description: "The WHOLE step, start to finish, however much of it needs a cook." },
    difficulty: { type: "string", enum: DIFFICULTIES },
    required_equipment: { type: "array", items: { type: "string", enum: EQUIPMENT } },
    required_materials: { type: "array", items: { type: "string" }, description: "material ids used in this step" },
    material_usage: {
      type: "array",
      description: "How much of each material this step uses, already scaled to the serving count.",
      items: {
        type: "object",
        properties: {
          material_id: { type: "string" },
          amount: { type: "number" },
          unit: { type: "string" },
        },
        required: ["material_id", "amount", "unit"],
        additionalProperties: false,
      },
    },
    tending: {
      type: "string",
      enum: ["hands_on", "tended", "timed", "set_and_forget"],
      description:
        "How much of a cook this step needs while it runs. hands_on: occupies someone throughout — chopping, stir-frying, anything where they have to be there. tended: runs without a cook but must be CHECKED while it goes and finished on time — a congee that scorches if it is not stirred, a poach held at a bare simmer. timed: runs alone with nothing to do in between, but the END MOMENT matters — an ice bath the chicken comes out of at eight minutes, a blanch. set_and_forget: runs alone and nobody minds when you get back — rice soaking, dough proving, meat resting. Ask two questions: does somebody have to be there while it runs, and does it matter when it ends. Whatever is not hands_on gets broken into an initial task, checks and an ending task in the NEXT pass — do not describe that breakdown here, just classify.",
    },
  },
  required: [
    "step_id", "description", "estimated_duration_sec", "difficulty", "required_equipment",
    "required_materials", "material_usage", "tending",
  ],
  additionalProperties: false,
};

export const DETAIL_SCHEMA = {
  name: "recipe_detail",
  strict: true,
  schema: {
    type: "object",
    properties: {
      materials: { type: "array", description: "Every material referenced by any step, once each.", items: materialSchema },
      steps: { type: "array", items: detailStepSchema },
    },
    required: ["materials", "steps"],
    additionalProperties: false,
  },
};

/** Compact, read-only view of the skeleton for passes 2 and 3 — ids and labels only, so the model has context without a reason to touch structure. */
function describeSkeleton(skeleton) {
  return skeleton.recipes
    .map((r) => `${r.title} (${r.servings} servings):\n${r.nodes.map((n) => `  ${n.id} [${n.phase}] ${n.label} — after: ${(n.depends_on || []).join(", ") || "-"}`).join("\n")}`)
    .join("\n\n");
}

/** Pass 2: for every step already named, how long it takes, how hard it is, what it needs, and whether it needs a cook throughout. */
export function buildDetailPrompt({ servings, diet, skill, targetTime, cooks, kitchen }, skeleton) {
  const { allowed, detail, header } = planContext({ servings, diet, skill, targetTime, cooks, kitchen });
  return `Here is the step-by-step shape already agreed for tonight's cooking. Fill in the detail for every step. Do not add, remove, rename or reorder steps — one steps entry per step_id below, using its exact id.

${header}

STEP DETAIL: ${detail}

The skill setting controls only how much each description explains. It is NEVER a reason to simplify the dish, substitute an easier technique, or suggest something else.

STEPS:
${describeSkeleton(skeleton)}

Rules:
- required_equipment may only use: ${allowed.join(", ")}. This kitchen has nothing else.
- Never require more of one piece of equipment at the same time than the kitchen has. With ${kitchen.burners} burner(s), at most ${kitchen.burners} steps may occupy a burner concurrently.
- Set the tending field on every step. hands_on is what lets the plan know somebody is occupied; the other three are what let the other cook work during a 40-minute congee instead of standing over it, and what let one person have several pots going.
- Be careful between tended and set_and_forget, because they are treated very differently. Ask: if nobody comes back for ten extra minutes, is anything wrong? Congee scorching on the bottom, a pot boiling over, a poach breaking into a boil — tended. Rice soaking, chicken chilling, meat resting — set_and_forget.
- None of the unattended kinds mean "easy". They mean the cook STARTS it and walks away. Rinsing rice is two minutes of standing at a sink, so it is hands_on even though it is easy; soaking the rinsed rice for thirty minutes is set_and_forget. If the person has to be there while it happens, it is hands_on however little skill it takes.
- Separate "does it need watching" from "does it matter when it ends". A congee needs both, so it is tended. An ice bath needs nothing in between but has to come out at eight minutes, so it is timed. Rice soaking needs neither, so it is set_and_forget.
- If the cook cannot walk away at all — a risotto that wants constant stirring, a custard that splits the moment you stop — that is hands_on for its whole duration, however long. Getting this wrong tells the plan somebody is free when they are standing at the stove.
- estimated_duration_sec is the step's WHOLE wall-clock length, from start to done, whatever its tending — the moments a cook actually spends on it come in the next pass and must fit inside this number.
- Scale every material_usage amount to ${servings} servings.
- Respect the dietary constraint in ingredient choice. Do not add a note about it; just design around it.
- Every material id used by any step must appear exactly once in the top-level materials list, and nothing else should appear there.`;
}

/** Pass 3: for every step that is not hands_on, the initial act, how many checks it needs and when, and the ending act. */
export function buildDecompositionPrompt({ servings, diet, skill, targetTime, cooks, kitchen }, steps) {
  const { header } = planContext({ servings, diet, skill, targetTime, cooks, kitchen });
  const list = steps
    .map((s) => `${s.step_id} [${s.tending}, ${Math.round(s.estimated_duration_sec / 60)}min total, ${s.difficulty}]: ${s.label} — ${s.description}`)
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

/**
 * Reject a graph the app cannot execute.
 *
 * The schema constrains shapes, not sense: it cannot stop a step
 * depending on an id that was never emitted, or a cycle, and either
 * would hang the scheduler with steps that can never become ready.
 * Better to fail here, where the message says what was wrong.
 */
export function validate(plan, expectedDishCount, { skipUnattended = false } = {}) {
  if (!plan?.recipes?.length) return "no recipes returned";
  // The schema constrains one recipe's shape but nothing stops the model
  // merging two requested dishes into a single recipe object — asked for
  // congee and mouth-watering chicken it can hand back one entry titled
  // "Congee" with both dishes' steps folded together, or just drop one
  // outright. Either way `recipes` is internally consistent and every
  // other check here passes, so a live run went from two dishes asked
  // for to one on the plate with no error anywhere.
  if (expectedDishCount != null && plan.recipes.length !== expectedDishCount) {
    return `expected ${expectedDishCount} dish(es), got ${plan.recipes.length}`;
  }
  const declared = new Set((plan.materials || []).map((m) => m.id));

  for (const r of plan.recipes) {
    if (typeof r.title !== "string" || !r.title) return "a recipe has no title";
    if (!r.nodes?.length) return `"${r.title}" has no steps`;

    // The schema constrains shape but a flaky reply can still slip a
    // node through with a field null'd out — seen once, live, as a
    // step with label null and estimated_duration_sec NaN. None of
    // that is a shape the rest of the app can render or schedule, and
    // it is not something toTemplates can default its way out of the
    // way it can an unrecognised tending value.
    for (const n of r.nodes) {
      if (typeof n.id !== "string" || !n.id) return `"${r.title}" has a step with no id`;
      if (typeof n.label !== "string" || !n.label) return `step "${n.id}" has no label`;
      if (!Number.isFinite(n.estimated_duration_sec) || n.estimated_duration_sec <= 0) {
        return `step "${n.id}" has an invalid duration`;
      }
      if (!DIFFICULTIES.includes(n.difficulty)) return `step "${n.id}" has an invalid difficulty "${n.difficulty}"`;
      if (!PHASES.includes(n.phase)) return `step "${n.id}" has an invalid phase "${n.phase}"`;
      if (!Array.isArray(n.depends_on)) return `step "${n.id}" has no depends_on list`;
      if (!Array.isArray(n.required_materials)) return `step "${n.id}" has no required_materials list`;

      // A tended/timed/set_and_forget step is a fixed bundle of hands-on
      // moments — start, maybe checks, end — not one long task and not
      // nothing. Every non-hands_on step must have gone through the
      // decomposition pass, and the shape it came back with must match
      // what its own tending kind allows: checks only where checks make
      // sense, an ending moment only where one exists to collect.
      if (!skipUnattended && n.tending && n.tending !== "hands_on") {
        const u = n.unattended;
        if (!u || typeof u !== "object") return `step "${n.id}" is ${n.tending} but was never decomposed`;
        if (!u.initial || !Number.isFinite(u.initial.duration_sec) || u.initial.duration_sec <= 0) {
          return `step "${n.id}" has no initial hands-on moment`;
        }
        if (n.tending === "tended") {
          if (!u.checkpoints || !Number.isFinite(u.checkpoints.count) || u.checkpoints.count <= 0) {
            return `step "${n.id}" is tended but has no checkpoints`;
          }
          if (!Number.isFinite(u.checkpoints.interval_sec) || u.checkpoints.interval_sec <= 0) {
            return `step "${n.id}" has a non-positive checkpoint interval`;
          }
        } else if (u.checkpoints) {
          return `step "${n.id}" is ${n.tending} but has checkpoints`;
        }
        if (n.tending === "set_and_forget") {
          if (u.ending) return `step "${n.id}" is set_and_forget but has an ending moment`;
        } else if (!u.ending || !Number.isFinite(u.ending.duration_sec) || u.ending.duration_sec <= 0) {
          return `step "${n.id}" is ${n.tending} but has no ending moment`;
        }
      } else if (n.unattended) {
        return `step "${n.id}" is hands_on but was decomposed anyway`;
      }
    }

    for (const n of r.nodes) {
      for (const m of n.required_materials || []) {
        if (!declared.has(m)) return `step "${n.id}" uses material "${m}", which is not in the materials list`;
      }
    }

    const shapeProblem = checkGraphShape(r.nodes);
    if (shapeProblem) return `"${r.title}" ${shapeProblem}`;
  }
  return null;
}

/**
 * Ids unique, every dependency points at a real step, no cycle. Shared
 * by the full validator and the skeleton pass, which has settled the
 * shape of the graph before duration, difficulty or tending exist to
 * check.
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
  if (seen !== nodes.length) return "has a circular dependency";
  return null;
}

/**
 * Pass 1's own validation: the graph's shape is fixed here and never
 * revisited, so catching a bad id or a cycle now is cheaper than
 * discovering it after two more model calls have built on top of it.
 */
export function validateSkeleton(skeleton, expectedDishCount) {
  if (!skeleton?.recipes?.length) return "no recipes returned";
  if (expectedDishCount != null && skeleton.recipes.length !== expectedDishCount) {
    return `expected ${expectedDishCount} dish(es), got ${skeleton.recipes.length}`;
  }
  for (const r of skeleton.recipes) {
    if (typeof r.title !== "string" || !r.title) return "a recipe has no title";
    if (!r.nodes?.length) return `"${r.title}" has no steps`;
    for (const n of r.nodes) {
      if (typeof n.id !== "string" || !n.id) return `"${r.title}" has a step with no id`;
      if (typeof n.label !== "string" || !n.label) return `step "${n.id}" has no label`;
      if (!PHASES.includes(n.phase)) return `step "${n.id}" has an invalid phase "${n.phase}"`;
      if (!Array.isArray(n.depends_on)) return `step "${n.id}" has no depends_on list`;
    }
    const shapeProblem = checkGraphShape(r.nodes);
    if (shapeProblem) return `"${r.title}" ${shapeProblem}`;
  }
  return null;
}

/**
 * Fold the detail pass back onto the skeleton by step_id. Structural
 * fields (id, label, phase, depends_on, sharing) come from the
 * skeleton, which already validated them — the detail pass was never
 * asked to repeat them, so there is nothing from it to prefer instead.
 * `problem` is set, and the plan left safely inert, if the detail pass
 * dropped or invented a step_id.
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
      if (!d && !problem) problem = `step "${n.id}" was never detailed`;
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

/** Every step the detail pass marked as needing more than a cook's hands — what pass 3 has to decompose. */
export function collectNonHandsOn(plan) {
  const out = [];
  for (const r of plan.recipes) {
    for (const n of r.nodes) {
      if (n.tending && n.tending !== "hands_on") {
        out.push({
          step_id: n.id,
          label: n.label,
          description: n.description,
          estimated_duration_sec: n.estimated_duration_sec,
          difficulty: n.difficulty,
          tending: n.tending,
        });
      }
    }
  }
  return out;
}

/**
 * Turn one decomposition-pass answer into the `unattended` shape
 * `validate()` and the app expect. Checkpoint spacing is derived here,
 * not trusted from the model — see the note above unattendedSchema for
 * why: the model says how many checks, the server divides what is left
 * of the step's own duration evenly between them, so the two numbers
 * can never disagree.
 */
export function attachUnattended(node, dec) {
  if (!dec) return node; // validate() reports the gap; nothing sensible to invent here.

  const initial = {
    duration_sec: Math.max(1, Math.round(Number(dec.initial_duration_sec)) || 1),
    difficulty: DIFFICULTIES.includes(dec.initial_difficulty) ? dec.initial_difficulty : "low",
  };

  const hasEnding = node.tending !== "set_and_forget" && Number(dec.ending_duration_sec) > 0;
  const ending = hasEnding
    ? {
        duration_sec: Math.max(1, Math.round(Number(dec.ending_duration_sec))),
        difficulty: DIFFICULTIES.includes(dec.ending_difficulty) ? dec.ending_difficulty : "low",
      }
    : null;

  let checkpoints = null;
  if (node.tending === "tended" && Number(dec.checkpoint_count) > 0) {
    const count = Math.round(Number(dec.checkpoint_count));
    const reserved = initial.duration_sec + (ending?.duration_sec || 0);
    const remaining = Math.max(count, Math.round(Number(node.estimated_duration_sec)) - reserved);
    checkpoints = {
      count,
      interval_sec: Math.max(1, Math.round(remaining / count)),
      duration_sec: Math.max(1, Math.round(Number(dec.checkpoint_duration_sec)) || 1),
      difficulty: DIFFICULTIES.includes(dec.checkpoint_difficulty) ? dec.checkpoint_difficulty : "low",
    };
    // Same self-correction src/utils/tending.js applies on read: a step
    // too short to support a real gap between checks was never tended,
    // whatever the detail pass called it — a 60-second "tended" step
    // asked for one check and got a 20s interval, which is not a check,
    // it is standing there. Fix the classification at the source instead
    // of leaving generation and the client to quietly disagree about it.
    if (checkpoints.interval_sec < MIN_CHECK_GAP_SEC) {
      return { ...node, tending: "hands_on" };
    }
  }

  return { ...node, unattended: { initial, checkpoints, ending } };
}

export function mergeDecomposition(plan, decomposition) {
  const byId = new Map((decomposition?.steps || []).map((d) => [d.step_id, d]));
  return {
    ...plan,
    recipes: plan.recipes.map((r) => ({
      ...r,
      nodes: r.nodes.map((n) => (n.tending && n.tending !== "hands_on" ? attachUnattended(n, byId.get(n.id)) : n)),
    })),
  };
}

/**
 * A no-LLM stand-in for pass 3, used only on the degraded fallback path.
 * The fallback model already struggles with one flat shape (see the note
 * above generatePerDish); asking it for a fourth kind of reasoning on
 * top of three dishes it cannot reliably separate would not produce a
 * better answer, just a slower failure. A deterministic split — a short
 * fixed slice off each end, checks spaced every few minutes in between —
 * is not as considered as a model reading the actual step, but it is
 * consistent, and consistent beats considered when the alternative is
 * asking a 4B model to do arithmetic it has already been seen to botch.
 */
export function heuristicDecompose(node) {
  if (!node.tending || node.tending === "hands_on") return node;
  const total = Math.max(1, Math.round(Number(node.estimated_duration_sec)) || 60);
  const edge = Math.min(120, Math.max(20, Math.round(total * 0.08)));
  const initial = { duration_sec: edge, difficulty: node.difficulty || "low" };
  const ending = node.tending === "set_and_forget" ? null : { duration_sec: edge, difficulty: node.difficulty || "low" };

  let checkpoints = null;
  if (node.tending === "tended") {
    const remaining = Math.max(1, total - initial.duration_sec - (ending?.duration_sec || 0));
    const targetInterval = Math.max(MIN_CHECK_GAP_SEC, Math.round(total / 8));
    const count = Math.max(1, Math.round(remaining / targetInterval));
    const interval_sec = Math.max(1, Math.round(remaining / count));
    // A step too short to leave a real gap between checks was never
    // tended at all — see the matching correction in attachUnattended.
    if (interval_sec < MIN_CHECK_GAP_SEC) return { ...node, tending: "hands_on" };
    checkpoints = {
      count,
      interval_sec,
      duration_sec: Math.min(30, Math.max(5, Math.round(total * 0.01))),
      difficulty: "low",
    };
  }

  return { ...node, unattended: { initial, checkpoints, ending } };
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
      // Unrecognised or missing falls back to hands_on: assuming work
      // needs a cook is the safe way to be wrong, since the opposite
      // quietly lets someone take on more than they can actually do.
      tending: ["hands_on", "tended", "timed", "set_and_forget"].includes(n.tending) ? n.tending : "hands_on",
      // The initial/checkpoints/ending breakdown from the decomposition
      // pass (or, on the degraded fallback path, from the deterministic
      // heuristic that stands in for it). Absent on hands_on steps,
      // where the whole duration is already one hands-on task.
      ...(n.unattended ? { unattended: n.unattended } : {}),
      ...(n.is_shareable && n.share_key
        ? { is_shareable: true, share_key: n.share_key }
        : {}),
    })),
  }));
}

// --- the two ways to get a plan ------------------------------------------
//
// PRIMARY is gemini-3.8-flash with a JSON schema, all dishes in one call.
// One call is what makes shared prep possible at all: a model that never
// sees two dishes together cannot notice they both need garlic minced.
//
// FALLBACK is qwen3.5-4b-32k-fast, which is the model a free-tier account
// has when it has nothing else. It cannot do the primary's job, and the
// limit is not subtle — measured on three dishes it either merged them
// into one recipe or ran to `finish: length` after emitting 226 materials
// and no recipes at all. It has no response_format either, so the JSON is
// asked for in the prompt and validated here.
//
// What it CAN do is one dish, reliably, in about four seconds. So the
// fallback asks one dish at a time and merges. The cost is stated plainly
// because it shows up in the product: nothing is ever shared, since no
// single call sees two dishes. A plan without shared prep is still a
// working plan. A plan that never arrives is not.

const SYSTEM = "You plan real cooking as a dependency graph. You are precise about time, equipment contention, and what can happen in parallel. You never pad a plan with commentary — every step is something someone does.";

// Spelled out for the fallback, which has no schema to lean on. Kept
// deliberately terse: an earlier version added "check every material is
// declared" and the model answered with 226 materials and no recipes.
const SHAPE = `Reply with ONLY a JSON object, no prose and no markdown fence:

{"materials":[{"id":"snake_case","label":"Tofu","category":"protein|vegetable|grain|pantry","amount":400,"unit":"g"}],
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
top-level materials list — and nothing else should appear there.`;

/** Pull a JSON object out of a reply that was not schema-constrained. */
function extractJson(raw) {
  if (!raw) return null;
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function callGateway({ model, system, user, maxTokens, schema, timeout, temperature = 0 }) {
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { authorization: API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      // Planning is not writing. The same dishes and the same kitchen
      // should give the same plan, and the difference is not cosmetic:
      // left at the default this model produced a step called
      // "submerge_big_wall" using a material named "f", where at 0 it
      // produced a clean graph for the same request.
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(schema ? { response_format: { type: "json_schema", json_schema: schema } } : {}),
      post_processing_steps: [{ type: "json-repair" }],
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // 400 "does not have access to this LLM Gateway model" is the shape a
    // missing model takes on this API — not a 403, and not an
    // account-level error. It is the whole reason a fallback exists.
    const missing = res.status === 400 && /does not have access|does not support/i.test(detail);
    return { error: `${res.status}`, missing, rateLimited: res.status === 429, detail: detail.slice(0, 300) };
  }
  const json = await res.json();
  return { content: json?.choices?.[0]?.message?.content, finish: json?.choices?.[0]?.finish_reason };
}

/**
 * All dishes, three calls: skeleton, then detail, then the unattended
 * breakdown. Still one model seeing every dish together at each stage,
 * which is what makes shared prep possible at all — a model that never
 * sees two dishes together cannot notice they both need garlic minced.
 */
async function generateTogether(params) {
  const skeletonOut = await callGateway({
    model: MODEL,
    system: SYSTEM,
    user: buildSkeletonPrompt(params),
    maxTokens: MAX_TOKENS,
    schema: SKELETON_SCHEMA,
    timeout: TIMEOUT_MS,
  });
  if (skeletonOut.error) return skeletonOut;
  const skeleton = extractJson(skeletonOut.content);
  if (!skeleton) return { error: "unparseable", detail: `finish_reason ${skeletonOut.finish} (skeleton)` };
  let problem = validateSkeleton(skeleton, params.dishes.length);
  if (problem) return { error: "invalid", detail: `skeleton: ${problem}` };

  const detailOut = await callGateway({
    model: MODEL,
    system: SYSTEM,
    user: buildDetailPrompt(params, skeleton),
    maxTokens: MAX_TOKENS,
    schema: DETAIL_SCHEMA,
    timeout: TIMEOUT_MS,
  });
  if (detailOut.error) return detailOut;
  const detail = extractJson(detailOut.content);
  if (!detail) return { error: "unparseable", detail: `finish_reason ${detailOut.finish} (detail)` };
  const { plan: detailed, problem: mergeProblem } = mergeDetail(skeleton, detail);
  if (mergeProblem) return { error: "invalid", detail: `detail: ${mergeProblem}` };
  problem = validate(detailed, params.dishes.length, { skipUnattended: true });
  if (problem) return { error: "invalid", detail: problem };

  let plan = detailed;
  const unattendedSteps = collectNonHandsOn(plan);
  if (unattendedSteps.length) {
    const decOut = await callGateway({
      model: MODEL,
      system: SYSTEM,
      user: buildDecompositionPrompt(params, unattendedSteps),
      maxTokens: MAX_TOKENS,
      schema: DECOMPOSITION_SCHEMA,
      timeout: TIMEOUT_MS,
    });
    if (decOut.error) return decOut;
    const decomposition = extractJson(decOut.content);
    if (!decomposition) return { error: "unparseable", detail: `finish_reason ${decOut.finish} (decomposition)` };
    plan = mergeDecomposition(plan, decomposition);
  }

  problem = validate(plan, params.dishes.length);
  if (problem) return { error: "invalid", detail: problem };
  return { plan, model: MODEL, shared: true };
}

/**
 * One dish per call, merged. No sharing is possible; see the note above.
 *
 * The calls run in parallel because they are independent and the fallback
 * is already the slow path — sequentially this measured 11.9s for three
 * dishes, which is a long time to watch a spinner for a degraded result.
 */
async function generatePerDish(params) {
  const attempt = async (dish) => {
    const out = await callGateway({
      model: FALLBACK_MODEL,
      system: `${SYSTEM}\n\n${SHAPE}`,
      user: buildPrompt({ ...params, dishes: [dish] }),
      maxTokens: FALLBACK_MAX_TOKENS,
      timeout: FALLBACK_TIMEOUT_MS,
    });
    if (out.error) return { dish, error: out.error, detail: out.detail };
    const plan = extractJson(out.content);
    if (!plan?.recipes?.length) return { dish, error: "unparseable", detail: `finish_reason ${out.finish}` };

    // The fallback model is never asked to do the decomposition pass —
    // see the note above heuristicDecompose for why — so it is done here,
    // deterministically, before validate() can object to a tended step
    // with no unattended breakdown.
    for (const recipe of plan.recipes) {
      recipe.nodes = (recipe.nodes || []).map(heuristicDecompose);
    }

    // Validate each dish on its own before it reaches the merge. A single
    // bad graph would otherwise fail the whole batch at the end, throwing
    // away two good dishes because a third went wrong. Each call asked
    // for exactly one dish, so exactly one recipe is the only valid shape
    // back.
    const problem = validate(plan, 1);
    if (problem) return { dish, error: "invalid", detail: problem };

    // The call was about ONE dish we named, so its identity is not the
    // model's to decide. Asked for mouth-watering chicken it came back
    // titled "Mapo Chicken" — a plausible-looking dish nobody ordered.
    // The cook's own words are authoritative; a title that has nothing in
    // common with them is a hallucination, not a flourish.
    // Asked for mouth-watering chicken it came back titled "Mapo
    // Chicken" — a dish nobody ordered. A first attempt kept the model's
    // title when it shared a word with the request, and "Mapo Chicken"
    // shares "chicken", so it survived. Not worth being clever about: on
    // the degraded path the cook's own words win outright. A plain
    // correct name beats an invented one.
    for (const recipe of plan.recipes) {
      recipe.dish_idea_raw = dish;
      recipe.title = dish;
    }
    return { dish, plan };
  };

  const results = await Promise.all(
    params.dishes.map(async (dish) => {
      const first = await attempt(dish);
      if (!first.error) return first;
      // One retry. The failures seen here are transient far more often
      // than they are systematic — a gateway 500, a reply that stopped
      // mid-object — and losing a dish the cook asked for is expensive
      // enough to be worth four more seconds.
      console.warn(`Recipe fallback retrying "${dish}" after ${first.error}: ${first.detail || ""}`);
      return attempt(dish);
    }),
  );

  const merged = { materials: [], recipes: [] };
  const seenMaterials = new Set();
  const seenStepIds = new Set();
  const failed = [];

  for (const r of results) {
    if (r.error) {
      failed.push(`${r.dish}: ${r.error}`);
      continue;
    }
    for (const recipe of r.plan.recipes) {
      // Each call names its own steps with no knowledge of the others, so
      // ids can collide. Measured: they did not, this time. "This time"
      // is not a guarantee, and a collision would make one dish's step
      // depend on another dish's step.
      const remap = new Map();
      for (const node of recipe.nodes || []) {
        let id = node.id;
        if (seenStepIds.has(id)) {
          let n = 2;
          while (seenStepIds.has(`${id}_${n}`)) n += 1;
          id = `${id}_${n}`;
          remap.set(node.id, id);
        }
        seenStepIds.add(id);
        node.id = id;
      }
      if (remap.size) {
        for (const node of recipe.nodes || []) {
          node.depends_on = (node.depends_on || []).map((d) => remap.get(d) ?? d);
        }
      }
      merged.recipes.push(recipe);
    }
    for (const m of r.plan.materials || []) {
      if (!seenMaterials.has(m.id)) {
        seenMaterials.add(m.id);
        merged.materials.push(m);
      }
    }
  }

  if (!merged.recipes.length) {
    return { error: "invalid", detail: `every dish failed (${failed.join("; ")})` };
  }
  const problem = validate(merged);
  if (problem) return { error: "invalid", detail: problem };
  return { plan: merged, model: FALLBACK_MODEL, shared: false, failed };
}

recipesRouter.post("/generate", async (req, res) => {
  if (!API_KEY) {
    return res.status(503).json({ error: "ASSEMBLYAI_API_KEY is not set on the server." });
  }

  const {
    dishes = [],
    servings = 2,
    diet = "none",
    skill = "regular",
    targetTime = 45,
    cooks = 2,
    kitchen = {},
  } = req.body || {};

  const list = (Array.isArray(dishes) ? dishes : [dishes]).map((d) => String(d || "").trim()).filter(Boolean);
  if (!list.length) return res.status(400).json({ error: "at least one dish is required" });

  const params = {
    dishes: list,
    servings,
    diet,
    skill,
    targetTime,
    cooks,
    kitchen: {
      burners: Number(kitchen.burners) || 2,
      hasWok: Boolean(kitchen.hasWok),
      hasOven: Boolean(kitchen.hasOven),
      pots: Number(kitchen.pots) ?? 2,
      cuttingBoards: Number(kitchen.cuttingBoards) || 1,
    },
  };

  try {
    let result = await generateTogether(params);

    // Fall back for any reason the primary did not produce a usable plan,
    // not only for a missing model. A model the account HAS but which
    // returned an invalid graph leaves the cook just as stuck.
    if (result.error && !result.rateLimited) {
      console.warn(`Recipe primary (${MODEL}) failed: ${result.error} ${result.detail || ""}`);
      const fallback = await generatePerDish(params);
      if (!fallback.error) {
        console.info(`Recipe fallback (${FALLBACK_MODEL}) produced ${fallback.plan.recipes.length} dish(es), unshared.`);
        result = fallback;
      } else {
        console.error(`Recipe fallback also failed: ${fallback.error} ${fallback.detail || ""}`);
      }
    }

    if (result.rateLimited) {
      return res.status(429).json({ error: "LLM Gateway rate limit", retryable: true });
    }
    if (result.error) {
      return res.status(502).json({ error: `Could not generate a plan: ${result.detail || result.error}` });
    }

    // Second pass: read it back before anyone cooks it. Only ever
    // improves the plan or leaves it alone — reviewPlan returns [] on any
    // failure, and applyFixes hands back the original if the patched
    // plan does not validate. Never worth failing a good generation over.
    let review = { applied: [], rejected: [] };
    if (REVIEW_ENABLED) {
      const fixes = await reviewPlan({
        plan: result.plan,
        params,
        model: REVIEW_MODEL,
        apiKey: API_KEY,
        equipment: EQUIPMENT,
      });
      if (fixes.length) {
        review = applyFixes(result.plan, fixes, validate);
        result = { ...result, plan: review.plan };
        review.applied.forEach((a) => console.info(`Recipe review fixed: ${a}`));
        review.rejected.forEach((r) => console.warn(`Recipe review rejected: ${r}`));
      }
    }

    res.set("Cache-Control", "no-store");
    return res.json({
      templates: toTemplates(result.plan, { diet, dishes: list }),
      materials: result.plan.materials,
      // The client shows nothing different, but a run that came back
      // unshared is worth being able to see when one looks wrong.
      generatedBy: result.model,
      sharedStepsPossible: result.shared,
      reviewedBy: REVIEW_ENABLED ? REVIEW_MODEL : null,
      reviewFixes: review.applied,
      // Named, not counted. If the fallback lost a dish the cook asked
      // for, the page has to be able to say WHICH one rather than
      // quietly returning a shorter plan than was requested.
      ...(result.failed?.length ? { missingDishes: result.failed } : {}),
    });
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    console.error("Recipe generation failed:", err?.message || err);
    return res
      .status(timedOut ? 504 : 502)
      .json({ error: timedOut ? "Recipe generation timed out" : "LLM Gateway unreachable" });
  }
});
