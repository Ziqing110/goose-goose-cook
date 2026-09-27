import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const dir=new URL('./',import.meta.url);
const origin=process.env.BRAND_QA_URL || 'http://127.0.0.1:5186';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({deviceScaleFactor:1});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const fixture={id:'brand-qa',status:'completed',cooks:[],recipes:[],summary:{dish:'A long dinner title to check the journal brand mark',mode:'cooperative',createdAt:'2026-09-27T00:00:00Z',totalSec:300,cooks:[],perStep:[],story:'Brand layout test fixture.'}};
// Isolate all backend access. This check must never alter real cooking sessions.
await page.route('**/api/**',route=>new URL(route.request().url()).pathname.startsWith('/api/') ? route.fulfill({json:route.request().url().includes('/sessions/brand-qa')?fixture:[]}) : route.continue());
for (const width of [1920,1280,375]) {
  await page.setViewportSize({width,height:900});
  await page.goto(`${origin}/`);
  if(width===375) {
    await page.getByText('Too cramped in here.').waitFor();
    await page.screenshot({path:fileURLToPath(new URL('qa/mobile-existing-size-guard.png',dir))});
    continue;
  }
  await page.locator('.brand-name').waitFor({timeout:10000}).catch(async error=>{
    console.error('UI errors:',errors,'Page:',await page.locator('body').innerText());
    await page.screenshot({path:fileURLToPath(new URL('qa/browser-failure.png',dir))});
    throw error;
  });
  assert.equal(await page.locator('.brand-name').innerText(),'Goose! Goose! Cook!');
  assert.equal((await page.locator('.brand-mark svg').boundingBox()).height,28);
  assert.equal(await page.title(),'Goose! Goose! Cook!');
  await page.locator('.topbar').screenshot({path:fileURLToPath(new URL(`qa/topbar-${width}.png`,dir))});
  await page.goto(`${origin}/cook/brand-qa`);
  await page.locator('.cc-brand-goose').waitFor();
  const mark=await page.locator('.cc-brand-goose').boundingBox();
  const title=await page.locator('.cc-title-row h1').boundingBox();
  assert.equal(mark.height,96);
  assert.ok(title.x+title.width<=mark.x,'journal title must not overlap the goose');
  await page.locator('.cc-title-row').screenshot({path:fileURLToPath(new URL(`qa/journal-${width}.png`,dir))});
}
// Keep API responses pending to inspect the genuine loading branch.
await page.setViewportSize({width:1280,height:900});
await page.unroute('**/api/**');
const held=[];
await page.route('**/api/**',route=>{if(new URL(route.request().url()).pathname.startsWith('/api/')) held.push(route); else return route.continue();});
await page.goto(`${origin}/`,{waitUntil:'domcontentloaded'});
await page.locator('.hp-hero-loading svg').waitFor();
assert.equal((await page.locator('.hp-hero-loading svg').boundingBox()).height,120);
await page.locator('.hp-hero-loading').screenshot({path:fileURLToPath(new URL('qa/loading-desktop.png',dir))});
for (const route of held) await route.fulfill({json:[]});
assert.deepEqual(errors,[]);
const html=await readFile(new URL('../../dist/index.html',dir),'utf8');
for (const name of ['favicon.ico','favicon.svg','apple-touch-icon.png']) assert.ok(html.includes(`href="/goose-goose-cook/${name}"`));
assert.ok(html.includes('content="https://ziqing110.github.io/goose-goose-cook/og-image.png"'));
await writeFile(new URL('qa/browser-result.json',dir),JSON.stringify({passed:true,viewports:[1920,1280,375],mobile:'existing desktop-only size guard preserved; brand shell not rendered',topbarHeight:28,journalMarkHeight:96,loadingMarkHeight:120,backend:'intercepted fixture; no writes',pageErrors:errors,buildPrefix:'/goose-goose-cook/'},null,2));
await browser.close();
console.log('PASS: 28px topbar, 96px journal without overlap, 120px loading, desktop; mobile size guard preserved; no page errors; build URL prefix.');
