import express from "express";
import cors from "cors";
import { kitchensRouter } from "./routes/kitchens.js";
import { recipeTemplatesRouter, materialsRouter } from "./routes/recipeTemplates.js";
import { sessionsRouter } from "./routes/sessions.js";
import { photoRouter } from "./routes/photo.js";
import { voiceRouter } from "./routes/voice.js";
import { understandingRouter } from "./routes/understanding.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
// Summary photos travel as base64 data URLs, which blow past the default
// 100kb body limit.
app.use(express.json({ limit: "12mb" }));

app.use("/api/kitchens", kitchensRouter);
app.use("/api/recipe-templates", recipeTemplatesRouter);
app.use("/api/materials", materialsRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/photo", photoRouter);
app.use("/api/voice", voiceRouter);
app.use("/api/understanding", understandingRouter);

app.listen(PORT, () => {
  console.log(`Kitchen Path API listening on http://localhost:${PORT}`);
});
