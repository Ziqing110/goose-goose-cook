"""Turn a phone recording into what the replay harness expects.

48 kHz, mono, 16-bit PCM WAV — the same shape the browser sends. The
harness refuses anything else on purpose, because a stereo or 24-bit file
transcribes to silence with no error and that is an hour nobody gets back.

    .venv-voice\\Scripts\\python.exe scripts/prep-audio.py recordings/raw/*.wav

Writes alongside as <name>.prepped.wav, or into --out if given. Reads
whatever libsndfile reads: WAV, FLAC, OGG, MP3. It does NOT read m4a/AAC,
which is what iPhone Voice Memos produces — export or share those as WAV
first, or record with an app that writes WAV directly.

Stereo is mixed down rather than rejected: a phone's two channels are the
same room, and the app only ever sends one.
"""

import argparse
import glob
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr

TARGET_RATE = 48000


def prep(src: Path, out_dir: Path | None) -> Path:
    audio, rate = sf.read(str(src), dtype="float32", always_2d=True)
    channels = audio.shape[1]
    mono = audio.mean(axis=1) if channels > 1 else audio[:, 0]

    if rate != TARGET_RATE:
        mono = soxr.resample(mono, rate, TARGET_RATE)

    peak = float(np.max(np.abs(mono))) if mono.size else 0.0
    # Clipping is the one thing worth flagging: it is inaudible on a phone
    # speaker and wrecks both the recogniser and the voiceprint.
    clipped = peak >= 0.999

    pcm = np.clip(mono, -1.0, 1.0)
    dest = (out_dir or src.parent) / f"{src.stem}.prepped.wav"
    sf.write(str(dest), pcm, TARGET_RATE, subtype="PCM_16")

    seconds = len(pcm) / TARGET_RATE
    note = "  ** CLIPPED - re-record further from the mic **" if clipped else ""
    if peak < 0.05:
        note = "  ** very quiet - check the mic was not covered **"
    print(f"{src.name}: {rate} Hz {channels}ch {seconds:5.1f}s  peak {peak:.2f} -> {dest.name}{note}")
    return dest


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+", help="input recordings (globs are fine)")
    ap.add_argument("--out", type=Path, default=None, help="output directory")
    args = ap.parse_args()

    paths = [Path(p) for pattern in args.files for p in sorted(glob.glob(pattern))]
    if not paths:
        print("no input files matched", file=sys.stderr)
        return 1
    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)

    failed = 0
    for path in paths:
        try:
            prep(path, args.out)
        except Exception as err:  # one bad file shouldn't stop a batch
            print(f"{path.name}: FAILED - {err}", file=sys.stderr)
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
