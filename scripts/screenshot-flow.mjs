// Drives the real app end to end in a headless browser and saves a
// screenshot at each stage, so the UI can be eyeballed without clicking
// through by hand. Requires `npm run dev:full` to already be running.
//
//   node scripts/screenshot-flow.mjs [outDir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = process.argv[2] || "screenshots";
const BASE = "http://localhost:5173";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const shots = [];
const shot = async (name) => {
  const file = path.join(OUT, `${String(shots.length + 1).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  shots.push(file);
  console.log("saved", file);
};

// Several actions are confirm()-gated; Playwright dismisses dialogs by
// default, which would silently cancel them.
page.on("dialog", (d) => d.accept());
page.on("console", (m) => {
  if (m.type() === "error") console.log("  [browser error]", m.text());
});
page.on("pageerror", (e) => console.log("  [page error]", e.message));

const click = async (text, opts = {}) => {
  const el = page.getByRole("button", { name: text, ...opts }).first();
  await el.waitFor({ state: "visible", timeout: 10000 });
  await el.click();
  await page.waitForTimeout(250);
};

// The schedule page's mode cards are a radio group, not buttons.
const pickMode = async (name) => {
  await page.getByRole("radio", { name: new RegExp(`^${name}`) }).click();
  await page.waitForTimeout(250);
};

await page.goto(BASE, { waitUntil: "networkidle" });
await shot("home");

// A session needs a kitchen; make one if none exists yet.
if (await page.getByRole("button", { name: /Add your first kitchen|\+ Add kitchen/ }).first().isVisible().catch(() => false)) {
  await click(/Add your first kitchen|\+ Add kitchen/);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Kitchen name").fill("Screenshot Kitchen");
  await shot("kitchen-modal");
  // Same label as the page-level button behind the scrim, so scope it.
  await dialog.getByRole("button", { name: /Add kitchen|Save changes/ }).click();
  await page.waitForTimeout(600);
}

if (await page.getByRole("button", { name: /Abandon run|Discard and start new/ }).first().isVisible().catch(() => false)) {
  await click(/Abandon run|Discard and start new/);
  await page.waitForTimeout(500);
}

await click(/Start the run/);
await page.waitForTimeout(600);
// With more than one kitchen saved, Home asks which one first.
const pick = page.getByRole("button", { name: "Screenshot Kitchen" }).first();
if (await pick.isVisible().catch(() => false)) {
  await pick.click();
  await page.waitForTimeout(800);
}
await shot("conversation");

// Answer the scripted questions. The first has no preset options, so
// the input has to be typed; the rest offer chips that fill it.
for (let i = 0; i < 8; i++) {
  if (await page.getByRole("button", { name: /Check the inventory/ }).first().isVisible().catch(() => false)) break;
  const input = page.locator(".answer-input");
  await input.click(); // clicking mutes the mic and enables typing
  await page.waitForTimeout(100);

  // Two cooks makes for a far more interesting schedule than "Just me".
  const twoCooks = page.locator(".template-chip", { hasText: /^2 cooks$/ });
  const chip = (await twoCooks.count()) ? twoCooks.first() : page.locator(".template-chip").first();
  if (await chip.isVisible().catch(() => false)) {
    await chip.click();
  } else {
    await input.fill("mapo tofu and chicken noodle soup");
  }
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForTimeout(350);
}
await shot("conversation-complete");

// Inventory carries the whole main line now: ingredients, the step
// board, its editor and approval are all one page.
await click(/Check the inventory/);
await page.waitForTimeout(400);
await shot("inventory-writing");
// The chef-at-work beat holds until the recipes land (up to a minute
// against the real generator; instant on the seeded templates).
await page.locator(".chef-working").waitFor({ state: "detached", timeout: 130000 }).catch(() => {});
await page.waitForTimeout(600);
await shot("inventory");

await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(400);
await shot("inventory-board");

await click(/Approve and schedule/);
await page.waitForTimeout(800);
await shot("inventory-approved");

await click(/Continue to schedule/);
await page.waitForTimeout(600);
await shot("voice-binding-empty");

// Bind both cooks.
const names = ["Mia", "Leo"];
const inputs = page.locator(".cook-name-input");
const count = await inputs.count();
for (let i = 0; i < count; i++) {
  await inputs.nth(i).fill(names[i] || `Cook ${i + 1}`);
  await page.waitForTimeout(150);
}
await shot("voice-binding-named");

// Every cook comes seeded with a bird, so this drives the chef drawer
// rather than satisfying a gate: open it from the lane chip, take a
// free bird, and let it fold itself away.
for (let i = 0; i < count; i++) {
  const chip = page.locator(".cook-lane-chip").nth(i);
  if (!(await chip.isVisible().catch(() => false))) break;
  await chip.click();
  await page.waitForTimeout(500);
  if (i === 0) await shot("voice-binding-chef-drawer");
  await page.locator(".cook-drawer .chef-tile:not([disabled])").nth(i + 2).click();
  await page.waitForTimeout(700);
}

for (let i = 0; i < count; i++) {
  const btn = page.getByRole("button", { name: /Start reading|Record again/ }).nth(i);
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    if (i === 0) {
      await page.waitForTimeout(700);
      await shot("voice-binding-recording");
    }
    await page.waitForTimeout(3000);
  }
}
await shot("voice-binding-bound");

await click(/Continue to scheduling/);
await page.waitForTimeout(1500);
await shot("schedule-no-mode");

await pickMode("Co-op");
await page.waitForTimeout(900);
await shot("schedule-coop-fit");

// Check the label thresholds at the other two zoom stops.
const zoom = page.locator(".sch-zoom-slider");
await zoom.fill("2");
await page.waitForTimeout(250);
await shot("schedule-coop-zoom-2x");

await zoom.fill("1");
await page.waitForTimeout(250);

// Open a task detail panel.
const firstTask = page.locator(".sch-block.is-task").first();
if (await firstTask.isVisible().catch(() => false)) {
  await firstTask.click();
  await page.waitForTimeout(300);
  await shot("schedule-step-detail");
}

await pickMode("Versus");
await page.waitForTimeout(600);
await shot("schedule-versus");

await pickMode("Co-op");
await page.waitForTimeout(600);

// --- live cooking, cooperation ---
await click(/Go live/);
await page.waitForTimeout(1500);
await shot("live-coop-start");

// Start and finish a step from the buttons.
const startBtn = page.getByRole("button", { name: /^(Start|Take it)$/ }).first();
if (await startBtn.isVisible().catch(() => false)) {
  await startBtn.click();
  await page.waitForTimeout(1200);
  await shot("live-coop-running");
  await page.getByRole("button", { name: "Done" }).first().click();
  await page.waitForTimeout(1500); // replan runs here
  await shot("live-coop-after-done");
}

// Drive one step by voice instead of tapping.
const cmd = page.locator(".lc-say-input");
if (await cmd.isVisible().catch(() => false)) {
  await cmd.fill("start");
  await page.getByRole("button", { name: "Say it" }).click();
  await page.waitForTimeout(700);
  await cmd.fill("done");
  await page.getByRole("button", { name: "Say it" }).click();
  await page.waitForTimeout(1200);
  await shot("live-coop-voice");

  await cmd.fill("what's next");
  await page.getByRole("button", { name: "Say it" }).click();
  await page.waitForTimeout(600);
  await shot("live-coop-status");
}

// Survive a reload mid-run.
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await shot("live-coop-after-reload");

// --- live cooking, competition ---
await page.goto(`${BASE}/session/schedule`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await shot("schedule-cook-in-progress");
await click(/Abandon this cook/);
await page.waitForTimeout(300);
await shot("schedule-abandon-confirm");
await click(/^Abandon$/);
await page.waitForTimeout(800);
await pickMode("Versus");
await page.waitForTimeout(400);
await click(/Go live/);
await page.waitForTimeout(1500);
await shot("live-comp-start");

// Each tile carries one claim button per cook; the first is cook 1.
const claim = page.locator(".lc-tile.is-claimable .lc-claim").first();
if (await claim.isVisible().catch(() => false)) {
  await claim.click();
  await page.waitForTimeout(800);
  await shot("live-comp-claimed");
  // Same cook tries to grab a second task while still holding one —
  // their button is now disabled, which is the refusal made visible.
  const second = page.locator(".lc-tile.is-claimable .lc-claim").first();
  if (await second.isVisible().catch(() => false)) {
    await second.click({ force: true }).catch(() => {});
    await page.waitForTimeout(700);
    await shot("live-comp-busy-refusal");
  }
  await page.getByRole("button", { name: "Done" }).first().click();
  await page.waitForTimeout(1200);
  await shot("live-comp-scored");
}

// "Call it early" opens a confirm Modal (no browser dialog any more).
await click(/Call it early|Dinner's up/);
await page.waitForTimeout(400);
if (await page.getByRole("button", { name: /^Call it$/ }).isVisible().catch(() => false)) {
  await shot("live-call-it-early");
  await click(/^Call it$/);
}
await page.waitForTimeout(1200);
await shot("live-summary");

// --- summary card ---
await click(/Take the cook card/);
await page.waitForTimeout(1500);
await shot("summary-empty");

// Upload a generated fixture image rather than shipping a binary.
const fixture = path.join(OUT, "fixture-food.png");
const png = await page.evaluate(() => {
  const c = document.createElement("canvas");
  c.width = 900;
  c.height = 600;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 900, 600);
  g.addColorStop(0, "#c0503c");
  g.addColorStop(1, "#e6b35c");
  x.fillStyle = g;
  x.fillRect(0, 0, 900, 600);
  x.fillStyle = "rgba(255,255,255,0.85)";
  x.font = "bold 64px sans-serif";
  x.fillText("dinner", 60, 320);
  return c.toDataURL("image/png").split(",")[1];
});
writeFileSync(fixture, Buffer.from(png, "base64"));
await page.setInputFiles('input[type="file"]', fixture);
await page.waitForTimeout(2500);
await shot("summary-with-photo");

// Back to Home, then re-open the same card from the history list.
await click(/Back to Home/);
await page.waitForTimeout(1200);
await shot("home-with-history");

const historyRow = page.locator(".hp-row-open").first();
if (await historyRow.isVisible().catch(() => false)) {
  await historyRow.click();
  await page.waitForTimeout(1500);
  await shot("summary-reopened");
}

await browser.close();
console.log(`\n${shots.length} screenshots in ${OUT}/`);
