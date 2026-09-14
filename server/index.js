import express from "express";
import cors from "cors";
import { kitchensRouter } from "./routes/kitchens.js";
import { recipeTemplatesRouter, materialsRouter } from "./routes/recipeTemplates.js";
import { sessionsRouter } from "./routes/sessions.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use("/api/kitchens", kitchensRouter);
app.use("/api/recipe-templates", recipeTemplatesRouter);
app.use("/api/materials", materialsRouter);
app.use("/api/sessions", sessionsRouter);

app.listen(PORT, () => {
  console.log(`Kitchen Path API listening on http://localhost:${PORT}`);
});
