# Voice Lab

A bench instrument for AssemblyAI Real-time STT. **Not part of the app.**

Nothing in this folder imports from `src/` or `server/`, and nothing in
the app imports from here. It has no dependencies — plain `node:http`
and plain browser JS — so it can't drift with the app's package tree,
and you can delete the whole folder when it has told you what you need.

Its only tie to the rest of the repo is reading `ASSEMBLYAI_API_KEY`
from the root `.env`.

## Run it

```bash
npm run lab        # → http://localhost:3100
```

The app doesn't need to be running. Nothing shares a port (app: 5173,
API: 3001, lab: 3100).

Grant microphone access when the browser asks. `localhost` counts as a
secure context, so no HTTPS setup is needed.

## What it does

Opens a real streaming session and shows you everything that comes back:

- **Live partials** as you speak, then each finalized turn as a card
- Per turn: `turn_order`, `speaker_label`, `end_of_turn_confidence`,
  first-word audio timestamp, speech duration, lowest word confidence
- **`finalize ___ms`** — how long after you stopped talking the turn was
  declared over. Turns amber past 700ms. This is the number that decides
  whether "Lindy, done" feels instant or sluggish.
- Per word: hover for `start`/`end` ms, confidence, and speaker. Words
  under 0.6 confidence are marked in red.
- **Raw messages** tab: every frame in and out, timestamped against
  session start
- **Download log**: the whole session as JSON — the exact params sent,
  keyterms, every turn with its expected line, and the raw frame log —
  named after the selected round

## What you can change

Everything the v3 endpoint accepts, grouped by what it affects:

| Group | Params |
|---|---|
| Model | `speech_model`, `mode`, `format_turns` |
| Noise | `voice_focus` (`near-field` / `far-field`), `voice_focus_threshold`, browser AEC/NS/AGC toggle |
| Speakers | `speaker_labels`, `max_speakers` |
| Turn detection | `end_of_turn_confidence_threshold`, `vad_threshold`, `min_turn_silence`, `max_turn_silence` |
| Accuracy steering | `keyterms_prompt`, `prompt` |
| Per-turn LLM | `llm_gateway` (JSON) |

Three presets: **Bare** (nothing on, for a baseline), **Kitchen**
(far-field + cook/dish keyterms + diarization), **Fast commands**
(`min_latency`, no formatting).

**Apply live** pushes keyterms and turn-detection changes mid-stream via
`UpdateConfiguration` — no reconnect, no lost session. Model and
voice-focus changes do need a reconnect.

## Things worth knowing

- **Voice Focus is `universal-3-5-pro` only**, and does nothing on the
  other models *without telling you* — the API ignores unrecognized
  query params rather than rejecting them. The page refuses to connect
  on that combination rather than let it quietly spoil a round.
- **Check the config echo** under the tabs. `Begin` echoes back the
  model and mode the server actually used, and the page flags a
  mismatch loudly. Voice Focus and the turn-detection params are *not*
  echoed, so the model line is the only proof any model-gated feature
  is live. A round with a mismatch warning should be discarded.
- **Turn down browser DSP while testing Voice Focus.** Stacking browser
  noise suppression on top of the server's makes any result impossible
  to attribute to either one. The checkbox is off by default.
- **Turns under ~1s get `speaker_label: "PENDING"`** — no speaker at
  all. Short commands are exactly where diarization is weakest, which is
  the main thing this lab exists to measure.
- **Billing is on connection-open time, not audio sent.** The page sends
  `Terminate` on disconnect and on tab close, but if you leave it
  connected while you make lunch, that's billed. Sessions here are
  capped at 600s server-side for that reason.
- Audio is mono 16-bit PCM in **binary** frames at the AudioContext's
  native sample rate (usually 48kHz, passed through as `sample_rate`).
  No resampling, no base64 — wrapping the audio in JSON is the most
  common way to get silence back from this API.

## The prompter, and why scoring is automatic

Pick a round in the dropdown and the page becomes a teleprompter: one
line at a time, big enough to read at 1.5m, with the speaker's name
beside it. Scripts live in `rounds.json`.

**Start with `R-core`** — a single 7-minute round that interleaves
calibration, names, short commands, cross-talk pairs and ambient traps on
one connection, with banners telling you what each block is for. It's the
go/no-go; the individual rounds go deeper on whatever it flags.

Each finalized turn is stamped with the line it was *supposed* to be.
That stamp is the whole trick — it's what lets `scripts/score-voice-log.mjs`
grade a session without a human re-reading transcripts and guessing which
turn was which line.

**Redo line** handles the inevitable: a flubbed read, or one utterance
that split into two turns. It marks the last turn discarded and steps the
pointer back, so a stumble doesn't shift every subsequent line's
expectation by one and ruin the round.

Then:

```bash
npm run score -- path/to/R1-quiet-<timestamp>.json
```

It prints WER, cook attribution, intent/step accuracy, `PENDING` rate,
finalize latency, cross-talk arbitration, false positives — and evaluates
the test plan's hard gates as PASS/FAIL. `--json` gives machine-readable
output. Pass several logs at once to compare conditions.

The scorer imports the **real** `parseCommand` from `src/utils/`, which
is why it lives in `scripts/` rather than here — this folder's claim to
import nothing from the app stays true.

Rounds with no script selected still record fine; they just can't be
auto-scored.
