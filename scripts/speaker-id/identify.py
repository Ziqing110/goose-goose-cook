#!/usr/bin/env python
"""Enrollment-based speaker ID over a voice-lab recording, using TitaNet.

    python scripts/speaker-id/identify.py <log.json> <audio.wav>

Answers one question: on OUR audio, does enrollment-based speaker
identification beat AssemblyAI's unsupervised diarization — and
specifically, does it beat it on the SHORT utterances where diarization
failed (63% correct under 1.5s, vs 94% over)?

Adapted from AssemblyAI's TitaNet + Pinecone cookbook, with three
deliberate departures:

1. NO PINECONE. The cookbook stores embeddings in a vector database
   because it identifies speakers across many files. We have two people
   and one session. Two vectors in a dict and a cosine similarity is the
   entire index; adding a hosted DB would add an account, a network hop
   and a failure mode without changing a single number.

2. NO RE-TRANSCRIPTION. The cookbook calls AssemblyAI to get utterance
   boundaries. We already have them — the lab log carries per-word
   `start`/`end` in ms, plus `audio.zeroSample` so those ms map onto the
   WAV. Re-transcribing would cost money and tell us nothing new.

3. ENROLLMENT FROM GROUND TRUTH, NOT FROM DIARIZATION. The cookbook
   enrolls each speaker from their longest *diarized* utterance, which
   inherits whatever diarization got wrong. Our prompter recorded who was
   actually supposed to be speaking, so we enroll from the calibration
   block where the speaker is known. That is a strictly better enrollment
   than the cookbook can build, and it means a poor result here cannot be
   blamed on a bad reference.

Output is a three-way comparison per turn: ground truth (the prompter),
AssemblyAI's `speaker_label`, and TitaNet's nearest-enrolled match.
"""

import json
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from scipy.signal import resample_poly

# TitaNet was trained at 16 kHz; the lab records at the AudioContext's
# native rate (usually 48 kHz). Feeding it the wrong rate silently
# degrades the embeddings rather than erroring.
TARGET_SR = 16000

# Below this, an embedding is not worth trusting from ANY model — it is a
# property of the representation, not of TitaNet. Reported separately
# rather than hidden, because it is the crux of the question.
SHORT_MS = 1500


def load_session(log_path: Path, wav_path: Path):
    log = json.loads(log_path.read_text(encoding="utf-8"))
    audio, sr = sf.read(wav_path, dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)

    meta = log.get("audio") or {}
    zero = meta.get("zeroSample", 0)
    if meta.get("sampleRate") and meta["sampleRate"] != sr:
        raise SystemExit(
            f"log says {meta['sampleRate']} Hz but the WAV is {sr} Hz — mismatched files?"
        )
    return log, audio, sr, zero


def slice_turn(audio, sr, zero, turn):
    """Cut a turn's audio using the API's own word timestamps."""
    words = turn.get("words") or []
    if not words:
        return None
    start_ms = words[0].get("start")
    end_ms = words[-1].get("end")
    if start_ms is None or end_ms is None:
        return None
    a = zero + int(start_ms * sr / 1000)
    b = zero + int(end_ms * sr / 1000)
    a, b = max(0, a), min(len(audio), b)
    return audio[a:b] if b > a else None


def to_16k(chunk, sr):
    if sr == TARGET_SR:
        return chunk
    # resample_poly keeps it exact for integer ratios (48k -> 16k is 1/3)
    # and avoids the drift a naive stride would introduce.
    from math import gcd

    g = gcd(int(sr), TARGET_SR)
    return resample_poly(chunk, TARGET_SR // g, int(sr) // g)


def embed(model, chunk, sr, tmpdir):
    chunk = to_16k(chunk, sr)
    if len(chunk) < TARGET_SR * 0.1:  # under 100ms there is nothing to embed
        return None
    path = Path(tmpdir) / "seg.wav"
    sf.write(path, chunk, TARGET_SR)
    with torch.no_grad():
        emb = model.get_embedding(str(path))
    v = emb.squeeze().cpu().numpy()
    n = np.linalg.norm(v)
    return v / n if n else None


def cosine(a, b):
    return float(np.dot(a, b))  # both are already unit-normalised


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    log_path, wav_path = Path(sys.argv[1]), Path(sys.argv[2])
    log, audio, sr, zero = load_session(log_path, wav_path)

    from nemo.collections.asr.models import EncDecSpeakerLabelModel

    print("loading TitaNet…")
    model = EncDecSpeakerLabelModel.from_pretrained(
        "nvidia/speakerverification_en_titanet_large"
    )
    model.eval()
    if torch.cuda.is_available():
        model = model.cuda()
        print(f"  on {torch.cuda.get_device_name(0)}")

    turns = [t for t in log["turns"] if not t.get("_discarded")]

    with tempfile.TemporaryDirectory() as tmp:
        # --- enroll -----------------------------------------------------
        # The calibration block: long, alternating, known speaker. Average
        # several embeddings per person rather than trusting one clip.
        enroll_pool = defaultdict(list)
        enrolled_turns = set()
        for t in turns:
            exp = t.get("_expected") or {}
            who = exp.get("speaker")
            if not who or (t.get("_durationMs") or 0) < 2000:
                continue
            if len(enroll_pool[who]) >= 3:
                continue
            chunk = slice_turn(audio, sr, zero, t)
            if chunk is None:
                continue
            v = embed(model, chunk, sr, tmp)
            if v is not None:
                enroll_pool[who].append(v)
                # Scoring a clip against an enrollment it is part of is
                # leakage — it would flatter TitaNet against AssemblyAI,
                # which never saw a reference at all. Held out below.
                enrolled_turns.add(t["turn_order"])

        if len(enroll_pool) < 2:
            raise SystemExit(
                "need at least two speakers with a 2s+ utterance to enroll from."
            )

        enrolled = {}
        for who, vs in enroll_pool.items():
            m = np.mean(vs, axis=0)
            enrolled[who] = m / np.linalg.norm(m)
            print(f"enrolled {who} from {len(vs)} clip(s)")

        names = sorted(enrolled)
        print(
            f"enrollment separation (cosine between {names[0]} and {names[1]}): "
            f"{cosine(enrolled[names[0]], enrolled[names[1]]):.3f}"
            "   (lower is better; >0.6 means the voices are hard to tell apart)"
        )

        # --- identify ---------------------------------------------------
        rows = []
        for t in turns:
            exp = t.get("_expected") or {}
            truth = exp.get("speaker")
            if not truth:
                continue  # trap lines have no owner
            chunk = slice_turn(audio, sr, zero, t)
            v = embed(model, chunk, sr, tmp) if chunk is not None else None
            if v is None:
                rows.append({"turn": t["turn_order"], "truth": truth, "titanet": None,
                             "score": 0.0, "dur": t.get("_durationMs"),
                             "aai": t.get("speaker_label"), "text": t.get("transcript")})
                continue
            scored = sorted(
                ((cosine(v, e), who) for who, e in enrolled.items()), reverse=True
            )
            (best_s, best_who), (next_s, _) = scored[0], scored[1]
            rows.append({
                "turn": t["turn_order"], "truth": truth, "titanet": best_who,
                "score": best_s, "margin": best_s - next_s,
                "dur": t.get("_durationMs"), "aai": t.get("speaker_label"),
                "text": t.get("transcript"),
                "enrolled": t["turn_order"] in enrolled_turns,
            })

    # --- compare --------------------------------------------------------
    # AssemblyAI's labels are arbitrary letters; learn the mapping from
    # ground truth the same way the JS scorer does, so the comparison is
    # fair rather than an artefact of which letter got handed out first.
    counts = defaultdict(lambda: defaultdict(int))
    for r in rows:
        if r["aai"] and r["aai"] != "PENDING":
            counts[r["truth"]][r["aai"]] += 1
    aai_map = {
        who: max(c.items(), key=lambda kv: kv[1])[0] for who, c in counts.items()
    }

    def acc(subset, key):
        judged = [r for r in subset if r[key]]
        if not judged:
            return None, 0
        if key == "aai":
            ok = sum(1 for r in judged if r["aai"] == aai_map.get(r["truth"]))
        else:
            ok = sum(1 for r in judged if r["titanet"] == r["truth"])
        return round(100 * ok / len(judged), 1), len(judged)

    held = [r for r in rows if not r.get("enrolled")]
    short = [r for r in held if (r["dur"] or 0) < SHORT_MS]
    long_ = [r for r in held if (r["dur"] or 0) >= SHORT_MS]
    print(
        f"\nheld out {len(rows) - len(held)} enrollment clips; "
        f"scoring {len(held)} turns"
    )

    print("\n" + "=" * 66)
    print(f"{'':22}{'AssemblyAI':>14}{'TitaNet':>14}")
    print("=" * 66)
    for label, subset in (("all utterances", held), (f"short (<{SHORT_MS}ms)", short),
                          (f"long (>={SHORT_MS}ms)", long_)):
        a, an = acc(subset, "aai")
        t_, tn = acc(subset, "titanet")
        print(f"{label:22}{(str(a) + '%') if a is not None else '—':>12} "
              f"{'(n=' + str(an) + ')':<0}{(str(t_) + '%') if t_ is not None else '—':>8} "
              f"(n={tn})")

    print("\nturns TitaNet got wrong:")
    bad = [r for r in held if r["titanet"] and r["titanet"] != r["truth"]]
    if not bad:
        print("  none")
    for r in bad:
        print(f"  #{r['turn']:>3} {r['dur']:>5}ms  {r['truth']}->{r['titanet']} "
              f"score {r['score']:.3f} margin {r.get('margin', 0):.3f}  "
              f"{json.dumps(r['text'])[:44]}")

    out = log_path.with_name(log_path.stem + "-titanet.json")
    out.write_text(json.dumps({"aai_map": aai_map, "rows": rows}, indent=2), encoding="utf-8")
    print(f"\nper-turn detail -> {out}")


if __name__ == "__main__":
    main()
