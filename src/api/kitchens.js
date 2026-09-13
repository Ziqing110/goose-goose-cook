// Thin fetch wrapper around the kitchens API (server/routes/kitchens.js).
// Proxied through Vite's dev server (see vite.config.js) so relative
// /api paths work without CORS setup.
const BASE = "/api/kitchens";

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export function listKitchens() {
  return request("", { method: "GET" });
}

export function createKitchen(profile) {
  return request("", { method: "POST", body: JSON.stringify(profile) });
}

export function updateKitchen(id, patch) {
  return request(`/${id}`, { method: "PUT", body: JSON.stringify(patch) });
}

export function deleteKitchen(id) {
  return request(`/${id}`, { method: "DELETE" });
}
