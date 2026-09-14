// Placeholder "backend". Stage 2 collects answers through a scripted,
// bounded question set (brief: "3-5 questions max"); Stage 3 needs a
// draft RecipeGraph shaped exactly like the schema in the project brief.
//
// There is no LLM or AssemblyAI call yet — generateRecipeGraph() below
// is the seam where that call goes. It already reacts to the
// conversation answers (e.g. dropping the pork nodes for a
// vegetarian/vegan cook) so the handoff between pages is real, even
// though the recipe content itself is hand-authored for the demo.

export const ELICITATION_QUESTIONS = [
  {
    id: "dishIdea",
    agentText: "What do you want to cook tonight?",
    options: [],
    freeTextPlaceholder: "e.g. mapo tofu",
  },
  {
    id: "servings",
    agentText: "How many people are we cooking for?",
    options: [
      { label: "2 servings", value: "2" },
      { label: "4 servings", value: "4" },
      { label: "6 servings", value: "6" },
    ],
    freeTextPlaceholder: "e.g. 8 servings",
  },
  {
    id: "diet",
    agentText: "Any dietary constraints I should design around?",
    options: [
      { label: "No restrictions", value: "none" },
      { label: "Vegetarian", value: "vegetarian" },
      { label: "Vegan", value: "vegan" },
    ],
    freeTextPlaceholder: "e.g. nut allergy",
  },
  {
    id: "targetTime",
    agentText: "What's the target finish time, start to plated?",
    options: [
      { label: "20 minutes", value: "20" },
      { label: "30 minutes", value: "30" },
      { label: "45 minutes", value: "45" },
    ],
    freeTextPlaceholder: "e.g. 35 minutes",
  },
  {
    id: "cooks",
    agentText: "How many cooks are in the kitchen right now?",
    options: [
      { label: "Just me", value: "1" },
      { label: "2 cooks", value: "2" },
      { label: "3 cooks", value: "3" },
    ],
    freeTextPlaceholder: "e.g. 4 cooks",
  },
];

export function nextNodeId(prefix = "step") {
  return `${prefix}_${crypto.randomUUID()}`;
}

/**
 * Builds a draft RecipeGraph for the demo dish (mapo tofu), matching the
 * `Recipe graph` schema in the brief. `answers` is the Stage 2 answer map
 * (question id -> value); only `diet` currently changes the graph shape,
 * but the function signature is the real seam for future personalization
 * (servings scaling duration, kitchenSetup limiting parallelism, etc).
 */
export function generateRecipeGraph(answers = {}) {
  const isMeatFree = answers.diet === "vegetarian" || answers.diet === "vegan";
  const servings = Number(answers.servings) || 4;
  const dishIdea = answers.dishIdea || "mapo tofu";

  const nodes = [
    {
      id: "tofu_cut",
      label: "Cut tofu into cubes",
      description: "Drain the block, cut into ~2cm cubes.",
      estimated_duration_sec: 180,
      difficulty: "low",
      required_equipment: ["cutting_board"],
      required_materials: ["tofu"],
      depends_on: [],
      status: "pending",
      phase: "prep",
    },
    {
      id: "aromatics_mince",
      label: "Mince garlic, ginger & scallion",
      description: "Fine-mince garlic and ginger; separate scallion whites from greens.",
      estimated_duration_sec: 150,
      difficulty: "low",
      required_equipment: ["cutting_board"],
      required_materials: ["garlic", "ginger", "scallion"],
      depends_on: [],
      status: "pending",
      phase: "prep",
    },
    {
      id: "sauce_mix",
      label: "Mix sauce & slurry",
      description: "Stock, soy sauce, sugar, and a cornstarch slurry, whisked together.",
      estimated_duration_sec: 120,
      difficulty: "medium",
      required_equipment: [],
      required_materials: ["stock", "soy_sauce", "cornstarch"],
      depends_on: [],
      status: "pending",
      phase: "prep",
    },
    {
      id: "tofu_blanch",
      label: "Blanch tofu",
      description: "Blanch cubes in salted water 1-2 min to firm up and remove bean flavor.",
      estimated_duration_sec: 120,
      difficulty: "low",
      required_equipment: ["stove_burner", "pot"],
      required_materials: [],
      depends_on: ["tofu_cut"],
      status: "pending",
      phase: "cook",
    },
    {
      id: "aromatics_saute",
      label: isMeatFree ? "Fry doubanjiang & aromatics" : "Brown pork, then fry doubanjiang & aromatics",
      description: isMeatFree
        ? "Fry doubanjiang and fermented black beans in oil until fragrant and red."
        : "Brown the ground pork until crisp, then fry doubanjiang and fermented black beans until fragrant.",
      estimated_duration_sec: isMeatFree ? 90 : 240,
      difficulty: "medium",
      required_equipment: ["stove_burner", "wok"],
      required_materials: ["doubanjiang", "fermented_black_beans"],
      depends_on: isMeatFree ? ["aromatics_mince"] : ["aromatics_mince", "pork_prep"],
      status: "pending",
      phase: "cook",
    },
    {
      id: "simmer_combine",
      label: "Combine & simmer",
      description: "Add blanched tofu and sauce to the wok, simmer to let the tofu take on flavor.",
      estimated_duration_sec: 240,
      difficulty: "high",
      required_equipment: ["stove_burner", "wok"],
      required_materials: [],
      depends_on: ["tofu_blanch", "aromatics_saute", "sauce_mix"],
      status: "pending",
      phase: "cook",
    },
    {
      id: "thicken_garnish",
      label: "Thicken & garnish",
      description: "Reduce until glossy, fold in scallion greens and a drizzle of chili oil.",
      estimated_duration_sec: 60,
      difficulty: "medium",
      required_equipment: ["stove_burner", "wok"],
      required_materials: ["chili_oil"],
      depends_on: ["simmer_combine"],
      status: "pending",
      phase: "cook",
    },
    {
      id: "plate_serve",
      label: "Plate & serve",
      description: "Transfer to a serving dish while still bubbling; serve immediately over rice.",
      estimated_duration_sec: 60,
      difficulty: "low",
      required_equipment: [],
      required_materials: ["rice"],
      depends_on: ["thicken_garnish"],
      status: "pending",
      phase: "plate",
    },
  ];

  if (!isMeatFree) {
    nodes.splice(2, 0, {
      id: "pork_prep",
      label: "Portion & season ground pork",
      description: "Portion the ground pork, season lightly with shaoxing wine.",
      estimated_duration_sec: 90,
      difficulty: "low",
      required_equipment: ["cutting_board"],
      required_materials: ["ground_pork"],
      depends_on: [],
      status: "pending",
      phase: "prep",
    });
  }

  return {
    recipe_id: `recipe_${Date.now()}`,
    title: isMeatFree ? "Mapo Tofu (vegetarian)" : "Mapo Tofu",
    dish_idea_raw: dishIdea,
    servings,
    created_at: new Date().toISOString(),
    nodes,
    // Materials a user adds while editing a step (not in MATERIAL_INFO
    // below) live here, keyed by id — same shape as MATERIAL_INFO's
    // values. Merge the two to get the full known-materials set.
    custom_materials: {},
  };
}

/** Turns a free-typed material name into a stable id, reusing an existing
 * one if it already matches (case/whitespace-insensitively). */
export function slugifyMaterialId(label) {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || `material_${Date.now()}`;
}

// Dummy portions for now — this is the seam for real recipe-scaling
// logic (servings-aware quantities) later. `category` drives the
// grouping in the materials checklist; kept coarse on purpose.
export const MATERIAL_INFO = {
  tofu: { label: "Tofu", category: "protein", amount: 400, unit: "g" },
  garlic: { label: "Garlic", category: "vegetable", amount: 3, unit: "cloves" },
  ginger: { label: "Ginger", category: "vegetable", amount: 1, unit: "thumb" },
  scallion: { label: "Scallion", category: "vegetable", amount: 2, unit: "stalks" },
  ground_pork: { label: "Ground pork", category: "protein", amount: 150, unit: "g" },
  stock: { label: "Stock", category: "pantry", amount: 200, unit: "ml" },
  soy_sauce: { label: "Soy sauce", category: "pantry", amount: 1, unit: "tbsp" },
  cornstarch: { label: "Cornstarch", category: "pantry", amount: 1, unit: "tsp" },
  doubanjiang: { label: "Doubanjiang", category: "pantry", amount: 1.5, unit: "tbsp" },
  fermented_black_beans: { label: "Fermented black beans", category: "pantry", amount: 1, unit: "tbsp" },
  chili_oil: { label: "Chili oil", category: "pantry", amount: 1, unit: "tsp" },
  rice: { label: "Rice", category: "grain", amount: 2, unit: "cups" },
};

// "protein" covers both meat and plant/other protein (tofu, eggs, etc.)
// — keeping meat as its own bucket next to tofu was over-splitting for
// what's really "the dish's protein component."
export const MATERIAL_CATEGORY_LABELS = {
  protein: "Protein",
  seafood: "Seafood",
  vegetable: "Vegetables",
  grain: "Grains",
  pantry: "Pantry & sauces",
  other: "Other",
};

// Display order for category groups (unlisted categories fall back to "other").
export const MATERIAL_CATEGORY_ORDER = ["protein", "seafood", "vegetable", "grain", "pantry", "other"];

export const EQUIPMENT_OPTIONS = ["cutting_board", "stove_burner", "wok", "pot", "oven"];
export const DIFFICULTY_OPTIONS = ["low", "medium", "high"];
export const PHASE_OPTIONS = [
  { value: "prep", label: "Prep" },
  { value: "cook", label: "Cook" },
  { value: "plate", label: "Plate" },
];
