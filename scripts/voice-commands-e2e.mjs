// Browser coverage for the voice command seam:
// fake microphone WAV -> getUserMedia/AudioWorklet -> raw PCM WebSocket ->
// mocked English transcript -> the real VoiceBar matchers and page handlers.
//
// The websocket is mocked so this stays deterministic and needs no API key.
// This verifies browser audio capture and command behavior, not STT accuracy.
// Run npm run dev in another terminal, then:
//
//   npx playwright install chromium  # once per machine
//   npm run test:voice-e2e
//   HEADED=1 npm run test:voice-e2e
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createRun } from "../src/utils/liveCook.js";
import { computeOpeningAssignment } from "../src/utils/scheduleLayout.js";

const BASE = process.env.VOICE_E2E_BASE || "http://127.0.0.1:5173";
const SAMPLE_RATE = 48_000;
const TEMP_DIR = await mkdtemp(path.join(os.tmpdir(), "kitchen-voice-e2e-"));
const WAV_PATH = path.join(TEMP_DIR, "fake-microphone.wav");

function writeFakeAudio(pathname) {
  // A short, non-silent 16-bit PCM tone is enough to prove that captured
  // microphone samples make it through the app's AudioWorklet and socket.
  // The mocked socket supplies the corresponding transcript below.
  const samples = SAMPLE_RATE * 180;
  const dataBytes = samples * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples; i += 1) {
    const envelope = 0.35 + 0.15 * Math.sin((2 * Math.PI * i) / SAMPLE_RATE);
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE) * 6000 * envelope);
    wav.writeInt16LE(sample, 44 + i * 2);
  }
  return writeFile(pathname, wav);
}

const graph = {
  title: "Voice test dinner",
  servings: 2,
  nodes: [{
    id: "dice_onion",
    label: "Dice onion",
    difficulty: "low",
    estimated_duration_sec: 120,
    depends_on: [],
    required_equipment: ["cutting_board"],
    required_materials: [],
    phase: "prep",
  }],
};

const session = {
  id: "voice-command-e2e",
  status: "active",
  kitchenProfileId: "voice-e2e-kitchen",
  conversation: {
    complete: true,
    answers: { dishIdea: ["Dinner"], servings: "2", cooks: "2" },
    transcript: [],
    understanding: {},
    questionIndex: 5,
  },
  recipes: [{ id: "voice-e2e-recipe", draft: graph, working: graph, approved: graph }],
  sharedSteps: [],
  cooks: [
    { id: "voice-e2e-cook-a", name: "Mia", bound: true, avatar: "spoon" },
    { id: "voice-e2e-cook-b", name: "Leo", bound: true, avatar: "whisk" },
  ],
  mode: "cooperation",
  run: null,
  nodePositions: {},
  outMaterialIds: [],
};

const kitchen = {
  id: "voice-e2e-kitchen",
  name: "Voice test kitchen",
  burners: 2,
  stoveBurners: 2,
  cuttingBoards: 2,
  pots: 2,
  hasWok: true,
  hasOven: true,
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const originalSession = clone(session);
const understandingInputs = [];
const voiceFailures = [];
let diagnosticPage = null;

async function mockApi(page, { sessionState = session, kitchenProfiles = [kitchen], hasActiveSession = true } = {}) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/voice/stt-token") {
      return route.fulfill({ json: { token: "voice-e2e-token" } });
    }
    if (url.pathname === "/api/kitchens" && request.method() === "GET") {
      return route.fulfill({ json: clone(kitchenProfiles) });
    }
    if (url.pathname === "/api/kitchens" && request.method() === "POST") {
      const created = { id: "voice-e2e-kitchen-" + kitchenProfiles.length, ...request.postDataJSON() };
      kitchenProfiles.push(created);
      return route.fulfill({ json: created });
    }
    if (url.pathname.startsWith("/api/kitchens/") && request.method() === "PUT") {
      const profileId = url.pathname.split("/").at(-1);
      const profile = kitchenProfiles.find((item) => item.id === profileId) || kitchen;
      Object.assign(profile, request.postDataJSON());
      return route.fulfill({ json: profile });
    }
    if (url.pathname === "/api/materials" && request.method() === "GET") {
      return route.fulfill({ json: [
        { id: "ginger", label: "Ginger", category: "vegetable", amount: 1, unit: "piece" },
        { id: "water", label: "Water", category: "pantry", amount: 2, unit: "cups" },
      ] });
    }
    if (url.pathname === "/api/recipe-templates" && request.method() === "GET") {
      return route.fulfill({ json: [] });
    }
    if (url.pathname === "/api/sessions" && request.method() === "GET") {
      return route.fulfill({
        json: url.searchParams.get("status") === "active" && hasActiveSession ? [clone(sessionState)] : [],
      });
    }
    if (url.pathname === "/api/sessions" && request.method() === "POST") {
      const payload = request.postDataJSON();
      Object.assign(sessionState, {
        ...clone(originalSession),
        id: payload.id,
        kitchenProfileId: payload.kitchenProfileId,
        status: "active",
        recipes: [],
        sharedSteps: [],
        run: null,
      });
      hasActiveSession = true;
      return route.fulfill({ json: clone(sessionState) });
    }
    if (url.pathname === "/api/understanding/read" && request.method() === "POST") {
      const body = request.postDataJSON();
      understandingInputs.push(body.text);
      // A fixed, valid reading keeps this test about dictation delivery and
      // page behavior; generated interpretation is not under test here.
      return route.fulfill({
        json: {
          value: ["ramen"],
          display: "Ramen",
          status: "confirmed",
          followUp: null,
          source: "local",
        },
      });
    }
    if (url.pathname === "/api/sessions/" + sessionState.id && request.method() === "PATCH") {
      Object.assign(sessionState, request.postDataJSON());
      return route.fulfill({ json: clone(sessionState) });
    }
    // Recipes are not patched through the session body — they have their
    // own endpoint (server/routes/sessions.js), and adding a step goes
    // through it. Without this the patch fell into the catch-all below,
    // which answered with the session untouched, so a step added on the
    // board was wiped by the next read and "add it to the board" looked
    // like it had done nothing.
    const recipePatch = url.pathname.match(/^\/api\/sessions\/[^/]+\/recipes\/([^/]+)$/);
    if (recipePatch && request.method() === "PATCH") {
      const recipe = sessionState.recipes.find((r) => r.id === recipePatch[1]);
      if (!recipe) return route.fulfill({ status: 404, json: { error: "recipe instance not found" } });
      const { working, approved, custom_materials } = request.postDataJSON() || {};
      if (working !== undefined) recipe.working = working;
      if (approved !== undefined) recipe.approved = approved;
      if (custom_materials !== undefined) recipe.custom_materials = custom_materials;
      return route.fulfill({ json: clone(recipe) });
    }
    if (url.pathname.startsWith("/api/sessions/")) {
      return route.fulfill({ json: clone(sessionState) });
    }
    return route.fulfill({
      status: 404,
      json: { error: "No voice e2e API mock for " + request.method() + " " + url.pathname },
    });
  });
  // Kokoro's large model is unrelated to input capture or command behavior.
  await page.route(/cdn\.jsdelivr\.net|huggingface\.co/, (route) => route.abort());
}

async function mockStreamingSocket(page) {
  let socket;
  let audioFrames = 0;
  let nonSilentFrames = 0;
  const waiters = [];
  let beginSent = false;

  const notify = () => {
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      const waiter = waiters[i];
      if (audioFrames >= waiter.target && (!waiter.requireSignal || nonSilentFrames > 0)) {
        waiters.splice(i, 1);
        clearTimeout(waiter.timer);
        waiter.resolve();
      }
    }
  };

  await page.routeWebSocket(/^wss:\/\/streaming\.assemblyai\.com\/v3\/ws(?:\?.*)?$/, (route) => {
    socket = route;
    route.onMessage((message) => {
      if (typeof message === "string") return; // UpdateConfiguration, Terminate, etc.
      const pcm = Buffer.from(message);
      audioFrames += 1;
      for (let i = 0; i + 1 < pcm.length; i += 2) {
        if (pcm.readInt16LE(i) !== 0) {
          nonSilentFrames += 1;
          break;
        }
      }
      if (!beginSent) {
        beginSent = true;
        route.send(JSON.stringify({
          type: "Begin",
          id: "voice-e2e-stream",
          configuration: { model: "universal-3-5-pro" },
        }));
      }
      notify();
    });
  });

  const waitForFrame = (target, requireSignal = false) => {
    if (audioFrames >= target && (!requireSignal || nonSilentFrames > 0)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.findIndex((w) => w.resolve === resolve);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error("No microphone PCM frame arrived (got " + audioFrames + ", wanted " + target + ")."));
      }, 10_000);
      waiters.push({ target, requireSignal, resolve, reject, timer });
    });
  };

  return {
    get audioFrames() {
      return audioFrames;
    },
    get nonSilentFrames() {
      return nonSilentFrames;
    },
    async waitForAudio() {
      await waitForFrame(audioFrames + 1);
      if (!nonSilentFrames) await waitForFrame(audioFrames + 1, true);
      assert.ok(nonSilentFrames > 0, "the fake microphone sent non-silent PCM audio");
    },
    async say(text, inspectPartial) {
      assert.ok(socket, "the streaming socket opened after unmuting");
      await waitForFrame(audioFrames + 1);
      assert.ok(audioFrames > 0, "microphone PCM audio reached the socket");
      assert.ok(nonSilentFrames > 0, "non-silent microphone audio reached the socket");
      socket.send(JSON.stringify({ type: "Turn", transcript: text, end_of_turn: false }));
      if (inspectPartial) {
        await page.waitForFunction(
          (expected) => document.querySelector(".goose-bubble-line")?.textContent === expected,
          text,
          { timeout: 5_000 },
        );
      }
      await inspectPartial?.();
      socket.send(JSON.stringify({
        type: "Turn",
        transcript: text,
        end_of_turn: true,
        // The synthetic transcript represents a person speaking before
        // the UI's asynchronous TTS reply begins. E2E coverage asserts
        // command effects, not acoustic echo suppression.
        startedAt: Date.now() - 10_000,
        words: text.split(/\s+/).map((word, i) => ({
          text: word,
          confidence: 0.99,
          start: i * 250,
          end: (i + 1) * 250,
        })),
      }));
      // Let the page's registered handler and React effects settle before
      // the next synthetic turn, as they would between spoken commands.
      await page.waitForTimeout(200);
    },
  };
}

/**
 * Turn the agent's spoken voice off for the run.
 *
 * Every reply the agent says out loud logs a speech span, and a turn
 * whose words were spoken inside one is discarded as the agent hearing
 * itself. That is right in a kitchen and meaningless here, where the
 * transcript is injected rather than heard — it just made whether a
 * command registered depend on how recently the agent had spoken.
 * Silencing it changes nothing the suite asserts: say() still sets the
 * line, so the bubble reads the same.
 */
async function silenceAgent(page) {
  await page.waitForFunction(() => Boolean(window.goose?.setVoiceEnabled));
  await page.evaluate(() => window.goose.setVoiceEnabled(false));
}

// The mic lives in the goose's first egg, which only fans out while the
// goose is hovered — so hover first, then click. The status pill is gone;
// the goose's pose and its bubble tab carry the state instead.
async function unmute(page, stream) {
  await page.locator(".goose-figure").hover();
  await page.locator(".goose-eggs.is-open").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Start listening" }).click();
  await page.getByRole("button", { name: "Mute listening" }).waitFor({ state: "visible" });
  await tagBecomes(page, "Listening");
  await stream.waitForAudio();
}

/**
 * Wait for the goose's status tab to read `tag`.
 *
 * The tab is textContent, not innerText: CSS uppercases it for display,
 * so the DOM still holds "Confirm" where the screen shows "CONFIRM".
 */
function tagBecomes(page, tag, timeout = 5_000) {
  return page.waitForFunction(
    (expected) => document.querySelector(".goose-bubble-tab")?.textContent === expected,
    tag,
    { timeout },
  );
}

async function openVoicePage(browserContext, route, options = {}) {
  const page = await browserContext.newPage();
  page.setDefaultTimeout(3_000);
  await mockApi(page, options);
  const stream = await mockStreamingSocket(page);
  page.on("dialog", (dialog) => dialog.accept());
  page.on("console", (m) => { if (m.text().startsWith("[dbg6]")) console.log("   ", m.text()); });
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  await silenceAgent(page);
  await unmute(page, stream);
  return { page, stream };
}

async function waitForAttribute(locator, name, expected, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await locator.getAttribute(name) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(await locator.getAttribute(name), expected, name + " did not become " + expected);
}

async function waitForInputValue(locator, expected, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await locator.inputValue() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(await locator.inputValue(), expected, "input value did not become " + expected);
}

async function waitForChecked(locator, expected, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await locator.isChecked() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(await locator.isChecked(), expected, "checkbox checked state did not become " + expected);
}

async function waitForObjectValue(object, key, expected, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (object[key] === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(object[key], expected, key + " did not become " + expected);
}

async function waitForPageCondition(page, fn, timeoutMs = 1_500) {
  await page.waitForFunction(fn, undefined, { timeout: timeoutMs });
}

async function settleVoiceCommands(page) {
  // React registers the newly mounted dialog's exclusive command layer in
  // an effect after it paints. Let that effect run before sending the next
  // synthetic turn; the hint itself may still be showing command feedback.
  await page.waitForTimeout(250);
}

async function checkVoiceBehavior(name, fn) {
  try {
    await fn();
    console.log("✔", name);
  } catch (err) {
    voiceFailures.push(name);
    const heard = diagnosticPage
      ? await diagnosticPage.evaluate(() => ({
          label: document.querySelector(".goose-bubble-tab")?.textContent || "",
          text: document.querySelector(".goose-bubble-line")?.textContent || "",
        })).catch(() => null)
      : null;
    console.log(
      "✖", name, "\n   ", err.message.split("\n")[0],
      heard?.text ? `\n    voice feedback: ${heard.label} ${heard.text}` : "",
    );
  }
}

await writeFakeAudio(WAV_PATH);
let browser;
let context;

try {
  browser = await chromium.launch({
    headless: process.env.HEADED !== "1",
    slowMo: process.env.HEADED === "1" ? Number(process.env.SLOWMO || 100) : 0,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--use-file-for-fake-audio-capture=" + WAV_PATH,
    ],
  });
  context = await browser.newContext({ permissions: ["microphone"], reducedMotion: "reduce" });
  const schedulePage = await context.newPage();
  await mockApi(schedulePage);
  const scheduleStream = await mockStreamingSocket(schedulePage);
  await schedulePage.goto(BASE + "/session/schedule", { waitUntil: "networkidle" });
  await silenceAgent(schedulePage);
  await schedulePage.getByRole("slider", { name: "Timeline zoom" }).waitFor({ state: "visible" });
  await unmute(schedulePage, scheduleStream);
  diagnosticPage = schedulePage;

  const zoom = schedulePage.getByRole("slider", { name: "Timeline zoom" });
  assert.equal(await zoom.getAttribute("aria-valuetext"), "1×");
  await scheduleStream.say("zoom in");
  await waitForAttribute(zoom, "aria-valuetext", "115%");
  assert.match(await schedulePage.locator(".goose-bubble-line").innerText(), /Zoom 115%/);

  // Let the page replace its registered command closure after the zoom state
  // update, just as it can while the person listens to the spoken reply.
  await schedulePage.waitForTimeout(200);
  await scheduleStream.say("zoom out");
  await waitForAttribute(zoom, "aria-valuetext", "1×");

  await checkVoiceBehavior("Schedule: voice changes between Versus and Co-op modes", async () => {
    const versus = schedulePage.getByRole("radio", { name: "Versus" });
    const coop = schedulePage.getByRole("radio", { name: "Co-op" });
    await scheduleStream.say("versus");
    await waitForAttribute(versus, "aria-checked", "true");
    await scheduleStream.say("cooperation");
    await waitForAttribute(coop, "aria-checked", "true");
  });
  await checkVoiceBehavior("Schedule: saying a step name opens its timing details", async () => {
    await scheduleStream.say("select the step Dice onion");
    await schedulePage.locator('.sch-detail[aria-label="Dice onion"]').waitFor({ state: "visible" });
  });
  await checkVoiceBehavior("Schedule: ‘close details’ closes the selected step", async () => {
    await scheduleStream.say("close details");
    await schedulePage.locator('.sch-detail[aria-label="Dice onion"]').waitFor({ state: "hidden" });
  });
  await checkVoiceBehavior("Schedule: asking who is free returns the co-op free-time answer", async () => {
    await scheduleStream.say("when am I free");
    await waitForPageCondition(schedulePage, () => /Free stretches|Nobody gets free time/.test(document.querySelector(".goose-bubble-line")?.textContent || ""));
  });
  await checkVoiceBehavior("Schedule: fit voice command selects the fitted timeline", async () => {
    await scheduleStream.say("fit the timeline");
    await waitForAttribute(schedulePage.getByRole("button", { name: "Fit", exact: true }), "aria-pressed", "true");
  });
  await checkVoiceBehavior("Schedule: edit-kitchen voice opens the profile and applies spoken changes", async () => {
    await scheduleStream.say("edit the kitchen");
    const profile = schedulePage.getByRole("dialog", { name: "Edit kitchen" });
    await profile.waitFor({ state: "visible" });
    await scheduleStream.say("four burners");
    await waitForInputValue(profile.locator("#kp-burners"), "4");
    await scheduleStream.say("oven off");
    await waitForChecked(profile.locator("#kp-hasOven"), false);
    await scheduleStream.say("oven on");
    await waitForChecked(profile.locator("#kp-hasOven"), true);
    await scheduleStream.say("cancel");
    await profile.waitFor({ state: "hidden" });
  });

  await scheduleStream.say("go to inventory");
  await schedulePage.waitForURL("**/session/inventory", { timeout: 5_000 });
  await schedulePage.locator(".inventory-page").waitFor({ state: "visible" });
  await schedulePage.close();

  // The Inventory voice checks use a separate unapproved graph with real
  // material references, so the assertions can observe availability and
  // graph changes rather than only hearing a matcher acknowledgement.
  const inventoryGraph = {
    title: "Voice test dinner",
    servings: 2,
    nodes: [
      {
        id: "dice_ginger",
        label: "Dice ginger",
        difficulty: "low",
        estimated_duration_sec: 120,
        depends_on: [],
        required_equipment: ["cutting_board"],
        required_materials: ["ginger"],
        phase: "prep",
      },
      {
        id: "boil_water",
        label: "Boil water",
        difficulty: "medium",
        estimated_duration_sec: 300,
        depends_on: ["dice_ginger"],
        required_equipment: ["stove_burner", "wok"],
        required_materials: ["water"],
        phase: "cook",
      },
      {
        id: "serve_noodles",
        label: "Serve noodles",
        difficulty: "low",
        estimated_duration_sec: 60,
        depends_on: ["boil_water"],
        required_equipment: [],
        required_materials: [],
        phase: "plate",
      },
      {
        id: "toast_sesame",
        label: "Toast sesame",
        difficulty: "low",
        estimated_duration_sec: 120,
        depends_on: [],
        required_equipment: [],
        required_materials: [],
        phase: "prep",
      },
    ],
  };
  kitchen.hasWok = false;
  Object.assign(session, {
    recipes: [{
      id: "voice-e2e-recipe",
      draft: clone(inventoryGraph),
      working: clone(inventoryGraph),
      approved: null,
    }],
    sharedSteps: [],
    outMaterialIds: [],
    nodePositions: {
      dice_ginger: { x: 0, y: 0 },
      boil_water: { x: 1_500, y: 0 },
      serve_noodles: { x: 1_500, y: 1_200 },
      toast_sesame: { x: 0, y: 1_200 },
    },
  });

  const inventoryPage = await context.newPage();
  inventoryPage.setDefaultTimeout(2_000);
  await mockApi(inventoryPage);
  const inventoryStream = await mockStreamingSocket(inventoryPage);
  inventoryPage.on("dialog", (dialog) => dialog.accept());
  inventoryPage.on("console", (m) => { if (m.text().startsWith("[dbg6]")) console.log("   ", m.text()); });
  await inventoryPage.goto(BASE + "/session/inventory", { waitUntil: "networkidle" });
  await silenceAgent(inventoryPage);
  await inventoryPage.getByRole("tab", { name: /Ingredients/ }).waitFor({ state: "visible" });
  await unmute(inventoryPage, inventoryStream);
  diagnosticPage = inventoryPage;
  await settleVoiceCommands(inventoryPage);

  // Scope each checkbox to its own row, taking the first match: an
  // expanded row lists the steps that use the ingredient, so a bare
  // hasText matches "Ginger" inside the Water row once a step named
  // "Mince ginger" is showing, and the locator stops being unique.
  // Only one tabpanel is mounted at a time, so the recipe board simply
  // does not exist in the DOM while the ingredient list is showing.
  // Anything asserted about a step has to be looked at from that tab.
  const ingredientTab = inventoryPage.getByRole("tab", { name: /Ingredients/ });
  const recipeTab = inventoryPage.getByRole("tab", { name: /Recipe graph/ });
  const onTheBoard = async (assertion) => {
    await recipeTab.click({ force: true });
    try {
      await assertion();
    } finally {
      await ingredientTab.click({ force: true });
    }
  };

  const ginger = inventoryPage.locator(".inv-row", { hasText: "Ginger" }).first().getByRole("checkbox").first();
  const water = inventoryPage.locator(".inv-row", { hasText: "Water" }).first().getByRole("checkbox").first();
  await checkVoiceBehavior("Inventory: ‘no ginger’ marks ginger out and blocks the step that needs it", async () => {
    await inventoryStream.say("no ginger");
    await waitForAttribute(ginger, "aria-checked", "false", 1_500);
    await onTheBoard(() =>
      inventoryPage.getByRole("button", { name: /Dice ginger, blocked/ }).waitFor({ state: "visible" }));
  });
  await checkVoiceBehavior("Inventory: ‘got ginger’ restores an out ingredient", async () => {
    // Put it out by the visible control first so this checks the voice action.
    if (await ginger.getAttribute("aria-checked") === "true") await ginger.click({ force: true });
    await waitForAttribute(ginger, "aria-checked", "false");
    await inventoryStream.say("got ginger");
    await waitForAttribute(ginger, "aria-checked", "true", 1_500);
  });
  await checkVoiceBehavior("Inventory: ‘no water’ marks water out and updates the dependent graph", async () => {
    await inventoryStream.say("no water");
    await waitForAttribute(water, "aria-checked", "false", 1_500);
    await onTheBoard(() =>
      inventoryPage.getByRole("button", { name: /Boil water, blocked/ }).waitFor({ state: "visible" }));
  });
  await checkVoiceBehavior("Inventory: ‘everything’s on hand’ clears all out ingredients", async () => {
    if (await ginger.getAttribute("aria-checked") === "true") await ginger.click({ force: true });
    if (await water.getAttribute("aria-checked") === "true") await water.click({ force: true });
    await waitForAttribute(ginger, "aria-checked", "false");
    await waitForAttribute(water, "aria-checked", "false");
    await inventoryStream.say("everything's on hand");
    await waitForAttribute(ginger, "aria-checked", "true", 1_500);
    await waitForAttribute(water, "aria-checked", "true", 1_500);
  });
  // Housekeeping between checks, not an assertion — put both ingredients
  // back on hand for what follows. Toggling one regroups the list, so the
  // row can be mid-rerender here; a failure to find it must not take the
  // rest of the suite down with it.
  for (const checkbox of [ginger, water]) {
    try {
      if (await checkbox.getAttribute("aria-checked", { timeout: 2_000 }) === "false") {
        await checkbox.click({ force: true, timeout: 2_000 });
      }
    } catch {
      /* left as it is; the checks that care assert their own state */
    }
  }

  await checkVoiceBehavior("Inventory: equipment notice opens the kitchen editor and ‘cook it anyway’ dismisses it", async () => {
    await inventoryStream.say("edit the kitchen profile");
    const profile = inventoryPage.getByRole("dialog", { name: "Edit kitchen" });
    await profile.waitFor({ state: "visible" });
    await inventoryStream.say("four burners");
    await waitForInputValue(profile.locator("#kp-burners"), "4");
    await inventoryStream.say("wok on");
    await waitForChecked(profile.locator("#kp-hasWok"), true);
    await inventoryStream.say("cancel");
    await profile.waitFor({ state: "hidden" });
    await inventoryStream.say("cook it anyway");
    await inventoryPage.getByRole("note").waitFor({ state: "hidden" });
  });

  await checkVoiceBehavior("Inventory: ingredient and recipe graph commands switch the selected tab", async () => {
    await inventoryStream.say("show the recipe graph");
    await waitForAttribute(inventoryPage.getByRole("tab", { name: /Recipe graph/ }), "aria-selected", "true");
    await inventoryStream.say("show ingredients");
    await waitForAttribute(inventoryPage.getByRole("tab", { name: /Ingredients/ }), "aria-selected", "true");
  });
  const boardZoom = inventoryPage.getByRole("slider", { name: "Zoom" });
  await checkVoiceBehavior("Inventory: ‘zoom in’ increases the board zoom", async () => {
    await inventoryStream.say("show the recipe graph");
    await boardZoom.waitFor({ state: "visible" });
    await boardZoom.focus();
    await boardZoom.press("Home");
    await waitForInputValue(boardZoom, "0");
    await inventoryPage.waitForTimeout(200);
    await inventoryStream.say("zoom in");
    await waitForInputValue(boardZoom, "5");
  });
  await checkVoiceBehavior("Inventory: ‘zoom out’ decreases the board zoom", async () => {
    await boardZoom.focus();
    await boardZoom.press("End");
    await waitForInputValue(boardZoom, "100");
    await inventoryPage.waitForTimeout(200);
    await inventoryStream.say("zoom out");
    await waitForInputValue(boardZoom, "95");
  });
  await checkVoiceBehavior("Inventory: ‘zoom closer’ increases the board zoom", async () => {
    await boardZoom.focus();
    await boardZoom.press("Home");
    await waitForInputValue(boardZoom, "0");
    await inventoryPage.waitForTimeout(200);
    await inventoryStream.say("zoom closer");
    await waitForInputValue(boardZoom, "5");
  });
  await checkVoiceBehavior("Inventory: ‘fit the board’ resets the board zoom", async () => {
    await boardZoom.focus();
    await boardZoom.press("End");
    await waitForInputValue(boardZoom, "100");
    await inventoryPage.waitForTimeout(200);
    await inventoryStream.say("fit the board");
    await waitForInputValue(boardZoom, "0");
  });
  const boardScroll = inventoryPage.locator(".board-scroll");
  await boardZoom.focus();
  await boardZoom.press("End");
  await waitForInputValue(boardZoom, "100");
  await inventoryPage.waitForTimeout(200);
  const overflow = await boardScroll.evaluate((el) => ({
    x: el.scrollWidth - el.clientWidth,
    y: el.scrollHeight - el.clientHeight,
  }));
  assert.ok(overflow.x > 0 && overflow.y > 0, "the fixture board can scroll in both axes");
  await checkVoiceBehavior("Inventory: ‘pan right’ moves the recipe board horizontally", async () => {
    await boardScroll.evaluate((el) => { el.scrollLeft = 0; });
    await inventoryStream.say("pan right");
    await waitForPageCondition(inventoryPage, () => document.querySelector(".board-scroll")?.scrollLeft > 0);
  });
  await checkVoiceBehavior("Inventory: ‘pan left’ moves the recipe board back", async () => {
    await boardScroll.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    const before = await boardScroll.evaluate((el) => el.scrollLeft);
    await inventoryStream.say("pan left");
    await inventoryPage.waitForFunction((value) => document.querySelector(".board-scroll")?.scrollLeft < value, before, { timeout: 1_500 });
  });
  await checkVoiceBehavior("Inventory: ‘scroll down’ moves the recipe board vertically", async () => {
    await boardScroll.evaluate((el) => { el.scrollTop = 0; });
    await inventoryStream.say("scroll down");
    await waitForPageCondition(inventoryPage, () => document.querySelector(".board-scroll")?.scrollTop > 0);
  });
  await checkVoiceBehavior("Inventory: ‘scroll up’ moves the recipe board back", async () => {
    await boardScroll.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const before = await boardScroll.evaluate((el) => el.scrollTop);
    await inventoryStream.say("scroll up");
    await inventoryPage.waitForFunction((value) => document.querySelector(".board-scroll")?.scrollTop < value, before, { timeout: 1_500 });
  });
  await checkVoiceBehavior("Inventory: find and edit by step name open and locate the intended step", async () => {
    await inventoryStream.say("find the step Boil water");
    await inventoryPage.getByRole("button", { name: /Boil water/ }).waitFor({ state: "visible" });
    await inventoryStream.say("edit the step Toast sesame");
    await inventoryPage.getByRole("dialog", { name: "Edit step" }).waitFor({ state: "visible" });
  });
  // The Add task command itself is tested separately from the dialog
  // fields. If it fails, click the same visible button so the remaining
  // dialog scenarios still report their own results.
  await checkVoiceBehavior("Inventory: ‘add a task’ opens the task form", async () => {
    await inventoryPage.getByRole("dialog", { name: "Edit step" }).getByRole("button", { name: "Close panel" }).evaluate((el) => el.click());
    await inventoryStream.say("add a task");
    await inventoryPage.getByRole("dialog", { name: "Add a task" }).waitFor({ state: "visible", timeout: 1_500 });
  });
  if (await inventoryPage.getByRole("dialog", { name: "Add a task" }).count() === 0) {
    const graphTab = inventoryPage.getByRole("tab", { name: /Recipe graph/ });
    if (await graphTab.getAttribute("aria-selected") !== "true") await graphTab.evaluate((el) => el.click());
    await inventoryPage.getByRole("button", { name: "Add a task" }).evaluate((el) => el.click());
    await inventoryPage.getByRole("dialog", { name: "Add a task" }).waitFor({ state: "visible" });
  }
  await settleVoiceCommands(inventoryPage);
  const addTaskForm = inventoryPage.getByRole("dialog", { name: "Add a task" });
  const addTaskName = addTaskForm.locator('input[placeholder="e.g. Toast the sesame seeds"]');
  const addTaskAfter = addTaskForm.locator(".panel-field").filter({ hasText: "Runs after" });
  const addTaskBefore = addTaskForm.locator(".panel-field").filter({ hasText: "Runs before" });
  await checkVoiceBehavior("Add Task dialog: ‘call it’ fills the task name", async () => {
    await inventoryStream.say("call it Toast sesame seeds");
    await waitForInputValue(addTaskName, "Toast sesame seeds");
  });
  await checkVoiceBehavior("Add Task dialog: duration speech changes minutes", async () => {
    await inventoryStream.say("set duration to three minutes");
    await waitForInputValue(addTaskForm.locator('input[type="number"]'), "3");
  });
  await checkVoiceBehavior("Add Task dialog: difficulty speech selects High", async () => {
    await inventoryStream.say("set difficulty to high");
    await waitForAttribute(addTaskForm.getByRole("radio", { name: "High" }), "aria-checked", "true");
  });
  await checkVoiceBehavior("Add Task dialog: phase speech selects Cook", async () => {
    await inventoryStream.say("set phase to cook");
    await waitForAttribute(addTaskForm.getByRole("radio", { name: "Cook" }), "aria-checked", "true");
  });
  await checkVoiceBehavior("Add Task dialog: equipment speech adds a wok", async () => {
    await inventoryStream.say("add a wok");
    await waitForAttribute(addTaskForm.getByRole("button", { name: "Wok" }), "aria-pressed", "true");
  });
  await checkVoiceBehavior("Add Task dialog: ‘runs after’ selects the prerequisite step", async () => {
    await inventoryStream.say("runs after Dice ginger");
    await waitForAttribute(addTaskAfter.getByRole("button", { name: /Dice ginger/ }), "aria-pressed", "true");
  });
  await checkVoiceBehavior("Add Task dialog: ‘runs before’ selects the following step", async () => {
    await inventoryStream.say("runs before Boil water");
    await waitForAttribute(addTaskBefore.getByRole("button", { name: /Boil water/ }), "aria-pressed", "true");
  });
  if (await addTaskForm.count()) {
    if (!(await addTaskName.inputValue())) await addTaskName.fill("Toast sesame seeds");
  }
  await checkVoiceBehavior("Add Task dialog: submit adds a visible step with the spoken name", async () => {
    const previousCount = await inventoryPage.locator(".board-card").count();
    await inventoryStream.say("add it to the board");
    await inventoryPage.waitForFunction((count) => document.querySelectorAll(".board-card").length > count, previousCount, { timeout: 1_500 });
    await inventoryPage.locator(".board-card-label", { hasText: "Toast sesame seeds" }).waitFor({ state: "visible" });
    await inventoryPage.getByRole("dialog", { name: "Edit step" }).waitFor({ state: "visible", timeout: 1_500 });
  });
  if (await inventoryPage.getByRole("dialog", { name: "Add a task" }).count()) {
    await inventoryPage.getByRole("dialog", { name: "Add a task" }).getByRole("button", { name: "Add to the board" }).evaluate((el) => el.click());
  }
  if (!(await inventoryPage.getByRole("dialog", { name: "Edit step" }).count())) {
    const taskName = inventoryPage.locator('input[placeholder="e.g. Toast the sesame seeds"]');
    if (await taskName.count()) await taskName.fill("Toast sesame seeds");
    const submit = inventoryPage.getByRole("button", { name: "Add to the board" });
    if (await submit.count()) await submit.evaluate((el) => el.click());
  }
  const stepEditor = inventoryPage.getByRole("dialog", { name: "Edit step" });
  if (await stepEditor.count()) await stepEditor.getByRole("button", { name: "Close panel" }).evaluate((el) => el.click());

  await checkVoiceBehavior("Edit Step dialog: rename speech updates the draft label", async () => {
    await inventoryStream.say("open the step Toast sesame");
    const editor = inventoryPage.getByRole("dialog", { name: "Edit step" });
    await editor.waitFor({ state: "visible" });
    await settleVoiceCommands(inventoryPage);
    await inventoryStream.say("rename it Toast seeds");
    await waitForInputValue(editor.locator("input.panel-input").first(), "Toast seeds");
  });
  const editStepForm = inventoryPage.getByRole("dialog", { name: "Edit step" });
  const editStepAfter = editStepForm.locator(".panel-field").filter({ hasText: "Runs after" });
  await checkVoiceBehavior("Edit Step dialog: duration speech updates minutes", async () => {
    const editor = editStepForm;
    await inventoryStream.say("make it four minutes");
    await waitForInputValue(editor.locator('input[type="number"]'), "4");
  });
  await checkVoiceBehavior("Edit Step dialog: difficulty speech selects Medium", async () => {
    const editor = editStepForm;
    await inventoryStream.say("make it medium difficulty");
    await waitForAttribute(editor.getByRole("radio", { name: "Med" }), "aria-checked", "true");
  });
  await checkVoiceBehavior("Edit Step dialog: phase speech selects Plate", async () => {
    const editor = editStepForm;
    await inventoryStream.say("mark it as plate");
    await waitForAttribute(editor.getByRole("radio", { name: "Plate" }), "aria-checked", "true");
  });
  await checkVoiceBehavior("Edit Step dialog: equipment speech adds a cutting board", async () => {
    const editor = editStepForm;
    await inventoryStream.say("add a cutting board");
    await waitForAttribute(editor.getByRole("button", { name: /Cutting board/ }), "aria-pressed", "true");
  });
  await checkVoiceBehavior("Edit Step dialog: ‘runs after’ adds the selected dependency", async () => {
    await inventoryStream.say("runs after Dice ginger");
    await waitForAttribute(editStepAfter.getByRole("button", { name: /Dice ginger/ }), "aria-pressed", "true");
  });
  await checkVoiceBehavior("Edit Step dialog: ‘stop waiting on’ removes the dependency", async () => {
    await inventoryStream.say("stop waiting on Dice ginger");
    await waitForAttribute(editStepAfter.getByRole("button", { name: /Dice ginger/ }), "aria-pressed", "false");
  });
  const editedLabel = editStepForm.locator("input.panel-input").first();
  if (await editedLabel.count() && await editedLabel.inputValue() !== "Toast seeds") await editedLabel.fill("Toast seeds");
  await checkVoiceBehavior("Edit Step dialog: save commits the edited name and closes the editor", async () => {
    await inventoryStream.say("save the step");
    await inventoryPage.getByRole("dialog", { name: "Edit step" }).waitFor({ state: "hidden", timeout: 1_500 });
    await inventoryPage.locator(".board-card-label", { hasText: "Toast seeds" }).waitFor({ state: "visible", timeout: 1_500 });
  });
  if (await inventoryPage.getByRole("dialog", { name: "Edit step" }).count()) {
    await inventoryPage.getByRole("dialog", { name: "Edit step" }).getByRole("button", { name: "Save" }).evaluate((el) => el.click());
  }
  await checkVoiceBehavior("Edit Step dialog: ‘cancel’ closes the editor", async () => {
    // Reopen it the way the suite opens it everywhere else. Clicking a
    // board card only selects the step; "open the step" is what puts the
    // editor up, and this check is about cancel, not about how it opened.
    if (!(await inventoryPage.getByRole("dialog", { name: "Edit step" }).count())) {
      await inventoryPage.locator(".board-card-label", { hasText: "Toast seeds" }).first().waitFor({ state: "visible" });
      await inventoryStream.say("open the step Toast seeds");
    }
    const editor = inventoryPage.getByRole("dialog", { name: "Edit step" });
    await editor.waitFor({ state: "visible" });
    await settleVoiceCommands(inventoryPage);
    await inventoryStream.say("cancel");
    await editor.waitFor({ state: "hidden" });
  });
  if (await inventoryPage.getByRole("dialog", { name: "Edit step" }).count()) {
    await inventoryPage.getByRole("dialog", { name: "Edit step" }).getByRole("button", { name: "Close panel" }).evaluate((el) => el.click());
  }
  await checkVoiceBehavior("Add Task dialog: ‘cancel’ closes the form", async () => {
    const addButton = inventoryPage.getByRole("button", { name: "Add a task" });
    await addButton.evaluate((el) => el.click());
    const form = inventoryPage.getByRole("dialog", { name: "Add a task" });
    await form.waitFor({ state: "visible" });
    await settleVoiceCommands(inventoryPage);
    await inventoryStream.say("cancel");
    await form.waitFor({ state: "hidden" });
  });
  if (await inventoryPage.getByRole("dialog", { name: "Add a task" }).count()) {
    await inventoryPage.getByRole("dialog", { name: "Add a task" }).getByRole("button", { name: "Cancel" }).evaluate((el) => el.click());
  }
  if (!(await inventoryPage.getByRole("dialog", { name: "Edit step" }).count())) {
    const target = inventoryPage.getByRole("button", { name: /Boil water/ }).first();
    if (await target.count()) await target.evaluate((el) => el.click());
  }
  await checkVoiceBehavior("Delete Step dialog: choose/drop-link commands change dependency handling and remove the step", async () => {
    await inventoryStream.say("edit the step Boil water");
    const editor = inventoryPage.getByRole("dialog", { name: "Edit step" });
    await editor.waitFor({ state: "visible" });
    await inventoryStream.say("delete this step");
    await inventoryPage.getByText(/Delete this step\?/).waitFor({ state: "visible", timeout: 1_500 });
    await inventoryStream.say("yes");
    const deleteDialog = inventoryPage.getByRole("dialog", { name: "Remove step" });
    await deleteDialog.waitFor({ state: "visible" });
    await settleVoiceCommands(inventoryPage);
    await inventoryStream.say("inherit");
    await waitForPageCondition(inventoryPage, () => document.querySelector(".delete-step-mode.is-on strong")?.textContent.includes("Move them to what this step was waiting on"));
    await inventoryStream.say("choose for each");
    await waitForPageCondition(inventoryPage, () => document.querySelector(".delete-step-mode.is-on")?.textContent.includes("Choose for each"));
    await inventoryStream.say("just drop the link");
    await waitForPageCondition(inventoryPage, () => document.querySelector(".delete-step-mode.is-on")?.textContent.includes("Just drop the link"));
    await inventoryStream.say("remove the step");
    await inventoryPage.getByRole("button", { name: /Boil water/ }).waitFor({ state: "hidden" });
  });

  await settleVoiceCommands(inventoryPage);
  await checkVoiceBehavior("Inventory: approve asks for confirmation and locks the board", async () => {
    await inventoryStream.say("approve");
    await inventoryPage.getByText(/Approve the board and move to scheduling/).waitFor({ state: "visible", timeout: 1_500 });
    await inventoryStream.say("yes");
    // The word "Approved" is on the page three times over once the board
    // locks — the panel's own title, the diff summary under it, and the
    // tab hint. The panel appearing is the thing being asserted.
    await inventoryPage.locator(".approved-panel").waitFor({ state: "visible" });
  });
  // Revise is meaningful only after approval. A mouse approval keeps that
  // assertion independent from the voice-approval scenario above.
  if (await ingredientTab.getAttribute("aria-selected") !== "true") await ingredientTab.click({ force: true });
  if (await ginger.count() && await ginger.getAttribute("aria-checked") === "false") await ginger.click({ force: true });
  if (await recipeTab.getAttribute("aria-selected") !== "true") await recipeTab.click({ force: true });
  const approveButton = inventoryPage.getByRole("button", { name: /Approve the plan/ });
  if (await approveButton.count()) {
    await approveButton.evaluate((el) => el.click());
    await inventoryPage.waitForTimeout(250);
  }
  await checkVoiceBehavior("Inventory: revise returns an approved board to editing", async () => {
    await inventoryStream.say("revise");
    await inventoryPage.getByRole("button", { name: "Add a task" }).waitFor({ state: "visible" });
  });
  if (!(await inventoryPage.getByRole("button", { name: "Add a task" }).count())) {
    const reviseButton = inventoryPage.getByRole("button", { name: /Revise/ });
    if (await reviseButton.count()) await reviseButton.click({ force: true });
  }
  await checkVoiceBehavior("Inventory: removing blocked steps confirms, then removes the unavailable dependency chain", async () => {
    if (await ingredientTab.getAttribute("aria-selected") !== "true") await ingredientTab.click({ force: true });
    if (await ginger.count() && await ginger.getAttribute("aria-checked") === "true") await ginger.evaluate((el) => el.click());
    await waitForAttribute(ginger, "aria-checked", "false");
    if (await recipeTab.getAttribute("aria-selected") !== "true") await recipeTab.click({ force: true });
    await inventoryStream.say("remove the blocked steps");
    await waitForPageCondition(inventoryPage, () => document.querySelector(".goose-bubble-tab")?.textContent === "Confirm");
    await inventoryStream.say("yes");
    await inventoryPage.getByRole("button", { name: /Dice ginger/ }).waitFor({ state: "hidden", timeout: 1_500 });
  });

  // Last, because it leaves the page: approving is the end of this step,
  // and the command under test is the one that walks out of it.
  await checkVoiceBehavior("Inventory: ‘continue to schedule’ moves on to the cooks", async () => {
    const approveButton = inventoryPage.getByRole("button", { name: /Approve the plan/ });
    if (await approveButton.count()) await approveButton.evaluate((el) => el.click());
    await inventoryPage.locator(".approved-panel").waitFor({ state: "visible" });
    await settleVoiceCommands(inventoryPage);
    await inventoryStream.say("continue to schedule");
    await inventoryPage.waitForURL(/session[/]voice-binding$/, { timeout: 3_000 });
  });
  await inventoryPage.close();
  kitchen.hasWok = true;

  // Rehydrate a fresh in-progress conversation so the second browser page
  // exercises dictation instead of the completed-conversation screen.
  Object.assign(session, {
    conversation: {
      complete: false,
      answers: { cooks: "2" },
      transcript: [],
      understanding: {},
      questionIndex: 0,
    },
    recipes: [],
    sharedSteps: [],
    mode: null,
  });

  const conversationPage = await context.newPage();
  await mockApi(conversationPage);
  const conversationStream = await mockStreamingSocket(conversationPage);
  await conversationPage.goto(BASE + "/session/conversation", { waitUntil: "networkidle" });
  diagnosticPage = conversationPage;
  const answer = conversationPage.locator(".answer-input");
  await answer.waitFor({ state: "visible" });
  await unmute(conversationPage, conversationStream);

  const spokenAnswer = "ramen";
  const progress = conversationPage.getByRole("progressbar", { name: "Questions answered" });
  assert.equal(await progress.getAttribute("aria-valuenow"), "0");
  const understandingRequest = conversationPage.waitForRequest(
    (request) => request.url().endsWith("/api/understanding/read"),
    { timeout: 5_000 },
  );
  await conversationStream.say(spokenAnswer, async () => {
    assert.equal(await answer.inputValue(), spokenAnswer, "the dictation input shows the partial before turn end");
  });
  await understandingRequest;
  await waitForAttribute(progress, "aria-valuenow", "1");
  assert.deepEqual(understandingInputs, [spokenAnswer]);
  assert.match(await conversationPage.getByRole("log").innerText(), /ramen/);

  await checkVoiceBehavior("Conversation: a named destination navigates instead of entering the answer", async () => {
    await conversationStream.say("go to home");
    await conversationPage.waitForURL("**/", { timeout: 3_000 });
  });
  await conversationPage.close();

  const completedConversation = await openVoicePage(context, "/session/conversation", {
    sessionState: clone(originalSession),
  });
  await checkVoiceBehavior("Conversation: ‘continue to inventory’ advances after the final answer", async () => {
    await completedConversation.stream.say("continue to inventory");
    await completedConversation.page.waitForURL("**/session/inventory", { timeout: 3_000 });
  });
  await completedConversation.page.close();

  // Home and Kitchen Profile use a separate copy of the session fixture so
  // these scenarios can change profiles and routes without affecting the
  // Inventory, Schedule, or conversation assertions above.
  const homeFixture = clone(originalSession);
  homeFixture.conversation.complete = false;
  homeFixture.recipes = [];
  homeFixture.sharedSteps = [];
  const homeProfiles = [clone(kitchen)];
  const home = await openVoicePage(context, "/", {
    sessionState: homeFixture,
    kitchenProfiles: homeProfiles,
  });
  const homePage = home.page;
  const homeStream = home.stream;
  diagnosticPage = homePage;
  await checkVoiceBehavior("Home: ‘add a kitchen’ opens the Add Kitchen dialog", async () => {
    await homeStream.say("add a kitchen");
    await homePage.getByRole("dialog", { name: "Add a kitchen" }).waitFor({ state: "visible" });
  });
  if (!(await homePage.getByRole("dialog", { name: "Add a kitchen" }).count())) {
    await homePage.getByRole("button", { name: "Add kitchen", exact: true }).click({ force: true });
  }
  const addKitchenDialog = homePage.getByRole("dialog", { name: "Add a kitchen" });
  await settleVoiceCommands(homePage);
  await checkVoiceBehavior("Kitchen Profile: spoken name updates the kitchen draft", async () => {
    await homeStream.say("call it Test Annex");
    await waitForInputValue(addKitchenDialog.locator("#kp-name"), "Test Annex");
  });
  const kitchenNameDraft = addKitchenDialog.locator("#kp-name");
  if (await kitchenNameDraft.inputValue() !== "Test Annex") await kitchenNameDraft.fill("Test Annex");
  await checkVoiceBehavior("Kitchen Profile: spoken burner count updates the numeric field", async () => {
    await homeStream.say("four burners");
    await waitForInputValue(addKitchenDialog.locator("#kp-burners"), "4");
  });
  await checkVoiceBehavior("Kitchen Profile: equipment speech turns the oven on", async () => {
    await homeStream.say("add an oven");
    await waitForChecked(addKitchenDialog.locator("#kp-hasOven"), true);
  });
  await checkVoiceBehavior("Kitchen Profile: save creates the configured kitchen", async () => {
    await homeStream.say("save the kitchen");
    await addKitchenDialog.waitFor({ state: "hidden" });
    const created = homeProfiles.find((profile) => profile.name === "Test Annex");
    assert.ok(created, "the new kitchen was persisted through the mocked API");
    assert.equal(created.burners, 4);
    assert.equal(created.hasOven, true);
  });
  await checkVoiceBehavior("Kitchen Profile: ‘cancel’ closes a second unsaved kitchen form", async () => {
    await homeStream.say("add another kitchen");
    const form = homePage.getByRole("dialog", { name: "Add a kitchen" });
    await form.waitFor({ state: "visible" });
    await settleVoiceCommands(homePage);
    await homeStream.say("cancel");
    await form.waitFor({ state: "hidden" });
  });
  if (await homePage.getByRole("dialog", { name: "Add a kitchen" }).count()) {
    await homePage.getByRole("dialog", { name: "Add a kitchen" }).getByRole("button", { name: "Cancel" }).evaluate((el) => el.click());
  }
  await checkVoiceBehavior("Home: ‘help’ shows usable voice guidance", async () => {
    await homeStream.say("help");
    await waitForPageCondition(homePage, () => /Try:/.test(document.querySelector(".goose-bubble-line")?.textContent || ""));
  });
  await checkVoiceBehavior("Home: abandon requires its exact passphrase; ‘yes’ leaves the run active", async () => {
    await homeStream.say("abandon the run");
    await waitForPageCondition(homePage, () => document.querySelector(".goose-bubble-tab")?.textContent === "Confirm");
    assert.match(await homePage.locator(".goose-bubble-line").innerText(), /I want to abort this cooking session/);
    await homeStream.say("yes");
    await homePage.getByRole("button", { name: "Resume the run" }).waitFor({ state: "visible" });
    assert.equal(homeFixture.status, "active");
  });
  await checkVoiceBehavior("Home: ‘resume the run’ returns to the current session stage", async () => {
    await homeStream.say("resume the run");
    await homePage.waitForURL("**/session/conversation", { timeout: 3_000 });
  });
  await checkVoiceBehavior("Home: the exact abandon passphrase abandons the run", async () => {
    await homeStream.say("go to home");
    await homePage.waitForURL("**/", { timeout: 3_000 });
    await homeStream.say("abandon the run");
    await waitForPageCondition(homePage, () => document.querySelector(".goose-bubble-tab")?.textContent === "Confirm");
    await homeStream.say("I want to abort this cooking session");
    await waitForObjectValue(homeFixture, "status", "abandoned");
    await homePage.getByRole("button", { name: "Start the run" }).waitFor({ state: "visible" });
  });
  await homePage.close();

  // With no active session, two kitchens make the spoken Start command ask
  // which kitchen. A word shared by both names is deliberately ambiguous;
  // a distinctive word must pick the corresponding kitchen.
  const pickerFixture = clone(originalSession);
  const pickerProfiles = [
    { ...clone(kitchen), id: "harbour-flat", name: "Harbour Flat" },
    { ...clone(kitchen), id: "harbour-loft", name: "Harbour Loft" },
  ];
  const picker = await openVoicePage(context, "/", {
    sessionState: pickerFixture,
    kitchenProfiles: pickerProfiles,
    hasActiveSession: false,
  });
  diagnosticPage = picker.page;
  await checkVoiceBehavior("Home: ‘start the run’ opens the kitchen picker when profiles are ambiguous", async () => {
    await picker.stream.say("start the run");
    await picker.page.locator(".hp-hero-state").getByRole("button", { name: "Harbour Flat", exact: true }).waitFor({ state: "visible" });
  });
  if (!(await picker.page.getByText("Which kitchen?", { exact: true }).count())) {
    await picker.page.getByRole("button", { name: "Start the run" }).click({ force: true });
  }
  await checkVoiceBehavior("Kitchen picker: a shared name word selects neither kitchen", async () => {
    await picker.stream.say("Harbour");
    assert.equal(new URL(picker.page.url()).pathname, "/");
    assert.equal(pickerFixture.kitchenProfileId, originalSession.kitchenProfileId);
  });
  await checkVoiceBehavior("Kitchen picker: a distinctive kitchen word starts the run there", async () => {
    await picker.stream.say("Flat");
    await picker.page.waitForURL("**/session/conversation", { timeout: 3_000 });
    assert.equal(pickerFixture.kitchenProfileId, "harbour-flat");
  });
  await picker.page.close();

  // A kitchen deleted during a session routes to this recovery page. The
  // spoken unique word must set the chosen profile before continuing.
  const repairFixture = clone(originalSession);
  repairFixture.kitchenProfileId = null;
  repairFixture.conversation.complete = false;
  repairFixture.recipes = [];
  const repairProfiles = [
    { ...clone(kitchen), id: "repair-flat", name: "Harbour Flat" },
    { ...clone(kitchen), id: "repair-loft", name: "Harbour Loft" },
  ];
  const repair = await openVoicePage(context, "/session/kitchen-setup", {
    sessionState: repairFixture,
    kitchenProfiles: repairProfiles,
  });
  diagnosticPage = repair.page;
  await checkVoiceBehavior("Kitchen Setup: a shared kitchen word is rejected as ambiguous", async () => {
    await repair.stream.say("Harbour");
    assert.equal(new URL(repair.page.url()).pathname, "/session/kitchen-setup");
    assert.equal(repairFixture.kitchenProfileId, null);
  });
  await checkVoiceBehavior("Kitchen Setup: a distinctive kitchen word selects that profile", async () => {
    await repair.stream.say("Loft");
    await repair.page.waitForURL("**/session/conversation", { timeout: 3_000 });
    await waitForObjectValue(repairFixture, "kitchenProfileId", "repair-loft");
    assert.equal(repairFixture.kitchenProfileId, "repair-loft");
  });
  await repair.page.close();

  // Voice Binding exercises page actions and its higher-priority picker and
  // recording layers. Rename, add, avatar selection, confirmation, and
  // recording cancellation each assert the rendered result.
  const bindingFixture = clone(originalSession);
  bindingFixture.cooks = [{ id: "binding-mia", name: "Mia", bound: true, avatar: "spoon" }];
  const binding = await openVoicePage(context, "/session/voice-binding", { sessionState: bindingFixture });
  const bindingPage = binding.page;
  const bindingStream = binding.stream;
  diagnosticPage = bindingPage;
  await checkVoiceBehavior("Voice Binding: ‘add a cook’ creates the second slot", async () => {
    await bindingStream.say("add another cook");
    await bindingPage.locator(".cook-slot").nth(1).waitFor({ state: "visible" });
  });
  if (await bindingPage.locator(".cook-slot").count() < 2) {
    await bindingPage.getByRole("button", { name: /Add another cook|Add a cook/ }).click({ force: true });
  }
  await checkVoiceBehavior("Voice Binding: ordinal voice command names the second cook", async () => {
    await bindingStream.say("call the second cook Leo");
    await waitForInputValue(bindingPage.locator(".cook-name-input").nth(1), "Leo");
  });
  await checkVoiceBehavior("Voice Binding: spoken avatar selection commits the selected chef", async () => {
    await bindingStream.say("choose avatar for Leo");
    const drawer = bindingPage.locator(".cook-drawer");
    await drawer.waitFor({ state: "visible" });
    await bindingStream.say("Tomato");
    await waitForPageCondition(bindingPage, () => document.querySelector(".cook-drawer .chef-tile.is-selected .chef-tile-name")?.textContent === "Tomato");
    await bindingStream.say("that's me");
    await drawer.waitFor({ state: "hidden" });
    await bindingPage.locator(".cook-lane-chip").filter({ hasText: "Chef Tomato" }).waitFor({ state: "visible" });
  });
  await checkVoiceBehavior("Voice Binding: avatar-picker ‘cancel’ keeps the current chef", async () => {
    await bindingStream.say("choose avatar for Mia");
    const drawer = bindingPage.locator(".cook-drawer");
    await drawer.waitFor({ state: "visible" });
    await bindingStream.say("cancel");
    await drawer.waitFor({ state: "hidden" });
    await bindingPage.locator(".cook-lane-chip").filter({ hasText: "Chef Spoon" }).waitFor({ state: "visible" });
  });
  await checkVoiceBehavior("Voice Binding: removing a cook asks first and ‘yes’ removes that cook", async () => {
    await bindingStream.say("remove the cook Leo");
    await waitForPageCondition(bindingPage, () => document.querySelector(".goose-bubble-tab")?.textContent === "Confirm");
    await bindingStream.say("yes");
    await waitForPageCondition(bindingPage, () => document.querySelectorAll(".cook-slot").length === 1);
    assert.equal(await bindingPage.locator(".cook-name-input").first().inputValue(), "Mia");
  });
  await checkVoiceBehavior("Voice Binding: recording can be started and cancelled by voice", async () => {
    await bindingStream.say("start recording for Mia");
    await bindingPage.locator(".cook-slot.is-recording").waitFor({ state: "visible" });
    await bindingStream.say("cancel");
    await bindingPage.locator(".cook-slot.is-recording").waitFor({ state: "hidden" });
  });
  await bindingPage.close();

  const readyBinding = await openVoicePage(context, "/session/voice-binding", {
    sessionState: clone(originalSession),
  });
  await checkVoiceBehavior("Voice Binding: ready cooks can continue to Schedule by voice", async () => {
    await readyBinding.stream.say("continue to scheduling");
    await readyBinding.page.waitForURL("**/session/schedule", { timeout: 3_000 });
  });
  await readyBinding.page.close();

  // Start an actual run through Schedule's confirmation prompt, then drive
  // Live Cook's addressed microphone fallback with named intent phrases.
  // The agent endpoint deliberately returns an error so the documented
  // keyword path, rather than an LLM-generated action, is under test.
  const liveFixture = clone(originalSession);
  liveFixture.mode = "cooperation";
  liveFixture.run = null;
  const live = await openVoicePage(context, "/session/schedule", { sessionState: liveFixture });
  diagnosticPage = live.page;
  await checkVoiceBehavior("Schedule: ‘go live’ asks for confirmation and ‘yes’ opens Live Cook", async () => {
    await live.stream.say("go live");
    await waitForPageCondition(live.page, () => document.querySelector(".goose-bubble-tab")?.textContent === "Confirm");
    await live.stream.say("yes");
    await live.page.waitForURL("**/session/live-cook", { timeout: 5_000 });
    await live.page.locator(".live-cook-page").waitFor({ state: "visible" });
  });
  if (new URL(live.page.url()).pathname !== "/session/live-cook") {
    await live.page.goto(BASE + "/session/live-cook", { waitUntil: "networkidle" });
  }
  await checkVoiceBehavior("Live Cook: addressed ‘pause’ stops the run and ‘resume’ restarts it", async () => {
    await live.stream.say("Goose pause");
    await live.page.locator(".live-cook-page.is-paused").waitFor({ state: "visible" });
    await live.stream.say("Goose resume");
    await live.page.locator(".live-cook-page:not(.is-paused)").waitFor({ state: "visible" });
  });
  await checkVoiceBehavior("Live Cook: Mandarin pause and resume phrases control the same run state", async () => {
    await live.stream.say("暂停");
    await live.page.locator(".live-cook-page.is-paused").waitFor({ state: "visible" });
    await live.stream.say("接着");
    await live.page.locator(".live-cook-page:not(.is-paused)").waitFor({ state: "visible" });
  });
  await checkVoiceBehavior("Live Cook: spoken start, done, undo, and skip update the step state", async () => {
    const mia = live.page.locator(".lc-card.is-a");
    const stepName = await mia.locator(".lc-step-title").innerText();
    await live.stream.say("Goose start " + stepName);
    await mia.getByRole("button", { name: "Done", exact: true }).waitFor({ state: "visible" });
    await live.stream.say("Goose done");
    await live.page.locator(".lc-pip.is-done").waitFor({ state: "visible" });
    await live.stream.say("Goose undo");
    await live.page.locator(".lc-pip.is-done").waitFor({ state: "hidden" });
    await mia.getByRole("button", { name: "Done", exact: true }).waitFor({ state: "visible" });
    await live.stream.say("Goose skip");
    await live.page.locator(".lc-pip.is-skipped").waitFor({ state: "visible" });
  });
  await checkVoiceBehavior("Live Cook: status and help voice commands appear in Toque's run log", async () => {
    await live.stream.say("Goose status");
    await live.stream.say("Goose score");
    await live.stream.say("Goose help");
    await live.page.getByRole("button", { name: /Open Toque/ }).click({ force: true });
    const log = live.page.getByRole("log");
    await log.waitFor({ state: "visible" });
    const text = await log.innerText();
    assert.match(text, /Goose status/);
    assert.match(text, /Goose score/);
    assert.match(text, /No score in co-op/);
    assert.match(text, /Say “done”|Say "done"/);
  });
  await checkVoiceBehavior("Live Cook: finishing the last step ends the run", async () => {
    await live.stream.say("Goose finish the cook");
    await live.page.locator(".live-cook-page.is-finished").waitFor({ state: "visible" });
  });
  await live.page.close();

  // A competitive run starts with opening suggestions and an unclaimed pool.
  // This fixture is created with the same run and opening-assignment helpers
  // as Schedule so claim/drop/skip/undo assert real card and pool changes.
  const contestNodes = [
    { id: "contest_chop", label: "Chop scallions", difficulty: "low", estimated_duration_sec: 90, depends_on: [], required_equipment: [], required_materials: [], phase: "prep" },
    { id: "contest_sauce", label: "Mix the sauce", difficulty: "medium", estimated_duration_sec: 150, depends_on: [], required_equipment: [], required_materials: [], phase: "prep" },
    { id: "contest_greens", label: "Wash the greens", difficulty: "low", estimated_duration_sec: 60, depends_on: [], required_equipment: [], required_materials: [], phase: "prep" },
    { id: "contest_bowls", label: "Warm the bowls", difficulty: "low", estimated_duration_sec: 75, depends_on: [], required_equipment: [], required_materials: [], phase: "prep" },
  ];
  const contestGraph = { ...clone(graph), title: "Voice test contest", nodes: contestNodes };
  const contestFixture = clone(originalSession);
  contestFixture.mode = "competition";
  contestFixture.recipes = [{
    id: "voice-e2e-contest-recipe",
    draft: clone(contestGraph),
    working: clone(contestGraph),
    approved: clone(contestGraph),
  }];
  const opening = computeOpeningAssignment(contestNodes, contestFixture.cooks, kitchen);
  contestFixture.run = createRun({ nodes: contestNodes, mode: "competition", schedule: null, opening });
  const contest = await openVoicePage(context, "/session/live-cook", { sessionState: contestFixture });
  await contest.page.locator(".live-cook-page.is-versus").waitFor({ state: "visible" });
  await checkVoiceBehavior("Live Cook: ‘claim’ takes a ready pool task", async () => {
    const tile = contest.page.locator(".lc-tile.is-claimable").first();
    await tile.waitFor({ state: "visible" });
    const stepName = await tile.locator(".lc-tile-label").innerText();
    await contest.stream.say("Goose claim " + stepName);
    await contest.page.locator(".lc-card.is-a.is-active").waitFor({ state: "visible" });
    await contest.page.locator(".lc-card.is-a .lc-step-title").filter({ hasText: stepName }).waitFor({ state: "visible" });
  });
  await checkVoiceBehavior("Live Cook: ‘drop’ returns a claimed step to the pool", async () => {
    const mia = contest.page.locator(".lc-card.is-a");
    const stepName = await mia.locator(".lc-step-title").innerText();
    await contest.stream.say("Goose drop");
    await mia.getByRole("button", { name: /Start|Take/ }).waitFor({ state: "visible" });
    await contest.page.locator(".lc-tile.is-claimable").filter({ hasText: stepName }).waitFor({ state: "visible" });
  });
  await checkVoiceBehavior("Live Cook: ‘skip’ removes a pool step and ‘undo’ restores it", async () => {
    const tile = contest.page.locator(".lc-tile.is-claimable").first();
    const stepName = await tile.locator(".lc-tile-label").innerText();
    await contest.stream.say("Goose skip " + stepName);
    await contest.page.locator(".lc-tile.is-claimable").filter({ hasText: stepName }).waitFor({ state: "hidden" });
    await contest.stream.say("Goose undo");
    await contest.page.locator(".lc-tile.is-claimable").filter({ hasText: stepName }).waitFor({ state: "visible" });
  });
  await contest.page.close();

  const abandonFixture = clone(contestFixture);
  abandonFixture.run = createRun({ nodes: contestNodes, mode: "competition", schedule: null, opening });
  const returnToCook = await openVoicePage(context, "/session/schedule", { sessionState: abandonFixture });
  await checkVoiceBehavior("Schedule: ‘back to the cook’ returns to the active run", async () => {
    await returnToCook.stream.say("back to the cook");
    await returnToCook.page.waitForURL("**/session/live-cook", { timeout: 3_000 });
  });
  await returnToCook.page.close();
  const abandonSchedule = await openVoicePage(context, "/session/schedule", { sessionState: abandonFixture });
  diagnosticPage = abandonSchedule.page;
  await checkVoiceBehavior("Schedule: abandoning a cook requires the exact passphrase", async () => {
    await abandonSchedule.stream.say("abandon the cook");
    await waitForPageCondition(abandonSchedule.page, () => document.querySelector(".goose-bubble-tab")?.textContent === "Confirm");
    assert.match(await abandonSchedule.page.locator(".goose-bubble-line").innerText(), /I want to abandon this cook/);
    await abandonSchedule.stream.say("yes");
    assert.ok(abandonFixture.run, "a yes/no answer alone leaves the cook active");
    await abandonSchedule.stream.say("abandon the cook");
    await waitForPageCondition(abandonSchedule.page, () => document.querySelector(".goose-bubble-tab")?.textContent === "Confirm");
    await abandonSchedule.stream.say("I want to abandon this cook");
    await waitForObjectValue(abandonFixture, "run", null);
  });
  await abandonSchedule.page.close();

  console.log(
    "Voice e2e scenarios completed; captured " + scheduleStream.audioFrames +
      " microphone PCM frames on the Schedule page.",
  );
  assert.deepEqual(voiceFailures, [], "Voice behavior E2E failures: " + voiceFailures.join(", "));
} finally {
  await context?.close();
  await browser?.close();
  await rm(TEMP_DIR, { recursive: true, force: true });
}
