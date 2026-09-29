// SQLite storage: the schema, a row mapper the routes share, and the
// demo seed. One shared pool; see the client_id note below for how a
// shared demo keeps visitors apart.
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
    out_material_ids_json TEXT NOT NULL DEFAULT '[]',
    node_positions_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    client_id TEXT
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

// Databases created before a column existed get it added here, since
// CREATE TABLE IF NOT EXISTS leaves an existing table alone.
const SESSION_COLUMNS_ADDED_LATER = {
  cooks_json: "TEXT NOT NULL DEFAULT '[]'",
  mode: "TEXT",
  run_json: "TEXT",
  summary_json: "TEXT",
  out_material_ids_json: "TEXT NOT NULL DEFAULT '[]'",
  // Where each step card sits on the board: layout, not recipe content.
  node_positions_json: "TEXT NOT NULL DEFAULT '{}'",
  // DEMO ONLY. Which browser started this session. NOT authentication:
  // the client generates it and asserts it in a header, so anyone can
  // send anyone else's. It exists so visitors to one shared, login-free
  // deployment don't see each other's cooks or abandon each other's
  // runs. Real accounts would replace it.
  client_id: "TEXT",
};
const existingColumns = new Set(db.prepare("PRAGMA table_info(sessions)").all().map((c) => c.name));
for (const [column, type] of Object.entries(SESSION_COLUMNS_ADDED_LATER)) {
  if (!existingColumns.has(column)) db.exec(`ALTER TABLE sessions ADD COLUMN ${column} ${type}`);
}

/**
 * Maps API objects to rows and back. Each field is [apiKey, column,
 * isJson]; JSON columns are stored as text. `toRow` fills any field the
 * body leaves undefined from `existing`, which is what a PATCH wants.
 */
export function rowMapper(fields) {
  return {
    fromRow: (row) => Object.fromEntries(fields.map(([key, column, json]) => [key, json ? JSON.parse(row[column]) : row[column]])),
    toRow: (body, existing = {}) =>
      Object.fromEntries(
        fields.map(([key, column, json]) => [
          column,
          body[key] === undefined ? existing[column] : json ? JSON.stringify(body[key]) : body[key],
        ]),
      ),
    assignments: fields.map(([, column]) => `${column}=@${column}`).join(", "),
  };
}
