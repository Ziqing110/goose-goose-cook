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
    cooks: JSON.parse(row.cooks_json),
    mode: row.mode,
    run: row.run_json ? JSON.parse(row.run_json) : null,
    summary: row.summary_json ? JSON.parse(row.summary_json) : null,
    // Materials the cook said they don't have. Session-level because a
    // material can feed steps in more than one of its recipes.
    unavailableMaterials: JSON.parse(row.unavailable_materials_json || "[]"),
    recipes: recipeRows.map(recipeRowToApi),
    sharedSteps: sharedStepRows.map(sharedStepRowToApi),
  };
}

// Home's run log needs a title, a kitchen, a duration and a status —
// not a whole session. Returning full rows there meant every past cook's
// base64 photo and run transcript was downloaded just to render a list
// of titles, so `?view=list` projects instead. json_extract does the
// digging inside SQLite, so the big JSON columns never cross the wire.
// The shape deliberately matches the compact row the client appends
// locally when a run ends (see sessionSummary in AppStateContext).
function listSessionsStmt(statuses) {
  return db.prepare(`
    SELECT id, kitchen_profile_id, status, started_at, ended_at,
           json_extract(conversation_json, '$.answers.dishIdea') AS dish_idea,
           json_extract(conversation_json, '$.answers.servings') AS answer_servings,
           json_extract(summary_json, '$.dish') AS summary_dish,
           summary_json IS NOT NULL AS has_summary
    FROM sessions
    ${statuses.length ? `WHERE status IN (${statuses.map(() => "?").join(",")})` : ""}
    ORDER BY started_at DESC
  `);
}

const listRecipeTitlesStmt = db.prepare(`
  SELECT json_extract(working_json, '$.title') AS title,
         json_extract(working_json, '$.servings') AS servings
  FROM recipe_instances WHERE session_id = ? ORDER BY position ASC
`);

function sessionRowToListApi(row) {
  const recipeRows = listRecipeTitlesStmt.all(row.id);
  const fromRecipes = recipeRows.map((r) => r.title).filter(Boolean).join(" + ");
  return {
    id: row.id,
    kitchenProfileId: row.kitchen_profile_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    dish: row.summary_dish || fromRecipes || row.dish_idea || null,
    servings: recipeRows[0]?.servings ?? (Number(row.answer_servings) || null),
    // Abandoned runs never froze a summary, so there's no card to open.
    hasSummary: Boolean(row.has_summary),
  };
}

const getSessionStmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
const getRecipesForSessionStmt = db.prepare("SELECT * FROM recipe_instances WHERE session_id = ? ORDER BY position ASC");
const getSharedStepsForSessionStmt = db.prepare("SELECT * FROM shared_steps WHERE session_id = ? ORDER BY id ASC");
const insertSessionStmt = db.prepare(`
  INSERT INTO sessions (id, kitchen_profile_id, status, started_at, ended_at, conversation_json, selected_node_id, cooks_json, mode, run_json, summary_json, unavailable_materials_json, updated_at)
  VALUES (@id, @kitchen_profile_id, @status, @started_at, @ended_at, @conversation_json, @selected_node_id, @cooks_json, @mode, @run_json, @summary_json, @unavailable_materials_json, @updated_at)
`);
const updateSessionStmt = db.prepare(`
  UPDATE sessions SET kitchen_profile_id=@kitchen_profile_id, status=@status, ended_at=@ended_at,
    conversation_json=@conversation_json, selected_node_id=@selected_node_id, cooks_json=@cooks_json,
    mode=@mode, run_json=@run_json, summary_json=@summary_json,
    unavailable_materials_json=@unavailable_materials_json, updated_at=@updated_at
  WHERE id=@id
`);

// The client resumes `activeSessions[0]` and silently drops the rest, so
// a second active row is unreachable forever: it never resumes and never
// reaches history. Starting a run therefore closes out any other active
// session, making "at most one active" an invariant the API guarantees
// rather than something the UI merely avoids tripping.
const abandonOtherActiveStmt = db.prepare(
  "UPDATE sessions SET status='abandoned', ended_at=@now, updated_at=@now WHERE status='active' AND id != @id"
);

sessionsRouter.post("/", (req, res) => {
  const { id, kitchenProfileId } = req.body;
  if (!id) return res.status(400).json({ error: "id is required" });
  const now = new Date().toISOString();
  abandonOtherActiveStmt.run({ id, now });
  const row = {
    id,
    kitchen_profile_id: kitchenProfileId ?? null,
    status: "active",
    started_at: now,
    ended_at: null,
    conversation_json: JSON.stringify(emptyConversation()),
    selected_node_id: null,
    cooks_json: JSON.stringify([]),
    mode: null,
    run_json: null,
    summary_json: null,
    unavailable_materials_json: "[]",
    updated_at: now,
  };
  insertSessionStmt.run(row);
  res.status(201).json(sessionRowToApi(row, [], []));
});

sessionsRouter.get("/", (req, res) => {
  const statuses = (req.query.status || "").split(",").filter(Boolean);
  if (req.query.view === "list") {
    return res.json(listSessionsStmt(statuses).all(...statuses).map(sessionRowToListApi));
  }
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

  const { kitchenProfileId, status, endedAt, conversation, selectedNodeId, cooks, mode, run, summary, unavailableMaterials } =
    req.body;
  const row = {
    id: existing.id,
    kitchen_profile_id: kitchenProfileId !== undefined ? kitchenProfileId : existing.kitchen_profile_id,
    status: status !== undefined ? status : existing.status,
    ended_at: endedAt !== undefined ? endedAt : existing.ended_at,
    conversation_json: conversation !== undefined ? JSON.stringify(conversation) : existing.conversation_json,
    selected_node_id: selectedNodeId !== undefined ? selectedNodeId : existing.selected_node_id,
    cooks_json: cooks !== undefined ? JSON.stringify(cooks) : existing.cooks_json,
    mode: mode !== undefined ? mode : existing.mode,
    run_json: run !== undefined ? (run ? JSON.stringify(run) : null) : existing.run_json,
    summary_json: summary !== undefined ? (summary ? JSON.stringify(summary) : null) : existing.summary_json,
    unavailable_materials_json:
      unavailableMaterials !== undefined ? JSON.stringify(unavailableMaterials) : existing.unavailable_materials_json,
    updated_at: new Date().toISOString(),
  };
  updateSessionStmt.run(row);
  res.json(sessionRowToApi(getSessionStmt.get(existing.id), getRecipesForSessionStmt.all(existing.id), getSharedStepsForSessionStmt.all(existing.id)));
});

// Without this a run could never leave the log — every test cook and
// misfire stayed on Home permanently. There are no FK cascades on these
// tables, so the children go first, in one transaction.
const deleteRecipesForSessionStmt = db.prepare("DELETE FROM recipe_instances WHERE session_id = ?");
const deleteSharedStepsForSessionStmt = db.prepare("DELETE FROM shared_steps WHERE session_id = ?");
const deleteSessionStmt = db.prepare("DELETE FROM sessions WHERE id = ?");
const deleteSessionCascade = db.transaction((id) => {
  deleteSharedStepsForSessionStmt.run(id);
  deleteRecipesForSessionStmt.run(id);
  deleteSessionStmt.run(id);
});

sessionsRouter.delete("/:id", (req, res) => {
  const existing = getSessionStmt.get(req.params.id);
  if (!existing) return res.status(404).json({ error: "session not found" });
  deleteSessionCascade(existing.id);
  res.status(204).end();
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
// recipe instance or other shared step that pointed at it â€” unlike a
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
