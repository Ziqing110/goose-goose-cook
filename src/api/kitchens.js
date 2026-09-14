// Thin client around the kitchens API (server/routes/kitchens.js).
import { apiRequest } from "./client.js";

const BASE = "/api/kitchens";
const request = (path, options) => apiRequest(BASE, path, options);

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
