// Shared fetch wrapper for every /api/* client. Proxied through Vite's
// dev server (see vite.config.js) so relative paths work without CORS
// setup.
export function apiRequest(base, path, options) {
  return fetch(`${base}${path}`, {
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
