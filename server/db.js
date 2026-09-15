// SQLite-backed storage. Single shared pool, no per-user scoping (per
// current project decision — revisit if real accounts are ever added).
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dbPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "data.sqlite");
export const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS kitchens (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    burners INTEGER NOT NULL,
    hasWok INTEGER NOT NULL,
    hasOven INTEGER NOT NULL,
    cuttingBoards INTEGER NOT NULL,
    pots INTEGER NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  -- Reference data: dish templates + the materials catalog. Read-only
  -- from the API's point of view; seeded once below.
  CREATE TABLE IF NOT EXISTS recipe_templates (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    dish_idea_raw TEXT NOT NULL,
    diet TEXT NOT NULL,
    servings_default INTEGER NOT NULL,
    nodes_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    unit TEXT NOT NULL
  );

  -- Session domain: a session owns an ordered list of recipe instances
  -- (recipe_instances.session_id) rather than embedding a single graph —
  -- this is what lets a session eventually hold more than one dish.
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    kitchen_profile_id TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    conversation_json TEXT NOT NULL,
    selected_node_id TEXT,
    cooks_json TEXT NOT NULL DEFAULT '[]',
    mode TEXT,
    run_json TEXT,
    summary_json TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recipe_instances (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    template_id TEXT,
    position INTEGER NOT NULL,
    draft_json TEXT NOT NULL,
    working_json TEXT NOT NULL,
    approved_json TEXT,
    custom_materials_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  );

  -- Session-owned steps shared across two or more of that session's
  -- recipe instances (e.g. one "mince garlic" feeding both Mapo Tofu and
  -- Chicken Noodle Soup) instead of each recipe instance carrying its
  -- own duplicate copy. Mirrors recipe_instances' draft/working/approved
  -- shape, just scoped to a single step object instead of a whole graph.
  -- Detected once, at the initial batch-instantiation of a session's
  -- recipes (see extractSharedSteps in src/utils/graphLayout.js) — there
  -- is no support for retroactively promoting an existing per-dish step
  -- into a shared one afterward.
  CREATE TABLE IF NOT EXISTS shared_steps (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    draft_json TEXT NOT NULL,
    working_json TEXT NOT NULL,
    approved_json TEXT,
    updated_at TEXT NOT NULL
  );
`);

// No migration system exists in this repo — CREATE TABLE IF NOT EXISTS
// is a no-op against an already-existing sessions table, so new columns
// need an explicit, guarded ALTER TABLE to reach a dev DB created before
// this change.
const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all().map((c) => c.name);
if (!sessionColumns.includes("cooks_json")) {
  db.exec("ALTER TABLE sessions ADD COLUMN cooks_json TEXT NOT NULL DEFAULT '[]'");
}
if (!sessionColumns.includes("mode")) {
  db.exec("ALTER TABLE sessions ADD COLUMN mode TEXT");
}
if (!sessionColumns.includes("run_json")) {
  db.exec("ALTER TABLE sessions ADD COLUMN run_json TEXT");
}
if (!sessionColumns.includes("summary_json")) {
  db.exec("ALTER TABLE sessions ADD COLUMN summary_json TEXT");
}

// ---------------------------------------------------------------------
// Seed data — hand-authored demo dishes and their materials catalog.
// Every seed row uses a fixed id and is inserted with INSERT OR IGNORE,
// so adding a new dish here is additive (just append to TEMPLATE_SEED /
// MATERIALS_SEED) and restarting the server never duplicates or resets
// rows a user has since edited.
// ---------------------------------------------------------------------

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
    // "Mince garlic" is split out as its own base step since both dishes
    // need it — is_shareable + share_key (not the literal `id`, which is
    // otherwise just cosmetic) are what src/utils/graphLayout.js's
    // extractSharedSteps() matches on to fold this into one shared step
    // when both dishes are instantiated together. material_usage lets
    // the merge state a real combined quantity instead of guessing from
    // the flat materials catalog. A future LLM template generator would
    // need to emit these same fields to mark a step as shareable.
    // Other aromatics specific to this dish stay in their own step.
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
      // Marks this as the dish's final step so the dependency graph
      // (src/utils/graphLayout.js#layoutLevels) always renders it in the
      // last column, even when another dish sharing the same graph has
      // a longer chain. A future LLM-generated dish must tag its own
      // terminal step the same way.
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

// A kitchen to cook in. The app can't start a session without one, and
// nothing creates one automatically, so a fresh clone would otherwise
// dead-end on the Home screen. Seeded so `npm run dev:full` is a working
// demo with no database file checked in and no setup steps.
const KITCHEN_SEED = [
  { id: "demo-kitchen", name: "Demo Kitchen", burners: 2, hasWok: 1, hasOven: 1, cuttingBoards: 1, pots: 2 },
];

// Fixed ids (not randomUUID()) so INSERT OR IGNORE below is stable across
// restarts — a new dish is just a new entry in this array.
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
  INSERT OR IGNORE INTO recipe_templates (id, title, dish_idea_raw, diet, servings_default, nodes_json, created_at)
  VALUES (@id, @title, @dish_idea_raw, @diet, @servings_default, @nodes_json, @created_at)
`);
const insertMaterialStmt = db.prepare(`
  INSERT OR IGNORE INTO materials (id, label, category, amount, unit) VALUES (@id, @label, @category, @amount, @unit)
`);
const insertKitchenStmt = db.prepare(`
  INSERT OR IGNORE INTO kitchens (id, name, burners, hasWok, hasOven, cuttingBoards, pots, createdAt, updatedAt)
  VALUES (@id, @name, @burners, @hasWok, @hasOven, @cuttingBoards, @pots, @createdAt, @updatedAt)
`);

// Everything demo-shaped lives here rather than in a committed database
// file, so a clone is `npm install && npm run dev:full` and nothing else.
// INSERT OR IGNORE on fixed ids means this is safe to re-run and never
// overwrites anything someone has since edited.
//
// This is placeholder content standing in for real generation — when the
// LLM recipe API lands, TEMPLATE_SEED stops being the source of dishes
// and this shrinks back to just the kitchen and the materials catalog.
function seedIfEmpty() {
  const now = new Date().toISOString();
  KITCHEN_SEED.forEach((k) => insertKitchenStmt.run({ ...k, createdAt: now, updatedAt: now }));
  TEMPLATE_SEED.forEach(({ nodes, ...t }) =>
    insertTemplateStmt.run({ ...t, nodes_json: JSON.stringify(nodes), created_at: now })
  );
  MATERIALS_SEED.forEach((m) => insertMaterialStmt.run(m));
}

seedIfEmpty();
