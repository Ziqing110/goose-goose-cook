// Thin client around the recipe-templates/materials reference-data API
// (server/routes/recipeTemplates.js) — read-only "content" that used to
// be hardcoded in src/data/dishes.js.
import { apiRequest } from "./client.js";

export function listRecipeTemplates() {
  return apiRequest("/api/recipe-templates", "", { method: "GET" });
}

export function listMaterials() {
  return apiRequest("/api/materials", "", { method: "GET" });
}
