// Voice lab — a bench instrument for AssemblyAI Real-time STT.
//
// Nothing here is meant to survive into the app. The job is to answer,
// with real voices in a real kitchen: how accurate is it, how fast does
// a turn finalize, does diarization hold up under cross-talk, and do
// keyterms actually help. Everything is exposed and everything is
// logged, because a number you can't export is a number you'll argue
// about later.

const WS_BASE = "wss://streaming.assemblyai.com/v3/ws";
const CHUNK_MS = 50;

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- state

let ws = null;
let audioCtx = null;
let workletNode = null;
let micStream = null;
let sessionStartWall = 0; // Date.now() at Begin — the zero for audio ms.
let sentParams = {}; // what we actually put on the URL, token stripped.
let terminationTimer = null; // guards the wait-for-Termination on close.

// --- audio capture ------------------------------------------------------
// The transcript alone can't be re-analysed. To compare AssemblyAI's
// diarization against anything else — TitaNet, pyannote, a future model —
// you need the original audio and a shared clock with the API's word
// timestamps. So keep every PCM chunk and remember which sample was
// playing when `Begin` arrived; that sample is t=0 for every `start`/`end`
// the API reports.
let pcmChunks = [];
let pcmSamples = 0;
let audioZeroSample = null;
let labSampleRate = 48000; // captured at connect; audioCtx is closed by then.
const MAX_RECORD_SECONDS = 900; // ~86MB at 48kHz; a guard, not a target.

// --- prompter -----------------------------------------------------------
// Two people read a fixed script off the screen, and each finalized turn
// gets stamped with the line it was *supposed* to be. That stamp is the
// whole reason scoring can be automatic: without it, grading means a human
// re-reading transcripts and guessing which line each turn was.
let rounds = {};
let roundKey = "";
let expectedQueue = []; // flattened expected utterances for this round
let expectedIdx = 0;

/** Every message in and out, in order. This is the deliverable. */
let log = [];
let turns = [];

// --------------------------------------------------------------- config

const KITCHEN_KEYTERMS = [
  "Lindy",
  "Zeina",
  "mapo tofu",
  "doubanjiang",
  "chicken noodle soup",
  "mince the garlic",
  "julienne",
  "Sichuan peppercorn",
  "silken tofu",
  "blanch the noodles",
];

const PRESETS = {
  bare: {
    label: "Bare",
    speech_model: "universal-3-5-pro",
    mode: "balanced",
    voice_focus: "",
    speaker_labels: false,
    max_speakers: 2,
    format_turns: true,
    keyterms: "",
    prompt: "",
  },
  kitchen: {
    label: "Kitchen (far-field + keyterms)",
    speech_model: "universal-3-5-pro",
    mode: "balanced",
    voice_focus: "far-field",
    speaker_labels: true,
    max_speakers: 2,
    format_turns: true,
    keyterms: KITCHEN_KEYTERMS.join("\n"),
    prompt:
      "Two people cooking Chinese food together in a home kitchen. They call each other by name and give each other short cooking instructions.",
  },
  fast: {
    label: "Fast commands (min latency)",
    speech_model: "universal-3-5-pro",
    mode: "min_latency",
    voice_focus: "far-field",
    speaker_labels: true,
    max_speakers: 2,
    format_turns: false,
    keyterms: KITCHEN_KEYTERMS.join("\n"),
    prompt: "",
  },
};

/** Read the form into the query params the socket wants. */
function buildParams(token) {
  const p = new URLSearchParams();
  p.set("token", token);
  p.set("encoding", "pcm_s16le");
  p.set("sample_rate", String(audioCtx.sampleRate));
  p.set("speech_model", $("speech_model").value);
  p.set("format_turns", String($("format_turns").checked));

  const mode = $("mode").value;
  if (mode) p.set("mode", mode);

  const vf = $("voice_focus").value;
  if (vf) {
    // Voice Focus is universal-3-5-pro only and NO-OPS SILENTLY elsewhere.
    // Worse, the API ignores unrecognized query params rather than
    // rejecting them, so a wrong model produces no error at all — you'd
    // just measure "Voice Focus didn't help" and believe it. Refuse the
    // combination rather than let it quietly poison a test round.
    if ($("speech_model").value !== "universal-3-5-pro") {
      throw new Error(
        `Voice Focus requires universal-3-5-pro, but the model is "${$("speech_model").value}". ` +
          `It would be silently ignored. Switch the model or set Voice Focus to off.`,
      );
    }
    p.set("voice_focus", vf);
    p.set("voice_focus_threshold", $("voice_focus_threshold").value);
  }

  if ($("speaker_labels").checked) {
    p.set("speaker_labels", "true");
    p.set("max_speakers", $("max_speakers").value);
  }

  // Turn detection. Only send what's been touched — the server's
  // defaults are model-dependent and better than anything we'd guess.
  for (const id of [
    "end_of_turn_confidence_threshold",
    "min_turn_silence",
    "max_turn_silence",
    "vad_threshold",
  ]) {
    const v = $(id).value.trim();
    if (v !== "") p.set(id, v);
  }

  const keyterms = parseKeyterms();
  if (keyterms.length) p.set("keyterms_prompt", JSON.stringify(keyterms));

  const prompt = $("prompt").value.trim();
  if (prompt) p.set("prompt", prompt);

  const gateway = $("llm_gateway").value.trim();
  if (gateway) {
    try {
      // Validate before sending — a malformed blob here closes the
      // socket with a generic error and looks like a mic problem.
      p.set("llm_gateway", JSON.stringify(JSON.parse(gateway)));
    } catch (err) {
      throw new Error(`llm_gateway is not valid JSON: ${err.message}`);
    }
  }

  return p;
}

// ------------------------------------------------------------- prompter

/** Flatten a round definition into one expected utterance per turn. */
function buildExpectedQueue(key) {
  const r = rounds[key];
  if (!r) return [];
  const lines = r.sameLinesAs ? rounds[r.sameLinesAs]?.lines || [] : r.lines || [];

  if (r.mode === "sequential") {
    return lines.map((l, i) => ({ ...l, round: key, lineIndex: i }));
  }
  if (r.mode === "paired") {
    // Two utterances per pair, in the order they should be spoken. The
    // scorer needs to know which one was *meant* to start first, since
    // that's the whole claim being tested about audio timestamps.
    return (r.pairs || []).flatMap((p, i) => [
      { ...p.first, step: p.step, intent: "claim", round: key, lineIndex: i, pairRole: "first", stagger: p.stagger },
      { ...p.second, step: p.step, intent: "claim", round: key, lineIndex: i, pairRole: "second", stagger: p.stagger },
    ]);
  }
  if (r.mode === "mixed") {
    // One round that interleaves calibration lines, commands, cross-talk
    // pairs and ambient traps, so the whole smoke test runs on a single
    // connection. Banners are signposts for the humans — they don't
    // consume a turn, they ride along on the next utterance.
    const out = [];
    let banner = null;
    (r.entries || []).forEach((e, i) => {
      if (e.kind === "banner") {
        banner = e.text;
        return;
      }
      const base = { round: key, lineIndex: i, banner };
      banner = null;
      if (e.kind === "pair") {
        out.push({ ...e.first, ...base, step: e.step, stepExpect: e.stepExpect, intent: "claim", pairRole: "first", stagger: e.stagger });
        out.push({ ...e.second, ...base, step: e.step, stepExpect: e.stepExpect, intent: "claim", pairRole: "second", stagger: e.stagger });
      } else if (e.kind === "trap") {
        // Stamped, unlike a freeform round: we know an ambient line was
        // coming, so a name appearing in it is unambiguously a failure.
        out.push({ ...e, ...base, speaker: null, kind: "trap" });
      } else {
        out.push({ ...e, ...base });
      }
    });
    return out;
  }

  // freeform (R6): no per-turn expectation — the whole point is that
  // nothing said should be a command.
  return [];
}

function selectRound(key) {
  roundKey = key;
  expectedQueue = buildExpectedQueue(key);
  expectedIdx = 0;
  $("round").value = key;
  renderPrompter();
}

function renderPrompter() {
  const r = rounds[roundKey];
  const el = $("prompter");
  if (!r) {
    el.innerHTML = `<p class="prompter-idle">No round selected — free exploration. Turns won't be stamped, so this session can't be auto-scored.</p>`;
    return;
  }

  if (r.mode === "freeform") {
    el.innerHTML = `
      <div class="prompter-head"><span class="tag warn">freeform · ${r.durationSeconds}s</span><span class="prompter-label">${r.label}</span></div>
      <p class="prompter-note">${r.note}</p>
      <ul class="traps">${(r.traps || []).map((t) => `<li>“${t}”</li>`).join("")}</ul>`;
    return;
  }

  const cur = expectedQueue[expectedIdx];
  const done = expectedIdx >= expectedQueue.length;
  const next = expectedQueue[expectedIdx + 1];

  el.innerHTML = `
    <div class="prompter-head">
      <span class="tag">${expectedIdx}/${expectedQueue.length}</span>
      <span class="prompter-label">${r.label}</span>
      ${r.note ? `<span class="prompter-note-inline">${r.note}</span>` : ""}
    </div>
    ${
      done
        ? `<p class="prompter-done">Round complete — hit <strong>Download log</strong>.</p>`
        : `${cur.banner ? `<p class="prompter-banner">${cur.banner}</p>` : ""}
           <div class="prompter-line">
             <span class="speaker speaker-${(cur.speaker || "either").toLowerCase()}">${cur.speaker || "either of you"}</span>
             ${cur.pairRole ? `<span class="tag ${cur.pairRole === "first" ? "ok" : ""}">${cur.pairRole} · ${cur.stagger}</span>` : ""}
             ${cur.delivery ? `<span class="tag warn">${cur.delivery}</span>` : ""}
             ${cur.addressed === false ? `<span class="tag warn">must be REJECTED</span>` : ""}
             ${cur.kind === "trap" ? `<span class="tag warn">say it naturally · NO NAMES</span>` : ""}
             <p class="prompter-text">${cur.text}</p>
           </div>
           ${next ? `<p class="prompter-next">next — <strong>${next.speaker}</strong>: ${next.text}</p>` : ""}`
    }`;
}

/** One term per line. 100 max, 50 chars each — over either is dropped. */
function parseKeyterms() {
  const all = $("keyterms")
    .value.split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = all.filter((t) => t.length <= 50).slice(0, 100);
  if (kept.length !== all.length) {
    note(`${all.length - kept.length} keyterm(s) dropped (>50 chars or over the 100 limit)`);
  }
  return kept;
}

// ------------------------------------------------------------ connection

async function connect() {
  setStatus("connecting", "Connecting");
  log = [];
  turns = [];
  pcmChunks = [];
  pcmSamples = 0;
  audioZeroSample = null;
  renderTurns();
  renderRaw();

  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        // Let Voice Focus do the work server-side; stacking browser DSP
        // on top makes results impossible to attribute to either one.
        echoCancellation: $("browser_dsp").checked,
        noiseSuppression: $("browser_dsp").checked,
        autoGainControl: $("browser_dsp").checked,
      },
    });
  } catch (err) {
    return fail(`Microphone denied or unavailable: ${err.message}`);
  }

  audioCtx = new AudioContext();
  await audioCtx.audioWorklet.addModule("pcm-processor.js");

  let token;
  try {
    const res = await fetch("/api/token?expires_in_seconds=60&max_session_duration_seconds=600");
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `Token request failed (${res.status})`);
    token = body.token;
  } catch (err) {
    return fail(err.message);
  }

  let params;
  try {
    params = buildParams(token);
  } catch (err) {
    return fail(err.message);
  }

  // Record exactly what was sent, minus the credential. Without this a
  // downloaded log can't be trusted to describe its own run.
  sentParams = Object.fromEntries([...params].filter(([k]) => k !== "token"));
  push("out", { type: "_connect", params: sentParams });

  ws = new WebSocket(`${WS_BASE}?${params}`);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => startAudio();
  ws.onmessage = (ev) => handleMessage(JSON.parse(ev.data));
  ws.onerror = () => fail("WebSocket error — see the browser console");
  ws.onclose = (ev) => {
    stopAudio();
    setStatus("idle", ev.code === 1000 ? "Closed" : `Closed (${ev.code})`);
    $("connect").textContent = "Connect";
  };
}

function startAudio() {
  labSampleRate = audioCtx.sampleRate;
  const chunkSamples = Math.round((audioCtx.sampleRate * CHUNK_MS) / 1000);
  const source = audioCtx.createMediaStreamSource(micStream);
  workletNode = new AudioWorkletNode(audioCtx, "pcm-processor", {
    processorOptions: { chunkSamples },
  });

  workletNode.port.onmessage = ({ data }) => {
    drawMeter(data.peak);
    if (pcmSamples < MAX_RECORD_SECONDS * audioCtx.sampleRate) {
      pcmChunks.push(data.pcm);
      pcmSamples += data.pcm.length;
    }
    if (ws?.readyState === WebSocket.OPEN) {
      // Raw binary frame. Not JSON, not base64 — wrapping it is the
      // single most common way to get silence back from this API.
      ws.send(data.pcm.buffer);
    }
  };

  source.connect(workletNode);
  // Terminating node so the worklet is actually pulled. Gain 0 keeps
  // the mic out of the speakers (and out of its own transcript).
  const sink = audioCtx.createGain();
  sink.gain.value = 0;
  workletNode.connect(sink).connect(audioCtx.destination);

  setStatus("live", `Live · ${audioCtx.sampleRate} Hz`);
  $("connect").textContent = "Disconnect";
}

function stopAudio() {
  workletNode?.port.close();
  workletNode?.disconnect();
  micStream?.getTracks().forEach((t) => t.stop());
  audioCtx?.close();
  workletNode = null;
  micStream = null;
  audioCtx = null;
  drawMeter(0);
}

function disconnect() {
  if (ws?.readyState !== WebSocket.OPEN) {
    ws?.close();
    return;
  }
  // Terminate flushes the final turn and stops the billing clock.
  // Sessions bill on connection-open time, not audio sent, so a socket
  // left open overnight is a real charge.
  ws.send(JSON.stringify({ type: "Terminate" }));
  push("out", { type: "Terminate" });

  // Do NOT close immediately. The docs are explicit: closing the socket
  // as soon as you send Terminate silently discards the last transcript,
  // the SpeakerRevision (worth ~400ms of extra latency at close), and the
  // Termination totals. Wait for the server to finish, with a timeout so
  // a dropped connection can't hang the button forever.
  setStatus("connecting", "Finishing…");
  const hardStop = setTimeout(() => {
    note("Server didn't send Termination within 3s — closing anyway.");
    ws?.close();
  }, 3000);
  terminationTimer = hardStop;
}

/** Push new keyterms / turn settings without reconnecting. */
function applyLive() {
  if (ws?.readyState !== WebSocket.OPEN) return note("Not connected.");
  const msg = { type: "UpdateConfiguration", keyterms_prompt: parseKeyterms() };
  for (const id of [
    "end_of_turn_confidence_threshold",
    "min_turn_silence",
    "max_turn_silence",
  ]) {
    const v = $(id).value.trim();
    if (v !== "") msg[id] = Number(v);
  }
  ws.send(JSON.stringify(msg));
  push("out", msg);
  note("Configuration updated mid-stream.");
}

// -------------------------------------------------------------- messages

function handleMessage(msg) {
  push("in", msg);

  switch (msg.type) {
    case "Begin": {
      sessionStartWall = Date.now();
      // Audio capture starts at ws.onopen, slightly before Begin. Pin the
      // sample offset now so slicing by the API's ms timestamps lands on
      // the right audio.
      audioZeroSample = pcmSamples;
      const echoed = msg.configuration || {};
      note(`Session ${msg.id} · model ${echoed.model ?? "?"} · mode ${echoed.mode ?? "?"}`);

      // The docs are explicit: unrecognized or misspelled query params are
      // IGNORED, not rejected. This echo is the only signal that what we
      // asked for is what we got — so check it rather than assume.
      if (echoed.model && echoed.model !== sentParams.speech_model) {
        note(
          `⚠ MODEL MISMATCH — asked for "${sentParams.speech_model}", got "${echoed.model}". ` +
            `Any model-gated feature (Voice Focus) is NOT running. Discard this round.`,
        );
        setStatus("error", "Config mismatch");
      }
      renderConfigEcho(echoed);
      break;
    }

    case "Turn":
      if (msg.end_of_turn) {
        // Stamp the line this turn was supposed to be, then advance. One
        // scripted line == one turn, so the pointer walks in lockstep; if
        // someone flubs, Redo steps it back and marks the turn discarded.
        const expected = expectedQueue[expectedIdx] || null;
        if (expected) expectedIdx += 1;
        turns.push({ ...decorate(msg), _expected: expected, _round: roundKey || null });
        renderTurns();
        renderPrompter();
        $("partial").textContent = "";
      } else {
        $("partial").textContent = msg.transcript || "";
      }
      break;

    case "SpeakerRevision": {
      // At session close the server re-runs diarization with the whole
      // conversation in view and sends back only the turns whose labels
      // changed. Early turns are the usual candidates — the model has the
      // least embedding context at the start.
      //
      // Scoring the live labels alone would understate diarization, so
      // apply the corrections but keep the original: the gap between them
      // is itself informative (how much did it need hindsight?).
      let changed = 0;
      for (const rev of msg.revisions || []) {
        const t = turns.find((x) => x.turn_order === rev.turn_order);
        if (!t) continue;
        if (t._speakerLabelLive === undefined) t._speakerLabelLive = t.speaker_label;
        t.speaker_label = rev.speaker_label;
        t._speakerRevised = true;
        if (rev.words) {
          const byStart = new Map(rev.words.map((w) => [w.start, w.speaker]));
          t.words = (t.words || []).map((w) =>
            byStart.has(w.start) ? { ...w, speaker: byStart.get(w.start) } : w,
          );
        }
        changed += 1;
      }
      note(`Speaker labels revised on ${changed} turn(s) at session close.`);
      renderTurns();
      break;
    }

    case "Termination":
      clearTimeout(terminationTimer);
      terminationTimer = null;
      // Everything is in now — including any SpeakerRevision, which
      // arrives just before this. Safe to close.
      setTimeout(() => ws?.close(), 0);
      note(
        `Terminated · ${msg.audio_duration_seconds}s audio / ${msg.session_duration_seconds}s session`,
      );
      break;

    case "Error":
      fail(`${msg.error_code}: ${msg.error}`);
      break;

    default:
      break;
  }
  renderRaw();
}

/**
 * Add the two numbers the test plan actually asks for.
 *
 * `finalizeLagMs` is wall-clock-since-Begin minus the audio timestamp of
 * the last word — i.e. how long after you stopped talking the turn was
 * declared over. That's the R7 metric, and it's the one that decides
 * whether "Lindy, done" feels instant or sluggish.
 */
function decorate(msg) {
  const words = msg.words || [];
  const first = words[0];
  const last = words[words.length - 1];
  const speechEndMs = last?.end ?? null;
  return {
    ...msg,
    _receivedWall: Date.now(),
    _firstWordStartMs: first?.start ?? null,
    _speechEndMs: speechEndMs,
    _durationMs: first && last ? last.end - first.start : null,
    _finalizeLagMs: speechEndMs === null ? null : Date.now() - sessionStartWall - speechEndMs,
    _minWordConfidence: words.length ? Math.min(...words.map((w) => w.confidence ?? 1)) : null,
  };
}

function push(dir, msg) {
  log.push({ at: new Date().toISOString(), sinceBeginMs: sessionStartWall ? Date.now() - sessionStartWall : null, dir, msg });
}

// ------------------------------------------------------------------- ui

function setStatus(kind, text) {
  const el = $("status");
  el.className = `status ${kind}`;
  el.textContent = text;
}

function fail(message) {
  setStatus("error", "Error");
  note(message);
  console.error(message);
}

function note(text) {
  const el = document.createElement("div");
  el.className = "note";
  el.textContent = text;
  $("notes").prepend(el);
}

function drawMeter(peak) {
  $("meter-fill").style.width = `${Math.min(100, peak * 140)}%`;
}

const fmt = (n, unit = "") => (n === null || n === undefined ? "—" : `${Math.round(n)}${unit}`);

/**
 * Show what we sent next to what the server echoed back.
 *
 * Voice Focus and the turn-detection params are NOT echoed in `Begin`, so
 * this can only ever prove the model took. That's still the difference
 * between "Voice Focus didn't help" and "Voice Focus never ran", which is
 * the difference between a finding and a wasted afternoon.
 */
function renderConfigEcho(echoed) {
  const rows = [
    ["model", sentParams.speech_model, echoed.model],
    ["mode", sentParams.mode || "(default)", echoed.mode],
    ["voice_focus", sentParams.voice_focus || "off", "not echoed"],
    ["speaker_labels", sentParams.speaker_labels || "false", "not echoed"],
    ["sample_rate", sentParams.sample_rate, "not echoed"],
  ];
  $("config-echo").innerHTML = rows
    .map(([k, sent, got]) => {
      const bad = got !== "not echoed" && String(sent) !== String(got);
      return `<span class="tag ${bad ? "warn" : ""}">${k}: ${sent}${
        got === "not echoed" ? "" : ` → ${got}`
      }</span>`;
    })
    .join(" ");
}

function renderTurns() {
  $("turn-count").textContent = turns.length;
  $("turns").innerHTML = turns
    .slice()
    .reverse()
    .map((t) => {
      const speaker = t.speaker_label
        ? `<span class="tag ${t.speaker_label === "PENDING" ? "warn" : "ok"}">speaker ${t.speaker_label}</span>`
        : "";
      const words = (t.words || [])
        .map(
          (w) =>
            `<span class="word ${(w.confidence ?? 1) < 0.6 ? "low" : ""}" title="${w.start}–${w.end}ms · conf ${(w.confidence ?? 1).toFixed(2)}${w.speaker ? ` · ${w.speaker}` : ""}">${w.text}</span>`,
        )
        .join(" ");
      const exp = t._expected;
      return `
        <article class="turn${t._discarded ? " discarded" : ""}">
          ${
            exp
              ? `<p class="prompter-next" style="margin:0 0 6px">expected — <strong>${exp.speaker}</strong>: “${exp.text}”</p>`
              : ""
          }
          <header>
            <span class="tag">#${t.turn_order}</span>
            ${t._discarded ? `<span class="tag warn">discarded</span>` : ""}
            ${speaker}
            ${t._speakerRevised ? `<span class="tag warn">revised from ${t._speakerLabelLive}</span>` : ""}
            <span class="tag">eot conf ${(t.end_of_turn_confidence ?? 0).toFixed(2)}</span>
            <span class="tag ${t._finalizeLagMs > 700 ? "warn" : "ok"}">finalize ${fmt(t._finalizeLagMs, "ms")}</span>
            <span class="tag">start ${fmt(t._firstWordStartMs, "ms")}</span>
            <span class="tag">dur ${fmt(t._durationMs, "ms")}</span>
            <span class="tag ${t._minWordConfidence < 0.6 ? "warn" : ""}">min conf ${t._minWordConfidence === null ? "—" : t._minWordConfidence.toFixed(2)}</span>
          </header>
          <p class="transcript">${t.transcript || "<em>(empty)</em>"}</p>
          <div class="words">${words}</div>
        </article>`;
    })
    .join("");
}

function renderRaw() {
  $("raw-count").textContent = log.length;
  if (!$("panel-raw").classList.contains("active")) return;
  $("raw").textContent = log
    .slice(-200)
    .map((e) => `${e.dir === "in" ? "←" : "→"} ${String(e.sinceBeginMs ?? "").padStart(6)}ms  ${JSON.stringify(e.msg)}`)
    .join("\n");
}

/** Concatenate the captured chunks into a mono 16-bit PCM WAV blob. */
function buildWav(sampleRate) {
  const total = pcmChunks.reduce((n, c) => n + c.length, 0);
  const pcm = new Int16Array(total);
  let at = 0;
  for (const c of pcmChunks) {
    pcm.set(c, at);
    at += c.length;
  }
  const bytes = pcm.length * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const ascii = (off, str) => [...str].forEach((ch, i) => v.setUint8(off + i, ch.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 36 + bytes, true);
  ascii(8, "WAVEfmt ");
  v.setUint32(16, 16, true); // PCM header size
  v.setUint16(20, 1, true); // format = PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  v.setUint32(40, bytes, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: "audio/wav" });
}

function save(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadLog() {
  const round = roundKey || "session";
  const stamp = Date.now();
  const blob = new Blob(
    [
      JSON.stringify(
        {
          round,
          roundKey,
          // The scorer reads rounds.json itself rather than trusting a
          // copy embedded here, so this is a tripwire: if they disagree,
          // the round definition changed after the recording.
          expectedCount: expectedQueue.length,
          recordedAt: new Date().toISOString(),
          // Shared clock for offline analysis: audioZeroSample is the
          // sample index where the API's t=0 falls.
          audio: pcmSamples
            ? {
                file: `${roundKey || "session"}-${stamp}.wav`,
                sampleRate: labSampleRate,
                zeroSample: audioZeroSample ?? 0,
                durationSeconds: Number((pcmSamples / labSampleRate).toFixed(2)),
              }
            : null,
          config: Object.fromEntries(
            [
              "speech_model", "mode", "voice_focus", "voice_focus_threshold",
              "speaker_labels", "max_speakers", "format_turns", "browser_dsp",
              "end_of_turn_confidence_threshold", "min_turn_silence",
              "max_turn_silence", "vad_threshold",
            ].map((id) => [id, $(id).type === "checkbox" ? $(id).checked : $(id).value]),
          ),
          // The form's state at download time; sentParams is what the
          // socket actually got. They differ if you changed a control
          // mid-round, which is exactly when you'd be misled.
          sentParams,
          keyterms: parseKeyterms(),
          prompt: $("prompt").value,
          turnCount: turns.length,
          turns,
          log,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  save(blob, `${round}-${stamp}.json`);
  if (pcmSamples) {
    save(buildWav(labSampleRate), `${roundKey || "session"}-${stamp}.wav`);
    note(`Saved ${(pcmSamples / labSampleRate).toFixed(1)}s of audio alongside the log.`);
  } else {
    note("No audio captured — the log alone can't be re-analysed offline.");
  }
}

function applyPreset(key) {
  const p = PRESETS[key];
  if (!p) return;
  $("speech_model").value = p.speech_model;
  $("mode").value = p.mode;
  $("voice_focus").value = p.voice_focus;
  $("speaker_labels").checked = p.speaker_labels;
  $("max_speakers").value = p.max_speakers;
  $("format_turns").checked = p.format_turns;
  $("keyterms").value = p.keyterms;
  $("prompt").value = p.prompt;
  note(`Preset: ${p.label}. Reconnect to apply model/voice-focus changes.`);
}

// ---------------------------------------------------------------- wiring

$("connect").addEventListener("click", () => {
  if (ws && ws.readyState <= WebSocket.OPEN) disconnect();
  else connect();
});
$("apply-live").addEventListener("click", applyLive);
$("download").addEventListener("click", downloadLog);
$("clear").addEventListener("click", () => {
  log = [];
  turns = [];
  $("notes").innerHTML = "";
  renderTurns();
  renderRaw();
});
document.querySelectorAll("[data-preset]").forEach((b) =>
  b.addEventListener("click", () => applyPreset(b.dataset.preset)),
);

$("round").addEventListener("change", () => selectRound($("round").value));

// Flubbed a line, or the mic split one utterance into two turns. Step the
// pointer back and mark the bad turn so the scorer skips it instead of
// grading it against the wrong line.
$("redo").addEventListener("click", () => {
  const last = turns[turns.length - 1];
  if (!last) return note("Nothing to redo.");
  last._discarded = true;
  if (expectedIdx > 0) expectedIdx -= 1;
  renderTurns();
  renderPrompter();
  note(`Discarded turn #${last.turn_order} — re-read the line.`);
});

// Load the scripts. The scorer reads this same file, so the lab and the
// grader can never disagree about what was supposed to be said.
fetch("rounds.json")
  .then((r) => r.json())
  .then((data) => {
    rounds = data;
    // Grouped, because a flat list of thirteen rounds gives no clue which
    // one to run. There is exactly one starting point; everything else is
    // a follow-up you only reach for if R-core flags something.
    const sel = $("round");
    const groups = new Map();
    for (const [k, v] of Object.entries(rounds)) {
      if (k.startsWith("_")) continue;
      const g = v.group || "Other";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push([k, v]);
    }
    const order = ["Run this", "If something looks broken"];
    const sorted = [...groups].sort(
      (a, b) =>
        (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99),
    );
    sel.innerHTML =
      sorted
        .map(
          ([g, items]) =>
            `<optgroup label="${g}">` +
            items.map(([k, v]) => `<option value="${k}">${k} · ${v.label}</option>`).join("") +
            `</optgroup>`,
        )
        .join("") + `<optgroup label="—"><option value="">free exploration (not scored)</option></optgroup>`;

    // Default to the one round anyone should start with.
    if (rounds["R-core"]) selectRound("R-core");
    else renderPrompter();
  })
  .catch((err) => note(`Could not load rounds.json: ${err.message}`));
document.querySelectorAll("[data-tab]").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".panel").forEach((p) =>
      p.classList.toggle("active", p.id === `panel-${b.dataset.tab}`),
    );
    renderRaw();
  }),
);

// A socket left open bills until it times out. Closing the tab should
// not cost money.
window.addEventListener("beforeunload", disconnect);

applyPreset("kitchen");
