// POST /api/recipes/generate — the conversation's answers in, recipe
// templates out. The work is in server/plan/.
import { Router } from "express";
import { sendError } from "../llm.js";
import { generatePlan } from "../plan/generate.js";
import { toTemplates } from "../plan/shape.js";

export const recipesRouter = Router();

const count = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

recipesRouter.post("/generate", async (req, res) => {
  const { dishes = [], servings = 2, diet = "none", skill = "regular", targetTime = 45, cooks = 2, kitchen = {} } = req.body || {};

  const list = [dishes].flat().map((d) => String(d || "").trim()).filter(Boolean);
  if (!list.length) return res.status(400).json({ error: "at least one dish is required" });

  const params = {
    dishes: list,
    servings,
    diet,
    skill,
    targetTime,
    cooks,
    kitchen: {
      burners: count(kitchen.burners, 2) || 2,
      hasWok: Boolean(kitchen.hasWok),
      hasOven: Boolean(kitchen.hasOven),
      pots: count(kitchen.pots, 2),
      cuttingBoards: count(kitchen.cuttingBoards, 1) || 1,
    },
  };

  try {
    const result = await generatePlan(params);
    res.set("Cache-Control", "no-store");
    return res.json({
      templates: toTemplates(result.plan, { diet, dishes: list }),
      materials: result.plan.materials,
      generatedBy: result.model,
      sharedStepsPossible: result.shared,
      reviewedBy: result.reviewedBy,
      reviewFixes: result.reviewFixes,
      // Named, not counted, so the page can say WHICH dish went missing.
      ...(result.failed?.length && { missingDishes: result.failed }),
    });
  } catch (err) {
    console.error("Recipe generation failed:", err.message);
    if (err.status) return sendError(res, err);
    return res.status(502).json({ error: `Could not generate a plan: ${err.message}` });
  }
});
