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

kitchensRouter.delete("/:id", (req, res) => {
  const result = deleteStmt.run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "kitchen not found" });
  res.status(204).end();
});
