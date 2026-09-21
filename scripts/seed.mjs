// Seed a ready-to-look-at session and leave it in place:  npm run seed
// Needs the app running (npm run dev:full). Prints where to go.
// It abandons any run in progress (see seed-session.mjs).
import { seedSession } from "./seed-session.mjs";

const BASE = process.env.BASE || "http://localhost:5173";
const { sessionId } = await seedSession(BASE);
console.log(`Seeded session ${sessionId} (Mapo Tofu + Chicken Noodle Soup, cooks Mia and Leo, all bound).`);
console.log("");
console.log("Open any of these:");
for (const [name, path] of [
  ["Recipe board          ", "/session/inventory"],
  ["Recipe loading screen ", "/session/inventory?preview=loading"],
  ["Chef binding page     ", "/session/voice-binding"],
  ["Schedule              ", "/session/schedule"],
  ["Schedule loading      ", "/session/schedule?preview=loading"],
]) console.log(`  ${name} ${BASE}${path}`);
console.log("");
console.log("Straight into a live cook, no clicking (dev server only):");
for (const [name, path] of [
  ["Co-op                 ", "/session/schedule?go=coop"],
  ["Versus                ", "/session/schedule?go=versus"],
]) console.log(`  ${name} ${BASE}${path}`);
console.log("");
console.log("Re-run this to start over; it abandons whatever run is in progress.");
console.log("Or skip this script: /jump/schedule, /jump/coop and /jump/versus seed and jump in one URL.");
