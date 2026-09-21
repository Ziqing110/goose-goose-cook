# What the kitchen recordings showed

Nine bench scenes, recorded 2026-09-20, replayed through Streaming STT with
the parameters VoiceBar actually sends (`universal-3-5-pro`, `vad_threshold`
0.45, `min_turn_silence` 400, `max_turn_silence` 1280, `voice_focus`
far-field, `language_codes` en+zh, step labels and the agent name as
keyterms). 54 finalized turns.

Reproduce any of it:

```
node --env-file-if-exists=.env scripts/replay-audio.mjs recordings/<scene>.wav \
  --keyterms "Goose,Cut tofu into cubes,Mince garlic,..." --json runs/<scene>.jsonl
node scripts/grade-turns.mjs runs/<scene>.jsonl          # add --no-carry to see the old behaviour
```

`grade-turns.mjs` needs no key and no network: it applies the live cook's
three gates — the confidence floor, the name-only carry, the addressing
check — to a saved run, so a threshold can be changed and re-measured in a
second instead of re-recording.

## Fixed: the turn splits after the name

**The symptom you reported as "Goose isn't heard."** It is not the addressing
gate mishearing the name. The name is heard perfectly. The turn *ends* on it.

People pause after saying a name — it is how you get someone's attention
before telling them the thing. The recogniser's end-of-turn check reads that
pause as a finished thought, so one sentence arrives as two turns:

```
00:08  Goose.                        -> addressed, asks for nothing, costs a model call
00:10  I'm done with the mincing.    -> no name, dropped as kitchen chatter
```

The instruction is the half that gets thrown away. Measured: **every scene at
the 128 ms default**, and still **two scenes in nine at the 400 ms** VoiceBar
already sets (scene 2's called-across-the-room line, scene 4's opener).

Raising `min_turn_silence` further trades the whole app's responsiveness
against one pause, so the fix is on our side. `isNameOnlyTurn` in
[addressing.js](../src/utils/addressing.js) recognises a turn that is the
agent's name and nothing else; [LiveCookPage](../src/pages/LiveCookPage.jsx)
answers it by opening the same engaged window an agent question opens, for
5 seconds, and sending nothing. The next turn is then heard as the rest of
the sentence.

Across the nine scenes: **39 → 41 useful turns**, and two model calls that
were being spent on the word "Goose" are not spent any more.

The addressing rule now lives in one module that both the browser and
`server/agent/turn.js` import, so the two cannot drift apart on what counts
as being spoken to. `npm test` also runs the server's own tests now; it was
globbing `src/utils` only, so `server/agent/turn.test.js` had never run in
CI.

## Checked, and deliberately left alone: the confidence floor

`MIN_VOICE_CONFIDENCE` drops a turn on its **lowest** word confidence, which
looks too harsh. On this data it is right: it drops exactly one turn of 54,
and that turn is genuinely garbled ("Goose, done with the sauce" came back as
"Goose, time for you to serve", min 0.32).

A mean would be worse, not better — the garbled turn's mean is 0.69, above
four transcripts that are word-perfect.

The margin is thin, though. Two correct transcripts sit at min 0.40 and 0.44,
within a rounding error of being thrown away. Worth watching, not worth
changing without more takes.

## Fixed: two cooks in one turn now get asked, not guessed at

Scene 8, the overlap scene, merged a line from each cook into a single turn:

```
00:28  Goose, done with— no way, that's mine!
```

Acted on, half of it is wrong. Two detectors were tried.

**Windowing the sidecar failed.** Sliding a 1.5s window across the turn and
identifying each one caught 1 of 5 at best, at any threshold. The voices are
concurrent rather than sequential, so TitaNet embeds the mixture and it
matches neither cook. `scripts/overlap-eval.mjs` is that experiment, kept
because a negative result is worth not rediscovering.

**The streaming API's own diarization works, but not via its label.** It
labels a merged turn with one speaker, same as before. The per-word speaker
*confidence* is what separates them, stepping down exactly at the handover:

```
Goose,/1.00 done/1.00 with—/1.00 no/0.63 way,/0.63 that's/0.63 mine./0.63
```

Measured across four scenes: a drop of 0.37 on the merged turn, 0.00 on all
nineteen single-speaker turns. It is the **drop** that separates, not the
level — clean turns sit anywhere from 0.50 to 1.00, so a floor on absolute
confidence would flag good speech all day.

On a turn that reads as shared, the model is told two cooks spoke and asked
for one short question naming both, and `parseChoice` drops every tool call
regardless. The prompt is a request; the guard is the guarantee. Against the
real transcript it goes from firing `done(tofu_cut)` + `claim(mince_garlic)`
blind to asking *"Which of you wanted to do the garlic, and who finished the
tofu?"* — and since that ends in a question mark, the existing engaged window
lets the answer come back without the name.

Turning `speaker_labels` on paid for itself twice: attribution now needs no
enrollment at all, and the diarization-tuned silence defaults it brings
(640ms rather than our 400) **merge** the name-split from scene 4 rather than
aggravating it.

Not caught, deliberately: both cooks saying the same words in the same instant
holds flat too. Nothing needs clarifying when they asked for the same thing.

The honest limit is one merged turn in the whole corpus. The 0.25 threshold
sits in a wide gap (0.00 against 0.37), but it is one example — a second
overlap take would firm it up considerably.

## Decided: Chinese is transcribed, not translated

The take was replayed five ways and the transcripts scored by whether the app
could act on them.

| language_codes | keyterms | addressed | verbatim Chinese | spurious words |
|---|---|---|---|---|
| en only | English | 5/5 | **0/5 — content destroyed** | — |
| en+zh | English | 4/5 | 1/5, rest translated | — |
| en+zh | + Chinese nouns | 5/5 | 3/5 | 豆腐 inserted in 4 turns |
| en+zh | + Chinese phrases | **5/5** | **5/5** | none |

**English-only is the trap.** It does not fall back to English words, it
throws the audio away: "Goose, 豆腐切好了" came back as `Goose`, and
"Goose, 蒜蓉 done" as `Goose,,`. Anyone reaching for it to keep the pipeline
simple would be deleting half of what the cooks said.

**Keyterms must be phrases, not nouns.** Short common nouns get over-applied
by the keyterm bias and turn up in sentences nobody said them in — 豆腐 was
inserted into four turns out of five. Phrases of three characters or more do
not. 蒜蓉 is the one noun kept, because without it the recogniser hears the
homophone 算容.

Priming the phrases also fixes addressing, for an unobvious reason:
"Goose豆腐切好了" comes back with a space after the name, so "goose" is its
own word and the gate sees it. That is the 4/5 → 5/5 above.

### The fallback was blind to Chinese, and that was the real bug

With a verbatim transcript, gpt-4.1 resolves every Chinese utterance —
豆腐切好了 to `done(tofu_cut)`, 我来做 the sauce to `claim(sauce_mix)`,
还要多久 to `status`. Four out of four.

The keyword grammar resolved **none of them**, because
`stepNameMatch.normalize()` strips everything outside `[a-z0-9]`, so a
Mandarin command arrived as an empty string and came back "unknown". That
matters precisely when it matters most: the keyword path is what runs when
the model is slow or down, so a Chinese-speaking cook had no fallback at all.

`normalizeLoose` keeps every letter, intent detection uses it, and the
commands people actually use mid-service now have Chinese patterns. That path
went from 0 of 5 to 4 of 5 — the fifth lost its verb in transcription, so
there is no intent left to find.

Step **matching** still normalises to ASCII on purpose. The labels are
English, a Chinese token can match none of them, and counting it would only
push the real match under the confirm floor — the same dilution the agent's
own name used to cause.

## Confirmed working, no action

- **Scene 3** — six lines of ordinary kitchen talk, several containing
  "done", "start" and "take". None addressed, none acted on. The gate is
  doing its job exactly.
- **Scene 6** — 45 seconds of fan, water, pot lids and dragged chairs
  produced **zero** phantom turns. `vad_threshold` 0.45 plus Voice Focus is
  holding. Both real commands came through clean.
- **Scene 5** — noise plus raised voices: 5 of 5 addressed.
- **Scene 7** — multi-action lines ("done with the onions, start the garlic")
  transcribed intact, no splitting.

## The agent, asked a cooking question

Separate from the recordings, measured with `npm run agent:calibrate`
(3 repeats, 31 cases).

**Check which model you are measuring.** `.env` sets no `AAI_AGENT_MODEL`,
so the route falls back to **gpt-4.1**, while `calibrate.mjs` defaults to
gemini-2.5-flash-lite. They are not close:

| model | actions | how-to | median |
|---|---|---|---|
| gemini-2.5-flash-lite | 53/69 | 18/24 | 1031ms |
| **gpt-4.1** (what ships) | **67/69** | **20/24** | **608ms** |

Faster and far more accurate. Every ratio below that is not labelled
gpt-4.1 was measured on flash-lite and understates what ships; the
`status` and `help` misfires in particular are mostly a small-model
problem. Pass `--models gpt-4.1` to measure what your cooks will meet.

Asked "how do I mince the scallions?" Goose used to **refuse** — "I can't
help with that, but your recipe should tell you how" — and two questions in
six misfired into `status` or `help`, reading out the run's progress or the
whole command list at somebody who asked how to cut an onion.

Two causes, both ours. The prompt filed technique questions under "unrelated
to this cook". And every step carries a `description` the page has always
rendered on the step card, which `buildAgentSnapshot` never sent, so the
model had nothing recipe-specific to answer from even if it wanted to.

Now sent as `how`. Asked the same question, Goose answers "Halve root to tip,
then slice into thin half-moons" — the recipe's own words.

### What did not work, and the numbers that said so

Rewriting the system prompt to invite cooking answers **cost more than it
bought**: actions fell from 52/69 to 34/69 while how-to rose 16/24 to 19/24.
Telling a small model to answer rather than act makes it answer rather than
act, across the board. Reverted.

The shipped combination — original prompt wording, `how` in the snapshot, and
the reply sanitiser below — measures **53/69 actions, 18/24 how-to**: action
accuracy unchanged from baseline, how-to up by two, no prompt gymnastics.

Getting the remaining six needs something more surgical than prompt wording;
a deterministic guard that strips `status`/`score`/`help` from a turn that is
plainly a cooking question is the obvious next thing to try, and is testable
in a way prompt edits are not.

### The agent was narrating its own scratchpad, out loud

Calibration turned up replies like `Thinking Process: 1. Identify the user's
intent...` and `toolcode print(default_api.status())` being returned as the
reply — which the page **speaks aloud**. It happens on the original prompt
too, so it is not new; nobody had looked.

`cleanReply` in [turn.js](../server/agent/turn.js) drops a reply that is
model scaffolding rather than speech, and cuts long ones at a sentence
boundary instead of mid-word. `MAX_TOKENS` went 300 to 700 in the gateway,
because that budget is shared with the model's reasoning tokens (~90 for a
one-sentence answer) and a cooking answer was running out mid-word:
"recipe doesn't say how much dou".

The calibration table now has eight how-to cases, so none of this can regress
unnoticed.

## Next

Scenes 10-12, the live takes, are the only way to test the agent own voice
coming back through the microphone, and nothing on this page has been
exercised in a real cook with a real mic - every figure here comes from
replay, unit tests or calibration against fixtures. A ten-minute live run
would be worth more than another bench recording.
