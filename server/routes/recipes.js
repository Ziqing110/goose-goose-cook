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
const FALLBACK_TIMEOUT_MS = 60_000;
const FALLBACK_MAX_TOKENS = 8000;

// The vocabulary the app already speaks. Everything here is checked
// after generation too — a model that invents an equipment id would
// otherwise produce steps the scheduler can never satisfy.
export const EQUIPMENT = ["stove_burner", "wok", "oven", "pot", "cutting_board"];
const PHASES = ["prep", "cook", "plate"];
const DIFFICULTIES = ["low", "medium", "high"];
const CATEGORIES = ["protein", "vegetable", "grain", "pantry"];

const nodeSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "snake_case, unique within this dish" },
    label: { type: "string", description: "Imperative, under 6 words: 'Cut tofu into cubes'" },
    description: { type: "string", description: "How to do it. Length depends on the skill setting." },
    estimated_duration_sec: { type: "integer" },
    difficulty: { type: "string", enum: DIFFICULTIES },
    phase: { type: "string", enum: PHASES },
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
    depends_on: {
      type: "array",
      items: { type: "string" },
      description: "ids of steps in THIS dish that must finish first. Empty for steps that can start immediately.",
    },
    attended: {
      type: "boolean",
      description:
        "Does this step occupy a cook for its whole duration? True for chopping, stir-frying, anything needing hands or eyes. FALSE for waiting: a simmer left alone, marinating, chilling, resting, water coming to the boil. An unattended step still takes wall-clock time but frees the cook to do something else.",
    },
    is_shareable: {
      type: "boolean",
      description: "True only when another dish in this run needs the identical prep and it could be done once.",
    },
    share_key: {
      // Single-typed, not ["string","null"]. A nullable union is accepted
      // by Anthropic's schema validator and rejected outright by Gemini's
      // and OpenAI's, which would quietly restrict this endpoint to one
      // vendor — and would rig any comparison between them.
      type: "string",
      description: "Identical string on every step that shares the work, e.g. 'mince_garlic'. Empty string when not shareable.",
    },
  },
  required: [
    "id", "label", "description", "estimated_duration_sec", "difficulty", "phase",
    "required_equipment", "required_materials", "material_usage", "depends_on",
    "attended", "is_shareable", "share_key",
  ],
  additionalProperties: false,
};

export const SCHEMA = {
  name: "recipe_plan",
  strict: true,
  schema: {
    type: "object",
    properties: {
      materials: {
        type: "array",
        description: "Every material referenced by any step, once each.",
        items: {
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
        },
      },
      recipes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            dish_idea_raw: { type: "string", description: "The dish as the cook named it." },
            servings: { type: "integer" },
            nodes: { type: "array", items: nodeSchema },
          },
          required: ["title", "dish_idea_raw", "servings", "nodes"],
          additionalProperties: false,
        },
      },
    },
    required: ["materials", "recipes"],
    additionalProperties: false,
  },
};

export function buildPrompt({ dishes, servings, diet, skill, targetTime, cooks, kitchen }) {
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

  return `Plan the cooking for tonight as a dependency graph of steps.

DISHES (all of them, cooked in the same session): ${dishes.join(", ")}
SERVINGS: ${servings}
DIETARY: ${diet}
TARGET: ${targetTime} minutes from start to plated
COOKS: ${cooks} people cooking in parallel
KITCHEN: ${kit}

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
- Mark attended false for any step that is just waiting: a simmer left alone, marinating, chilling, resting, water heating. This is what lets the other cook work during a 40-minute congee instead of standing over it, and it is also what lets one person hold several waits at once. Get it wrong and the plan says two people are busy when one of them is reading their phone.
- Scale every material_usage amount to ${servings} servings.
- Respect the dietary constraint in ingredient choice. Do not add a note about it; just design around it.
${dishes.length > 1
  ? `- These dishes share a kitchen. Where two dishes need the IDENTICAL prep (same ingredient, same cut), mark both steps is_shareable true with the same share_key, so the work can be done once. Every other step has is_shareable false and share_key "".`
  : `- Only one dish, so nothing is shareable: is_shareable is false and share_key is "" on every step.`}
- Every material id used in any step must appear exactly once in the top-level materials list.`;
}

/**
 * Reject a graph the app cannot execute.
 *
 * The schema constrains shapes, not sense: it cannot stop a step
 * depending on an id that was never emitted, or a cycle, and either
 * would hang the scheduler with steps that can never become ready.
 * Better to fail here, where the message says what was wrong.
 */
export function validate(plan) {
  if (!plan?.recipes?.length) return "no recipes returned";
  const declared = new Set((plan.materials || []).map((m) => m.id));

  for (const r of plan.recipes) {
    if (!r.nodes?.length) return `"${r.title}" has no steps`;
    const ids = new Set(r.nodes.map((n) => n.id));
    if (ids.size !== r.nodes.length) return `"${r.title}" has duplicate step ids`;

    for (const n of r.nodes) {
      for (const dep of n.depends_on || []) {
        if (!ids.has(dep)) return `step "${n.id}" depends on "${dep}", which does not exist`;
      }
      for (const m of n.required_materials || []) {
        if (!declared.has(m)) return `step "${n.id}" uses material "${m}", which is not in the materials list`;
      }
    }

    // Kahn's algorithm: anything left unvisited is in a cycle.
    const indegree = new Map(r.nodes.map((n) => [n.id, (n.depends_on || []).length]));
    const queue = [...indegree].filter(([, d]) => d === 0).map(([id]) => id);
    let seen = 0;
    while (queue.length) {
      const id = queue.shift();
      seen++;
      for (const n of r.nodes) {
        if ((n.depends_on || []).includes(id)) {
          const left = indegree.get(n.id) - 1;
          indegree.set(n.id, left);
          if (left === 0) queue.push(n.id);
        }
      }
    }
    if (seen !== r.nodes.length) return `"${r.title}" has a circular dependency`;
  }
  return null;
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
      // Defaults to true: a step nobody marked is assumed to need a cook,
      // which is the safe way to be wrong. Claiming an unattended step
      // does not make you busy (see arbitrateClaim), so guessing false
      // would quietly let someone take on work they cannot do.
      attended: n.attended !== false,
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
     "depends_on":[],"attended":true,"is_shareable":false,"share_key":""}]}]}

attended is false when the step is only waiting — a simmer left alone,
marinating, chilling, resting. True when it needs hands or eyes.

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

/** All dishes in one schema-constrained call. Can find shared prep. */
async function generateTogether(params) {
  const out = await callGateway({
    model: MODEL,
    system: SYSTEM,
    user: buildPrompt(params),
    maxTokens: MAX_TOKENS,
    schema: SCHEMA,
    timeout: TIMEOUT_MS,
  });
  if (out.error) return out;
  const plan = extractJson(out.content);
  if (!plan) return { error: "unparseable", detail: `finish_reason ${out.finish}` };
  const problem = validate(plan);
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
    // Validate each dish on its own before it reaches the merge. A single
    // bad graph would otherwise fail the whole batch at the end, throwing
    // away two good dishes because a third went wrong.
    const problem = validate(plan);
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

    res.set("Cache-Control", "no-store");
    return res.json({
      templates: toTemplates(result.plan, { diet, dishes: list }),
      materials: result.plan.materials,
      // The client shows nothing different, but a run that came back
      // unshared is worth being able to see when one looks wrong.
      generatedBy: result.model,
      sharedStepsPossible: result.shared,
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
