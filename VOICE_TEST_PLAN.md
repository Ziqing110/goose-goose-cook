# Voice test plan — real humans, one microphone

Run against the standalone lab — `npm run lab`, then
<http://localhost:3100> (Stage A in `VOICE_PLAN.md`). Not the app, not
the live-cook screen. The point is to find out whether single-device
voice actually works in a kitchen **before** we build on top of it.

## Start here: R-core, about 7 minutes

**Pick `R-core` in the lab's dropdown and read straight through.** One
connection, one download, no reconnects, 42 utterances. That's the whole
test for tonight.

```
~3.5 min  reading        ~3 min  setup + connect + download
```

It runs five blocks back to back, each announced by a banner on the
prompter so you know what you're doing and why:

| Block | Utterances | Answers |
|---|---|---|
| Calibration | 6 | Can diarization tell your two voices apart? |
| Names | 8 | Does "Lindy" / "Zeina" survive transcription? |
| Short commands | 8 | Do fast commands work, and are bare ones rejected? |
| Cross-talk | 5 pairs | Does the earlier first word win a contested claim? |
| False positives | 10 | Does normal kitchen talk ever fire a command? |

Then:

```bash
npm run score -- path/to/R-core-<timestamp>.json
```

**What 7 minutes buys you, honestly:** a signal, not a rate. Eight name
samples can tell "this works" from "this is broken" — it cannot
distinguish 95% from 88%. The false-positive gate is the exception: with
ten ambient lines, *any* firing is informative, and zero is meaningful.

Treat R-core as the go/no-go. If it passes, the longer rounds below are
worth an evening. If the wake word fires on ambient speech, or you both
get the same diarization label, you've learned the important thing in
seven minutes and D1 is decided.

## The long version (~75 min, only if R-core passes)

183 utterances across all rounds, ~19 minutes of pure speaking; the rest
is per-round overhead. Full pass ~55 min, plus ~20 min for a second pass
on the other config. Do it on **Bare** and then **Kitchen** so config
changes have measured before/after numbers rather than vibes.

The individual rounds below go deeper on whatever R-core flagged. You
probably don't need all of them — pick the ones that map to the number
that came back weak.

## A note on your two voices

You're both women, which makes this harder in one specific way and
changes nothing else. Diarization separates speakers by voice embedding,
and two voices in a similar pitch range are closer together in that space
than the mixed-gender pairs most demos use. Expect a higher `PENDING`
rate on short turns and more label flipping under cross-talk than the
docs' caveats imply.

That's an argument for running **R-cal first** — it measures whether the
model separates *your* two voices at all, before you spend an hour on
rounds that assume it can. It's also why the name-prefix hypothesis
matters more here, not less: a name in the transcript is immune to
whatever the embeddings do.

Second thing worth knowing: **"Zeina" is an unusual token for English
STT** and will likely come back as "Zena", "Xena" or "Zaina". That's
what `keyterms_prompt` is for, and R2 is what measures whether it
worked. The scorer counts near-misses as hits (up to 2 edits for a
5+ character name), because the real parser will fuzzy-match against a
two-name list. If R2 still fails, the honest fix is to pick a different
call-name — and that's a legitimate finding, not a workaround.

## Setup

- **Two people.** Call them Lindy and Zeina for the whole session; the
  fixture tables and the seeded cook colors use those names.
- **One device**, mic at roughly **1.5m**, about where a laptop or
  propped phone actually sits on a counter. Not held, not headset — the
  whole premise is hands covered in garlic.
- **Noise sources you can switch on and off**: extractor fan, a pan
  actively sizzling, running tap, a radio or podcast at conversational
  volume.
- The lab open at <http://localhost:3100>, round box filled in, and
  **Download log** ready after each round.

## How a round runs

1. Pick the round in the lab's dropdown. The **prompter** shows one line
   at a time, large, with the speaker's name — read it off the screen.
2. Each finalized turn gets stamped with the line it was supposed to be,
   and the prompter advances. Flubbed it, or one utterance split into two
   turns? Hit **Redo line** — that marks the turn discarded and steps
   back, so a stumble doesn't corrupt the round.
3. **Download log** at the end.
4. Score it: `npm run score -- path/to/R1-quiet-<ts>.json`

**Scoring is automatic.** That stamp is what makes it possible — without
it, grading means a human re-reading transcripts and guessing which turn
was which line. The scorer computes WER, cook attribution, intent and
step accuracy, `PENDING` rate, finalize latency, cross-talk arbitration
and false positives, runs the **real** `parseCommand` from
`src/utils/voiceCommands.js`, and evaluates the hard gates below rather
than leaving them to your judgement.

What still needs a human: reading the `problems` list to separate "STT
got it wrong" from "you misread the line", and R9's delivery labels.

Keep every JSON. The config block is saved with it, so a result is
always traceable to the settings that produced it — and these same logs
become the fixture table for Stage C2.

## Config matrix

Run R1-R6 at each of these — they're the **Bare** and **Kitchen**
presets in the lab. Two configs, not six: resist the urge to tune more
than one thing at a time.

| Config | `speaker_labels` | Voice Focus | `keyterms_prompt` |
|---|---|---|---|
| **Bare** (preset) | on, `max_speakers: 2` | off | none |
| **Kitchen** (preset) | on, `max_speakers: 2` | on | cook names + all step labels + ingredients |

Keyterm list for the Kitchen preset (already loaded in the lab): `Lindy`, `Zeina`, `mapo tofu`, `doubanjiang`,
`chicken noodle soup`, `mince the garlic`, `julienne`, plus every step
label from the seeded demo graph.

---

## R-cal — Voice separation (run this first)

**There is no voice enrollment in AssemblyAI.** Nothing you send teaches
it your voices — I checked the Speaker Identification docs, and even that
feature works by inferring names from *conversation content*, not from
audio, and only on pre-recorded files. So this round doesn't train
anything. It measures whether the model's diarization separates your two
voices on its own, and learns which anonymous label ("A"/"B") belongs to
whom.

Eight alternating lines, deliberately long so none falls under the ~1s
`PENDING` threshold. Read them off the prompter, one each, normal voice.

**Scorer gives you:** `diarization label map` (e.g. `Lindy=A Zeina=B`)
and `diarization agreement %`.

**Three outcomes, each pointing somewhere different:**

- **Agreement ≥ 90%** — diarization works on your voices. It's a usable
  cross-check alongside the name prefix, and R8 is worth running.
- **Agreement 60–90%** — works but unreliably. Name prefix carries
  identity; diarization is a tiebreak at best.
- **Both of you map to the same label** — the scorer says so loudly.
  Diarization did not separate you, no downstream tuning fixes that, and
  D1 goes straight to the name-prefix design. Skip R8 entirely.

Not a pass/fail gate. It's the cheapest possible answer to "can the API
tell us apart", and it takes one minute.

## R0 — Sanity

Quiet room, one speaker, 0.5m. Say five full sentences.

**Pass:** transcripts are recognisably correct, `end_of_turn` fires,
`words[]` carry `start`/`end`/`confidence`. If this fails, the problem
is the harness, not the kitchen.

## R1 — Distance and noise

Lindy alone, reads the same 10-utterance script four times, one per
condition:

1. quiet, 1.5m
2. extractor fan on
3. fan + active sizzling
4. fan + sizzle + running tap

Script (say each as its own turn, pause between):

```
Lindy, start
Lindy, done
Lindy, I'll take mincing the garlic
Lindy, status
Lindy, drop it
Lindy, take the doubanjiang
Lindy, skip that
Lindy, score
Lindy, what's next
Lindy, we're done
```

**Scorer gives you:** `word error rate` and `intent correct` per
condition. Run all four logs in one go to compare:
`npm run score -- R1-quiet*.json R1-fan*.json R1-fan-sizzle*.json R1-fan-sizzle-tap*.json`

**Pass:** ≥ 8/10 correct intent through condition 3. Condition 4 is the
stretch goal, not the bar — if it only works with the tap off, that is a
finding we can design around (pause the mic during obvious water use),
not a failure.

## R2 — Name recognition

The single highest-leverage thing to measure, because name resolution
gates *every* command in the single-device design.

Each cook says their own name 10 times, in varied framings:

```
Lindy, done
Lindy — I'll take the garlic
This is Lindy, starting now
Lindy here, done
Lindy? Done.
```

Then repeat with the other cook.

**Scorer gives you:** `cook attribution` (including 1-edit fuzzy hits
like "Lindy" → "Lindi", which Stage C2's parser is specced to catch) and
`of which exact spelling` — the gap between those two tells you how much
work the fuzzy matcher will have to do.

**Pass:** >= 95% correct cook attribution on the Kitchen preset. If a
name is chronically mistranscribed, **change the name** — that is a
legitimate fix, and voice binding is exactly the screen where we'd
catch it.

## R3 — Short commands

The `"PENDING"` diarization threshold is ~1s, and this is where
single-device is theoretically weakest.

Say each 10 times, naturally fast, not enunciated:

```
Lindy, done          (with name)
done               (bare — expected to be REJECTED as unaddressed)
Lindy, go
Lindy, next
```

**Scorer gives you:** per-turn `durationMs`, `speaker_label PENDING %`,
and a hard failure on any bare line that came back carrying a name —
that's the rejection signal the whole design leans on.

**Pass:** named short commands transcribe correctly ≥ 9/10, and bare
commands carry no name 10/10. The rejection itself is Stage C2's job;
what's being measured here is that the *signal* to reject on is
reliably present or absent.

## R4 — Step reference matching

The scorer runs the real `parseCommand` against a candidate list of
**every** seeded step — wider than the app's run-scoped list, so this is
the harder case. Two lines are marked `stepExpect: "ambiguous"` in
`rounds.json`: "take the doubanjiang" names a material rather than a step
label, and "take the tofu" could be cut-or-blanch. For those, candidates
*are* the correct answer and the scorer grades them that way.

```
Lindy, I'll take mincing the garlic
Lindy, take the garlic
Lindy, give me the tofu one
Lindy, I've got the noodles
Lindy, take the thing with the doubanjiang
Lindy, take the sauce
```

**Scorer gives you:** `step correct %`, `ambiguous refs asked (not
guessed) %`, and `step resolved to WRONG step` — that last count is the
one that matters most.

**Pass:** ≥ 80% resolve to the right step; the remainder must return
candidates rather than resolving to the *wrong* step. A wrong-step
resolution is much worse than a clarifying question.

## R5 — Cross-talk and simultaneous claims

The competition-mode scenario, and risk #2 on the plan's list.

Ten trials. On a count of three, both cooks claim the **same** step at
the same time:

```
Lindy: "Lindy, I'll take the garlic"
Zeina: "Zeina, I'll take the garlic"
```

Vary the offset: 5 trials fully simultaneous, 5 with a deliberate
~300ms stagger.

**Scorer gives you:** `staggered arbitration correct` (did the earlier
`words[0].start` win?) and `pairs with a lost utterance`. The prompter
labels which speaker goes **first** in each pair, which is what makes
the arbitration check meaningful.

**Pass:** in the staggered trials, the earlier `words[0].start` wins
10/10 — that is the arbitration guarantee we're claiming, so it has to
hold. Fully simultaneous trials will lose utterances; **measure how
often** and note it honestly. If both are lost, the correct product
behaviour is an explicit "say that again, one at a time" prompt, not a
silent coin flip.

## R6 — False positives (the one that breaks demos)

Two cooks talk normally for **three minutes** with no intent to command
anything. Cook actual food. Include these traps verbatim:

```
"I'm done with this wine"
"are we done here?"
"I'll take the bin out after"
"skip the coriander, I hate it"
"start the timer on your phone"
"can you help me with this lid"
"drop it in the pot"
"that's it, that's the whole recipe"
```

**Scorer gives you:** `FALSE POSITIVES` (utterances carrying a cook
name — must be zero) and `would have fired w/o wake word` — how many of
those ambient lines would have triggered a real command without the name
prefix. That second number is the entire argument for the wake word;
expect it to be alarming.

**Pass:** **zero** utterances carrying a cook name. This is a hard gate.
Every one of those trap lines contains a real intent keyword — they all
pass the parser and are stopped only by the name prefix. If any fires,
the wake-word hypothesis is dead and Stage C does not start on it — go
read the fallbacks in `VOICE_PLAN.md`'s Stage B.

## R7 — Turn detection tuning

Only after R1–R6 have baselines. Sweep one param at a time via
`UpdateConfiguration`, 10 utterances each:

- `end_of_turn_confidence_threshold`
- `min_turn_silence`
- `max_turn_silence`

Watch for the two failure shapes: a long claim
("Lindy, I'll take mincing the garlic and the ginger") cut into two turns,
versus a fast "Lindy, done" waiting too long to finalise.

**Record:** chosen values + the reasoning. Put them in `.env` so they're
one place, not scattered in the client.

**Target:** < 700ms from end of speech to `end_of_turn` on short
commands, with no mid-claim splits.

## R8 — Diarization as cross-check

Replay the R5 logs. For every turn where a name *was* resolved, check
whether `speaker_label` agreed.

**Record:** agreement rate, and the `PENDING` rate by turn duration.

This isn't pass/fail — it tells us whether diarization is worth keeping
as a tiebreak, or whether it's noise we should drop. Decide from the
number.

## R9 — Composure (LLM Gateway)

Same utterance, three deliveries: calm, rushed, panicked-shouting.
Five utterances × 3 = 15 samples.

Put a composure prompt in the lab's **LLM Gateway** box and read the
`LLMGatewayResponse` frames in the Raw tab.

**Record:** the composure label per delivery, and added latency per turn.

**Pass:** labels track the delivery well enough to be worth scoring,
**and** the command path is never blocked waiting on it. Latency
regression on commands is an automatic fail regardless of label quality.

---

## Go / no-go gates

Do not start Stage C integration until:

- **R6 is zero false positives.** Non-negotiable.
- **R3 bare commands are rejected 10/10.**
- **R2 attribution ≥ 95%** in config B.
- **R5 staggered arbitration is 10/10** on audio timestamps.

R1 and R4 can be below target and still proceed — they're accuracy
dials, and keyterms plus turn tuning still have room. The four above are
correctness properties, and the design depends on them holding.

## Results log

Keep one table per full pass. Numbers, not adjectives.

| Round | Config | Metric | Result | Pass? | Notes |
|---|---|---|---|---|---|
| R0 | — | sanity | | | |
| R1 | Bare / Kitchen | intent correct /10 per condition | | | |
| R2 | Bare / Kitchen | cook attribution % | | | |
| R3 | Bare / Kitchen | named /10, bare rejected /10 | | | |
| R4 | Bare / Kitchen | step resolved % | | | |
| R5 | Kitchen | staggered wins /10, simultaneous lost /10 | | | |
| R6 | Kitchen | false commands in 3 min | | | |
| R7 | Kitchen | end-of-turn latency ms | | | |
| R8 | Kitchen | diarization agreement %, PENDING % | | | |
| R9 | Kitchen | composure tracks delivery, added latency ms | | | |
