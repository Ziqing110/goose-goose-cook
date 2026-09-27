// Renders public/og-image.png, the link-preview image, from the brand
// masters: the M goose (design/brand/goose-mark.svg) on the left and the
// hand-lettered wordmark (direction A, src/utils/wordmark.js) on the
// right. Composition from the brand pass, surface 7: 1200×630 on white,
// M 480 tall, an 84px gap, the pair centred in the 1200×600 safe zone.
// The pass sized its wordmark for the wider B caps; direction A is set by
// width instead, about as wide as the lettering in the supplied OG, so it
// still reads when a chat app shrinks the preview. Ink only, like
// direction A everywhere else.
//
// Re-run after changing either master:  node scripts/render-og.mjs
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { wordmarkGeometry, wordmarkSize } from "../src/utils/wordmark.js";

const W = 1200;
const H = 630;
const INK = "#1a1a1a";
const GOOSE_H = 480;
const GAP = 84;
const WORDMARK_W = 700;

const { glyphs, stroke, viewBox } = wordmarkGeometry("hand");
const CAP = (WORDMARK_W / viewBox[2]) * 100;
const mark = wordmarkSize(CAP);
// One pen for the whole image: the goose's outline matches the
// wordmark's stroke at this size instead of the master's 2px.
const penPx = (stroke * CAP) / 100;

const gooseSvg = readFileSync(new URL("../design/brand/goose-mark.svg", import.meta.url), "utf8")
  .replace(/stroke-width="2"/, `stroke-width="${penPx}"`)
  .replace("<svg ", `<svg width="${(GOOSE_H * 360) / 830}" height="${GOOSE_H}" `);

const wordmarkSvg = `<svg viewBox="${viewBox.join(" ")}" width="${mark.width}" height="${mark.height}"
  fill="none" stroke="${INK}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">
  ${glyphs.map((g) => `<path transform="translate(${g.x} 0)" d="${g.d}"/>`).join("")}
</svg>`;

const html = `<!doctype html><html><body style="margin:0">
<div style="width:${W}px;height:${H}px;background:#fff;color:${INK};display:flex;align-items:center;justify-content:center;gap:${GAP}px">
  ${gooseSvg}
  ${wordmarkSvg}
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(html);
const out = new URL("../public/og-image.png", import.meta.url).pathname;
await page.screenshot({ path: out });
await browser.close();
console.log(`wrote ${out}`);
