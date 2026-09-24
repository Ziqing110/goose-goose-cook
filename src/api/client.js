// Shared fetch wrapper for every /api/* client.
//
// In dev this stays empty, so paths are relative and go through Vite's
// proxy (see vite.config.js) with no CORS involved. In the Pages build
// there is no proxy and no API on that origin, so VITE_API_BASE points at
// the deployed API — scheme and host with NO trailing slash, e.g.
// https://goose-goose-cook.onrender.com.
export const API_ORIGIN = import.meta.env.VITE_API_BASE || "";

export function apiRequest(base, path, options) {
  return fetch(`${API_ORIGIN}${base}${path}`, {
    headers: { "Content-Type": "application/json" },
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
