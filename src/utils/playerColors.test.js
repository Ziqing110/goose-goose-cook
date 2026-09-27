import test from "node:test";
import assert from "node:assert/strict";
import { CHEF_AVATARS } from "./cooks.js";
import { contrast, playerBird, playerRing } from "./playerColors.js";

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
