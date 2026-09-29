// DEMO ONLY. Which browser is asking, as asserted by the client in a
// header (see the client_id note in db.js). It keeps honest visitors to
// one shared deployment apart and nothing more: never authorise on it.
export const clientOf = (req) => req.get("X-Kitchen-Client") || "";
