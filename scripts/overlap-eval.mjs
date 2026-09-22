// Can we tell "two cooks in one turn" from "one cook, badly heard"?
//
// Scene 8 is the two of them talking over each other on purpose, and its
// turns contain both voices — whatever such a turn is credited to, half
// of it is wrong. Before asking the agent to handle that case, we have to
// be able to DETECT it, and detecting it must not fire on the ordinary
// scenes where one person is simply hard to hear.
//
// The method: slide a window across the turn's audio and identify each
// window separately. One speaker gives the same answer throughout. Two
// speakers give confident answers that disagree.
//
//   npm run speaker          # sidecar up
//   node scripts/overlap-eval.mjs
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { SPEAKER_THRESHOLDS } from "../src/utils/speakerMatch.js";

const SIDECAR = process.env.SPEAKER_URL || "http://127.0.0.1:3103";
const COOK_A = "eval_cook_a";
const COOK_B = "eval_cook_b";
const PAD_MS = 150;

// The sidecar needs half a second to say anything useful, so windows are
// 1.5s with a half-window hop: long enough to embed, short enough that a
// handover inside one turn lands in some window on its own.
const WINDOW_MS = 1500;
const HOP_MS = 750;

const ENROLL_ON = ["scene-01", "scene-05"];
const OVERLAP_SCENE = "scene-08";
// Ordinary two-person scenes. Nothing here should read as an overlap.
const CLEAN_SCENES = ["scene-02", "scene-04", "scene-07"];

function readWav(path) {
  const buf = readFileSync(path);
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") fmt = { rate: buf.readUInt32LE(pos + 12) };
    else if (id === "data") data = buf.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + (size % 2);
  }
  return { rate: fmt.rate, pcm: data };
}

const sheetLines = (path) =>
  readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.match(/^(\d\d):(\d\d)\s+([AB]+):/))
    .filter(Boolean)
    .map((m) => ({ at: (Number(m[1]) * 60 + Number(m[2])) * 1000, who: m[3] }));

const turns = (path) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((m) => m.type === "Turn" && m.end_of_turn && (m.words || []).length);

const post = (path, body) =>
  fetch(`${SIDECAR}${path}`, { method: "POST", body }).then(async (r) => {
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error || `sidecar ${r.status}`);
    return json;
  });

function scene(prefix) {
  const f = readdirSync("recordings").find((x) => x.startsWith(prefix) && x.endsWith(".wav"));
  const stem = f.replace(/\.wav$/, "");
  const run = `runs/${stem}.appcfg.jsonl`;
  return {
    stem,
    wav: `recordings/${f}`,
    sheet: `recordings/${stem}.txt`,
    jsonl: existsSync(run) ? run : `runs/${stem}.jsonl`,
  };
}

const clipOf = ({ pcm, rate }, turn) => {
  const w = turn.words;
  const from = Math.max(0, Math.floor(((w[0].start - PAD_MS) / 1000) * rate)) * 2;
  const to = Math.min(pcm.length, Math.ceil(((w[w.length - 1].end + PAD_MS) / 1000) * rate) * 2);
  return pcm.subarray(from, to);
};

/**
 * Identify each window of a turn.
 * @returns {Promise<Array<{cook:string|null, score:number, margin:number}>>}
 */
async function windows(clip, rate) {
  const bytesPerMs = (rate * 2) / 1000;
  const size = Math.floor(WINDOW_MS * bytesPerMs);
  const hop = Math.floor(HOP_MS * bytesPerMs);
  const out = [];
  for (let at = 0; at + size <= clip.length; at += hop) {
    const res = await post(`/identify?rate=${rate}&candidates=${COOK_A},${COOK_B}`, clip.subarray(at, at + size));
    out.push({
      cook: res.cook === COOK_A ? "A" : res.cook === COOK_B ? "B" : null,
      score: Number(res.score ?? 0),
      margin: Number(res.margin ?? 0),
    });
  }
  return out;
}

/**
 * Two cooks in one turn?
 *
 * Only windows the sidecar is confident about get a vote. An unclear
 * window is not evidence of a second speaker, it is just an unclear
 * window — which is exactly the distinction between overlap and a cook
 * who mumbled.
 *
 * The bar is LOWER than a whole turn's, and has to be: a 1.5s window
 * carries a fraction of the evidence a 3s turn does, so the floor tuned
 * for turns rejects nearly every window and nothing ever disagrees.
 */
function readsAsOverlap(ws, minScore, minMargin) {
  const confident = ws.filter((w) => w.cook && w.score >= minScore && w.margin >= minMargin);
  const voices = new Set(confident.map((w) => w.cook));
  return { overlap: voices.size > 1, voices: [...voices], confident: confident.length, total: ws.length };
}

// --- enroll, from the same scenes speaker-eval uses --------------------
const voices = { A: [], B: [] };
let rate = 48000;
for (const prefix of ENROLL_ON) {
  const s = scene(prefix);
  const audio = readWav(s.wav);
  rate = audio.rate;
  const lines = sheetLines(s.sheet);
  for (const turn of turns(s.jsonl)) {
    const at = turn.words[0].start;
    let who = lines[0].who;
    for (const line of lines) {
      if (line.at - 1500 <= at) who = line.who;
      else break;
    }
    if (voices[who]) voices[who].push(clipOf(audio, turn));
  }
}
for (const [who, cook] of [["A", COOK_A], ["B", COOK_B]]) {
  await post(`/enroll?cook=${cook}&rate=${rate}`, Buffer.concat(voices[who]));
  console.log(`enrolled ${who}`);
}

// --- embed everything once, then sweep --------------------------------
const collect = async (prefix) => {
  const s = scene(prefix);
  const audio = readWav(s.wav);
  const out = [];
  for (const turn of turns(s.jsonl)) {
    out.push({ text: turn.transcript || "", ws: await windows(clipOf(audio, turn), rate) });
  }
  return out;
};

const overlapTurns = await collect(OVERLAP_SCENE);
const cleanTurns = [];
for (const prefix of CLEAN_SCENES) cleanTurns.push(...(await collect(prefix)));

console.log(`\n${OVERLAP_SCENE}: ${overlapTurns.length} turns with both voices in them`);
console.log(`ordinary: ${cleanTurns.length} turns with one voice each\n`);

// What a window has to clear before its vote counts. The pair that
// matters is the one that catches overlaps without firing on the
// ordinary turns — a false alarm makes a cook repeat themselves for
// nothing, which is worse than the split credit it was trying to avoid.
console.log("  score  margin | caught  false alarms");
for (const minScore of [0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50]) {
  for (const minMargin of [0.02, 0.05, 0.10]) {
    const caught = overlapTurns.filter((r) => readsAsOverlap(r.ws, minScore, minMargin).overlap).length;
    const alarms = cleanTurns.filter((r) => readsAsOverlap(r.ws, minScore, minMargin).overlap).length;
    console.log(
      `   ${minScore.toFixed(2)}   ${minMargin.toFixed(2)} |   ${String(caught).padStart(2)}/${overlapTurns.length}       ${String(alarms).padStart(2)}/${cleanTurns.length}`,
    );
  }
}
console.log(`\n(a whole turn has to clear ${SPEAKER_THRESHOLDS.minScore} / ${SPEAKER_THRESHOLDS.minMargin}; windows carry less evidence)`);

for (const cook of [COOK_A, COOK_B]) {
  await fetch(`${SIDECAR}/voiceprints?cook=${cook}`, { method: "DELETE" }).catch(() => {});
}
