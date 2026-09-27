import test from "node:test";
import assert from "node:assert/strict";
import { WORDMARK_LABEL, WORDMARK_VARIANTS, wordmarkGeometry, wordmarkSize } from "./wordmark.js";

for (const variant of WORDMARK_VARIANTS) {
  test(`${variant}: every non-space character of the name gets a glyph`, () => {
    const { glyphs } = wordmarkGeometry(variant);
    assert.equal(glyphs.length, WORDMARK_LABEL.replace(/ /g, "").length);
    assert.ok(glyphs.every((g) => typeof g.d === "string" && g.d.length > 0));
  });

  test(`${variant}: glyphs advance left to right`, () => {
    const { glyphs } = wordmarkGeometry(variant);
    for (let i = 1; i < glyphs.length; i++) assert.ok(glyphs[i].x > glyphs[i - 1].x);
  });

  test(`${variant}: size scales with the cap height and includes the stroke overhang`, () => {
    const { advance } = wordmarkGeometry(variant);
    const { width, height } = wordmarkSize(100, variant);
    assert.ok(width > advance);
    assert.ok(height > 100);
    assert.equal(wordmarkSize(12, variant).width, width * 0.12);
  });
}
