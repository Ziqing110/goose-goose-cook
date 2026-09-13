// SQLite-backed kitchen storage. Single shared pool, no per-user
// scoping (per current project decision — revisit if real accounts
// are ever added).
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
  )
`);
