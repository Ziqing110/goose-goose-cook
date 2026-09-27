// The colour of a player's bird, for the ring around their avatar. The
// rest of the player's colour (names, scores, bars, bands) stays the
// fixed player A blue / player B orange; only the ring follows the bird
// they picked, so it never clashes with the bird's own tint inside it.
// A player who never picked a bird borrows the bird at their seat
// (player 1 Spoon, player 2 Whisk), the way the "Up for grabs" claim
// buttons do.
//
// A bird carries two tones, `bg` (the tile tint) and `ink` (text that
// clears 4.5:1 on it). The ring is derived from them, never stored.
import { CHEF_AVATARS, chefAvatar } from "./cooks.js";

const hex = (n) => Math.round(n).toString(16).padStart(2, "0");
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** `t` of the way from colour `a` to colour `b`, both #rrggbb. */
export function mix(a, b, t) {
  const x = rgb(a);
  const y = rgb(b);
  return `#${x.map((v, i) => hex(v + (y[i] - v) * t)).join("")}`;
}

const WHITE = "#ffffff";

const luminance = (h) =>
  rgb(h)
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);

/** WCAG contrast ratio between two #rrggbb colours. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The ring is a mid tone between the bird's tint and ink: it starts 45%
// of the way and steps darker until it clears 3:1 on white, the floor for
// a ring to read (WCAG 1.4.11). The pale birds (yellow, pink, green) need
// the extra step.
function midTone(bird) {
  let t = 0.45;
  while (t < 1 && contrast(mix(bird.bg, bird.ink, t), WHITE) < 3) t += 0.05;
  return mix(bird.bg, bird.ink, t);
}

/** The bird a player's colours come from. */
export function playerBird(cook, index) {
  return (cook?.avatar && chefAvatar(cook.avatar)) || CHEF_AVATARS[index % CHEF_AVATARS.length];
}

/** The ring colour for a player's avatar: a mid tone of their bird. */
export function playerRing(cook, index) {
  return midTone(playerBird(cook, index));
}
