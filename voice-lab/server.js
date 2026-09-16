// Standalone token-minting + static server for the voice lab.
//
// Deliberately NOT part of server/index.js: the lab is a throwaway
// instrument for learning what the API does, and it should stay
// runnable (and deletable) without touching the app. Zero dependencies
// — node:http only — so it can't drift with the app's deps either.
//
// The API key lives here and never reaches the browser. The page asks
// this server for a short-lived streaming token instead.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.LAB_PORT || 3100);
const API_KEY = process.env.ASSEMBLYAI_API_KEY || "";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJSON(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": TYPES[".json"], "Cache-Control": "no-store" });
  res.end(text);
}

/**
 * Mint a temporary streaming token.
 * GET https://streaming.assemblyai.com/v3/token
 *   ?expires_in_seconds=1..600 &max_session_duration_seconds=60..10800
 * Authorization header takes the raw key — no "Bearer" prefix.
 */
async function mintToken(res, url) {
  if (!API_KEY) {
    return sendJSON(res, 503, {
      error:
        "ASSEMBLYAI_API_KEY is not set. Put it in .env at the repo root, then rerun `npm run lab`.",
    });
  }

  const params = new URLSearchParams({
    expires_in_seconds: url.searchParams.get("expires_in_seconds") || "60",
    max_session_duration_seconds:
      url.searchParams.get("max_session_duration_seconds") || "600",
  });

  try {
    const upstream = await fetch(
      `https://streaming.assemblyai.com/v3/token?${params}`,
      { headers: { Authorization: API_KEY } },
    );
    const body = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      // Surface AssemblyAI's own message — a 401 here means a bad key,
      // and guessing at that from a generic 500 wastes real time.
      return sendJSON(res, upstream.status, {
        error: body.error || `Token request failed (${upstream.status})`,
      });
    }
    return sendJSON(res, 200, body);
  } catch (err) {
    return sendJSON(res, 502, { error: `Could not reach AssemblyAI: ${err.message}` });
  }
}

async function serveStatic(res, pathname) {
  // normalize() + the ROOT prefix check keeps "../../.env" from being
  // served. This binds to localhost only, but a static server that can
  // read the whole disk is a bad habit regardless.
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/api/token") return mintToken(res, url);
  return serveStatic(res, url.pathname);
}).listen(PORT, () => {
  console.log(`\n  Voice lab → http://localhost:${PORT}`);
  console.log(
    API_KEY
      ? `  API key loaded (${API_KEY.length} chars)\n`
      : `  ⚠ No ASSEMBLYAI_API_KEY found — add it to .env at the repo root\n`,
  );
});
