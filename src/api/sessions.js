// Thin client around the sessions API (server/routes/sessions.js).
// Sessions own an ordered list of recipe instances server-side — see
// AppStateContext.jsx for how the client mirrors that shape.
import { apiRequest } from "./client.js";

const BASE = "/api/sessions";
const request = (path, options) => apiRequest(BASE, path, options);

export function createSession(session) {
  return request("", { method: "POST", body: JSON.stringify(session) });
}

export function getSession(id) {
  return request(`/${id}`, { method: "GET" });
}

export function listSessions(statuses) {
  const query = statuses?.length ? `?status=${statuses.join(",")}` : "";
  return request(query, { method: "GET" });
}

// Compact rows for Home's run log — no recipes, run transcript or
// base64 photo. Use this for anything that only lists sessions;
// listSessions() is for when the whole session is actually needed.
export function listSessionSummaries(statuses) {
  const status = statuses?.length ? `&status=${statuses.join(",")}` : "";
  return request(`?view=list${status}`, { method: "GET" });
}

export function deleteSession(id) {
  return request(`/${id}`, { method: "DELETE" });
}

// `keepalive` lets the request outlive the page (used to flush a
// pending sync on unload); browsers cap keepalive bodies at ~64KB, so
// it's only for the small top-level session patch.
export function updateSession(id, patch, { keepalive = false } = {}) {
  return request(`/${id}`, { method: "PATCH", body: JSON.stringify(patch), keepalive });
}

export function createRecipeInstance(sessionId, recipe) {
  return request(`/${sessionId}/recipes`, { method: "POST", body: JSON.stringify(recipe) });
}

export function updateRecipeInstance(sessionId, recipeId, patch) {
  return request(`/${sessionId}/recipes/${recipeId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function createSharedStep(sessionId, sharedStep) {
  return request(`/${sessionId}/shared-steps`, { method: "POST", body: JSON.stringify(sharedStep) });
}

export function updateSharedStep(sessionId, stepId, patch) {
  return request(`/${sessionId}/shared-steps/${stepId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteSharedStep(sessionId, stepId) {
  return request(`/${sessionId}/shared-steps/${stepId}`, { method: "DELETE" });
}
