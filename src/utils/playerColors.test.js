import test from "node:test";
import assert from "node:assert/strict";
import { CHEF_AVATARS } from "./cooks.js";
import { contrast, playerBird, playerRing, playerLaneColors, playerLaneCssVars } from "./playerColors.js";

test("a player's ring comes from the bird they picked", () => {
  assert.equal(playerBird({ avatar: "tomato" }, 0).id, "tomato");
  assert.notEqual(playerRing({ avatar: "tomato" }, 0), playerRing({ avatar: "roller" }, 0));
});

test("a player without a bird borrows the one at their seat", () => {
  assert.equal(playerBird({ avatar: null }, 0).id, "spoon");
  assert.equal(playerBird(undefined, 1).id, "whisk");
});

test("every bird's ring reads on white", () => {
  for (const bird of CHEF_AVATARS) {
    const ring = playerRing({ avatar: bird.id }, 0);
    assert.ok(contrast(ring, "#ffffff") >= 3, `${bird.id} ring ${ring}`);
  }
});

test("a player's lane colours come from the bird they picked, not their seat", () => {
  const tomato = playerLaneColors({ avatar: "tomato" }, 0);
  const roller = playerLaneColors({ avatar: "roller" }, 0);
  assert.notEqual(tomato.accent, roller.accent);
  // Same bird, either seat, same lane colours.
  assert.deepEqual(playerLaneColors({ avatar: "tomato" }, 0), playerLaneColors({ avatar: "tomato" }, 1));
});

test("every bird's lane ink reads on white, the way its ink already does on its own tile", () => {
  for (const bird of CHEF_AVATARS) {
    const { accent, ink, bg, field, rule } = playerLaneColors({ avatar: bird.id }, 0);
    assert.equal(accent, bird.bg);
    assert.equal(ink, bird.ink);
    assert.ok(contrast(ink, "#ffffff") >= 4.5, `${bird.id} lane ink ${ink}`);
    // The lane washes and the rule all stay paler than the accent
    // they're mixed from, with the rule the strongest of the three
    // washes (a touch of ink, then washed back toward white) but
    // still a quiet hairline, not a bold stripe.
    assert.ok(contrast(bg, "#ffffff") < contrast(accent, "#ffffff"));
    assert.ok(contrast(field, "#ffffff") < contrast(accent, "#ffffff"));
    assert.ok(contrast(rule, "#ffffff") < contrast(accent, "#ffffff"));
    assert.ok(contrast(rule, "#ffffff") > contrast(field, "#ffffff"));
  }
});

test("playerLaneCssVars names the two slots the way tokens.css does", () => {
  const vars = playerLaneCssVars([{ avatar: "tomato" }, { avatar: "booky" }]);
  assert.equal(vars["--kp-cook-a"], "#cfc4fb");
  assert.equal(vars["--kp-cook-a-ink"], "#3b3183");
  assert.equal(vars["--kp-cook-b"], "#ff9c8c");
  assert.equal(vars["--kp-cook-b-ink"], "#8c1f14");
  assert.ok(vars["--kp-cook-a-bg"] && vars["--kp-field-cook-a"]);
  assert.ok(vars["--kp-paper-rule-a"] && vars["--kp-paper-rule-b"]);
  assert.notEqual(vars["--kp-paper-rule-a"], vars["--kp-paper-rule-b"]);
});
