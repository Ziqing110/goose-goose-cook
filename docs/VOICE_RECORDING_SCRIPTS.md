# Live-cook recording scripts

Scripts for two people to read in a real kitchen, so the AssemblyAI path
(Streaming STT → turn detection → addressing gate → agent → handlers) can be
tested against the same audio twice. Recorded once, replayed forever.

Dish is the seeded **Mapo Tofu** graph, so every step name below is a real
`label` the board will show and a real keyterm the recogniser is primed with:

| id | label |
|---|---|
| `tofu_cut` | Cut tofu into cubes |
| `mince_garlic` | Mince garlic |
| `aromatics_mince_other` | Mince ginger & scallion |
| `sauce_mix` | Mix sauce & slurry |
| `tofu_blanch` | Blanch tofu |
| `aromatics_saute` | Brown pork, then fry doubanjiang & aromatics |
| `simmer_combine` | Combine & simmer |
| `thicken_garnish` | Thicken & garnish |
| `plate_serve` | Plate & serve |

**A** and **B** are the two cooks. Use your own real names when you read —
cook names are sent as keyterms, so a fake name tests the wrong thing.
The agent is **Goose**; it will not answer during a bench take, so leave the
gap where its line would go.

## Two kinds of take

**Bench takes** (scenes 1–9) are recorded standalone, with nothing running.
They replay through the STT harness and test transcription, turn
segmentation, the addressing gate, speaker ID and intent selection.

**Live takes** (scenes 10–12) must be recorded *while an actual cook is
running in the app*, because they test what happens when Goose's own voice
is in the room. Record the room, not the tab: a system-audio capture will not
have the echo we are trying to test.

## Priority order

The two symptoms we are chasing right now are **"Goose isn't heard"** and
**"wrong step / wrong cook"**. So record in this order, and stop whenever you
have had enough — even the first three are useful on their own:

1. **Scene 2** — the name. This is the one that matters most.
2. **Scene 4** — near-identical step names.
3. **Scene 1** — the clean baseline, so we know what "working" looks like.
4. **The enrollment clips** — without them every line is credited to whichever
   cook the toggle happens to be on, which is "wrong cook" by construction.
5. **Scene 7**, then 3, 5, 8, 9. Scene 6 any time. Scenes 10–12 are live takes
   and can wait.

## Use the prompter — do not count seconds

```
npm run dev      # then open http://localhost:5173/teleprompter.html
```

It runs the take for you: pick a scene, press Start, and it counts you in,
holds three seconds of room tone, then shows one line at a time in letters
you can read from across the kitchen. **Press Space (or click anywhere) the
moment you stop talking** and it times the pause itself before showing the
next line. How long you take to speak is yours; how long the silence lasts is
the test, and only one of those is worth making a person measure.

It also records. The take is captured in the page as 48 kHz mono 16-bit
WAV — exactly what the browser sends AssemblyAI, with the same echo
cancellation and noise suppression the app turns on — and the WAV drops into
Downloads the moment the scene ends. Because the prompter's clock and the
file's clock are the same clock, a sheet that says `00:41` means 41 seconds
into that WAV.

The timing sheet fills itself in as you go and saves with the WAV, same name,
no button needed.

Press **Folder** once and pick `overcooked/recordings` — after that both files
are written straight there instead of to Downloads, and a corrected sheet
overwrites the old one in place rather than piling up `(1)`, `(2)` copies. The
browser asks permission the first time and forgets the folder on reload, so
it is one click per session. Without it, takes land in Downloads and you move
them yourself.

If either of you improvised a line, fix it in the sheet and press **Save
sheet**. Nothing to copy, nothing to convert, nothing to line up afterwards.

**Prompt only** turns recording off, for when the take is being captured
somewhere else — a phone, or the app itself for scenes 10–12.

### If you record on a phone instead

- Put it where the laptop would be, **1–2 m away**, not in your hand.
- Record to **WAV**. iPhone Voice Memos writes m4a, which nothing here reads
  without ffmpeg.
- Convert before replaying:

  ```
  .venv-voice\Scripts\python.exe scripts/prep-audio.py recordings/raw/*.wav --out recordings
  ```

  It mixes to mono, resamples to 48 kHz, writes 16-bit PCM, and warns about
  clipping or a covered mic. The replay harness refuses anything else on
  purpose: a stereo or 24-bit file transcribes to silence with no error.

### The room

- Extractor fan **on** for scenes 5, 6, 8 and 11; off for the rest. The
  prompter says which, per scene.
- Improvise wording freely — natural speech is the point. Just fix the sheet.
- Two takes of every scene, minimum. The second take is what tells us a
  failure is a real failure and not one bad delivery.

### Files

The prompter names them; drop them into `recordings/` (gitignored):

```
recordings/
  enroll-A-1.wav  enroll-A-2.wav                  ~10 s each, see below
  enroll-B-1.wav  enroll-B-2.wav
  scene-01-clean-handoff_take1.wav
  scene-01-clean-handoff_take1.txt                what was actually said, with times
```

### Enrollment clips

Needed for the speaker sidecar (TitaNet). Each cook, alone, reads for about
ten seconds at normal cooking volume and distance:

> "I'm A. I'm cooking tonight, and this is what I sound like when I'm standing
> at the stove talking over the fan."

Twice each, ideally a few minutes apart so the two samples are not identical
in tone.

---

## Scene 1 — Clean handoff (the baseline)

**Exercises:** ordinary claim → start → done, two speakers alternating,
addressing by name every time. If this is not clean, nothing else matters.
**Fan off.**

```
A: Goose, I'll take the tofu.
   (pause 2 s)
A: Goose, starting on it now.
   (pause 4 s)
B: Goose, I'm on the garlic.
   (pause 3 s)
B: Goose, done with the garlic.
   (pause 2 s)
A: Goose, tofu's cut.
   (pause 3 s)
A: Goose, what's next?
   (pause 3 s)
B: Goose, I'll take the ginger and scallion.
   (pause 5 s)
B: Goose, that's done.
```

**Pass:** every line is one turn, transcribed with the step name right;
intents claim/start/done/status land on the right step and the right cook.

## Scene 2 — The name, mangled

**Exercises:** the addressing gate and its one-edit slack. Speech recognition
mangles "Goose" constantly, and each of these is a real mishearing we should
either accept or knowingly reject. Say them naturally — do **not** perform a
mispronunciation, just say the name in your ordinary accent, at different
speeds and distances.
**Fan off.**

```
A: Goose, I'm done with the tofu.            (normal)
   (pause 2 s)
A: Goose I'm done with the tofu.             (no comma, run together)
   (pause 2 s)
A: goose done with the tofu                  (fast, clipped)
   (pause 2 s)
A: Hey Goose, done with the tofu.
   (pause 2 s)
A: (turned away from the mic) Goose, done with the tofu.
   (pause 2 s)
B: Goose, I'm done with the tofu.            (same line, other voice)
   (pause 2 s)
B: (called from across the room) Goose! Done with the tofu!
```

**Pass:** all seven are addressed. Write in the `.txt` what the recogniser
actually produced for the name in each — that list is what we tune the keyterm
and the edit-distance slack against.

## Scene 3 — Talk that is not for Goose

**Exercises:** the addressing gate's other half. None of these may reach the
model or move the board. Several deliberately contain action words.
**Fan off.**

```
A: Can you pass me the cutting board?
   (pause 2 s)
B: Yeah, hold on, I'm done with this.
   (pause 2 s)
A: I think we should start the rice.
   (pause 2 s)
B: Did you take the garlic already?
   (pause 2 s)
A: This is way too spicy.
   (pause 2 s)
B: (to A, laughing) You always skip the blanching.
   (pause 3 s)
A: Goose, ignore us. Sorry.
```

**Pass:** nothing but the last line reaches the agent, and the board is
unchanged. The last line should be addressed and then politely do nothing.

## Scene 4 — Near-identical step names

**Exercises:** step-name matching and the confirm-before-acting path. The
known gap: two steps that read alike should be asked about, not guessed.
**Fan off.** "Mince garlic" and "Mince ginger & scallion" are already close;
if you can, add a third step "Mince the chilli" to the board first.

```
A: Goose, I'm done with the mincing.
   (pause 4 s — Goose should ask which)
A: The garlic one.
   (pause 3 s)
B: Goose, start the mince.
   (pause 4 s)
B: Yes.
   (pause 3 s)
A: Goose, done with the ginger.
   (pause 2 s)
A: Goose, done with the ginger and scallion.
```

**Pass:** the ambiguous ones ask; the unambiguous ones act. An answer given
inside the engaged window needs no "Goose".

## Scene 5 — Noisy kitchen, real commands

**Exercises:** VAD threshold, keyterms, and the word-confidence gate.
**Fan ON, plus running water and a pan sizzling if you can manage it.**

```
   (10 s of just the noise, nobody speaks)
A: Goose, I'm done with the tofu.
   (pause 3 s)
B: (over the sizzle, raised voice) Goose, take the sauce!
   (pause 3 s)
A: (normal volume, not raised) Goose, blanch is done.
   (pause 3 s)
B: (mumbled, half turned away) Goose, done with the sauce.
   (pause 5 s)
A: Goose, status.
```

**Pass:** the clear lines land; the mumbled one is either transcribed right or
dropped by the confidence gate — but **not** acted on wrongly. The 10 s of pure
noise must not open a turn that never closes.

## Scene 6 — The empty-turn watchdog

**Exercises:** the 9-second empty-turn watchdog and `ForceEndpoint`. Noise that
reads as speech to the VAD without producing a single word.
**Fan ON, and make kitchen noise that sounds vaguely vocal** — running water,
a clattering pot lid, a wok being scraped, a chair dragged. No words at all.

```
   (25 s of noise, nobody speaks)
A: Goose, status.
   (pause 5 s)
   (20 s more noise)
B: Goose, what's next?
```

**Pass:** the watchdog force-ends the noise turns; the two real commands are
heard normally and are not swallowed by a stuck turn.

## Scene 7 — Several things in one breath

**Exercises:** multiple tool calls in one turn, and the order they apply in.
**Fan off.**

```
A: Goose, done with the onions, start the garlic.
   (pause 4 s)
B: Goose, I'll take the sauce and the blanching.
   (pause 4 s)
A: Goose, I'm done here — what should I pick up next?
   (pause 4 s)
B: Goose, drop the sauce, give it to A.
   (pause 4 s)
A: Goose, actually undo that.
```

**Pass:** each line produces exactly the actions asked for and no extras;
"undo" reverses only the last one.

## Scene 8 — Both talking at once

**Exercises:** turn segmentation with overlapping speakers, and speaker
attribution when two voices land inside one turn.
**Fan ON.**

```
A: Goose, I'm done with the tofu —
B: (starting ~1 s in, over A) Goose, I'll take the garlic.
   (pause 4 s)
A and B together, same moment: Goose, status.
   (pause 4 s)
A: Goose, done with —
B: (cutting in) — no wait, that's mine.
   (pause 4 s)
A: Goose, ignore that last bit.
```

**Pass:** we are not expecting perfection here. What we need is the failure
mode written down: does it merge into one turn, attribute to one cook, act
twice, or act wrongly? This scene exists to size the problem.

## Scene 9 — Mixed Chinese and English

**Exercises:** the model's code-switching, and whether the language codes we
send match the pair actually spoken.
**Fan off.** Speak the way you actually would.

```
A: Goose, 豆腐切好了.
   (pause 3 s)
A: Goose, I'm done with the 豆腐.
   (pause 3 s)
B: Goose, 我来做 the sauce.
   (pause 3 s)
B: Goose, 蒜蓉 done.
   (pause 3 s)
A: Goose, 还要多久?
```

**Pass:** record what comes back verbatim. Even a wrong transcript is useful —
it tells us whether to bias the language codes, add Pinyin keyterms, or gate
this off.

---

## Live takes — record these with the app actually running

### Making Goose talk on cue

Goose's own replies are capped at fifteen words, which is not enough to talk
over. So for the barge-in take, drive it directly. In the dev build the live
cook page exposes a handle on `window`:

```js
goose.ramble()        // a long line, about twenty seconds of it
goose.speak("Right, the tofu is in. Give it four minutes and do not stir it.")
goose.stop()          // cut it off, the way barge-in does
goose.isSpeaking()
```

Open the browser console on the live cook page and call it when the prompter
tells you to. Two other ways in, both real rather than synthetic: type
`status` into the agent box (a typed command runs the same handler a spoken
one does), or have the cook who is not reading the line say "Goose, status"
while the other talks over the answer.

The handle is behind `import.meta.env.DEV`, so it is compiled out of a
production build — it exists for these takes and nothing else.


## Scene 10 — Goose talking over you

**Exercises:** echo suppression and barge-in. The agent's own TTS goes out of
the speakers and back into the mic.
**Fan off. Speakers at the volume you would really use — not headphones.**

```
A: Goose, status.          (or run goose.ramble() in the console)
   (as soon as Goose starts talking, cut in:)
A: Goose, stop — I'm done with the tofu.
   (pause 4 s)
B: Goose, score.
   (let Goose finish completely this time)
   (pause 2 s)
B: Goose, start the simmer.
   (pause 4 s)
A: Goose, what's next?
   (while Goose answers, say nothing for 10 s — just let it talk)
```

**Pass:** Goose never transcribes itself as a cook; barge-in cuts its line; the
command spoken over it still lands.

## Scene 11 — A long real stretch

**Exercises:** idle detection at two minutes, session length, the socket
staying healthy across quiet minutes, and billing behaviour.
**Fan ON. Aim for 6–8 minutes.** Actually cook something, or mime it.

```
A: Goose, I'll take the tofu.
   ... cook normally, talk to each other, do not address Goose ...
   (at least one stretch of 2.5 minutes with no command at all)
B: Goose, still there?
   ... more normal cooking talk ...
A: Goose, status.
   ... another long quiet stretch ...
B: Goose, we're nearly there.
```

**Pass:** the connection survives; idle fires once at the right time and
recovers; no runaway turn; ordinary talk never acts.

## Scene 12 — Finishing, and the "done" collision

**Exercises:** end-the-run versus finish-a-step — the one place where a
mis-ranked intent ends the whole cook by accident.
**Fan off, live take** so the confirmation dialogue is real.

```
A: Goose, I'm done.
   (pause 4 s)
A: Goose, done with the garnish.
   (pause 4 s)
B: Goose, we're done.
   (pause 4 s — expect a confirmation)
B: No, not yet.
   (pause 3 s)
A: Goose, plate it up, I'm done with the plating.
   (pause 4 s)
B: Goose, we're all done. Dinner's up.
   (pause 3 s)
B: Yes.
```

**Pass:** only the last one ends the run, and only after the confirmation.
"I'm done" and "done with the garnish" must close a step, never the cook.

---

## What to send back

Per scene: the WAV(s), the `.txt` of what was actually said, and one line on
what looked wrong if you were watching the app. That is enough to turn each
one into a regression case.

## Replaying them

```
node --env-file-if-exists=.env scripts/replay-audio.mjs recordings/scene-02.prepped.wav \
  --keyterms "Goose,Cut tofu into cubes,Mince garlic,Mince ginger & scallion,Mix sauce & slurry" \
  --json runs/scene-02.jsonl
```

It streams the file to Streaming STT at real speed with the same parameters
the browser uses, and prints one line per finalized turn: the timestamp, the
transcript, the lowest word confidence, how long the turn stayed open, and
whether the addressing gate accepted it (`»` means Goose was heard).

The `--json` file is every raw message. Keep one per run and diff them —
that is how a parameter change (`--vad`, `--keyterms`, `--langs`) is judged
on evidence rather than on one lucky take.
