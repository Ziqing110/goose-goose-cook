// The agent's voice: Kokoro-82M on WebGPU, chosen by ear in tts-lab/.
//
// Free and local: the model runs in the browser on the user's GPU, so no
// paid TTS and nothing leaves the machine. Kokoro can't shift pitch, so
// the chipmunk comes from playing its output back faster; RATE raises
// pitch and speed together, and Kokoro's own SPEED slows the tempo back
// down to compensate (0.6 * 1.6 is roughly natural pace).
//
// Falls back to the browser's built-in Web Speech voice when WebGPU is
// missing or the model fails to load, so the agent is never mute.
//
// Not in utils/ because it touches the DOM (AudioContext, speechSynthesis).
import { createSpanLog } from "../utils/speechSpans.js";

// What the cook calls the agent. It answers only when addressed by this.
// A placeholder until the real name is chosen; it is also sent to the
// server, which does the addressing check, so this is the one place to
// change it.
export const AGENT_NAME = "Goose";

export const AGENT_VOICE = {
  voice: "am_santa",
  speed: 0.6, // Kokoro tempo, pitch unchanged
  rate: 1.6, // playbackRate: speed and pitch together
  dtype: "fp32",
  device: "webgpu",
};

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
// Loaded from a CDN, as in the lab, so the bundler never has to deal with
// onnxruntime-web. The weights come from Hugging Face on first use and are
// then cached by the browser.
const KOKORO_JS = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";

// The mic hears this voice too. Browser echo cancellation takes most of it
// out, but not all, so every stretch of real playback is logged and a turn
// whose speech began inside one is treated as the agent, not a cook.
const spans = createSpanLog();

/**
 * Was the agent audibly speaking at wall-clock time `at` (ms)? Ask with
 * when the words were SPOKEN, not when the transcript arrived: a turn
 * finalizes after its trailing silence, so its text usually lands after
 * the agent has stopped.
 */
export const agentWasSpeakingAt = (at) => spans.covers(at);

const TAIL_MS = 500;

let ttsPromise = null;
let ctx = null;
let source = null;
let token = 0;
let speaking = false;
let tailTimer = null;
const listeners = new Set();

function setSpeaking(next) {
  if (speaking === next) return;
  speaking = next;
  listeners.forEach((fn) => fn(next));
}

export const isSpeaking = () => speaking;

// Whether the agent is allowed to play audio at all. Lives here rather
// than in React state because speak() is called from plain modules; the
// VoiceBar mirrors the app-state toggle onto it.
let voiceEnabled = true;

/** Turn the agent's spoken voice on or off. Silences anything playing. */
export function setVoiceEnabled(next) {
  voiceEnabled = Boolean(next);
  if (!voiceEnabled) stop();
}

export const isVoiceEnabled = () => voiceEnabled;

/** Subscribe to speaking changes. Returns an unsubscribe function. */
export function onSpeakingChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function load() {
  ttsPromise ??= (async () => {
    if (!navigator.gpu) throw new Error("WebGPU unavailable");
    const { KokoroTTS } = await import(/* @vite-ignore */ KOKORO_JS);
    return KokoroTTS.from_pretrained(MODEL, {
      dtype: AGENT_VOICE.dtype,
      device: AGENT_VOICE.device,
    });
  })();
  return ttsPromise;
}

/** Start downloading and compiling the model so the first line isn't late. */
export function preload() {
  load().catch(() => {}); // speak() handles the failure by falling back
}

function playBuffer(buffer, myToken) {
  return new Promise((resolve) => {
    if (myToken !== token) return resolve();
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = AGENT_VOICE.rate;
    source.connect(ctx.destination);
    source.onended = () => {
      spans.end();
      resolve();
    };
    spans.begin();
    source.start();
  });
}

// Roughly three words a second, plus slack. A browser with no installed
// voices accepts an utterance and then reports nothing at all — neither
// onend nor onerror — so without a deadline this promise never settles,
// speak() never reaches its finally, and the agent stays "speaking"
// forever: stuck pose, and a speech span that never closes.
const webSpeechBudget = (text) => 3_000 + (text.split(/\s+/).length / 3) * 1_000;

function speakWebSpeech(text, myToken) {
  return new Promise((resolve) => {
    if (myToken !== token || !("speechSynthesis" in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      spans.end();
      resolve();
    };
    const deadline = setTimeout(finish, webSpeechBudget(text));
    u.onstart = () => spans.begin();
    u.onend = u.onerror = finish;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

/** Cut the agent off mid-sentence (barge-in, mute, page change). */
export function stop() {
  token += 1;
  clearTimeout(tailTimer);
  try { source?.stop(); } catch { /* not started */ }
  source = null;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  spans.end();
  setSpeaking(false);
}

/**
 * Say a line. A new line replaces whatever is still playing, since the
 * newest thing the agent has to say is the one that matters.
 */
export async function speak(text) {
  const line = text?.trim();
  if (!line) return;
  // The goose's voice egg. Off means the agent still decides what it
  // would say — the caller's logic is untouched — it just doesn't say
  // it out loud, so the subtitle bubble still carries the line.
  if (!voiceEnabled) return;
  stop();
  const myToken = token;
  setSpeaking(true);
  try {
    const tts = await load();
    const audio = await tts.generate(line, {
      voice: AGENT_VOICE.voice,
      speed: AGENT_VOICE.speed,
    });
    if (myToken !== token) return;
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    const buffer = ctx.createBuffer(1, audio.audio.length, audio.sampling_rate);
    buffer.copyToChannel(audio.audio, 0);
    await playBuffer(buffer, myToken);
  } catch {
    await speakWebSpeech(line, myToken);
  } finally {
    if (myToken === token) {
      tailTimer = setTimeout(() => setSpeaking(false), TAIL_MS);
    }
  }
}

// Dev-only handle for the barge-in and echo takes (see
// docs/VOICE_RECORDING_SCRIPTS.md, scene 10). Testing "Goose talks over
// you" needs the agent talking on cue and for long enough to be talked
// over, which its own replies — capped at fifteen words — are not. This
// gives the recording session a way to start and stop it deliberately.
//
// Stripped from production builds: import.meta.env.DEV is a compile-time
// constant, so the whole block disappears from the bundle.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.goose = {
    speak,
    stop,
    isSpeaking,
    // The browser e2e injects transcripts instead of playing audio into
    // a microphone, so the agent's own voice is pure nondeterminism
    // there: every reply logs a speech span, and a turn that lands
    // inside one is discarded as echo. Silencing it leaves the replies
    // themselves intact — say() still sets the line the bubble shows.
    setVoiceEnabled,
    /** A line long enough to still be talking when you cut in. */
    ramble: () =>
      speak(
        "Right, while that simmers, here is where we stand. The tofu is cubed and blanched, " +
          "the garlic and the ginger are minced, the sauce is mixed and waiting, and the " +
          "doubanjiang has had its minute in the wok. What happens next is the part people " +
          "rush: let it sit, let the oil go red, and do not stir it like a risotto.",
      ),
  };
}
