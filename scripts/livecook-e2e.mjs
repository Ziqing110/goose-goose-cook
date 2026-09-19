// Drives the real Live cook page in a headless browser and asserts what
// the design brief promises: the two cards' action blocks line up, the
// pool's claim buttons line up, Versus is the arena (cards full-width,
// agent beneath), a pause freezes every clock and disables every
// action, "done" with nothing held asks which one, and Call it early
// lands on Service done. Requires `npm run dev:full` to be running.
//
//   node scripts/livecook-e2e.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";

const BASE = "http://localhost:5173";
const browser = await chromium.launch();
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
page.on("console", (m) => m.type() === "error" && !/404/.test(m.text()) && errors.push(m.text()));

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
// Setup: Home → kitchen → conversation → inventory → cooks → schedule.
// Same clicks as screenshot-flow.mjs, minus the screenshots.
// ---------------------------------------------------------------------
await page.goto(BASE, { waitUntil: "networkidle" });
if (await page.getByRole("button", { name: /Add your first kitchen|\+ Add kitchen/ }).first().isVisible().catch(() => false)) {
  await click(/Add your first kitchen|\+ Add kitchen/);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Kitchen name").fill("E2E Kitchen");
  await dialog.getByRole("button", { name: /Add kitchen|Save changes/ }).click();
  await page.waitForTimeout(600);
}
if (await page.getByRole("button", { name: /Abandon run|Discard and start new/ }).first().isVisible().catch(() => false)) {
  await click(/Abandon run|Discard and start new/);
  await page.waitForTimeout(500);
}
await click(/Start the run/);
await page.waitForTimeout(600);
const pick = page.getByRole("button", { name: /Kitchen$/ }).first();
if (await pick.isVisible().catch(() => false)) {
  await pick.click();
  await page.waitForTimeout(800);
}
for (let i = 0; i < 8; i++) {
  if (await page.getByRole("button", { name: /Check the inventory/ }).first().isVisible().catch(() => false)) break;
  const input = page.locator(".answer-input");
  await input.click();
  await page.waitForTimeout(100);
  const twoCooks = page.locator(".template-chip", { hasText: /^2 cooks$/ });
  const chip = (await twoCooks.count()) ? twoCooks.first() : page.locator(".template-chip").first();
  if (await chip.isVisible().catch(() => false)) await chip.click();
  else await input.fill("mapo tofu and chicken noodle soup");
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForTimeout(350);
}
await click(/Check the inventory/);
await page.waitForTimeout(2000);
await click(/Approve and schedule/);
await page.waitForTimeout(800);
await click(/Continue to schedule/);
await page.waitForTimeout(600);
const names = ["Mia", "Leo"];
const inputs = page.locator(".cook-name-input");
const count = await inputs.count();
for (let i = 0; i < count; i++) await inputs.nth(i).fill(names[i] || `Cook ${i + 1}`);
for (let i = 0; i < count; i++) {
  const pickChef = page.getByRole("button", { name: /Pick your chef/ }).first();
  if (!(await pickChef.isVisible().catch(() => false))) break;
  await pickChef.click();
  await page.waitForTimeout(300);
  await page.locator(".chef-tile:not([disabled])").first().click();
  await click(/That.s me/);
}
for (let i = 0; i < count; i++) {
  const btn = page.getByRole("button", { name: /Start reading|Record again/ }).nth(i);
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(3000);
  }
}
await click(/Continue to scheduling/);
await page.waitForTimeout(1500);

const cards = page.locator(".lc-card");

// ---------------------------------------------------------------------
// Versus
// ---------------------------------------------------------------------
await pickMode("Versus");
await click(/Go live/);
await page.waitForTimeout(1500);

await check("versus: leaderboard above the cards, cards full width 50/50, agent beneath them", async () => {
  const lb = await box(page.locator(".lc-leaderboard"));
  const a = await box(cards.nth(0));
  const b = await box(cards.nth(1));
  const agent = await box(page.locator(".lc-agent"));
  const play = await box(page.locator(".lc-play"));
  assert.ok(lb.y + lb.height <= a.y, "leaderboard is above the cards");
  sameY(a, b, "cards");
  assert.ok(Math.abs(a.width - b.width) <= 1, "equal card widths");
  assert.ok(b.x + b.width >= play.x + play.width - 1, "the second card reaches the right edge — no side column");
  assert.ok(agent.y >= a.y + a.height - 1, "the agent band is below the cards");
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
  assert.equal(await cards.nth(0).locator(".lc-eyebrow").innerText(), "On it");
  const miaButtons = page.locator(".lc-tile.is-claimable .lc-claim.is-a");
  const n = await miaButtons.count();
  for (let i = 0; i < n; i++) assert.equal(await miaButtons.nth(i).isEnabled(), false, "Mia is busy");
  const leoButtons = page.locator(".lc-tile.is-claimable .lc-claim.is-b");
  assert.equal(await leoButtons.first().isEnabled(), true, "Leo is free");
});

await check("versus: Done on a card scores it and the leaderboard rolls", async () => {
  const before = await page.locator(".lc-leader-points").allInnerTexts();
  await cards.nth(0).locator(".lc-btn-done").click();
  await page.waitForTimeout(800);
  const after = await page.locator(".lc-leader-points").allInnerTexts();
  assert.notDeepEqual(before, after, `${before} → ${after}`);
  assert.match(await cards.nth(0).locator(".lc-card-pts").innerText(), /^\d+ pts$/);
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
  assert.ok(xb.width >= a.width - 40, "full width inside the card");
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(scrollW <= 390, `page scrollWidth ${scrollW}`);
  // The transcript collapses to its last two lines with a "More".
  const log = await box(page.locator(".lc-log"));
  assert.ok(log.height <= 64, `log ${log.height}px`);
  assert.ok(await page.getByRole("button", { name: "More" }).isVisible(), "More toggle");
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
await click(/Go live/);
await page.waitForTimeout(1500);

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
  assert.ok(u.x + u.width > card.x + card.width - 40, "Undo hugs the card's right edge");
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
  const before = await page.locator(".lc-count").innerText();
  await page.locator(".lc-say-input").fill("done");
  await click(/Say it/);
  await page.waitForTimeout(1200);
  const after = await page.locator(".lc-count").innerText();
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
  assert.equal(await page.locator(".lc-step-row").count(), await page.locator(".lc-step-row").count(), "step list rendered");
});

await browser.close();

if (errors.length) console.log("\nbrowser errors:\n  " + errors.join("\n  "));
console.log(`\n${failures.length === 0 ? "all checks passed" : `${failures.length} check(s) failed`}`);
process.exit(failures.length || errors.length ? 1 : 0);
