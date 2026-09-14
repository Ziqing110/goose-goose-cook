import { Router } from "express";
import { db } from "../db.js";

export const sessionsRouter = Router();

const emptyConversation = () => ({ complete: false, transcript: [], answers: {}, questionIndex: 0 });

function recipeRowToApi(row) {
  return {
    id: row.id,
    templateId: row.template_id,
    position: row.position,
    draft: JSON.parse(row.draft_json),
    working: JSON.parse(row.working_json),
    approved: row.approved_json ? JSON.parse(row.approved_json) : null,
    custom_materials: JSON.parse(row.custom_materials_json),
  };
}

function sharedStepRowToApi(row) {
  return {
    id: row.id,
    draft: JSON.parse(row.draft_json),
    working: JSON.parse(row.working_json),
    approved: row.approved_json ? JSON.parse(row.approved_json) : null,
  };
}

function sessionRowToApi(row, recipeRows, sharedStepRows) {
  return {
    id: row.id,
    kitchenProfileId: row.kitchen_profile_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    conversation: JSON.parse(row.conversation_json),
    selectedNodeId: row.selected_node_id,
    recipes: recipeRows.map(recipeRowToApi),
    sharedSteps: sharedStepRows.map(sharedStepRowToApi),
  };
}

const getSessionStmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
const getRecipesForSessionStmt = db.prepare("SELECT * FROM recipe_instances WHERE session_id = ? ORDER BY position ASC");
const getSharedStepsForSessionStmt = db.prepare("SELECT * FROM shared_steps WHERE session_id = ? ORDER BY id ASC");
const insertSessionStmt = db.prepare(`
  INSERT INTO sessions (id, kitchen_profile_id, status, started_at, ended_at, conversation_json, selected_node_id, updated_at)
  VALUES (@id, @kitchen_profile_id, @status, @started_at, @ended_at, @conversation_json, @selected_node_id, @updated_at)
`);
const updateSessionStmt = db.prepare(`
  UPDATE sessions SET kitchen_profile_id=@kitchen_profile_id, status=@status, ended_at=@ended_at,
    conversation_json=@conversation_json, selected_node_id=@selected_node_id, updated_at=@updated_at
  WHERE id=@id
`);

sessionsRouter.post("/", (req, res) => {
  const { id, kitchenProfileId } = req.body;
  if (!id) return res.status(400).json({ error: "id is required" });
  const now = new Date().toISOString();
  const row = {
    id,
    kitchen_profile_id: kitchenProfileId ?? null,
    status: "active",
    started_at: now,
    ended_at: null,
    conversation_json: JSON.stringify(emptyConversation()),
    selected_node_id: null,
    updated_at: now,
  };
  insertSessionStmt.run(row);
  res.status(201).json(sessionRowToApi(row, [], []));
});

sessionsRouter.get("/", (req, res) => {
  const statuses = (req.query.status || "").split(",").filter(Boolean);
  const rows = statuses.length
    ? db.prepare(`SELECT * FROM sessions WHERE status IN (${statuses.map(() => "?").join(",")}) ORDER BY started_at DESC`).all(...statuses)
    : db.prepare("SELECT * FROM sessions ORDER BY started_at DESC").all();
  res.json(rows.map((row) => sessionRowToApi(row, getRecipesForSessionStmt.all(row.id), getSharedStepsForSessionStmt.all(row.id))));
});

sessionsRouter.get("/:id", (req, res) => {
  const row = getSessionStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: "session not found" });
  res.json(sessionRowToApi(row, getRecipesForSessionStmt.all(row.id), getSharedStepsForSessionStmt.all(row.id)));
});

sessionsRouter.patch("/:id", (req, res) => {
  const existing = getSessionStmt.get(req.params.id);
  if (!existing) return res.status(404).json({ error: "session not found" });

  const { kitchenProfileId, status, endedAt, conversation, selectedNodeId } = req.body;
  const row = {
    id: existing.id,
    kitchen_profile_id: kitchenProfileId !== undefined ? kitchenProfileId : existing.kitchen_profile_id,
    status: status !== undefined ? status : existing.status,
    ended_at: endedAt !== undefined ? endedAt : existing.ended_at,
    conversation_json: conversation !== undefined ? JSON.stringify(conversation) : existing.conversation_json,
    selected_node_id: selectedNodeId !== undefined ? selectedNodeId : existing.selected_node_id,
    updated_at: new Date().toISOString(),
  };
  updateSessionStmt.run(row);
  res.json(sessionRowToApi(getSessionStmt.get(existing.id), getRecipesForSessionStmt.all(existing.id), getSharedStepsForSessionStmt.all(existing.id)));
});

const insertRecipeStmt = db.prepare(`
  INSERT INTO recipe_instances (id, session_id, template_id, position, draft_json, working_json, approved_json, custom_materials_json, updated_at)
  VALUES (@id, @session_id, @template_id, @position, @draft_json, @working_json, @approved_json, @custom_materials_json, @updated_at)
`);
const getRecipeStmt = db.prepare("SELECT * FROM recipe_instances WHERE id = ? AND session_id = ?");
const updateRecipeStmt = db.prepare(`
  UPDATE recipe_instances SET working_json=@working_json, approved_json=@approved_json,
    custom_materials_json=@custom_materials_json, updated_at=@updated_at
  WHERE id=@id AND session_id=@session_id
`);

sessionsRouter.post("/:id/recipes", (req, res) => {
  const session = getSessionStmt.get(req.params.id);
  if (!session) return res.status(404).json({ error: "session not found" });

  const { id, templateId, draft, working, custom_materials } = req.body;
  if (!id || !draft || !working) return res.status(400).json({ error: "id, draft, and working are required" });

  const position = getRecipesForSessionStmt.all(session.id).length;
  const now = new Date().toISOString();
  const row = {
    id,
    session_id: session.id,
    template_id: templateId ?? null,
    position,
    draft_json: JSON.stringify(draft),
    working_json: JSON.stringify(working),
    approved_json: null,
    custom_materials_json: JSON.stringify(custom_materials || {}),
    updated_at: now,
  };
  insertRecipeStmt.run(row);
  res.status(201).json(recipeRowToApi(row));
});

sessionsRouter.patch("/:id/recipes/:recipeId", (req, res) => {
  const existing = getRecipeStmt.get(req.params.recipeId, req.params.id);
  if (!existing) return res.status(404).json({ error: "recipe instance not found" });

  const { working, approved, custom_materials } = req.body;
  const row = {
    id: existing.id,
    session_id: existing.session_id,
    working_json: working !== undefined ? JSON.stringify(working) : existing.working_json,
    approved_json: approved !== undefined ? (approved ? JSON.stringify(approved) : null) : existing.approved_json,
    custom_materials_json: custom_materials !== undefined ? JSON.stringify(custom_materials) : existing.custom_materials_json,
    updated_at: new Date().toISOString(),
  };
  updateRecipeStmt.run(row);
  res.json(recipeRowToApi(getRecipeStmt.get(existing.id, existing.session_id)));
});

const getSharedStepStmt = db.prepare("SELECT * FROM shared_steps WHERE id = ? AND session_id = ?");
const insertSharedStepStmt = db.prepare(`
  INSERT INTO shared_steps (id, session_id, draft_json, working_json, approved_json, updated_at)
  VALUES (@id, @session_id, @draft_json, @working_json, @approved_json, @updated_at)
`);
const updateSharedStepStmt = db.prepare(`
  UPDATE shared_steps SET working_json=@working_json, approved_json=@approved_json, updated_at=@updated_at
  WHERE id=@id AND session_id=@session_id
`);
const deleteSharedStepStmt = db.prepare("DELETE FROM shared_steps WHERE id = ? AND session_id = ?");

sessionsRouter.post("/:id/shared-steps", (req, res) => {
  const session = getSessionStmt.get(req.params.id);
  if (!session) return res.status(404).json({ error: "session not found" });

  const { id, draft, working } = req.body;
  if (!id || !draft || !working) return res.status(400).json({ error: "id, draft, and working are required" });

  const now = new Date().toISOString();
  const row = {
    id,
    session_id: session.id,
    draft_json: JSON.stringify(draft),
    working_json: JSON.stringify(working),
    approved_json: null,
    updated_at: now,
  };
  insertSharedStepStmt.run(row);
  res.status(201).json(sharedStepRowToApi(row));
});

sessionsRouter.patch("/:id/shared-steps/:stepId", (req, res) => {
  const existing = getSharedStepStmt.get(req.params.stepId, req.params.id);
  if (!existing) return res.status(404).json({ error: "shared step not found" });

  const { working, approved } = req.body;
  const row = {
    id: existing.id,
    session_id: existing.session_id,
    working_json: working !== undefined ? JSON.stringify(working) : existing.working_json,
    approved_json: approved !== undefined ? (approved ? JSON.stringify(approved) : null) : existing.approved_json,
    updated_at: new Date().toISOString(),
  };
  updateSharedStepStmt.run(row);
  res.json(sharedStepRowToApi(getSharedStepStmt.get(existing.id, existing.session_id)));
});

// Deleting a shared step can leave dangling depends_on references in any
// recipe instance or other shared step that pointed at it — unlike a
// plain per-recipe node delete (scoped to one recipe's own array), a
// shared step can be a dependency across recipe boundaries, so the
// scrub has to run over every recipe instance + every other shared step
// in the session, atomically.
sessionsRouter.delete("/:id/shared-steps/:stepId", (req, res) => {
  const session = getSessionStmt.get(req.params.id);
  if (!session) return res.status(404).json({ error: "session not found" });
  const existing = getSharedStepStmt.get(req.params.stepId, req.params.id);
  if (!existing) return res.status(404).json({ error: "shared step not found" });

  const scrub = db.transaction((sessionId, stepId) => {
    deleteSharedStepStmt.run(stepId, sessionId);

    getRecipesForSessionStmt.all(sessionId).forEach((r) => {
      const working = JSON.parse(r.working_json);
      const nodes = working.nodes.map((n) => ({ ...n, depends_on: (n.depends_on || []).filter((d) => d !== stepId) }));
      updateRecipeStmt.run({
        id: r.id,
        session_id: sessionId,
        working_json: JSON.stringify({ ...working, nodes }),
        approved_json: r.approved_json,
        custom_materials_json: r.custom_materials_json,
        updated_at: new Date().toISOString(),
      });
    });

    getSharedStepsForSessionStmt.all(sessionId).forEach((s) => {
      const working = JSON.parse(s.working_json);
      updateSharedStepStmt.run({
        id: s.id,
        session_id: sessionId,
        working_json: JSON.stringify({ ...working, depends_on: (working.depends_on || []).filter((d) => d !== stepId) }),
        approved_json: s.approved_json,
        updated_at: new Date().toISOString(),
      });
    });
  });

  scrub(req.params.id, req.params.stepId);
  res.status(204).end();
});
