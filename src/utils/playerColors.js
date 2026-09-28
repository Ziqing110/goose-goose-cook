// The colour of a player's bird, used both for the ring around their
// avatar and — via playerLaneCssVars below — for the whole swim lane
// (names, scores, bars, bands, ticks). A player who never picked a bird
// borrows the bird at their seat (player 1 Spoon, player 2 Whisk), the
// way the "Up for grabs" claim buttons do.
//
// A bird carries two tones, `bg` (the tile tint) and `ink` (text that
// clears 4.5:1 on it). The ring and the lane palette are both derived
// from them, never stored.
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

// The rest of the swim lane — not just the ring — follows the bird a
// player picked. `bg` is already the bird's solid tile colour, so it
// becomes the lane's accent (borders, ticks, fills); `ink` is already
// tuned to 4.5:1 on white (see cooks.js), so it becomes the lane's text
// colour untouched. `bg` and `field` are pale washes of the same tile
// colour toward white, at the same two depths the old fixed blue/orange
// tokens used (--kp-cook-a-bg and --kp-field-cook-a). `rule` is the
// muted header underline (--kp-paper-rule-a): a touch of ink stirred
// into the tile colour, then washed back toward white so it stays a
// quiet hairline rather than a bold stripe of the bird's own colour.
const LANE_BG_MIX = 0.22;
const LANE_FIELD_MIX = 0.4;
const LANE_RULE_MIX = 0.12;
const LANE_RULE_WASH = 0.5;

/** A player's full lane palette: { accent, ink, bg, field, rule }, from their bird. */
export function playerLaneColors(cook, index) {
  const bird = playerBird(cook, index);
  return {
    accent: bird.bg,
    ink: bird.ink,
    bg: mix(WHITE, bird.bg, LANE_BG_MIX),
    field: mix(WHITE, bird.bg, LANE_FIELD_MIX),
    rule: mix(WHITE, mix(bird.bg, bird.ink, LANE_RULE_MIX), LANE_RULE_WASH),
  };
}

const SLOT_VARS = ["a", "b"];

/**
 * CSS custom properties for the two lane slots, keyed the way tokens.css
 * and design-v4.css already name them (--kp-cook-a, --kp-cook-a-ink, ...).
 * Meant to be applied once, high enough in the DOM to reach both the
 * in-tree page and any portaled surface (e.g. document.documentElement).
 */
export function playerLaneCssVars(cooks = []) {
  const vars = {};
  SLOT_VARS.forEach((slot, index) => {
    const { accent, ink, bg, field, rule } = playerLaneColors(cooks[index], index);
    vars[`--kp-cook-${slot}`] = accent;
    vars[`--kp-cook-${slot}-ink`] = ink;
    vars[`--kp-cook-${slot}-bg`] = bg;
    vars[`--kp-field-cook-${slot}`] = field;
    vars[`--kp-paper-rule-${slot}`] = rule;
  });
  return vars;
}
