// Mints short-lived Streaming STT tokens for the browser, so the API key
// never leaves the server. Authorization is the RAW key: "Bearer" is the
// Voice Agent API's scheme, not this product's (see CLAUDE.md).
import { Router } from "express";
import { API_KEY, MISSING_KEY_MESSAGE } from "../llm.js";

export const voiceRouter = Router();

const TOKEN_URL = "https://streaming.assemblyai.com/v3/token";

/** Clamp to the ranges the API documents, so a typo fails here not there. */
const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.min(max, Math.max(min, n))) : String(fallback);
};

voiceRouter.get("/stt-token", async (req, res) => {
  // A fresh clone with no .env should say so, not surface as a 401.
  if (!API_KEY) return res.status(503).json({ error: MISSING_KEY_MESSAGE });
  const params = new URLSearchParams({
    // Short: the token only has to survive the hop from this fetch to
    // the WebSocket opening.
    expires_in_seconds: clamp(req.query.expires_in_seconds, 1, 600, 60),
    // Streaming bills on how long the socket stays OPEN, idle or not, and
    // a tab that closes without sending Terminate keeps billing until the
    // session times out. At the 3h ceiling that abandoned tab is $1.35 of
    // universal-3-5-pro; 90 min halves it.
    //
    // Not lower: hitting the cap drops the socket mid-cook and the mic
    // has to reconnect. The socket only lives while unmuted (VoiceBar's
    // toggle), so this budget is unmuted time, not cook time.
    max_session_duration_seconds: clamp(
      req.query.max_session_duration_seconds,
      60,
      10800,
      Number(process.env.AAI_MAX_SESSION_SECONDS) || 5400,
    ),
  });

  try {
    const upstream = await fetch(`${TOKEN_URL}?${params}`, { headers: { Authorization: API_KEY } });
    const body = await upstream.json().catch(() => ({}));
    // Pass AssemblyAI's own message through: a 401 here means a bad key.
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: body.error || `Token request failed (${upstream.status})` });
    }
    // A token is single-use and short-lived; a cached one is just a
    // confusing failure a few seconds later.
    res.set("Cache-Control", "no-store");
    return res.json(body);
  } catch (err) {
    return res.status(502).json({ error: `Could not reach AssemblyAI: ${err.message}` });
  }
});
