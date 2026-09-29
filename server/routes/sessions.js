// Sessions and what they own: an ordered list of recipe instances, and
// steps shared across those recipes (one "mince garlic" feeding two
// dishes). Recipes and shared steps each keep a draft, a working copy
// and an approved copy.
import { Router } from "express";
import { db, rowMapper } from "../db.js";
import { clientOf } from "../client.js";

export const sessionsRouter = Router();

const now = () => new Date().toISOString();

const sessionFields = rowMapper([
  ["kitchenProfileId", "kitchen_profile_id"],
  ["status", "status"],
  ["endedAt", "ended_at"],
  ["conversation", "conversation_json", true],
  ["selectedNodeId", "selected_node_id"],
  ["cooks", "cooks_json", true],
  ["mode", "mode"],
  ["run", "run_json", true],
  ["summary", "summary_json", true],
  // Ingredients the cook marked "out" on the Inventory page.
  ["outMaterialIds", "out_material_ids_json", true],
  // { nodeId: { x, y } }: board layout, not recipe content.
  ["nodePositions", "node_positions_json", true],
]);
const recipeFields = rowMapper([
  ["working", "working_json", true],
  ["approved", "approved_json", true],
  ["custom_materials", "custom_materials_json", true],
]);
const sharedStepFields = rowMapper([
  ["working", "working_json", true],
  ["approved", "approved_json", true],
]);

const getSessionStmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
const getRecipesStmt = db.prepare("SELECT * FROM recipe_instances WHERE session_id = ? ORDER BY position ASC");
const getSharedStepsStmt = db.prepare("SELECT * FROM shared_steps WHERE session_id = ? ORDER BY id ASC");
const getRecipeStmt = db.prepare("SELECT * FROM recipe_instances WHERE id = ? AND session_id = ?");
const getSharedStepStmt = db.prepare("SELECT * FROM shared_steps WHERE id = ? AND session_id = ?");

const recipeToApi = (row) => ({
  id: row.id,
  templateId: row.template_id,
  position: row.position,
  draft: JSON.parse(row.draft_json),
  ...recipeFields.fromRow(row),
});
const sharedStepToApi = (row) => ({ id: row.id, draft: JSON.parse(row.draft_json), ...sharedStepFields.fromRow(row) });

function sessionToApi(row) {
  return {
    id: row.id,
    startedAt: row.started_at,
    ...sessionFields.fromRow(row),
    recipes: getRecipesStmt.all(row.id).map(recipeToApi),
    sharedSteps: getSharedStepsStmt.all(row.id).map(sharedStepToApi),
  };
}

/** Load a session or answer 404; handlers return early on undefined. */
function findSession(req, res) {
  const row = getSessionStmt.get(req.params.id);
  if (!row) res.status(404).json({ error: "session not found" });
  return row;
}

// Rows with no owner are visible to everyone: that is what `npm run seed`
// creates, and seeded demo content is meant to be shared.
const OWNED_BY = "(client_id IS NULL OR client_id = '' OR client_id = ?)";
const statusFilter = (statuses) => (statuses.length ? `AND status IN (${statuses.map(() => "?").join(",")})` : "");

// Home's run log needs a title, a kitchen, a duration and a status, not a
// whole session with its photo and run transcript. json_extract digs in
// SQLite so the big JSON columns never cross the wire.
const listRecipeTitlesStmt = db.prepare(`
  SELECT json_extract(working_json, '$.title') AS title,
         json_extract(working_json, '$.servings') AS servings
  FROM recipe_instances WHERE session_id = ? ORDER BY position ASC
`);

function sessionToListItem(row) {
  const recipes = listRecipeTitlesStmt.all(row.id);
  const fromRecipes = recipes.map((r) => r.title).filter(Boolean).join(" + ");
  return {
    id: row.id,
    kitchenProfileId: row.kitchen_profile_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    dish: row.summary_dish || fromRecipes || row.dish_idea || null,
    servings: recipes[0]?.servings ?? (Number(row.answer_servings) || null),
    // Abandoned runs never froze a summary, so there's no card to open.
    hasSummary: Boolean(row.has_summary),
  };
}

sessionsRouter.get("/", (req, res) => {
  const statuses = String(req.query.status || "").split(",").filter(Boolean);
  const where = `WHERE ${OWNED_BY} ${statusFilter(statuses)} ORDER BY started_at DESC`;
  const args = [clientOf(req), ...statuses];
  if (req.query.view === "list") {
    const rows = db.prepare(`
      SELECT id, kitchen_profile_id, status, started_at, ended_at,
             json_extract(conversation_json, '$.answers.dishIdea') AS dish_idea,
             json_extract(conversation_json, '$.answers.servings') AS answer_servings,
             json_extract(summary_json, '$.dish') AS summary_dish,
             summary_json IS NOT NULL AS has_summary
      FROM sessions ${where}
    `).all(...args);
    return res.json(rows.map(sessionToListItem));
  }
  res.json(db.prepare(`SELECT * FROM sessions ${where}`).all(...args).map(sessionToApi));
});

// Not scoped to the client, on purpose: ids are uuids, and a shared link
// to one cook should keep working.
sessionsRouter.get("/:id", (req, res) => {
  const row = findSession(req, res);
  if (row) res.json(sessionToApi(row));
});

// The client resumes only one active session, so a second active row
// would be unreachable forever. Starting a session closes out any other
// active one, scoped to this browser so one visitor never ends another's
// run on the shared demo.
const abandonOtherActiveStmt = db.prepare(
  "UPDATE sessions SET status='abandoned', ended_at=@now, updated_at=@now WHERE status='active' AND id != @id AND ifnull(client_id, '') = @client_id",
);
const insertSessionStmt = db.prepare(`
  INSERT INTO sessions (id, kitchen_profile_id, status, started_at, conversation_json, updated_at, client_id)
  VALUES (@id, @kitchen_profile_id, 'active', @started_at, @conversation_json, @started_at, @client_id)
`);
const emptyConversation = { complete: false, transcript: [], answers: {}, understanding: {}, questionIndex: 0 };

sessionsRouter.post("/", (req, res) => {
  const { id, kitchenProfileId } = req.body;
  if (!id) return res.status(400).json({ error: "id is required" });
  const client_id = clientOf(req);
  const started_at = now();
  db.transaction(() => {
    abandonOtherActiveStmt.run({ id, now: started_at, client_id });
    insertSessionStmt.run({
      id,
      kitchen_profile_id: kitchenProfileId ?? null,
      started_at,
      conversation_json: JSON.stringify(emptyConversation),
      client_id,
    });
  })();
  res.status(201).json(sessionToApi(getSessionStmt.get(id)));
});

const updateSessionStmt = db.prepare(`UPDATE sessions SET ${sessionFields.assignments}, updated_at=@updated_at WHERE id=@id`);

sessionsRouter.patch("/:id", (req, res) => {
  const existing = findSession(req, res);
  if (!existing) return;
  updateSessionStmt.run({ ...sessionFields.toRow(req.body, existing), id: existing.id, updated_at: now() });
  res.json(sessionToApi(getSessionStmt.get(existing.id)));
});

// There are no FK cascades on these tables, so children are deleted
// explicitly, in one transaction.
const deleteRecipesStmt = db.prepare("DELETE FROM recipe_instances WHERE session_id = ?");
const deleteSharedStepsStmt = db.prepare("DELETE FROM shared_steps WHERE session_id = ?");
const deleteSessionStmt = db.prepare("DELETE FROM sessions WHERE id = ?");
const clearPlan = db.transaction((id) => {
  deleteSharedStepsStmt.run(id);
  deleteRecipesStmt.run(id);
});

sessionsRouter.delete("/:id", (req, res) => {
  const existing = findSession(req, res);
  if (!existing) return;
  db.transaction(() => {
    clearPlan(existing.id);
    deleteSessionStmt.run(existing.id);
  })();
  res.status(204).end();
});

// Starting the conversation over discards the plan it produced, but keeps
// the session, its kitchen and its cooks. Recipes are generated from the
// answers once, so stale rows would otherwise come back on reload.
sessionsRouter.delete("/:id/plan", (req, res) => {
  const existing = findSession(req, res);
  if (!existing) return;
  clearPlan(existing.id);
  res.status(204).end();
});

// --- recipe instances ---------------------------------------------------

const insertRecipeStmt = db.prepare(`
  INSERT INTO recipe_instances (id, session_id, template_id, position, draft_json, working_json, approved_json, custom_materials_json, updated_at)
  VALUES (@id, @session_id, @template_id, @position, @draft_json, @working_json, NULL, @custom_materials_json, @updated_at)
`);
const updateRecipeStmt = db.prepare(
  `UPDATE recipe_instances SET ${recipeFields.assignments}, updated_at=@updated_at WHERE id=@id AND session_id=@session_id`,
);

sessionsRouter.post("/:id/recipes", (req, res) => {
  const session = findSession(req, res);
  if (!session) return;
  const { id, templateId, draft, working, custom_materials } = req.body;
  if (!id || !draft || !working) return res.status(400).json({ error: "id, draft, and working are required" });

  insertRecipeStmt.run({
    id,
    session_id: session.id,
    template_id: templateId ?? null,
    position: getRecipesStmt.all(session.id).length,
    draft_json: JSON.stringify(draft),
    working_json: JSON.stringify(working),
    custom_materials_json: JSON.stringify(custom_materials || {}),
    updated_at: now(),
  });
  res.status(201).json(recipeToApi(getRecipeStmt.get(id, session.id)));
});

sessionsRouter.patch("/:id/recipes/:recipeId", (req, res) => {
  const existing = getRecipeStmt.get(req.params.recipeId, req.params.id);
  if (!existing) return res.status(404).json({ error: "recipe instance not found" });
  updateRecipeStmt.run({ ...recipeFields.toRow(req.body, existing), id: existing.id, session_id: existing.session_id, updated_at: now() });
  res.json(recipeToApi(getRecipeStmt.get(existing.id, existing.session_id)));
});

// --- shared steps -------------------------------------------------------

const insertSharedStepStmt = db.prepare(`
  INSERT INTO shared_steps (id, session_id, draft_json, working_json, approved_json, updated_at)
  VALUES (@id, @session_id, @draft_json, @working_json, NULL, @updated_at)
`);
const updateSharedStepStmt = db.prepare(
  `UPDATE shared_steps SET ${sharedStepFields.assignments}, updated_at=@updated_at WHERE id=@id AND session_id=@session_id`,
);
const deleteSharedStepStmt = db.prepare("DELETE FROM shared_steps WHERE id = ? AND session_id = ?");

sessionsRouter.post("/:id/shared-steps", (req, res) => {
  const session = findSession(req, res);
  if (!session) return;
  const { id, draft, working } = req.body;
  if (!id || !draft || !working) return res.status(400).json({ error: "id, draft, and working are required" });

  insertSharedStepStmt.run({
    id,
    session_id: session.id,
    draft_json: JSON.stringify(draft),
    working_json: JSON.stringify(working),
    updated_at: now(),
  });
  res.status(201).json(sharedStepToApi(getSharedStepStmt.get(id, session.id)));
});

sessionsRouter.patch("/:id/shared-steps/:stepId", (req, res) => {
  const existing = getSharedStepStmt.get(req.params.stepId, req.params.id);
  if (!existing) return res.status(404).json({ error: "shared step not found" });
  updateSharedStepStmt.run({ ...sharedStepFields.toRow(req.body, existing), id: existing.id, session_id: existing.session_id, updated_at: now() });
  res.json(sharedStepToApi(getSharedStepStmt.get(existing.id, existing.session_id)));
});

// A shared step can be a dependency across recipe boundaries, so
// deleting one scrubs it from every recipe and every other shared step
// in the session, atomically.
const withoutDependency = (node, stepId) => ({ ...node, depends_on: (node.depends_on || []).filter((d) => d !== stepId) });

const deleteSharedStep = db.transaction((sessionId, stepId) => {
  deleteSharedStepStmt.run(stepId, sessionId);
  const updated_at = now();
  for (const row of getRecipesStmt.all(sessionId)) {
    const working = JSON.parse(row.working_json);
    const nodes = working.nodes.map((n) => withoutDependency(n, stepId));
    updateRecipeStmt.run({ ...recipeFields.toRow({ working: { ...working, nodes } }, row), id: row.id, session_id: sessionId, updated_at });
  }
  for (const row of getSharedStepsStmt.all(sessionId)) {
    const working = withoutDependency(JSON.parse(row.working_json), stepId);
    updateSharedStepStmt.run({ ...sharedStepFields.toRow({ working }, row), id: row.id, session_id: sessionId, updated_at });
  }
});

sessionsRouter.delete("/:id/shared-steps/:stepId", (req, res) => {
  if (!getSharedStepStmt.get(req.params.stepId, req.params.id)) {
    return res.status(404).json({ error: "shared step not found" });
  }
  deleteSharedStep(req.params.id, req.params.stepId);
  res.status(204).end();
});
