import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";

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

kitchensRouter.get("/", (req, res) => {
  res.json(listStmt.all().map(toApi));
});

kitchensRouter.post("/", (req, res) => {
  const { name, burners, hasWok, hasOven, cuttingBoards, pots } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(),
    name: name.trim(),
    burners: Number(burners) || 0,
    hasWok: hasWok ? 1 : 0,
    hasOven: hasOven ? 1 : 0,
    cuttingBoards: Number(cuttingBoards) || 0,
    pots: Number(pots) || 0,
    createdAt: now,
    updatedAt: now,
  };
  insertStmt.run(row);
  res.status(201).json(toApi(row));
});

kitchensRouter.put("/:id", (req, res) => {
  const existing = getStmt.get(req.params.id);
  if (!existing) return res.status(404).json({ error: "kitchen not found" });

  const { name, burners, hasWok, hasOven, cuttingBoards, pots } = req.body;
  const row = {
    id: existing.id,
    name: name !== undefined ? String(name).trim() : existing.name,
    burners: burners !== undefined ? Number(burners) : existing.burners,
    hasWok: hasWok !== undefined ? (hasWok ? 1 : 0) : existing.hasWok,
    hasOven: hasOven !== undefined ? (hasOven ? 1 : 0) : existing.hasOven,
    cuttingBoards: cuttingBoards !== undefined ? Number(cuttingBoards) : existing.cuttingBoards,
    pots: pots !== undefined ? Number(pots) : existing.pots,
    updatedAt: new Date().toISOString(),
  };
  updateStmt.run(row);
  res.json(toApi(getStmt.get(req.params.id)));
});

// Deleting the kitchen a live run is using used to succeed silently:
// the session's kitchen_profile_id went null, the route guards bounced
// the cook to kitchen setup mid-cook, and every later re-plan fell back
// to a one-burner, one-board kitchen without saying so. Refuse instead;
// finished runs hold no such claim and don't block it.
const countActiveSessionsStmt = db.prepare(
  "SELECT COUNT(*) AS n FROM sessions WHERE kitchen_profile_id = ? AND status = 'active'"
);

kitchensRouter.delete("/:id", (req, res) => {
  const existing = getStmt.get(req.params.id);
  if (!existing) return res.status(404).json({ error: "kitchen not found" });
  if (countActiveSessionsStmt.get(req.params.id).n > 0) {
    return res.status(409).json({ error: `"${existing.name}" is in use by the run you have in progress. Finish or abandon that run first.` });
  }
  deleteStmt.run(req.params.id);
  res.status(204).end();
});
