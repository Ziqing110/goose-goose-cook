// Voice commands for choosing a kitchen by name. Shared by Home's picker
// and the session's "pick another kitchen" page.
import { normalizeUtterance } from "./navCommands.js";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One command per kitchen on offer, matching what its button says.
 *
 * Kitchens are named by people, so the full name is the primary match —
 * "flat 3 galley" has to work as three words, not just its first. But
 * nobody says the whole name every time, so a single distinctive word
 * counts too, as long as it belongs to exactly one kitchen on the list.
 * Ambiguity is dropped rather than guessed: picking the wrong kitchen
 * starts a whole run against the wrong equipment.
 */
export function kitchenPickCommands(profiles, start, label = (p) => `Starting in ${p.name}.`) {
  const norm = (s) => normalizeUtterance(s);

  // Words that identify exactly one kitchen. Anything shared between two
  // ("kitchen", "flat") identifies neither.
  const counts = new Map();
  profiles.forEach((p) => {
    new Set(norm(p.name).split(" ").filter((w) => w.length > 3)).forEach((w) => {
      counts.set(w, (counts.get(w) || 0) + 1);
    });
  });

  return profiles.map((p) => {
    const full = norm(p.name);
    const phrases = [new RegExp(`\\b${escapeRe(full)}\\b`)];
    norm(p.name)
      .split(" ")
      .filter((w) => w.length > 3 && counts.get(w) === 1)
      .forEach((w) => phrases.push(new RegExp(`\\b${escapeRe(w)}\\b`)));
    return {
      phrases,
      label: label(p),
      run: () => start(p.id),
    };
  });
}
