import express from "express";
import cors from "cors";
import { kitchensRouter } from "./routes/kitchens.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use("/api/kitchens", kitchensRouter);

app.listen(PORT, () => {
  console.log(`Kitchen Path API listening on http://localhost:${PORT}`);
});
