import express from "express";
import cors from "cors";
import { kitchensRouter } from "./routes/kitchens.js";
import { recipeTemplatesRouter, materialsRouter } from "./routes/recipeTemplates.js";
import { sessionsRouter } from "./routes/sessions.js";
import { photoRouter } from "./routes/photo.js";
import { voiceRouter } from "./routes/voice.js";
import { understandingRouter } from "./routes/understanding.js";
import { recipesRouter } from "./routes/recipes.js";
import { agentRouter } from "./routes/agent.js";

const app = express();
const PORT = process.env.PORT || 3001;

// In dev the browser talks to Vite's proxy, same origin, so CORS never
// comes up and an empty list means "allow everything". In the Pages build
// the page is on github.io and this API is elsewhere, so the origin has to
// be named: scheme and host only — a path like /goose-goose-cook is not
// part of an origin and would make the header never match.
//
// This is a speed bump, not a gate: Origin is trivially forged outside a
// browser. What actually bounds the bill is the session cap in
// routes/voice.js.
const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
app.use(cors(allowed.length ? { origin: allowed } : {}));
// Summary photos travel as base64 data URLs, which blow past the default
// 100kb body limit.
app.use(express.json({ limit: "12mb" }));

// Cheap liveness check. Render polls this to decide the service is up,
// and it is what to point a warm-up ping at before a demo — it touches
// no model and costs nothing, unlike every other route here.
app.get("/api/health", (req, res) => res.json({ ok: true, key: Boolean(process.env.ASSEMBLYAI_API_KEY) }));

app.use("/api/kitchens", kitchensRouter);
app.use("/api/recipe-templates", recipeTemplatesRouter);
app.use("/api/materials", materialsRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/photo", photoRouter);
app.use("/api/voice", voiceRouter);
app.use("/api/understanding", understandingRouter);
app.use("/api/recipes", recipesRouter);
app.use("/api/agent", agentRouter);

app.listen(PORT, () => {
  console.log(`Kitchen Path API listening on http://localhost:${PORT}`);
});
