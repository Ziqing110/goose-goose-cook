// Mints short-lived AssemblyAI tokens for the browser.
//
// The API key stays on this side. The browser never sees it — it asks
// for a token, redeems it on the WebSocket, and that's the whole reason
// these endpoints exist.
//
// TWO endpoints, because the two AssemblyAI products we use differ in
// both URL and auth scheme. This is the trap their own agent
// instructions call out, so it is encoded once here rather than
// remembered at each call site:
//
//   Streaming STT (live cook)   raw key, no prefix
//   Voice Agent  (conversation) Bearer <key>
//
// Generalising either rule to the other product fails with an opaque
// 401. See CLAUDE.md for the full table of differences.
import { Router } from "express";

export const voiceRouter = Router();

const API_KEY = process.env.ASSEMBLYAI_API_KEY || "";

/** Clamp to the ranges the API documents, so a typo fails here not there. */
const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.min(max, Math.max(min, n))) : String(fallback);
};

function requireKey(res) {
  if (API_KEY) return true;
  // A fresh clone with no .env should say so, rather than surfacing as a
  // mysterious 401 from AssemblyAI.
  res.status(503).json({
    error:
      "ASSEMBLYAI_API_KEY is not set. Copy .env.example to .env, add the key, " +
      "and restart the server (npm run server).",
  });
  return false;
}

async function mint(res, url, authHeader) {
  try {
    const upstream = await fetch(url, { headers: { Authorization: authHeader } });
    const body = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      // Pass AssemblyAI's own message through — a 401 here means a bad
      // key, and guessing at that from a generic 500 wastes real time.
      return res.status(upstream.status).json({
        error: body.error || `Token request failed (${upstream.status})`,
      });
    }
    // no-store: a token is single-use and short-lived; a cached one is
    // just a confusing failure a few seconds later.
    res.set("Cache-Control", "no-store");
    return res.json(body);
  } catch (err) {
    return res.status(502).json({ error: `Could not reach AssemblyAI: ${err.message}` });
  }
}

/**
 * Streaming STT — used by the live cook and by voice navigation.
 * Authorization is the RAW key. Adding "Bearer" here fails.
 */
voiceRouter.get("/stt-token", async (req, res) => {
  if (!requireKey(res)) return;
  const params = new URLSearchParams({
    // Short: the token only has to survive the hop from this fetch to
    // the WebSocket opening.
    expires_in_seconds: clamp(req.query.expires_in_seconds, 1, 600, 60),
    // Streaming bills on how long the socket stays OPEN, idle or not, and
    // a tab that closes without sending Terminate keeps billing until the
    // session times out. At the 3h ceiling that abandoned tab is $1.35 of
    // universal-3-5-pro; 90 min halves it.
    //
    // Not lower, even though it would be cheaper: hitting this cap is a
    // BAD failure. There is no reconnect — ws.onclose just tears down the
    // audio and goes idle, so the mic dies mid-cook and the only way back
    // is toggling mute off and on, with nothing on screen saying why.
    // 90 min is the long cook this project designs for.
    //
    // In practice there is slack: the socket only lives while unmuted
    // (VoiceBar's toggle), so this budget is unmuted time, not cook time.
    max_session_duration_seconds: clamp(
      req.query.max_session_duration_seconds,
      60,
      10800,
      Number(process.env.AAI_MAX_SESSION_SECONDS) || 5400,
    ),
  });
  await mint(res, `https://streaming.assemblyai.com/v3/token?${params}`, API_KEY);
});

/**
 * Voice Agent — used by the conversation stage.
 * Authorization is "Bearer <key>". This is the exception in AssemblyAI's
 * API surface, not the rule.
 *
 * Agent tokens are single-use per session: mint a fresh one on every
 * reconnect, including session.resume. Don't cache them client-side.
 */
voiceRouter.get("/agent-token", async (req, res) => {
  if (!requireKey(res)) return;
  const params = new URLSearchParams({
    expires_in_seconds: clamp(req.query.expires_in_seconds, 1, 600, 300),
    max_session_duration_seconds: clamp(
      req.query.max_session_duration_seconds,
      60,
      10800,
      8640,
    ),
  });
  await mint(res, `https://agents.assemblyai.com/v1/token?${params}`, `Bearer ${API_KEY}`);
});
