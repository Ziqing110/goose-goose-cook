// Thin client over the photo-styling seam (server/routes/photo.js).
// The response's `source` says whether a real model ran ("model") or the
// stub echoed the original back ("stub"), which is what tells the caller
// to fall back to a local canvas treatment.
import { apiRequest } from "./client.js";

export function stylePhoto(dataUrl, prompt) {
  return apiRequest("/api/photo", "/style", { method: "POST", body: JSON.stringify({ dataUrl, prompt }) });
}
