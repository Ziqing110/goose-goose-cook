// Generic, dish-agnostic helpers. The actual recipe content (the Mapo
// Tofu demo, its steps, and the materials catalog) now lives in the
// database — see server/db.js's seed data and src/api/recipeTemplates.js
// — so RecipeGraphPage renders whatever template comes back from the
// API instead of one hand-authored dish baked into the bundle.

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

// "protein" covers both meat and plant/other protein (tofu, eggs, etc.)
// — keeping meat as its own bucket next to tofu was over-splitting for
// what's really "the dish's protein component." This taxonomy is a
// small, fixed set of display groupings — not worth a DB round-trip,
// unlike the materials themselves (src/api/recipeTemplates.js).
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
// Display names for equipment ids — the ids are stable keys used in
// recipe data, not something a cook should ever read on screen.
export const EQUIPMENT_LABELS = {
  cutting_board: "Cutting board",
  stove_burner: "Stove burner",
  wok: "Wok",
  pot: "Pot",
  oven: "Oven",
};
export const equipmentLabel = (id) => EQUIPMENT_LABELS[id] || id.replace(/_/g, " ");
export const DIFFICULTY_OPTIONS = ["low", "medium", "high"];
export const PHASE_OPTIONS = [
  { value: "prep", label: "Prep" },
  { value: "cook", label: "Cook" },
  { value: "plate", label: "Plate" },
];
