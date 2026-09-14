import { Router } from "express";
import { db } from "../db.js";

export const recipeTemplatesRouter = Router();
export const materialsRouter = Router();

function templateToApi(row) {
  return { ...row, nodes: JSON.parse(row.nodes_json) };
}

const listTemplatesStmt = db.prepare("SELECT * FROM recipe_templates ORDER BY created_at ASC");
const listMaterialsStmt = db.prepare("SELECT * FROM materials ORDER BY id ASC");

recipeTemplatesRouter.get("/", (req, res) => {
  res.json(listTemplatesStmt.all().map(templateToApi));
});

materialsRouter.get("/", (req, res) => {
  res.json(listMaterialsStmt.all());
});
