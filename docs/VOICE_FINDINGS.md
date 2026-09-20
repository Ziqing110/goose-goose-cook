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

## Not fixed: two cooks in one turn

Scene 8, the overlap scene, merged a line from each cook into a single turn:

```
00:28  Goose, done with— no way, that's mine!
```

One turn, one speaker attribution, two people. Whatever that turn is credited
to, it is half wrong — this is the other half of "wrong cook". The speaker
sidecar cannot fix it either, since it embeds the whole clip.

Options, in order of appeal: enable `speaker_labels` on the connection (the
server diarizes per turn, and the docs note it retunes the silence thresholds
to break turns at speaker changes); or split the clip on the sidecar's
embeddings before identifying. Neither is worth doing before the enrollment
clips exist, because there is currently no way to tell whether attribution is
right.

## Not fixed: Chinese comes back inconsistently

Scene 9, with `language_codes` en+zh set:

| Said | Heard |
|---|---|
| Goose, 豆腐切好了 | `Goose tofu切好了` |
| Goose, I'm done with the 豆腐 | `Goose, I'm done with the tofu.` |
| Goose, 我来做 the sauce | `Goose, I'll do the sauce.` |
| Goose, 蒜蓉 done | `Goose,蒜蓉,蛋。` |
| Goose, 还要多久 | `Goose, how long?` |

Addressing survives all five, which is the important part. But the model is
**translating rather than transcribing** — 我来做 came back as "I'll do",
还要多久 as "how long?" — and one line lost its verb entirely. For step
matching that is a problem: the board's labels are English, so a translated
transcript may actually match *better*. Needs its own scene and a decision
about what we want, not a parameter tweak.

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
(gemini-2.5-flash-lite, 3 repeats, 31 cases).

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

Scenes 10–12, the live takes, are the only way to test the agent's own voice
coming back through the microphone. That is the remaining unknown and needs
the app running, not a bench recording.
