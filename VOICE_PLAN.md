# Voice build plan — AssemblyAI integration

Companion to `HANDOFF.md`. That doc says where the seams are; this one
says what goes in them, in what order, and how we know each step worked.

**Nothing touches the app until Stage C.** Stage A is a standalone lab
(`voice-lab/`, `npm run lab`) that exists to find out what the APIs
actually do. Stage B is deciding, on evidence. Only then do we integrate.
Test procedure is in `VOICE_TEST_PLAN.md`.

---

## Stage A — Explore, outside the app ✅ built

`voice-lab/` is a zero-dependency page and server that opens a real
streaming session and shows every field that comes back: live partials,
per-turn `speaker_label` / `end_of_turn_confidence` / finalize latency,
per-word timestamps and confidence, and the raw frame log. Every v3
parameter is a control on the page. Sessions download as labelled JSON.

It imports nothing from `src/` or `server/`, and nothing imports it.
Delete the folder when it's done its job.

```bash
npm run lab        # → http://localhost:3100
```

See `voice-lab/README.md` for what each control does and the API
gotchas worth knowing before you start (Voice Focus is pro-model only;
browser DSP contaminates Voice Focus results; sub-1s turns get
`PENDING` speakers; billing is on connection time, not audio).

**Go play with it.** Everything below is provisional until you have.

---

## Stage B — Decide, on evidence

### The proposed split (to confirm, not assume)

| Stage | Path | Reasoning |
|---|---|---|
| Conversation (elicitation) | **Voice Agent API** | One human, one agent, strict turn-taking — what the managed pipeline is for. JSON-Schema tool calling fills the answers reducer directly. AssemblyAI's own guidance agrees: use this when "speech in, speech out is the whole product". |
| Live cook | **Real-time STT** (`wss://streaming.assemblyai.com/v3/ws`) | 2+ cooks, agent silent unless addressed, and an LLM+TTS round-trip in the loop would wreck claim arbitration. We already own the orchestration (`voiceCommands.js`, `liveCook.js`) — and AssemblyAI's guidance says bring-your-own-LLM-and-TTS belongs on Streaming STT, not the agent endpoint. |
| Diary card | **Speech Understanding** (async) | Real sentiment analysis over the finished session. Latency is free here. |

### The open question: single-device speaker identity

We want **one device, one mic** — not a connection per cook. That's the
realistic kitchen setup and the easier demo. The cost is that speaker
identity gets hard.

Streaming diarization exists (`speaker_labels: true`, `max_speakers`),
but three things land on our use case:

- turns under ~1s come back `speaker_label: "PENDING"` — and "done!" is
  about 0.4s
- overlapping speech collapses to one speaker, and competition mode is
  *designed* to make two people talk at once
- **both testers are women.** Diarization separates speakers by voice
  embedding, and two voices in a similar pitch range sit closer together
  in that space than the mixed-gender pairs most demos assume. This is
  the realistic case for this app — housemates, couples, friends cooking
  together are often same-gender — so it's the right thing to test, but
  expect worse separation than the docs' caveats suggest.

And there is **no voice enrollment anywhere in AssemblyAI** — Speaker
Identification (Speech Understanding) infers names from conversation
*content*, not audio, and only on pre-recorded files. Nothing can be
taught whose voice is whose. `R-cal` in the test plan measures what
diarization does unaided; that's the ceiling.

**Hypothesis:** diarization can't be the source of truth, so names
become mandatory in the command grammar — "Lindy, done", not "done".

If that holds, it buys four things at once:

1. identity comes from the transcript text: exact, no embedding
   warm-up, immune to cross-talk
2. the utterance crosses the ~1s threshold, so diarization starts
   working and becomes a free cross-check
3. it doubles as a **wake word**. Without it, every sentence in the
   kitchen runs through `parseCommand` — "I'm done with this wine"
   fires `finish_run`. This is the biggest correctness risk in the
   feature, and the name prefix is what kills it.
4. it demos better; a judge watching a video can follow who claimed what

**This is a hypothesis, not a decision.** R2, R3, R5 and R6 in the test
plan are what confirm or kill it. Possible outcomes:

- *Confirmed* → proposed precedence is **name in text → diarization
  `speaker_label` → manual dropdown override** (the existing `speakerId`
  control at `LiveCookPage.jsx:57`, kept as the escape hatch).
- *Diarization turns out better than the docs imply* (R-cal agreement
  ≥ 90%) → drop the mandatory prefix, keep names optional as a
  disambiguator.
- *Both are shaky* → fall back to a connection per cook (phones), and
  accept the messier setup. Still entirely viable; just a worse demo.

**Run `R-cal` before anything else.** One minute, eight lines, and it
tells you which of these three branches you're on — before spending an
hour on rounds that assume diarization works.

### What to write down at the end of Stage B

- which path per stage, and why
- how speaker identity is resolved, with the measured numbers behind it
- the config we're standardising on (model, mode, voice focus, turn
  detection values) — these go in `.env`, not scattered in the client
- which risks are retired and which we're accepting

---

## Stage C — Integrate (not before B)

Ordered by risk retired per hour. Nothing here starts until the Stage B
decisions are written down.

### C1 — Token endpoints in the real server

`server/routes/voice.js`, mounted in `server/index.js` alongside the
existing routers. **Two endpoints, because the two products differ in
both URL and auth scheme** — this is the trap AssemblyAI's own agent
instructions call out, so encode it once here and never think about it
again:

```
GET /api/voice/stt-token          → for the live cook (Streaming STT)
  upstream: https://streaming.assemblyai.com/v3/token
            ?expires_in_seconds=60 &max_session_duration_seconds=10800
  header:   Authorization: <key>            // RAW, no prefix

GET /api/voice/agent-token        → for the conversation (Voice Agent)
  upstream: https://agents.assemblyai.com/v1/token
            ?expires_in_seconds=300 &max_session_duration_seconds=8640
  header:   Authorization: Bearer <key>     // Bearer, only here
```

Both verified working against our key. The key never reaches the
browser — that's the whole reason these exist. Readable 503 when the key
is missing, so a fresh clone fails legibly. Lift the STT implementation
from `voice-lab/server.js`; it's already proven.

Agent tokens are **single-use per session** — mint a fresh one on every
reconnect, including `session.resume`. Don't cache them.

### C2 — Speaker + name resolution in the parser (no API key, no mic)

Today `parseCommand` never looks at names; `LiveCookPage` passes
`cookId` from the dropdown. Add to `src/utils/voiceCommands.js`:

```js
resolveSpeaker(text, cooks) -> { cookId, rest, confidence }
```

Strips a leading name ("Lindy, done", "Lindy done", "this is Zeina, I'll take
the garlic") and returns the matched cook plus the remaining text.
Fuzzy-match names the way `resolveStepRef` already fuzzy-matches step
labels — STT won't always spell a name right, and the candidate list is
two people long.

`parseCommand` then runs `detectIntent` on `rest`, not `text`, and gains
an `addressed: boolean`. `LiveCookPage` ignores utterances where
`addressed === false` unless the dropdown is explicitly overriding.

Pure functions, no I/O. **Build the fixture table from the transcripts
Stage A produced**, not from invented strings — that's the point of
keeping the JSON logs.

### C3 — Streaming hook + live cook wiring

Port `voice-lab/app.js`'s socket and `pcm-processor.js` into
`src/hooks/useStreamingTranscript.js`. On `end_of_turn: true` →
`resolveSpeaker` → the existing `handleUtterance(cookId, text)` at
`LiveCookPage.jsx:242`. Nothing downstream changes.

Bind the real stream to the chrome that already fakes it: `VoiceBar`'s
`voice-transcript-text` shows live partials, its four `meter-bar`
elements take real RMS from the worklet.

**Arbitrate claims on `words[0].start`** (ms from stream start), not
message arrival order. Two cooks on one mic share a clock, so this is
exact where arrival order is a coin flip. Most technically defensible
detail in the project — make it real, not approximate.

### C4 — Voice binding becomes real

Replace `RECORDING_DURATION_MS`'s staged animation in
`VoiceBindingPage.jsx` with a short real capture that (a) confirms the
cook's name transcribes correctly and (b) registers it as a keyterm.
Same screen, same UX, now load-bearing.

If a name is chronically mistranscribed, the honest fix is to change the
name — and this is the screen that catches it.

### C5 — Keyterms from the approved graph

On session open, send `keyterms_prompt` with both cook names, every step
label from the approved graph, and ingredient names. Re-send via
`UpdateConfiguration` on replan — no reconnect. Voice Focus on.

Cheapest accuracy win available; improves `resolveStepRef`'s hit rate
without touching the matcher. Stage A gives you the before/after numbers
to prove it was worth it.

### C6 — Composure via LLM Gateway

Sentiment is *not* a streaming feature. But an `llm_gateway` block in
the connection config fires per completed turn and returns
`LLMGatewayResponse` over the same socket:

```json
{ "model": "claude-sonnet-4-6",
  "messages": [{ "role": "user", "content": "{{turn}}" }],
  "max_tokens": 4000 }
```

Prompt for `{"composure": "calm|strained|panicked", "confidence": 0-1}` —
the third term in competition mode's difficulty × quality × composure
score, currently unbacked. Structured outputs aren't documented for the
streaming path, so validate the JSON, fall back to `calm`, and never
block a command waiting on it.

### C7 — Conversation via Voice Agent API

`wss://agents.assemblyai.com/v1/ws`. Single connection; AssemblyAI owns
STT/LLM/TTS/turn-taking. Vendor reference checked in verbatim at
`docs/assemblyai-voice-agent-api.md` — read it before writing any of
this, because almost nothing transfers from the streaming path.

**Nothing about this shares shape with the live-cook socket.** Auth is
`Bearer`, audio is base64 inside JSON events (not binary frames), the
rate is fixed at 24 kHz, and config goes in a `session.update` message
rather than query params. Build it at 24 kHz by constructing the
`AudioContext` with `{ sampleRate: 24000 }` and letting the browser
resample — don't write your own resampler.

Lifecycle: send `session.update` **immediately on open** (don't wait),
then start sending `input.audio` **only after `session.ready`**. Note the
field asymmetry — `input.audio` carries audio in `audio`, `reply.audio`
carries it in `data`.

Tools use a **flat** schema (`{type, name, description, parameters}`),
not OpenAI's nested form. One tool does the job:

```json
{ "type": "function", "name": "record_answer",
  "description": "Record the cook's answer to the current setup question.",
  "parameters": { "type": "object",
    "properties": {
      "field": { "type": "string", "enum": ["dish","servings","diet","targetTime","cooks"] },
      "value": { "type": "string" },
      "label": { "type": "string" } },
    "required": ["field","value"] } }
```

Wire it to the existing `onAnswer(value, label)` contract in
`VoiceInput.jsx` — that seam is already the right shape. Send
`tool.result` **after** `reply.done`, and discard pending results when
`reply.done.status === "interrupted"`. Optionally add `propose_dishes`
replacing `matchTemplates` in `RecipeGraphPage`.

Pick a voice id from the published list (default `anna`); invented names
fail silently at `session.update`. Turn on `getUserMedia`'s
`echoCancellation` / `noiseSuppression` / `autoGainControl` here — unlike
the streaming path, where we deliberately leave them off to isolate Voice
Focus, this is a full-duplex loop and hardware AEC is what stops the
agent's own TTS being transcribed as the user.

Lowest-risk phase, because AssemblyAI owns the pipeline. Deliberately
last.

### C8 — Diary sentiment

Save session audio, submit async with `sentiment_analysis: true`, get
per-sentence `POSITIVE` / `NEUTRAL` / `NEGATIVE` with speaker labels and
ms timestamps. Plot sentiment-per-cook against the schedule on the
summary card. The real model, not the live approximation.

---

## Risk ranking (honest)

1. **False-positive commands from ambient kitchen chatter** — the name
   prefix is the proposed mitigation. R6 is a hard gate.
2. **Cross-talk during simultaneous claims** — name prefix plus
   audio-timestamp arbitration. Residual risk is real; measure it (R5).
3. **Short-utterance accuracy at 1.5m over extractor-fan noise** —
   Voice Focus and keyterms. Measurable, tunable (R1, R3).
4. Step-label matching — already scoped to three candidates, low risk (R4).
5. Voice Agent API conversation — low risk, managed pipeline.

None is a research problem. All are measurable in Stage A, which is why
Stage A comes first.
