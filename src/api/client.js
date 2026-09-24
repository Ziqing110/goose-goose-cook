// Shared fetch wrapper for every /api/* client.
//
// In dev this stays empty, so paths are relative and go through Vite's
// proxy (see vite.config.js) with no CORS involved. In the Pages build
// there is no proxy and no API on that origin, so VITE_API_BASE points at
// the deployed API — scheme and host with NO trailing slash, e.g.
// https://goose-goose-cook.onrender.com.
export const API_ORIGIN = import.meta.env.VITE_API_BASE || "";

// DEMO ONLY. Identifies this browser to the API so one shared deployment
// can host several visitors without them tripping over each other.
//
// It is not a credential and proves nothing — it is generated here, in
// the client, and simply asserted in a header. It stops accidental
// collisions, not a determined person. Real accounts would replace it
// entirely.
//
// Deliberately sessionStorage, not localStorage: a hackathon demo run in
// a fresh tab should start clean rather than resume whatever the last
// person at that laptop was cooking.
const CLIENT_KEY = "kitchen-path.client-id";

function clientId() {
  try {
    const found = sessionStorage.getItem(CLIENT_KEY);
    if (found) return found;
    const made = crypto.randomUUID();
    sessionStorage.setItem(CLIENT_KEY, made);
    return made;
  } catch {
    // Private mode, blocked storage, or no crypto: a per-page-load id is
    // still better than everyone sharing one bucket.
    return "ephemeral";
  }
}

export function apiRequest(base, path, options) {
  return fetch(`${API_ORIGIN}${base}${path}`, {
    headers: { "Content-Type": "application/json", "X-Kitchen-Client": clientId() },
    ...options,
  }).then(async (res) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    if (res.status === 204) return null;
    return res.json();
  });
}
