// How often does the speaker sidecar credit the right cook?
//
// Nothing new needs recording to answer that. The kitchen takes already
// contain both voices; the prompter's timing sheet says who read each
// line, and the replayed JSONL carries word-level timestamps, so every
// turn can be cut out of the WAV and labelled with the person who said
// it. Some scenes enroll, the rest are marked.
//
//   npm run speaker                 # the sidecar must be up
//   node scripts/speaker-eval.mjs
//
// Enrolls under test ids and deletes them afterwards, so the cooks bound
// in the app are never touched.
//
// Turns are matched to lines by TIME, not by position, so a turn that
// split after the name still gets the right speaker. Scene 8 is left out
// because it is two people talking over each other on purpose: its turns
// contain both voices and there is no single right answer to mark
// against. Scene 6 is mostly noise and scene 3 is deliberate chatter.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { decideSpeaker, SPEAKER_THRESHOLDS } from "../src/utils/speakerMatch.js";

const SIDECAR = process.env.SPEAKER_URL || "http://127.0.0.1:3103";
const COOK_A = "eval_cook_a";
const COOK_B = "eval_cook_b";
// A little room either side, as LiveCookPage takes when it cuts a clip.
const PAD_MS = 150;

const ENROLL_ON = ["scene-01", "scene-05"];
const MARK_ON = ["scene-02", "scene-03", "scene-04", "scene-07", "scene-09"];

function readWav(path) {
  const buf = readFileSync(path);
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") fmt = { rate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
    else if (id === "data") data = buf.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`${path}: no fmt/data chunk`);
  return { rate: fmt.rate, pcm: data };
}

/** Each line the prompter showed: when, and who read it. */
function sheetLines(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.match(/^(\d\d):(\d\d)\s+([AB]):/))
    .filter(Boolean)
    .map((m) => ({ at: (Number(m[1]) * 60 + Number(m[2])) * 1000, who: m[3] }));
}

/** Final turns with word timings, from a replay run. */
function turns(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((m) => m.type === "Turn" && m.end_of_turn && (m.words || []).length);
}

/** The slice of PCM a turn's words occupy. */
function clipOf({ pcm, rate }, turn) {
  const words = turn.words;
  const from = Math.max(0, Math.floor(((words[0].start - PAD_MS) / 1000) * rate)) * 2;
  const to = Math.min(pcm.length, Math.ceil(((words[words.length - 1].end + PAD_MS) / 1000) * rate) * 2);
  return pcm.subarray(from, to);
}

const post = (path, body) =>
  fetch(`${SIDECAR}${path}`, { method: "POST", body }).then(async (r) => {
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error || `sidecar ${r.status}`);
    return json;
  });

function scenes(prefixes) {
  return readdirSync("recordings")
    .filter((f) => f.endsWith(".wav") && prefixes.some((p) => f.startsWith(p)))
    .map((f) => {
      const stem = f.replace(/\.wav$/, "");
      const run = `runs/${stem}.appcfg.jsonl`;
      const plain = `runs/${stem}.jsonl`;
      return {
        stem,
        wav: `recordings/${f}`,
        sheet: `recordings/${stem}.txt`,
        jsonl: existsSync(run) ? run : plain,
      };
    });
}

// The prompter's clock and the WAV's clock are the same clock, so a turn
// belongs to whichever line was on screen when it started. Aligning by
// time rather than by position survives the cases that matter: a turn
// that split after the name gives both halves the same speaker, which is
// right, and a stray tail turn is attributed to the line it trailed.
//
// SLACK covers the sheet's one-second resolution, which rounds a line's
// timestamp down, and the beat between a line appearing and someone
// starting to read it.
const SLACK_MS = 1500;

function labelled(scene) {
  const lines = sheetLines(scene.sheet);
  if (!lines.length) return [];
  return turns(scene.jsonl).map((turn) => {
    const at = turn.words[0].start;
    let who = lines[0].who;
    for (const line of lines) {
      if (line.at - SLACK_MS <= at) who = line.who;
      else break;
    }
    return { turn, who };
  });
}

const health = await fetch(`${SIDECAR}/health`).then((r) => r.json()).catch(() => null);
if (!health?.ok) {
  console.error(`The speaker sidecar is not answering on ${SIDECAR}. Start it with: npm run speaker`);
  process.exit(1);
}
console.log(`sidecar up on ${health.device}\n`);

// --- enroll -----------------------------------------------------------
const voices = { A: [], B: [] };
for (const scene of scenes(ENROLL_ON)) {
  const rows = labelled(scene);
  const audio = readWav(scene.wav);
  for (const { turn, who } of rows) voices[who].push(clipOf(audio, turn));
  console.log(`enroll from ${scene.stem}: ${rows.length} turns`);
}

const rate = readWav(scenes(ENROLL_ON)[0].wav).rate;
for (const [who, cook] of [["A", COOK_A], ["B", COOK_B]]) {
  const joined = Buffer.concat(voices[who]);
  const res = await post(`/enroll?cook=${cook}&rate=${rate}`, joined);
  console.log(`  ${who}: ${res.seconds}s of voice enrolled`);
}

// --- mark -------------------------------------------------------------
console.log();
let right = 0;
let wrong = 0;
let unsure = 0;
const misses = [];
// Every raw result, so the thresholds can be swept without asking the
// model to embed all of this again.
const samples = [];

for (const scene of scenes(MARK_ON)) {
  const rows = labelled(scene);
  const audio = readWav(scene.wav);
  console.log(`\n${scene.stem}`);
  for (const { turn, who } of rows) {
    const clip = clipOf(audio, turn);
    const result = await post(`/identify?rate=${rate}&candidates=${COOK_A},${COOK_B}`, clip);
    samples.push({
      truth: who,
      cook: result.cook === COOK_A ? "A" : result.cook === COOK_B ? "B" : null,
      score: Number(result.score ?? 0),
      margin: Number(result.margin ?? 0),
      seconds: Number(result.seconds ?? 0),
      text: turn.transcript,
    });
    const verdict = decideSpeaker(result);
    const said = verdict.cookId === COOK_A ? "A" : verdict.cookId === COOK_B ? "B" : null;
    const mark = said === null ? "?" : said === who ? "ok" : "XX";
    if (said === null) unsure += 1;
    else if (said === who) right += 1;
    else {
      wrong += 1;
      misses.push({ scene: scene.stem, text: turn.transcript, who, said });
    }
    console.log(
      `  ${mark}  said=${who} heard=${said ?? verdict.reason}  score ${Number(result.score ?? 0).toFixed(2)} margin ${Number(result.margin ?? 0).toFixed(2)}  ${(turn.transcript || "").slice(0, 44)}`,
    );
  }
}

console.log(`\n${right} right, ${wrong} wrong, ${unsure} not sure (of ${right + wrong + unsure})`);
console.log(`thresholds: score >= ${SPEAKER_THRESHOLDS.minScore}, margin >= ${SPEAKER_THRESHOLDS.minMargin}, >= ${SPEAKER_THRESHOLDS.minSeconds}s`);
if (misses.length) {
  console.log("\nwrong cook credited:");
  misses.forEach((m) => console.log(`  ${m.scene}: ${m.who} heard as ${m.said} — "${m.text}"`));
}

// --- what would other thresholds have done? ---------------------------
//
// The figures in speakerMatch.js are starting points; its own comment
// says to measure them on the real pair, because two similar voices sit
// closer together than the demo pairs they were picked against. This is
// that measurement.
//
// A wrong answer costs more than no answer - no answer falls back to the
// speaker toggle, a wrong one silently credits somebody else with the
// step - so the column that matters is "wrong", and "unsure" is only the
// price paid for it.
console.log("\n  score  margin | right  wrong  unsure");
for (const minScore of [0.40, 0.45, 0.50, 0.55, 0.60]) {
  for (const minMargin of [0.10, 0.15, 0.20, 0.25]) {
    let r = 0;
    let w = 0;
    let u = 0;
    for (const row of samples) {
      const ok = row.cook && row.seconds >= SPEAKER_THRESHOLDS.minSeconds
        && row.score >= minScore && row.margin >= minMargin;
      if (!ok) u += 1;
      else if (row.cook === row.truth) r += 1;
      else w += 1;
    }
    const flag = minScore === SPEAKER_THRESHOLDS.minScore && minMargin === SPEAKER_THRESHOLDS.minMargin ? "  <- in use" : "";
    console.log(`   ${minScore.toFixed(2)}   ${minMargin.toFixed(2)} |  ${String(r).padStart(3)}    ${String(w).padStart(3)}     ${String(u).padStart(3)}${flag}`);
  }
}

// --- clean up ---------------------------------------------------------
for (const cook of [COOK_A, COOK_B]) {
  await fetch(`${SIDECAR}/voiceprints?cook=${cook}`, { method: "DELETE" }).catch(() => {});
}
console.log("\ntest voiceprints removed; the cooks bound in the app are untouched");
