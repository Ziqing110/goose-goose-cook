// Generates recipe graphs with an LLM, through AssemblyAI's LLM Gateway.
//
// This is the seam matchTemplates() has been describing since it was
// written: "eventually picking dishes from what the user actually asked
// for instead of 'all of them'." The conversation now collects the
// dishes, so this turns them into the same node graphs the seeded
// templates use.
//
// MODEL. claude-sonnet-4-6, not claude-sonnet-5 — Sonnet 5 and Opus 5 do
// not support `response_format` on the gateway (they take `tools`
// instead), so schema-constrained output is unavailable on them. Verified
// against the live account, not just the docs table. A recipe graph has
// far too much structure to ask for in prose and hope.
//
// This is a slow, one-off call behind a loading state, unlike the
// per-answer reader in understanding.js, which is why it can afford a
// large model and a 60s budget where that one gets 5s.
import { Router } from "express";

export const recipesRouter = Router();

const API_KEY = process.env.ASSEMBLYAI_API_KEY || "";
const GATEWAY = "https://llm-gateway.assemblyai.com/v1/chat/completions";
const MODEL = process.env.AAI_RECIPE_MODEL || "claude-sonnet-4-6";

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

// The vocabulary the app already speaks. Everything here is checked
// after generation too — a model that invents an equipment id would
// otherwise produce steps the scheduler can never satisfy.
const EQUIPMENT = ["stove_burner", "wok", "oven", "pot", "cutting_board"];
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
    is_shareable: {
      type: "boolean",
      description: "True only when another dish in this run needs the identical prep and it could be done once.",
    },
    share_key: {
      type: ["string", "null"],
      description: "Identical string on every step that shares the work, e.g. 'mince_garlic'. Null when not shareable.",
    },
  },
  required: [
    "id", "label", "description", "estimated_duration_sec", "difficulty", "phase",
    "required_equipment", "required_materials", "material_usage", "depends_on",
    "is_shareable", "share_key",
  ],
  additionalProperties: false,
};

const SCHEMA = {
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

function buildPrompt({ dishes, servings, diet, skill, targetTime, cooks, kitchen }) {
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
- Scale every material_usage amount to ${servings} servings.
- Respect the dietary constraint in ingredient choice. Do not add a note about it; just design around it.
${dishes.length > 1
  ? `- These dishes share a kitchen. Where two dishes need the IDENTICAL prep (same ingredient, same cut), mark both steps is_shareable true with the same share_key, so the work can be done once.`
  : `- Only one dish, so nothing is shareable: is_shareable is false and share_key is null on every step.`}
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
function validate(plan) {
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
function toTemplates(plan, { diet, dishes }) {
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
      ...(n.is_shareable && n.share_key
        ? { is_shareable: true, share_key: n.share_key }
        : {}),
    })),
  }));
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

  const profile = {
    burners: Number(kitchen.burners) || 2,
    hasWok: Boolean(kitchen.hasWok),
    hasOven: Boolean(kitchen.hasOven),
    pots: Number(kitchen.pots) ?? 2,
    cuttingBoards: Number(kitchen.cuttingBoards) || 1,
  };

  try {
    const upstream = await fetch(GATEWAY, {
      method: "POST",
      headers: { authorization: API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          {
            role: "system",
            content:
              "You plan real cooking as a dependency graph. You are precise about time, equipment contention, and what can happen in parallel. You never pad a plan with commentary — every step is something someone does.",
          },
          { role: "user", content: buildPrompt({ dishes: list, servings, diet, skill, targetTime, cooks, kitchen: profile }) },
        ],
        response_format: { type: "json_schema", json_schema: SCHEMA },
        post_processing_steps: [{ type: "json-repair" }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (upstream.status === 429) {
      return res.status(429).json({ error: "LLM Gateway rate limit", retryable: true });
    }
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error("Recipe generation error:", upstream.status, detail.slice(0, 300));
      return res.status(502).json({ error: `LLM Gateway returned ${upstream.status}` });
    }

    const json = await upstream.json();
    const content = json?.choices?.[0]?.message?.content;
    let plan;
    try {
      plan = typeof content === "string" ? JSON.parse(content) : content;
    } catch {
      return res.status(502).json({ error: "Recipe plan was not valid JSON" });
    }

    const problem = validate(plan);
    if (problem) {
      console.error("Recipe plan rejected:", problem);
      return res.status(502).json({ error: `Recipe plan was not usable: ${problem}` });
    }

    res.set("Cache-Control", "no-store");
    return res.json({
      templates: toTemplates(plan, { diet, dishes: list }),
      materials: plan.materials,
    });
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    console.error("Recipe generation failed:", err?.message || err);
    return res
      .status(timedOut ? 504 : 502)
      .json({ error: timedOut ? "Recipe generation timed out" : "LLM Gateway unreachable" });
  }
});
