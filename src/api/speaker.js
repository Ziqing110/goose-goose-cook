// Client for the local speaker-identification sidecar
// (speaker-sidecar/server.py, `npm run speaker`).
//
// It runs on this machine and voiceprints never leave it: audio goes in,
// an embedding comes out, and only embeddings are kept. Every call here can
// fail because the sidecar isn't running, and every caller must treat that
// as "carry on without it", never as an error the cook has to deal with.
//
// Proxied through Vite at /speaker (see vite.config.js).
const BASE = "/speaker";
const TIMEOUT_MS = 2500;

const bytes = (pcm) => new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);

async function call(path, options) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS), ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Speaker service ${res.status}`);
  return body;
}

const post = (path, pcm) =>
  call(path, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes(pcm) });

/** @returns {Promise<{cook, score, margin, scores, seconds}>} raw scores; decide with decideSpeaker */
export const identifySpeaker = ({ pcm, rate, candidates }) =>
  post(`/identify?rate=${rate}&candidates=${encodeURIComponent(candidates.join(","))}`, pcm);

/** Add a voice sample for one cook. */
export const enrollVoice = ({ cookId, pcm, rate }) =>
  post(`/enroll?cook=${encodeURIComponent(cookId)}&rate=${rate}`, pcm);

/** Forget one cook's voice, or everyone's when no id is given. */
export const clearVoice = (cookId) =>
  call(`/voiceprints${cookId ? `?cook=${encodeURIComponent(cookId)}` : ""}`, { method: "DELETE" });

export const speakerHealth = () => call("/health");
