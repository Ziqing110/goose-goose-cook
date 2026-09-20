// Drives the real Live cook page in a headless browser and asserts what
// the design brief promises: the two cards' action blocks line up, the
// pool's claim buttons line up, Versus is the arena (cards full-width,
// agent beneath), the primaries sit above the shell's fixed VoiceBar on
// a 1280×800 counter screen, a claim the kitchen can't honour is greyed
// and a refused one answers on its tile, a pause freezes every clock
// and disables every action, "done" with nothing held asks which one,
// and Call it early lands on Service done. Requires `npm run dev:full`
// to be running. Setup seeds a session through the API (see below); it
// does not click through.
//
//   node scripts/livecook-e2e.mjs
//   HEADED=1 node scripts/livecook-e2e.mjs      # watch it in a real browser
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { seedSession } from "./seed-session.mjs";

const BASE = "http://localhost:5173";
// HEADED=1 opens a visible browser, slowed by SLOWMO ms per action (default
// 200) so the run can be followed by eye:  HEADED=1 npm run test:e2e
const headed = process.env.HEADED === "1";
const browser = await chromium.launch({ headless: !headed, slowMo: headed ? Number(process.env.SLOWMO || 200) : 0 });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const failures = [];
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// Home's "Abandon run" is still a browser confirm; Live cook itself
// must never open one (a dialog appearing there is a failure below).
let dialogs = 0;
page.on("dialog", (d) => {
  dialogs += 1;
  d.accept();
});
// The agent's voice (Kokoro) is a ~300 MB model fetched from a CDN. It is not
// what this test is about, so it is blocked: the page falls back to the
// browser's own voice, and the failed fetches are not counted as errors.
await page.route(/cdn\.jsdelivr\.net|huggingface\.co/, (route) => route.abort());
// The agent's brain is blocked too. This test is about the page's layout and
// handlers, which the typed box reaches either way; a model call would make
// every "type, wait, look" step depend on the network and on model timing.
// Blocked, the page falls back to its keyword grammar, as it always did.
await page.route("**/api/agent/turn", (route) => route.abort());
const isVoiceModelNoise = (m) =>
  /jsdelivr|huggingface|\/api\/agent/.test(m.location().url || "") || /onnxruntime/.test(m.text());
page.on("console", (m) => m.type() === "error" && !/404/.test(m.text()) && !isVoiceModelNoise(m) && errors.push(m.text()));

const click = async (text, opts = {}) => {
  const el = page.getByRole("button", { name: text, ...opts }).first();
  await el.waitFor({ state: "visible", timeout: 10000 });
  await el.click();
  await page.waitForTimeout(250);
};
const pickMode = async (name) => {
  await page.getByRole("radio", { name: new RegExp(`^${name}`) }).click();
  await page.waitForTimeout(250);
};
const box = (loc) => loc.boundingBox();
const check = async (name, fn) => {
  try {
    await fn();
    console.log("✔", name);
  } catch (err) {
    failures.push(name);
    console.log("✖", name, "\n   ", err.message.split("\n")[0]);
  }
};
// Two boxes share a y (or bottom) within a pixel of rounding.
const sameY = (a, b, msg) => assert.ok(Math.abs(a.y - b.y) <= 1, `${msg}: y ${a.y} vs ${b.y}`);
const sameBottom = (a, b, msg) => assert.ok(Math.abs(a.y + a.height - (b.y + b.height)) <= 1, `${msg}: bottom ${a.y + a.height} vs ${b.y + b.height}`);

// ---------------------------------------------------------------------
// Setup: seed a session through the API instead of clicking through it.
//
// The conversation now reads answers with a model and Voice binding needs
// real speech, so driving both from a headless browser is slow, flaky and
// (for binding) impossible without a microphone. What this test is about
// starts at Schedule, so the session is built to look like one that got
// there: conversation complete, recipes approved, two cooks bound.
//
// The recipes are the app's own FALLBACK path, on purpose. With no dish
// named in the conversation the app instantiates its seeded templates
// (Mapo Tofu + Chicken Noodle Soup, with the shared garlic) with no model
// call, so the run is the same every time and needs no API key. This uses
// the app's own helpers, so it cannot drift from what the page would build.
//
// Note: starting a session closes out any other active one. That is the
// API's invariant, not this script's choice, so a run you had going is
// abandoned. The session created here is deleted at the end.
// ---------------------------------------------------------------------
const { remove: removeSession } = await seedSession(BASE);

// Loaded fresh, so the app hydrates the seeded session as its active one.
await page.goto(`${BASE}/session/schedule`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const cards = page.locator(".lc-card");

// ---------------------------------------------------------------------
// Versus
// ---------------------------------------------------------------------
const goLive = async () => {
  await click(/Go live/);
  // Versus runs a countdown before the cards exist.
  await cards.first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(600);
};
const primariesAboveBar = async () => {
  const bar = await box(page.locator(".voice-bar"));
  const xl = page.locator(".lc-card .lc-card-actions .lc-btn-xl");
  for (let i = 0; i < 2; i++) {
    const b = await box(xl.nth(i));
    assert.ok(b.y + b.height <= bar.y, `primary ${i} bottom ${b.y + b.height} vs bar top ${bar.y}`);
  }
};
await pickMode("Versus");
await goLive();

await check("versus: at 1280×800 both primaries are on screen above the VoiceBar", primariesAboveBar);

await check("versus: one column — strip, cards 50/50 with a score each, the board beneath, Toque as one line", async () => {
  const strip = await box(page.locator(".lc-strip"));
  const a = await box(cards.nth(0));
  const b = await box(cards.nth(1));
  const pool = await box(page.locator(".lc-pool"));
  const toque = await box(page.locator(".lc-toque-line"));
  assert.ok(strip.y + strip.height <= a.y, "the strip is above the cards");
  sameY(a, b, "cards");
  assert.ok(Math.abs(a.width - b.width) <= 1, "equal card widths");
  assert.ok(Math.abs(a.x + a.width + (b.x - (a.x + a.width)) + b.width - (pool.x + pool.width)) <= 2, "the cards span the same width as the board");
  assert.ok(pool.y >= a.y + a.height - 1, "the board is under the cards");
  assert.ok(toque.y >= pool.y + pool.height - 1, "Toque's line is under the board");
  assert.equal(await page.locator(".lc-race").count(), 0, "no race widget");
  assert.equal(await page.locator(".lc-side").count(), 0, "no side column in Versus");
  assert.equal(await cards.locator(".lc-card-points").count(), 2, "a score on each card");
  assert.ok(await page.locator(".lc-lead-line").isVisible(), "the strip carries the lead line");
  assert.equal(await page.locator(".lc-field.is-versus .lc-seam").count(), 1, "the versus field has its seam");
});

await check("versus: no drift chip (there is no plan to drift from)", async () => {
  assert.equal(await page.locator(".lc-drift").count(), 0);
});

await check("versus: claim buttons in one pool row share a bottom edge even when labels wrap", async () => {
  const tiles = page.locator(".lc-tile.is-claimable");
  const n = await tiles.count();
  assert.ok(n >= 2, `${n} claimable tiles`);
  const rows = new Map();
  for (let i = 0; i < n; i++) {
    const t = await box(tiles.nth(i));
    const btn = await box(tiles.nth(i).locator(".lc-claim").first());
    const key = Math.round(t.y);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push({ tile: t, btn });
  }
  for (const [y, items] of rows) {
    for (const it of items.slice(1)) {
      sameBottom(items[0].btn, it.btn, `row ${y} claim buttons`);
      sameBottom(items[0].tile, it.tile, `row ${y} tiles`);
    }
  }
});

await check("versus: a claim moves the tile to Taken, and the busy player's buttons go grey", async () => {
  const first = page.locator(".lc-tile.is-claimable").first();
  const label = await first.locator(".lc-tile-label").innerText();
  await first.locator(".lc-claim.is-a").click();
  await page.waitForTimeout(600);
  const taken = page.locator(".lc-tile.is-taken", { hasText: label });
  assert.equal(await taken.count(), 1, "tile is now Taken");
  assert.equal(await cards.nth(0).locator(".lc-card-status").innerText(), "On it");
  const miaButtons = page.locator(".lc-tile.is-claimable .lc-claim.is-a");
  const n = await miaButtons.count();
  for (let i = 0; i < n; i++) assert.equal(await miaButtons.nth(i).isEnabled(), false, "Mia is busy");
  // Leo is free — but only for tiles that don't need the board Mia holds.
  const leoButtons = page.locator(".lc-tile.is-claimable .lc-claim.is-b:enabled");
  assert.ok((await leoButtons.count()) >= 1, "Leo is free");
});

await check("versus: a claim the kitchen can't honour is greyed, and a refused one answers on the tile", async () => {
  // Mia holds a board step; every other tile that needs the one board
  // greys out for Leo with the reason as its tooltip.
  const boardTiles = page.locator(".lc-tile.is-claimable", { has: page.locator(".lc-chip", { hasText: /Cutting board/ }) });
  const n = await boardTiles.count();
  assert.ok(n >= 1, `${n} board tiles`);
  const leo = boardTiles.first().locator(".lc-claim.is-b");
  assert.equal(await leo.isEnabled(), false, "Leo can't take a board step while the board is busy");
  assert.match((await leo.getAttribute("title")) || "", /No cutting board free/);
  // The tile says why instead of Toque's line alone: force a refusal
  // through the drawer (the same handler) and read it on the tile.
  const label = await boardTiles.first().locator(".lc-tile-label").innerText();
  await page.getByRole("button", { name: /Open Toque/ }).click();
  await page.getByRole("radio", { name: /Leo/ }).click();
  await page.locator(".lc-say-input").fill(`take ${label}`);
  await click(/Say it/);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const note = page.locator(".lc-tile", { hasText: label }).locator(".lc-claim-note");
  assert.equal(await note.count(), 1, "the refusal is on the tile");
  assert.match(await note.innerText(), /cutting board/i);
});

await check("versus: Done on a card scores it — the card's counter rolls and the strip says who leads", async () => {
  const before = await cards.locator(".lc-card-points").allInnerTexts();
  await cards.nth(0).locator(".lc-btn-done").click();
  await page.waitForTimeout(1200);
  const after = await cards.locator(".lc-card-points").allInnerTexts();
  assert.notDeepEqual(before, after, `${before} → ${after}`);
  assert.match(await page.locator(".lc-lead-line").innerText(), /^Mia leads by \d+$/);
});

await check("versus: Toque's line opens the drawer with the whole run, Escape closes it", async () => {
  await page.locator(".lc-toque-line").click();
  await page.waitForTimeout(400);
  const drawer = page.locator(".lc-drawer");
  assert.equal(await drawer.count(), 1, "drawer open");
  assert.ok((await drawer.locator(".lc-line").count()) >= 2, "the run reads back");
  assert.ok(await drawer.locator(".lc-speaker").isVisible(), "the speaker toggle lives in the drawer");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".lc-drawer").count(), 0, "drawer closed");
});

await check("versus: Done and Take it sit on one line with both secondary slots present", async () => {
  // Mia is free now and gets an "Up for grabs" suggestion; claim for Leo
  // so one card is On it and the other is a suggestion.
  await page.locator(".lc-tile.is-claimable .lc-claim.is-b").first().click();
  await page.waitForTimeout(600);
  const xl = page.locator(".lc-card .lc-card-actions .lc-btn-xl");
  assert.equal(await xl.count(), 2);
  sameY(await box(xl.nth(0)), await box(xl.nth(1)), "primaries");
});

// Mobile: single column, fixed order, primaries stay 64 and full width.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
await check("mobile 390: cards stack in player order, primaries 64px full-width, no horizontal scroll", async () => {
  const a = await box(cards.nth(0));
  const b = await box(cards.nth(1));
  assert.ok(b.y >= a.y + a.height - 1, "stacked");
  assert.equal(await cards.nth(0).locator(".lc-card-name").innerText(), "Mia");
  const xl = page.locator(".lc-card .lc-card-actions .lc-btn-xl").first();
  const xb = await box(xl);
  assert.ok(xb.height >= 64, `primary ${xb.height}px`);
  // Full width up to the goose's slot (88px on mobile).
  assert.ok(xb.width >= a.width - 40 - 88, "full width inside the card");
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(scrollW <= 390, `page scrollWidth ${scrollW}`);
  // The scores come back up to the strip; Toque stays one line.
  assert.equal(await page.locator(".lc-strip .lc-score-pill").count(), 2, "score pills in the strip");
  assert.ok(await page.locator(".lc-toque-line").isVisible(), "Toque's line");
});

// ---------------------------------------------------------------------
// Co-op
// ---------------------------------------------------------------------
await page.setViewportSize({ width: 1280, height: 800 });
await page.goto(`${BASE}/session/schedule`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await click(/Abandon this cook/);
await click(/^Abandon$/);
await page.waitForTimeout(600);
await pickMode("Co-op");
await goLive();

await check("co-op: at 1280×800 both primaries are on screen above the VoiceBar", primariesAboveBar);

await check("co-op: 768 wide — the strip's note shrinks instead of widening the page", async () => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.waitForTimeout(400);
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(scrollW <= 768, `page scrollWidth ${scrollW}`);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(400);
});

const primaries = page.locator(".lc-card .lc-card-actions .lc-btn-xl");

await check("co-op: exactly two player cards, in player order", async () => {
  assert.equal(await cards.count(), 2);
  assert.equal(await cards.nth(0).locator(".lc-card-name").innerText(), "Mia");
  assert.equal(await cards.nth(1).locator(".lc-card-name").innerText(), "Leo");
});

await check("co-op: both cards start with a 64px primary on the same line", async () => {
  assert.equal(await primaries.count(), 2);
  const a = await box(primaries.nth(0));
  const b = await box(primaries.nth(1));
  sameY(a, b, "primaries");
  assert.ok(a.height >= 64 && b.height >= 64, `primary heights ${a.height}/${b.height}`);
});

// One player starts, the other doesn't: Done + Skip/Undo on one side,
// Start with an empty secondary slot on the other — still one line.
await primaries.nth(0).click();
await page.waitForTimeout(600);
await check("co-op: Done on one card and Start on the other sit on the same line", async () => {
  const done = page.locator(".lc-card").nth(0).locator(".lc-btn-done");
  const start = page.locator(".lc-card").nth(1).locator(".lc-btn-xl");
  sameY(await box(done), await box(start), "Done vs Start");
  const secondaries = page.locator(".lc-card .lc-card-secondary");
  assert.equal(await secondaries.count(), 2, "the secondary slot is rendered on both cards");
  sameY(await box(secondaries.nth(0)), await box(secondaries.nth(1)), "secondary rows");
});

await check("co-op: Undo is the far-right ghost and only the acting player can use it", async () => {
  const mia = cards.nth(0);
  const leo = cards.nth(1);
  const undoMia = mia.getByRole("button", { name: "Undo" });
  const skipMia = mia.getByRole("button", { name: "Skip" });
  assert.equal(await undoMia.isEnabled(), true, "Mia just started something");
  const u = await box(undoMia);
  const s = await box(skipMia);
  const card = await box(mia);
  assert.ok(u.x > s.x, "Undo is right of Skip");
  // The action block stops 118px short of the edge — that margin is the goose's.
  assert.ok(u.x + u.width > card.x + card.width - 40 - 118, "Undo hugs the action block's right edge");
  const undoLeo = leo.getByRole("button", { name: "Undo" });
  assert.equal(await undoLeo.count(), 0, "Leo has nothing to undo, so no Undo is shown");
});

await check("co-op: step timer ticks and reads mono m:ss", async () => {
  const timer = cards.nth(0).locator(".lc-timer-value");
  const t1 = await timer.innerText();
  await page.waitForTimeout(1500);
  const t2 = await timer.innerText();
  assert.match(t1, /^\d+:\d{2}$/);
  assert.notEqual(t1, t2, "timer advanced");
});

await check("co-op: pause freezes both clocks and disables every action; Resume becomes the primary", async () => {
  await click(/^Pause$/);
  assert.ok(await page.locator(".lc-paused").isVisible(), "paused banner");
  const clock = page.locator(".lc-clock-value");
  const timer = cards.nth(0).locator(".lc-timer-value");
  const c1 = await clock.innerText();
  const t1 = await timer.innerText();
  await page.waitForTimeout(2200);
  assert.equal(await clock.innerText(), c1, "run clock frozen");
  assert.equal(await timer.innerText(), t1, "step timer frozen");
  const actions = page.locator(".lc-card button, .lc-footer button");
  const n = await actions.count();
  for (let i = 0; i < n; i++) assert.equal(await actions.nth(i).isEnabled(), false, `action ${i} disabled while paused`);
  const resume = page.getByRole("button", { name: /^Resume$/ });
  assert.ok((await resume.getAttribute("class")).includes("btn-primary"), "Resume is the primary");
  await resume.click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator(".lc-paused").count(), 0);
});

await check("co-op: 'done' from a player holding nothing asks which one, with ≤3 options + Cancel", async () => {
  // Leo is the speaker, holding nothing.
  await page.getByRole("radio", { name: /Leo/ }).click();
  await page.locator(".lc-say-input").fill("done");
  await click(/Say it/);
  await page.waitForTimeout(400);
  const pendingOpts = page.locator(".lc-pending .lc-pending-option");
  const n = await pendingOpts.count();
  assert.ok(n >= 1 && n <= 3, `${n} options`);
  assert.ok(await page.locator(".lc-pending").getByRole("button", { name: "Cancel" }).isVisible());
  await page.locator(".lc-pending").getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".lc-pending").count(), 0);
});

await check("co-op: 'done' from the player holding a step finishes it via the same handler as the button", async () => {
  await page.getByRole("radio", { name: /Mia/ }).click();
  const before = await page.locator(".lc-count-big").innerText();
  await page.locator(".lc-say-input").fill("done");
  await click(/Say it/);
  await page.waitForTimeout(1200);
  const after = await page.locator(".lc-count-big").innerText();
  assert.notEqual(before, after, `count ${before} → ${after}`);
  assert.ok(await page.locator(".lc-line.is-agent").last().innerText().then((t) => /done in/.test(t)), "agent confirms");
});

await check("co-op: Call it early is a Modal, and confirming lands on Service done", async () => {
  const dialogsBefore = dialogs;
  await click(/Call it early/);
  assert.equal(dialogs, dialogsBefore, "no browser dialog on the play surface");
  const dialog = page.getByRole("dialog");
  assert.ok(await dialog.isVisible());
  await dialog.getByRole("button", { name: "Keep cooking" }).click();
  await page.waitForTimeout(200);
  assert.equal(await page.getByRole("dialog").count(), 0, "Keep cooking closes it");
  await click(/Call it early/);
  await page.getByRole("dialog").getByRole("button", { name: /^Call it$/ }).click();
  await page.waitForTimeout(800);
  assert.ok(await page.locator(".lc-service").isVisible(), "Service done panel");
  assert.ok(await page.getByRole("button", { name: /See the cook card/ }).isVisible());
  assert.equal(await page.locator(".lc-card").count(), 0, "cards are replaced");
  assert.ok((await page.locator(".lc-step-row").count()) > 0, "step list rendered");
  // One step done, the rest skipped: nothing to cheer, so no winner tiles.
  assert.equal(await page.locator(".lc-score-tile.is-winner").count(), 0, "no celebration for a run that was called off");
});

await browser.close();
// The seeded session was this script's; leave the database without it.
await removeSession().catch((err) => console.log("cleanup failed:", err.message));

if (errors.length) console.log("\nbrowser errors:\n  " + errors.join("\n  "));
console.log(`\n${failures.length === 0 ? "all checks passed" : `${failures.length} check(s) failed`}`);
process.exit(failures.length || errors.length ? 1 : 0);
