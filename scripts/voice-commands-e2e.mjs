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

const BASE = process.env.VOICE_E2E_BASE || "http://127.0.0.1:5173";
const SAMPLE_RATE = 48_000;
const TEMP_DIR = await mkdtemp(path.join(os.tmpdir(), "kitchen-voice-e2e-"));
const WAV_PATH = path.join(TEMP_DIR, "fake-microphone.wav");

function writeFakeAudio(pathname) {
  // A short, non-silent 16-bit PCM tone is enough to prove that captured
  // microphone samples make it through the app's AudioWorklet and socket.
  // The mocked socket supplies the corresponding transcript below.
  const samples = SAMPLE_RATE * 3;
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
const understandingInputs = [];

async function mockApi(page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/voice/stt-token") {
      return route.fulfill({ json: { token: "voice-e2e-token" } });
    }
    if (url.pathname === "/api/kitchens" && request.method() === "GET") {
      return route.fulfill({ json: [kitchen] });
    }
    if (url.pathname === "/api/sessions" && request.method() === "GET") {
      return route.fulfill({
        json: url.searchParams.get("status") === "active" ? [clone(session)] : [],
      });
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
    if (url.pathname === "/api/sessions/" + session.id && request.method() === "PATCH") {
      Object.assign(session, request.postDataJSON());
      return route.fulfill({ json: clone(session) });
    }
    if (url.pathname.startsWith("/api/sessions/")) {
      return route.fulfill({ json: clone(session) });
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
      assert.ok(nonSilentFrames > 0, "non-silent microphone audio reached the socket");
      socket.send(JSON.stringify({ type: "Turn", transcript: text, end_of_turn: false }));
      await page.waitForFunction(
        (expected) => document.querySelector(".voice-transcript-text")?.textContent === expected,
        text,
        { timeout: 5_000 },
      );
      await inspectPartial?.();
      socket.send(JSON.stringify({
        type: "Turn",
        transcript: text,
        end_of_turn: true,
        words: text.split(/\s+/).map((word, i) => ({
          text: word,
          confidence: 0.99,
          start: i * 250,
          end: (i + 1) * 250,
        })),
      }));
    },
  };
}

async function unmute(page, stream) {
  await page.getByRole("button", { name: "Unmute" }).click({ force: true });
  await page.getByRole("button", { name: "Mute" }).waitFor({ state: "visible" });
  await page.locator(".voice-status-pill").filter({ hasText: "Listening" }).waitFor({ state: "visible" });
  await stream.waitForAudio();
}

async function waitForAttribute(locator, name, expected, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await locator.getAttribute(name) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(await locator.getAttribute(name), expected, name + " did not become " + expected);
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
  context = await browser.newContext({ permissions: ["microphone"] });
  const schedulePage = await context.newPage();
  await mockApi(schedulePage);
  const scheduleStream = await mockStreamingSocket(schedulePage);
  await schedulePage.goto(BASE + "/session/schedule", { waitUntil: "networkidle" });
  await schedulePage.getByRole("slider", { name: "Timeline zoom" }).waitFor({ state: "visible" });
  await unmute(schedulePage, scheduleStream);

  const zoom = schedulePage.getByRole("slider", { name: "Timeline zoom" });
  assert.equal(await zoom.getAttribute("aria-valuetext"), "1×");
  await scheduleStream.say("zoom in");
  await waitForAttribute(zoom, "aria-valuetext", "115%");
  assert.match(await schedulePage.locator(".voice-transcript-text").innerText(), /Zoom 115%/);

  // Let the page replace its registered command closure after the zoom state
  // update, just as it can while the person listens to the spoken reply.
  await schedulePage.waitForTimeout(200);
  await scheduleStream.say("zoom out");
  await waitForAttribute(zoom, "aria-valuetext", "1×");

  await scheduleStream.say("go to inventory");
  await schedulePage.waitForURL("**/session/inventory", { timeout: 5_000 });
  await schedulePage.locator(".inventory-page").waitFor({ state: "visible" });
  await schedulePage.close();

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

  console.log(
    "PASS voice e2e: unmute captured " + scheduleStream.audioFrames +
      " PCM frames, zoom in/out changed the timeline, spoken navigation opened Inventory, " +
      "and conversation dictation submitted and advanced.",
  );
} finally {
  await context?.close();
  await browser?.close();
  await rm(TEMP_DIR, { recursive: true, force: true });
}
