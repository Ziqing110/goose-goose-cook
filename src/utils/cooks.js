// Cook-domain helpers shared by the voice-binding page, the schedule
// page, and App.jsx's route guards.

export const COOK_COLOR_KEYS = ["mia", "leo", "sage"];

// Color is derived from array index, never stored — consistent with
// this codebase's "compute, don't store" convention for other derived
// display values (see graphLayout.js). A 4th+ cook cycles back through
// the same 3 tokens; adding a 4th token is a small future follow-up.
export function cookColorKey(index) {
  return COOK_COLOR_KEYS[index % COOK_COLOR_KEYS.length];
}

// Long enough for a real name, short enough not to wreck the schedule
// lane labels or the leaderboard.
export const MAX_COOK_NAME_LENGTH = 24;

// Two cooks called "Mia" make every name-addressed voice command
// ambiguous and give the scoreboard two identical panels, so names have
// to be distinct. Compared trimmed and case-insensitively, because
// "mia" and "Mia " are the same person to everyone but a string.
export function duplicateCookNames(cooks) {
  const counts = new Map();
  cooks.forEach((c) => {
    const key = c.name.trim().toLowerCase();
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });
  return new Set([...counts].filter(([, n]) => n > 1).map(([key]) => key));
}

export function areCooksBound(cooks) {
  return cooks.length > 0 && cooks.every((c) => c.name.trim() && c.bound) && duplicateCookNames(cooks).size === 0;
}

// Each cook reads a fixed line rather than saying anything they like:
// a known script gives voice recognition the same words to compare
// against across cooks, and the lines are deliberately different from
// each other (and phonetically varied) so two voices reading them are
// easier to tell apart than two people ad-libbing "hello".
const VOICE_PHRASES = [
  "I'm {name}, and I solemnly swear I will not burn the garlic tonight.",
  "I'm {name}, and yes, I already ate half the ingredients.",
  "I'm {name}, and the smoke alarm is basically my kitchen timer.",
];

export function voicePhraseFor(index, name) {
  return VOICE_PHRASES[index % VOICE_PHRASES.length].replace("{name}", name);
}

// Files in public/ are copied verbatim, so Vite does NOT rewrite a path
// like "/avatars/1115.png" for the base path — under Pages that 404s and
// every bird goes missing. Build them off BASE_URL instead.
// import.meta.env is injected by Vite and simply absent under `node
// --test`, which runs this file directly — hence the guard, not a default
// anyone should need to change.
const avatar = (file) => `${import.meta.env?.BASE_URL ?? "/"}avatars/${file}`;

// The chef birds a cook claims on the voice-binding page. `id` is what
// the cook stores (cook.avatar); art lives in public/avatars/. `bg` is
// the tile/circle tint behind the art, `ink` the matching text colour
// (darkened to clear 4.5:1 on `bg`).
export const CHEF_AVATARS = [
  { id: "spoon", src: avatar("1115.png"), name: "Spoon", bg: "#a9d4fb", ink: "#14456f", hue: "Blue" },
  { id: "whisk", src: avatar("1116.png"), name: "Whisk", bg: "#ffb866", ink: "#7a3a00", hue: "Orange" },
  { id: "slurp", src: avatar("1131.png"), name: "Slurp", bg: "#a8e6c4", ink: "#175232", hue: "Green" },
  { id: "tomato", src: avatar("1117.png"), name: "Tomato", bg: "#cfc4fb", ink: "#3b3183", hue: "Purple" },
  { id: "booky", src: avatar("1123.png"), name: "Booky", bg: "#ff9c8c", ink: "#8c1f14", hue: "Red" },
  { id: "roller", src: avatar("1120.png"), name: "Roller", bg: "#f6c9dd", ink: "#8a2f57", hue: "Pink" },
  { id: "flip", src: avatar("1133.png"), name: "Flip", bg: "#ffe08a", ink: "#6e4d00", hue: "Yellow" },
  { id: "stir", src: avatar("1128.png"), name: "Stir", bg: "#c9c3b4", ink: "#4d463a", hue: "Stone" },
];

export const UNCLAIMED_AVATAR = { id: null, src: avatar("unclaimed.png"), name: "Unclaimed", bg: "#f2f1ee", ink: "#6e6e6b", hue: null };

export function chefAvatar(id) {
  return CHEF_AVATARS.find((a) => a.id === id) || UNCLAIMED_AVATAR;
}

// Index into CHEF_AVATARS, or -1 for a cook who hasn't claimed one. The
// bird carousel on the cooks page steps through the list from here, so
// an unclaimed cook (-1) steps into the list at either end.
export function chefAvatarIndex(id) {
  return CHEF_AVATARS.findIndex((a) => a.id === id);
}

// The next bird in `dir` from `id`, never landing on one already taken.
// Wraps, and returns the same bird when nothing else is free.
export function stepChefAvatar(id, dir, taken) {
  const n = CHEF_AVATARS.length;
  const from = chefAvatarIndex(id);
  // From unclaimed, forwards starts at the head and backwards at the tail.
  let i = from === -1 ? (dir > 0 ? -1 : 0) : from;
  for (let tries = 0; tries < n; tries += 1) {
    i = (i + dir + n) % n;
    if (!taken.has(CHEF_AVATARS[i].id)) return CHEF_AVATARS[i].id;
  }
  return id;
}

// Seeded cooks come with a bird each so the line-up reads as two chefs
// from the first paint rather than two blanks. Sessions that predate
// avatars still carry `avatar: null`, which is why nothing downstream
// may assume a cook has one.
export function defaultChefAvatar(index) {
  return CHEF_AVATARS[index % CHEF_AVATARS.length].id;
}
