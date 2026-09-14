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

export function areCooksBound(cooks) {
  return cooks.length > 0 && cooks.every((c) => c.name.trim() && c.bound);
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
