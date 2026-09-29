// Seed data: a demo kitchen, hand-authored dishes and the materials
// catalog, so a fresh clone runs with no setup. Fixed ids with INSERT OR
// IGNORE make it safe to re-run and never overwrite a user's edits.
// Templates are the exception: read-only reference data, so their steps
// follow this file and an existing database picks up changes on restart.
import { db } from "./db.js";

function mapoTofuNodes(isMeatFree) {
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
    // Both dishes need garlic minced, so it is its own step with a
    // share_key: extractSharedSteps (src/utils/graphLayout.js) folds the
    // two into one shared step, and material_usage lets the merge state
    // a combined quantity.
    {
      id: "mince_garlic",
      label: "Mince garlic",
      description: "Mince the garlic cloves.",
      estimated_duration_sec: 60,
      difficulty: "low",
      required_equipment: ["cutting_board"],
      required_materials: ["garlic"],
      material_usage: { garlic: { amount: 3, unit: "cloves" } },
      depends_on: [],
      status: "pending",
      phase: "prep",
      is_shareable: true,
      share_key: "mince_garlic",
    },
    {
      id: "aromatics_mince_other",
      label: "Mince ginger & scallion",
      description: "Fine-mince ginger; separate scallion whites from greens.",
      estimated_duration_sec: 90,
      difficulty: "low",
      required_equipment: ["cutting_board"],
      required_materials: ["ginger", "scallion"],
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
    // The default demo's unattended steps, taken from a real generated Mapo
    // Tofu run: both are timed (nobody minds while they go, but the moment
    // they end matters), so a cook can start the water and go chop.
    {
      id: "boil_water",
      label: "Boil salted water in pot",
      description: "Bring salted water to a boil in a pot.",
      estimated_duration_sec: 300,
      difficulty: "low",
      required_equipment: ["stove_burner", "pot"],
      required_materials: [],
      depends_on: [],
      status: "pending",
      phase: "prep",
      tending: "timed",
      unattended: {
        initial: { duration_sec: 45, difficulty: "low" },
        checkpoints: null,
        ending: { duration_sec: 15, difficulty: "low" },
      },
    },
    {
      id: "tofu_blanch",
      label: "Blanch tofu",
      description: "Blanch cubes in salted water 1-2 min to firm up and remove bean flavor.",
      estimated_duration_sec: 120,
      difficulty: "low",
      required_equipment: ["stove_burner", "pot"],
      required_materials: [],
      depends_on: ["tofu_cut", "boil_water"],
      status: "pending",
      phase: "cook",
      tending: "timed",
      unattended: {
        initial: { duration_sec: 20, difficulty: "low" },
        checkpoints: null,
        ending: { duration_sec: 30, difficulty: "low" },
      },
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
      depends_on: isMeatFree
        ? ["mince_garlic", "aromatics_mince_other"]
        : ["mince_garlic", "aromatics_mince_other", "pork_prep"],
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
      // Keeps the dish's final step in the board's last column, even
      // beside a dish with a longer chain (graphLayout.js#layoutLevels).
      is_end_step: true,
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

  return nodes;
}

function chickenNoodleSoupNodes() {
  return [
    {
      id: "chicken_trim",
      label: "Trim & season chicken",
      description: "Trim excess fat off the chicken thighs and season with salt & pepper.",
      estimated_duration_sec: 120,
      difficulty: "low",
      required_equipment: ["cutting_board"],
      required_materials: ["chicken"],
      depends_on: [],
      status: "pending",
      phase: "prep",
    },
    {
      id: "veg_chop",
      label: "Dice onion, carrot & celery",
      description: "Dice the mirepoix — onion, carrot, and celery — into small even pieces.",
      estimated_duration_sec: 240,
      difficulty: "low",
      required_equipment: ["cutting_board"],
      required_materials: ["onion", "carrot", "celery"],
      depends_on: [],
      status: "pending",
      phase: "prep",
    },
    // Same shareable base step as Mapo Tofu's "mince_garlic" — matched
    // by share_key, not the literal id. Deliberately a different
    // material_usage amount than Mapo Tofu's so the merged shared step
    // demonstrably combines two distinct quantities.
    {
      id: "mince_garlic",
      label: "Mince garlic",
      description: "Mince the garlic cloves.",
      estimated_duration_sec: 60,
      difficulty: "low",
      required_equipment: ["cutting_board"],
      required_materials: ["garlic"],
      material_usage: { garlic: { amount: 2, unit: "cloves" } },
      depends_on: [],
      status: "pending",
      phase: "prep",
      is_shareable: true,
      share_key: "mince_garlic",
    },
    {
      id: "stock_measure",
      label: "Measure stock, bay leaf & thyme",
      description: "Measure out the stock and set aside the bay leaf and thyme.",
      estimated_duration_sec: 60,
      difficulty: "low",
      required_equipment: [],
      required_materials: ["stock", "bay_leaf", "thyme"],
      depends_on: [],
      status: "pending",
      phase: "prep",
    },
    {
      id: "saute_veg",
      label: "Sauté onion, carrot & celery",
      description: "Sweat the mirepoix and garlic in the pot until softened.",
      estimated_duration_sec: 300,
      difficulty: "medium",
      required_equipment: ["stove_burner", "pot"],
      required_materials: [],
      depends_on: ["veg_chop", "mince_garlic"],
      status: "pending",
      phase: "cook",
    },
    {
      id: "simmer_chicken",
      label: "Add chicken & stock, simmer",
      description: "Add the chicken, stock, bay leaf and thyme; simmer until the chicken is cooked through.",
      estimated_duration_sec: 900,
      difficulty: "medium",
      required_equipment: ["stove_burner", "pot"],
      required_materials: [],
      depends_on: ["saute_veg", "chicken_trim", "stock_measure"],
      status: "pending",
      phase: "cook",
    },
    {
      id: "shred_chicken",
      label: "Shred the cooked chicken",
      description: "Pull the chicken out, shred with two forks, discard the bay leaf.",
      estimated_duration_sec: 180,
      difficulty: "low",
      required_equipment: ["cutting_board"],
      required_materials: [],
      depends_on: ["simmer_chicken"],
      status: "pending",
      phase: "cook",
    },
    {
      id: "cook_noodles",
      label: "Cook egg noodles in the broth",
      description: "Bring the broth back to a simmer and cook the egg noodles directly in it.",
      estimated_duration_sec: 420,
      difficulty: "medium",
      required_equipment: ["stove_burner", "pot"],
      required_materials: ["egg_noodles"],
      depends_on: ["shred_chicken"],
      status: "pending",
      phase: "cook",
    },
    {
      id: "finish_garnish",
      label: "Return chicken & garnish with parsley",
      description: "Stir the shredded chicken back in, adjust seasoning, and finish with chopped parsley.",
      estimated_duration_sec: 120,
      difficulty: "low",
      required_equipment: ["stove_burner", "pot"],
      required_materials: ["parsley"],
      depends_on: ["cook_noodles"],
      status: "pending",
      phase: "cook",
    },
    {
      id: "plate_serve",
      label: "Ladle & serve hot",
      description: "Ladle into bowls and serve immediately while hot.",
      estimated_duration_sec: 60,
      difficulty: "low",
      required_equipment: [],
      required_materials: [],
      depends_on: ["finish_garnish"],
      status: "pending",
      phase: "plate",
      is_end_step: true,
    },
  ];
}

// The app can't start a session without a kitchen, so a fresh clone
// would otherwise dead-end on Home.
const KITCHEN_SEED = [
  { id: "demo-kitchen", name: "Demo Kitchen", burners: 2, hasWok: 1, hasOven: 1, cuttingBoards: 1, pots: 2 },
];

const TEMPLATE_SEED = [
  { id: "mapo-tofu-none", title: "Mapo Tofu", dish_idea_raw: "mapo tofu", diet: "none", servings_default: 4, nodes: mapoTofuNodes(false) },
  { id: "mapo-tofu-vegetarian", title: "Mapo Tofu (vegetarian)", dish_idea_raw: "mapo tofu", diet: "vegetarian", servings_default: 4, nodes: mapoTofuNodes(true) },
  { id: "chicken-noodle-soup-none", title: "Chicken Noodle Soup", dish_idea_raw: "chicken noodle soup", diet: "none", servings_default: 4, nodes: chickenNoodleSoupNodes() },
];

const MATERIALS_SEED = [
  { id: "tofu", label: "Tofu", category: "protein", amount: 400, unit: "g" },
  { id: "garlic", label: "Garlic", category: "vegetable", amount: 3, unit: "cloves" },
  { id: "ginger", label: "Ginger", category: "vegetable", amount: 1, unit: "thumb" },
  { id: "scallion", label: "Scallion", category: "vegetable", amount: 2, unit: "stalks" },
  { id: "ground_pork", label: "Ground pork", category: "protein", amount: 150, unit: "g" },
  { id: "stock", label: "Stock", category: "pantry", amount: 200, unit: "ml" },
  { id: "soy_sauce", label: "Soy sauce", category: "pantry", amount: 1, unit: "tbsp" },
  { id: "cornstarch", label: "Cornstarch", category: "pantry", amount: 1, unit: "tsp" },
  { id: "doubanjiang", label: "Doubanjiang", category: "pantry", amount: 1.5, unit: "tbsp" },
  { id: "fermented_black_beans", label: "Fermented black beans", category: "pantry", amount: 1, unit: "tbsp" },
  { id: "chili_oil", label: "Chili oil", category: "pantry", amount: 1, unit: "tsp" },
  { id: "rice", label: "Rice", category: "grain", amount: 2, unit: "cups" },
  { id: "chicken", label: "Chicken thighs", category: "protein", amount: 500, unit: "g" },
  { id: "onion", label: "Onion", category: "vegetable", amount: 1, unit: "whole" },
  { id: "carrot", label: "Carrot", category: "vegetable", amount: 2, unit: "whole" },
  { id: "celery", label: "Celery", category: "vegetable", amount: 2, unit: "stalks" },
  { id: "egg_noodles", label: "Egg noodles", category: "grain", amount: 200, unit: "g" },
  { id: "bay_leaf", label: "Bay leaf", category: "pantry", amount: 1, unit: "leaf" },
  { id: "thyme", label: "Thyme", category: "pantry", amount: 0.5, unit: "tsp" },
  { id: "parsley", label: "Parsley", category: "vegetable", amount: 2, unit: "tbsp" },
];

const insertTemplateStmt = db.prepare(`
  INSERT INTO recipe_templates (id, title, dish_idea_raw, diet, servings_default, nodes_json, created_at)
  VALUES (@id, @title, @dish_idea_raw, @diet, @servings_default, @nodes_json, @created_at)
  ON CONFLICT(id) DO UPDATE SET nodes_json = excluded.nodes_json
`);
const insertMaterialStmt = db.prepare(`
  INSERT OR IGNORE INTO materials (id, label, category, amount, unit) VALUES (@id, @label, @category, @amount, @unit)
`);
const insertKitchenStmt = db.prepare(`
  INSERT OR IGNORE INTO kitchens (id, name, burners, hasWok, hasOven, cuttingBoards, pots, createdAt, updatedAt)
  VALUES (@id, @name, @burners, @hasWok, @hasOven, @cuttingBoards, @pots, @createdAt, @updatedAt)
`);

function seed() {
  const now = new Date().toISOString();
  KITCHEN_SEED.forEach((k) => insertKitchenStmt.run({ ...k, createdAt: now, updatedAt: now }));
  TEMPLATE_SEED.forEach(({ nodes, ...t }) =>
    insertTemplateStmt.run({ ...t, nodes_json: JSON.stringify(nodes), created_at: now })
  );
  MATERIALS_SEED.forEach((m) => insertMaterialStmt.run(m));
}

seed();
