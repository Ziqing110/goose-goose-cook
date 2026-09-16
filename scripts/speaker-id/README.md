# Speaker ID experiment — TitaNet vs AssemblyAI diarization

**An experiment, not a component.** Nothing in the app imports this. It
exists to answer one question with a number:

> Our R-core run showed AssemblyAI's diarization at 94% on long turns and
> **63% on turns under 1.5s** — with `PENDING` never firing, so the errors
> were silent. Does enrollment-based speaker ID do better on the short
> utterances, or is that a limit of voice embeddings in general?

If TitaNet also collapses under 1.5s, the answer is settled: identity has
to come from the name in the transcript, and no library swap changes it.
If TitaNet holds up, it is worth the architectural cost of a Python
sidecar.

## Why this is different from diarization

Diarization is unsupervised — "how many voices are here, which is which",
no prior knowledge, arbitrary A/B labels that can drift mid-session.

This is **identification with enrollment**: two known people, a reference
recording of each, and every utterance matched to the nearer of two
vectors. Strictly easier, and it is the "record my voice so it knows me"
step AssemblyAI does not offer.

## Setup

```bash
py -3.13 -m venv .venv-voice
./.venv-voice/Scripts/python -m pip install torch --index-url https://download.pytorch.org/whl/cu124
./.venv-voice/Scripts/python -m pip install nemo_toolkit[asr] soundfile scipy
```

Python 3.13, not 3.14 — the ML stack is better tested there. ~4GB and a
while. A GPU is optional; TitaNet runs fine on CPU for a 7-minute file.

## Run

```bash
./.venv-voice/Scripts/python scripts/speaker-id/identify.py \
    path/to/R-core-<ts>.json path/to/R-core-<ts>.wav
```

Both files come from the lab's **Download log** button, which now saves
the WAV alongside the JSON. A log recorded before that change has no
audio and cannot be used here — re-run R-core.

## What it prints

```
                          AssemblyAI       TitaNet
all utterances                  78.1%         ...%
short (<1500ms)                 63.0%         ...%
long (>=1500ms)                 94.0%         ...%
```

Plus every turn TitaNet got wrong, with its cosine score and the margin
over the runner-up — a wrong answer with a thin margin is a different
problem from a confident wrong answer.

It also prints **enrollment separation**: the cosine distance between the
two enrolled voices. Above ~0.6 means the two voices are intrinsically
close in embedding space, which caps how well *any* model can separate
them and is worth knowing before blaming the model.

## Three departures from AssemblyAI's cookbook

1. **No Pinecone.** The cookbook uses a vector DB to identify speakers
   across many files. Two people, one session: two vectors in a dict and
   a cosine similarity. A hosted DB would add an account and a network
   hop without changing a number.
2. **No re-transcription.** The cookbook calls AssemblyAI for utterance
   boundaries. The lab log already has per-word `start`/`end` in ms, plus
   `audio.zeroSample` to map those onto the WAV.
3. **Enrollment from ground truth.** The cookbook enrolls from each
   speaker's longest *diarized* utterance, inheriting diarization's
   errors. We enroll from the calibration block, where the prompter
   recorded who was actually speaking — a better reference than the
   cookbook can build, so a poor result here can't be blamed on it.

## Reading the result

The short-utterance row is the whole experiment. Long-turn accuracy was
never the problem.

Expect embeddings to need roughly 1–3 seconds of speech for a stable
vector; that is a property of the representation, not of TitaNet. If the
short row lands near AssemblyAI's 63%, that confirms it, and the
leading-name rule stays the design.
