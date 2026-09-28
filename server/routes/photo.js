import { Router } from "express";

export const photoRouter = Router();

// Free serverless inference, no billing risk: HUGGINGFACE_API_TOKEN is
// optional, and with none set this behaves exactly as it always has --
// hands the original back with source "stub", and the client applies its
// own local pixel-art treatment (see utils/summaryCard.js) so there's
// still something fun to look at either way.
const HF_TOKEN = process.env.HUGGINGFACE_API_TOKEN;
// A community model whose repo defines a custom pipeline that returns
// the cutout image directly, rather than a segmentation mask for
// somebody else's code to apply -- see huggingface.co/briaai/RMBG-1.4.
const HF_MODEL = process.env.HF_BACKGROUND_MODEL || "briaai/RMBG-1.4";
const HF_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}`;
// Generous: a community model that nobody has called in a while "cold
// starts" on the free tier, and a cook waiting on their finished card's
// photo can afford a few extra seconds far more than a live turn can.
const TIMEOUT_MS = 20_000;

function dataUrlToBuffer(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error("Not a base64 image data URL");
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

/**
 * THE IMAGE-MODEL SEAM.
 *
 * Cuts the background out of a dish photo via Hugging Face's free
 * serverless Inference API. Returns { dataUrl, source }; the client only
 * ever looks at `source` to know whether a local treatment is needed on
 * top -- it always pixelates regardless, so this only has to try.
 */
async function stylePhoto(dataUrl) {
  if (!HF_TOKEN) return { dataUrl, source: "stub" };

  const { mime, buffer } = dataUrlToBuffer(dataUrl);
  let upstream;
  try {
    upstream = await fetch(HF_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${HF_TOKEN}`, "content-type": mime },
      body: buffer,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === "TimeoutError") throw new Error(`Hugging Face took longer than ${TIMEOUT_MS}ms — likely a cold start. Try again in a moment.`);
    throw new Error(`Could not reach Hugging Face: ${err.message}`);
  }

  const contentType = upstream.headers.get("content-type") || "";
  if (!upstream.ok) {
    // A model spinning up on the free tier answers 503 with
    // { error, estimated_time } instead of the image -- worth surfacing
    // plainly, since "try again shortly" is the actual fix, not a bug.
    const body = contentType.includes("application/json") ? await upstream.json().catch(() => ({})) : {};
    const wait = body.estimated_time ? ` (loading, ~${Math.ceil(body.estimated_time)}s — try again shortly)` : "";
    throw new Error(body.error ? `${body.error}${wait}` : `Hugging Face ${upstream.status}${wait}`);
  }

  if (contentType.startsWith("image/")) {
    const out = Buffer.from(await upstream.arrayBuffer());
    return { dataUrl: `data:${contentType};base64,${out.toString("base64")}`, source: "model" };
  }
  // Some pipelines answer 200 with JSON (a base64 field) rather than raw
  // image bytes even on success -- read for that before giving up.
  const body = await upstream.json().catch(() => null);
  const b64 = body?.[0]?.blob ?? body?.image ?? null;
  if (!b64) throw new Error("Hugging Face returned an unexpected response.");
  return { dataUrl: `data:image/png;base64,${b64}`, source: "model" };
}

photoRouter.post("/style", async (req, res) => {
  const { dataUrl } = req.body || {};
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return res.status(400).json({ error: "dataUrl must be an image data URL" });
  }
  try {
    res.json(await stylePhoto(dataUrl));
  } catch (err) {
    console.error("Photo styling failed:", err);
    res.status(502).json({ error: "Could not style that photo" });
  }
});
