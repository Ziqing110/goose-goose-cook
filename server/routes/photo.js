import { Router } from "express";

export const photoRouter = Router();

/**
 * THE IMAGE-MODEL SEAM.
 *
 * This is where a real image model call goes. It lives on the server so
 * an API key never reaches the browser, and it's the *only* place that
 * has to change to make styling real — the client calls this route
 * either way and doesn't care which branch ran.
 *
 * To wire a provider:
 *   1. put the key in server-side env (e.g. process.env.IMAGE_API_KEY)
 *   2. POST `dataUrl` + `prompt` to the provider's image-edit endpoint
 *   3. return { dataUrl: <generated image>, source: "model" }
 *
 * Until then it hands the original back with source "stub", and the
 * client applies a local canvas treatment so there's still something to
 * look at — labelled as a local effect rather than passed off as
 * generated.
 */
async function stylePhoto(dataUrl /*, prompt */) {
  return { dataUrl, source: "stub" };
}

photoRouter.post("/style", async (req, res) => {
  const { dataUrl, prompt } = req.body || {};
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return res.status(400).json({ error: "dataUrl must be an image data URL" });
  }
  try {
    res.json(await stylePhoto(dataUrl, prompt));
  } catch (err) {
    console.error("Photo styling failed:", err);
    res.status(502).json({ error: "Could not style that photo" });
  }
});
