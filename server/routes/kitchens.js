import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { clientOf } from "../client.js";

export const kitchensRouter = Router();

function toApi(row) {
  return { ...row, hasWok: Boolean(row.hasWok), hasOven: Boolean(row.hasOven) };
}

const listStmt = db.prepare("SELECT * FROM kitchens ORDER BY createdAt ASC");
const getStmt = db.prepare("SELECT * FROM kitchens WHERE id = ?");
const insertStmt = db.prepare(`
  INSERT INTO kitchens (id, name, burners, hasWok, hasOven, cuttingBoards, pots, createdAt, updatedAt)
  VALUES (@id, @name, @burners, @hasWok, @hasOven, @cuttingBoards, @pots, @createdAt, @updatedAt)
`);
const updateStmt = db.prepare(`
  UPDATE kitchens SET name=@name, burners=@burners, hasWok=@hasWok, hasOven=@hasOven,
    cuttingBoards=@cuttingBoards, pots=@pots, updatedAt=@updatedAt
  WHERE id=@id
`);
const deleteStmt = db.prepare("DELETE FROM kitchens WHERE id = ?");

// Two kitchens with the same name cannot be told apart — not in the
// picker, and not by voice, where a kitchen is chosen by saying a word
// that belongs to exactly one of them (utils/kitchenPick.js). A second
// "Home kitchen" makes that word ambiguous and the spoken pick stops
// working for BOTH. Compared case-insensitively and trimmed, because
// "Home Kitchen" and "home kitchen " are the same kitchen to everyone
// except a string comparison.
const nameTakenStmt = db.prepare(
  "SELECT id FROM kitchens WHERE lower(trim(name)) = lower(trim(?)) AND id != ?"
);
const nameIsTaken = (name, selfId = "") => Boolean(nameTakenStmt.get(name, selfId));

kitchensRouter.get("/", (req, res) => {
  res.json(listStmt.all().map(toApi));
});

const count = (value) => Math.max(0, Math.round(Number(value)) || 0);
const flag = (value) => (value ? 1 : 0);

/** The body's fields over `existing`'s, normalized for the table. */
function kitchenFields(body, existing = {}) {
  const pick = (key, normalize) => (body[key] !== undefined ? normalize(body[key]) : existing[key]);
  return {
    name: pick("name", (name) => String(name).trim()),
    burners: pick("burners", count),
    hasWok: pick("hasWok", flag),
    hasOven: pick("hasOven", flag),
    cuttingBoards: pick("cuttingBoards", count),
    pots: pick("pots", count),
  };
}

/** Why `name` cannot be used, or null. */
function nameProblem(name, selfId) {
  if (!name) return { status: 400, error: "name is required" };
  if (nameIsTaken(name, selfId)) return { status: 409, error: `You already have a kitchen called “${name}”.` };
  return null;
}

kitchensRouter.post("/", (req, res) => {
  const fields = kitchenFields({ burners: 0, hasWok: false, hasOven: false, cuttingBoards: 0, pots: 0, ...req.body });
  const problem = nameProblem(fields.name);
  if (problem) return res.status(problem.status).json({ error: problem.error });
  const now = new Date().toISOString();
  const row = { id: randomUUID(), ...fields, createdAt: now, updatedAt: now };
  insertStmt.run(row);
  res.status(201).json(toApi(row));
});

kitchensRouter.put("/:id", (req, res) => {
  const existing = getStmt.get(req.params.id);
  if (!existing) return res.status(404).json({ error: "kitchen not found" });
  const fields = kitchenFields(req.body, existing);
  const problem = nameProblem(fields.name, existing.id);
  if (problem) return res.status(problem.status).json({ error: problem.error });
  updateStmt.run({ id: existing.id, ...fields, updatedAt: new Date().toISOString() });
  res.json(toApi(getStmt.get(existing.id)));
});

// Deleting the kitchen a live run is using used to succeed silently:
// the session's kitchen_profile_id went null, the route guards bounced
// the cook to kitchen setup mid-cook, and every later re-plan fell back
// to a one-burner, one-board kitchen without saying so. Refuse instead;
// finished runs hold no such claim and don't block it.
//
// Only a cook that has actually started and not ended, and only in this
// browser. Every visit leaves an 'active' session row behind while it is
// still planning -- including other tabs, other browsers and test
// runs -- and counting those blocked the delete with "the run you have
// in progress" when nothing was cooking anywhere the person could see.
// A planning session whose kitchen goes is already handled: the route
// guards send it back to the kitchen picker.
const countActiveSessionsStmt = db.prepare(
  `SELECT COUNT(*) AS n FROM sessions
   WHERE kitchen_profile_id = ? AND status = 'active'
     AND run_json IS NOT NULL AND json_extract(run_json, '$.endedAt') IS NULL
     AND ifnull(client_id, '') = ?`
);

kitchensRouter.delete("/:id", (req, res) => {
  const existing = getStmt.get(req.params.id);
  if (!existing) return res.status(404).json({ error: "kitchen not found" });
  if (countActiveSessionsStmt.get(req.params.id, clientOf(req)).n > 0) {
    return res.status(409).json({ error: `"${existing.name}" is in use by the run you have in progress. Finish or abandon that run first.` });
  }
  deleteStmt.run(req.params.id);
  res.status(204).end();
});
