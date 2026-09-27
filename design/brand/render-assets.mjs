import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const dir = new URL('./',import.meta.url);
const root = new URL('../../',dir);
await mkdir(new URL('qa/',dir),{recursive:true});
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({deviceScaleFactor:1});
async function render(file, size, output, {dark=false, opaque=false, pad=0, height=size}={}) {
  const content = await readFile(new URL(file,dir));
  const mime = file.endsWith('.png') ? 'image/png' : 'image/svg+xml';
  await page.setViewportSize({width:size,height});
  await page.emulateMedia({colorScheme:dark?'dark':'light'});
  await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:${opaque?(dark?'#202124':'#fff'):'transparent'}}img{display:block;width:${size-pad*2}px;height:${height-pad*2}px;margin:${pad}px}</style><img src="data:${mime};base64,${content.toString('base64')}">`);
  await page.locator('img').evaluate(img => img.decode());
  await page.screenshot({path:fileURLToPath(new URL(output,dir)),omitBackground:!opaque});
}
for (const size of [16,32,48]) {
  await render(size===16?'goose-head-16.svg':'goose-head.svg',size,`qa/ico-${size}.png`);
}
await render('goose-head.svg',180,'../../public/apple-touch-icon.png',{opaque:true,pad:18});
await render('og-layout.svg',1200,'../../public/og-image.png',{opaque:true,height:630});
await render('goose-lockup.svg',561,'qa/lockup.png',{opaque:true,height:701});
await render('goose-mark.svg',174,'qa/mark-400.png',{opaque:true,height:400});
for (const dark of [false,true]) {
  for (const size of [16,28,32,48,64]) {
    await render('../../public/favicon.svg',size,`qa/head-${size}-${dark?'dark':'light'}.png`,{dark,opaque:true});
  }
  for (const size of [16,32,48]) await render(`qa/ico-${size}.png`,size,`qa/fallback-${size}-${dark?'dark':'light'}.png`,{dark,opaque:true});
}
const preview = `<!doctype html><meta charset="utf-8"><title>Goose brand — actual-size QA</title>
<style>body{font:15px system-ui;margin:32px;background:#eee;color:#1a1a1a}h1{font-size:24px}section{padding:24px;margin:20px 0;background:white}.dark{background:#202124;color:#f7f6f3}.row{display:flex;align-items:center;gap:30px}.item{text-align:center}.item span{display:block;margin-top:12px;font-size:12px}img{object-fit:contain}iframe{border:0} .large{display:flex;gap:30px;align-items:center}</style>
<h1>Goose! Goose! Cook! — brand assets</h1><p>Actual-size 1× samples · selected baguette goose · L / M / S</p>
${['light','dark'].map(mode=>`<section class="${mode}"><h2>S · ${mode} / 1×</h2><div class="row">${[16,28,32,48,64].map(s=>`<div class="item"><img src="qa/head-${s}-${mode}.png" width="${s}" height="${s}"><span>${s}px${s===16?' · one eye':''}</span></div>`).join('')}<div class="item"><img src="../../public/apple-touch-icon.png" width="180" height="180"><span>Apple · 180px · opaque</span></div></div><h3>ICO fallback · actual decoded frames</h3><div class="row">${[16,32,48].map(s=>`<div class="item"><img src="qa/fallback-${s}-${mode}.png" width="${s}" height="${s}"><span>${s}px</span></div>`).join('')}</div></section>`).join('')}
<section><h2>M · 2px minimum stroke at 96px</h2><div class="row">${[96,120,200,400].map(s=>`<div class="item"><img src="goose-mark.svg" height="${s}"><span>${s}px</span></div>`).join('')}</div></section>
<section><h2>L · retained hand-lettering / vector</h2><img src="goose-lockup.svg" height="500"></section>
<section><h2>OG · 1200 × 630 (shown at half size)</h2><img src="../../public/og-image.png" width="600" height="315"></section>`;
await writeFile(new URL('preview.html',dir),preview);
await page.setViewportSize({width:1000,height:1800});
await page.goto(new URL('preview.html',dir).href);
await page.screenshot({path:fileURLToPath(new URL('qa/contact-sheet.png',dir)),fullPage:true});
await browser.close();
