// Client for the local speaker-identification sidecar
// (speaker-sidecar/server.py, `npm run speaker`).
//
// It runs on this machine and voiceprints never leave it: audio goes in,
// an embedding comes out, and only embeddings are kept. Every call here can
// fail because the sidecar isn't running, and every caller must treat that
// as "carry on without it", never as an error the cook has to deal with.
//
// Proxied through Vite at /speaker (see vite.config.js).
//
// Off unless VITE_SPEAKER_SERVICE=on (in .env), and never on in the
// deployed demo: the sidecar does not ship. Off, nothing is fetched and
// every call rejects at once, so callers take the same fallback they
// would for a sidecar that is down -- the diarization label bound on the
// voice-binding page, then the speaker toggle.
export const SPEAKER_SERVICE = import.meta.env.VITE_SPEAKER_SERVICE === "on";
const BASE = "/speaker";
const TIMEOUT_MS = 2500;

const bytes = (pcm) => new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);

async function call(path, options) {
  if (!SPEAKER_SERVICE) throw new Error("Speaker service disabled");
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

/**
 * Add a turn the app is sure about to a cook's voiceprint (see
 * shouldLearn). Fails quietly on an older sidecar without /learn, as
 * every call here may.
 */
export const learnVoice = ({ cookId, pcm, rate }) =>
  post(`/learn?cook=${encodeURIComponent(cookId)}&rate=${rate}`, pcm);

/** Forget one cook's voice, or everyone's when no id is given. */
export const clearVoice = (cookId) =>
  call(`/voiceprints${cookId ? `?cook=${encodeURIComponent(cookId)}` : ""}`, { method: "DELETE" });

export const speakerHealth = () => call("/health");
