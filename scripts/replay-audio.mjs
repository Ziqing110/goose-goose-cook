// Replay a recorded WAV through AssemblyAI Streaming STT, exactly the way
// the browser does it, and print what comes back.
//
// The point is that a kitchen recording becomes a repeatable test. The
// browser path is unrepeatable by nature — you cannot say the same
// sentence twice into the same fan noise — so every tuning decision
// (vad_threshold, keyterms, language codes, the empty-turn watchdog)
// gets argued from one take and forgotten. This sends the same bytes
// every time.
//
// It mirrors src/hooks/useStreamingTranscript.js deliberately: same URL,
// same raw-binary frames, same 50 ms chunks, same params. If the two ever
// disagree, the hook is the source of truth and this is the bug.
//
//   node --env-file-if-exists=.env scripts/replay-audio.mjs recordings/scene-01.wav
//
// Every connection parameter defaults to what VoiceBar's STREAM_CONFIG
// sends, because a replay on different settings measures a system nobody
// is running. The flags exist to change one thing at a time and see what
// it does — which is the whole point of having the recordings.
//
// Flags:
//   --keyterms a,b,c    prime the recogniser (the app sends step + cook names)
//   --vad 0.45          vad_threshold
//   --langs en,zh       language_codes
//   --model NAME        speech_model
//   --voice-focus TYPE  voice_focus ("off" to disable; universal-3-5-pro only)
//   --min-silence 400   min_turn_silence, ms before the end-of-turn check runs
//   --max-silence 1280  max_turn_silence, ms before a turn is force-ended
//   --name Goose        agent name for the addressing check (default Goose)
//   --speed N           playback speed; 1 = real time. Anything else
//                       distorts turn detection, so only for a quick look.
//   --json out.jsonl    write every message for diffing between runs
import { readFileSync, createWriteStream } from "node:fs";
import { basename } from "node:path";
import { isAddressed } from "../server/agent/turn.js";

const WS_BASE = "wss://streaming.assemblyai.com/v3/ws";
const TOKEN_URL = "https://streaming.assemblyai.com/v3/token";
const CHUNK_MS = 50;

const argv = process.argv.slice(2);
// Every flag here takes a value, so the positional argument is whatever
// is left once each flag and the word after it are accounted for.
const VALUED = ["keyterms", "vad", "langs", "model", "voice-focus", "min-silence", "max-silence", "max-speakers", "name", "speed", "json"];
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const consumed = new Set();
argv.forEach((arg, i) => {
  if (arg.startsWith("--") && VALUED.includes(arg.slice(2))) consumed.add(i).add(i + 1);
});
const file = argv.find((a, i) => !consumed.has(i) && !a.startsWith("--"));

if (!file) {
  console.error("usage: node scripts/replay-audio.mjs <file.wav> [--keyterms a,b] [--vad 0.4] ...");
  process.exit(1);
}

const KEY = process.env.ASSEMBLYAI_API_KEY;
if (!KEY) {
  console.error("ASSEMBLYAI_API_KEY is not set. Copy .env.example to .env and add the key.");
  process.exit(1);
}

const AGENT_NAME = flag("name", "Goose");
const SPEED = Number(flag("speed", "1")) || 1;
const jsonPath = flag("json");
const jsonOut = jsonPath ? createWriteStream(jsonPath) : null;

/**
 * Minimal RIFF reader. Deliberately strict: we want a bad recording to
 * fail here with a sentence about the format, not silently transcribe to
 * nothing because it was 24-bit or stereo.
 */
function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${path} is not a WAV file.`);
  }
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = buf.subarray(pos + 8, pos + 8 + size);
    if (id === "fmt ") {
      fmt = {
        format: body.readUInt16LE(0),
        channels: body.readUInt16LE(2),
        rate: body.readUInt32LE(4),
        bits: body.readUInt16LE(14),
      };
    } else if (id === "data") {
      data = body;
    }
    pos += 8 + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt || !data) throw new Error(`${path} has no fmt/data chunk.`);
  if (fmt.format !== 1 || fmt.bits !== 16) {
    throw new Error(`${path} must be 16-bit PCM (got format ${fmt.format}, ${fmt.bits}-bit).`);
  }
  if (fmt.channels !== 1) {
    throw new Error(`${path} must be mono (got ${fmt.channels} channels).`);
  }
  return { rate: fmt.rate, pcm: data };
}

function buildParams(token, rate) {
  const p = new URLSearchParams();
  p.set("token", token);
  p.set("encoding", "pcm_s16le");
  p.set("sample_rate", String(rate));
  const model = flag("model", "universal-3-5-pro");
  p.set("speech_model", model);
  p.set("format_turns", "true");
  p.set("vad_threshold", flag("vad", "0.45"));
  // With speaker_labels the server applies diarization-tuned silence
  // defaults (640/768) so turns break at a speaker change. Ours would
  // override those, so they stand down unless asked for by name.
  const diarize = argv.includes("--speaker-labels");
  const minSilence = flag("min-silence", diarize ? "" : "400");
  const maxSilence = flag("max-silence", diarize ? "" : "1280");
  if (minSilence) p.set("min_turn_silence", minSilence);
  if (maxSilence) p.set("max_turn_silence", maxSilence);
  if (diarize) {
    p.set("speaker_labels", "true");
    p.set("max_speakers", flag("max-speakers", "2"));
  }
  const focus = flag("voice-focus", "far-field");
  if (focus !== "off") {
    if (model !== "universal-3-5-pro") {
      throw new Error("voice_focus requires universal-3-5-pro; it would be silently ignored.");
    }
    p.set("voice_focus", focus);
  }
  const keyterms = (flag("keyterms") || "").split(",").map((t) => t.trim()).filter(Boolean);
  if (keyterms.length) p.set("keyterms_prompt", JSON.stringify(keyterms.slice(0, 100)));
  const langs = (flag("langs", "en,zh") || "").split(",").map((t) => t.trim()).filter(Boolean);
  if (langs.length) p.set("language_codes", JSON.stringify(langs));
  return p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clock = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}.${String(Math.floor(ms % 1000)).padStart(3, "0")}`;

const { rate, pcm } = readWav(file);
const bytesPerChunk = Math.round((rate * CHUNK_MS) / 1000) * 2;
const durationMs = (pcm.length / 2 / rate) * 1000;

console.log(`${basename(file)} — ${rate} Hz mono, ${(durationMs / 1000).toFixed(1)}s`);
console.log(`  vad ${flag("vad", "0.45")} · voice_focus ${flag("voice-focus", "far-field")} · langs ${flag("langs", "en,zh")}${argv.includes("--speaker-labels") ? " · speaker_labels (server silence defaults)" : ` · silence ${flag("min-silence", "400")}/${flag("max-silence", "1280")}ms`}`);

const tokenRes = await fetch(`${TOKEN_URL}?expires_in_seconds=60`, {
  headers: { Authorization: KEY }, // raw key: Streaming STT, not the Voice Agent
});
const tokenBody = await tokenRes.json();
if (!tokenRes.ok) {
  console.error(`Token request failed (${tokenRes.status}): ${tokenBody.error || ""}`);
  process.exit(1);
}

const ws = new WebSocket(`${WS_BASE}?${buildParams(tokenBody.token, rate)}`);
ws.binaryType = "arraybuffer";

const turns = [];
let streamStart = 0;
let openTurnAt = 0;

const record = (obj) => jsonOut?.write(`${JSON.stringify(obj)}\n`);

ws.onopen = async () => {
  streamStart = Date.now();
  for (let off = 0; off < pcm.length; off += bytesPerChunk) {
    if (ws.readyState !== WebSocket.OPEN) break;
    ws.send(pcm.subarray(off, off + bytesPerChunk));
    // Pace against the wall clock rather than sleeping a flat CHUNK_MS,
    // so scheduler jitter doesn't accumulate into a stream that runs
    // minutes slow over a long take.
    const due = streamStart + (off / 2 / rate) * 1000 / SPEED;
    const wait = due - Date.now();
    if (wait > 1) await sleep(wait);
  }
  // Same grace as the hook: Terminate, then wait for Termination, because
  // closing immediately discards the last turn.
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "Terminate" }));
  setTimeout(() => ws.close(), 5000);
};

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  record({ at: Date.now() - streamStart, ...msg });
  switch (msg.type) {
    case "Begin":
      console.log(`  session ${msg.id} · model ${msg.configuration?.model ?? "?"}\n`);
      openTurnAt = Date.now();
      break;

    case "Turn": {
      const text = (msg.transcript || "").trim();
      if (!msg.end_of_turn) break;
      const words = msg.words || [];
      const lowest = words.reduce((min, w) => Math.min(min, w.confidence ?? 1), 1);
      const startMs = Number.isFinite(words[0]?.start) ? words[0].start : Date.now() - streamStart;
      const openFor = Date.now() - openTurnAt;
      const addressed = isAddressed(text, AGENT_NAME);
      turns.push({ startMs, text, lowest, addressed, empty: !text });

      const mark = !text ? "·" : addressed ? "»" : " ";
      const who = msg.speaker_label ? `[${msg.speaker_label}] ` : "";
      console.log(`${clock(startMs)} ${mark} ${who}${text || "(no words — turn ended empty)"}`);
      if (text) {
        console.log(`          conf ${lowest.toFixed(2)} · ${words.length} words · turn open ${(openFor / 1000).toFixed(1)}s${addressed ? "" : " · NOT addressed"}`);
      }
      openTurnAt = Date.now();
      break;
    }

    case "Termination":
      ws.close();
      break;

    case "Error":
      console.error(`  ERROR ${msg.error_code}: ${msg.error}`);
      break;

    default:
      break;
  }
};

ws.onerror = () => console.error("  connection failed");

ws.onclose = () => {
  jsonOut?.end();
  const spoken = turns.filter((t) => !t.empty);
  const unclear = spoken.filter((t) => t.lowest < 0.4);
  console.log(`\n${spoken.length} turns · ${turns.length - spoken.length} empty · ${spoken.filter((t) => t.addressed).length} addressed to ${AGENT_NAME}`);
  if (unclear.length) {
    console.log(`${unclear.length} below the 0.4 confidence gate the live cook drops on:`);
    unclear.forEach((t) => console.log(`  ${clock(t.startMs)} ${t.lowest.toFixed(2)} ${t.text}`));
  }
  if (jsonPath) console.log(`raw messages -> ${jsonPath}`);
};
